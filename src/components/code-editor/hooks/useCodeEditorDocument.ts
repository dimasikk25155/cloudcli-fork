import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../utils/api';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { downloadFile } from '../../../utils/fileDownload';
import type { CodeEditorFile } from '../types/types';
import { isBinaryFile } from '../utils/binaryFile';
import { getPreviewKind } from '../utils/previewableFile';

type UseCodeEditorDocumentParams = {
  file: CodeEditorFile;
  projectPath?: string;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

export const useCodeEditorDocument = ({ file, projectPath }: UseCodeEditorDocumentParams) => {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isBinary, setIsBinary] = useState(false);
  // The server may resolve a reference from chat to a file in another workspace,
  // so it reports back the absolute path it actually read. Saving uses that path
  // instead of re-resolving the ambiguous reference.
  const [resolvedPath, setResolvedPath] = useState(file.path);
  // Some binaries (images, PDFs, audio, video) can be rendered natively, so the
  // editor shows an inline preview instead of the generic binary placeholder.
  const previewKind = getPreviewKind(file.name);
  // `fileProjectId` is the DB primary key passed down from the editor sidebar;
  // the fallback to `projectPath` preserves older callers that didn't yet
  // propagate the identifier.
  const fileProjectId = file.projectId ?? projectPath;
  const filePath = file.path;
  const fileName = file.name;
  const fileDiffNewString = file.diffInfo?.new_string;
  const fileDiffOldString = file.diffInfo?.old_string;

  useEffect(() => {
    const loadFileContent = async () => {
      try {
        setLoading(true);
        setIsBinary(false);
        setResolvedPath(filePath);

        // Natively previewable media (image/pdf/audio/video) is rendered by
        // CodeEditorMediaPreview, so there is nothing to read as text here.
        // Clear any buffer left over from a previously opened text file so a
        // stray save can't write stale content over the binary file.
        if (getPreviewKind(file.name)) {
          setContent('');
          setLoading(false);
          return;
        }

        // Check if file is binary by extension
        if (isBinaryFile(file.name)) {
          setContent('');
          setIsBinary(true);
          setLoading(false);
          return;
        }

        // Diff payload may already include full old/new snapshots, so avoid disk read.
        if (file.diffInfo && fileDiffNewString !== undefined && fileDiffOldString !== undefined) {
          setContent(fileDiffNewString);
          setLoading(false);
          return;
        }

        if (!fileProjectId) {
          throw new Error('Missing project identifier');
        }

        const response = await api.readFile(fileProjectId, filePath);
        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        setContent(data.content);
        if (typeof data.path === 'string' && data.path) {
          setResolvedPath(data.path);
        }
      } catch (error) {
        const message = getErrorMessage(error);
        console.error('Error loading file:', error);
        setContent(`// Error loading file: ${message}\n// File: ${fileName}\n// Path: ${filePath}`);
      } finally {
        setLoading(false);
      }
    };

    loadFileContent();
  }, [file.diffInfo, file.name, fileDiffNewString, fileDiffOldString, fileName, filePath, fileProjectId]);

  const handleSave = useCallback(async () => {
    // Preview-only and binary files have no editable text buffer; never write
    // them back (e.g. via Cmd/Ctrl+S) or we'd corrupt the file on disk.
    if (previewKind || isBinaryFile(fileName)) {
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      if (!fileProjectId) {
        throw new Error('Missing project identifier');
      }

      const response = await api.saveFile(fileProjectId, resolvedPath, content);

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Save failed: ${response.status}`);
        }

        const textError = await response.text();
        console.error('Non-JSON error response:', textError);
        throw new Error(`Save failed: ${response.status} ${response.statusText}`);
      }

      await response.json();

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      const message = getErrorMessage(error);
      console.error('Error saving file:', error);
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  }, [content, resolvedPath, fileProjectId, previewKind, fileName]);

  // Качаем ФАЙЛ С ДИСКА, а не текстовый буфер редактора. Раньше здесь
  // собирался Blob из `content`, и для архива, APK или картинки он пустой:
  // такие файлы редактор вообще не читает. Скачивался пустой файл (а на экране
  // ошибки — текст ошибки, сохранённый под именем файла).
  const handleDownload = useCallback(() => {
    if (fileProjectId) {
      downloadFile(fileProjectId, resolvedPath, fileName);
      return;
    }

    // Остался только просмотр диффа без проекта — там текст и есть весь файл.
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = fileName;

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    URL.revokeObjectURL(url);
  }, [content, fileName, fileProjectId, resolvedPath]);

  // Ссылка для того, у кого нет доступа в Neo3: живёт сутки и ведёт ровно на
  // этот файл. Адрес сразу уезжает в буфер обмена — его остаётся вставить в чат.
  const [shareBusy, setShareBusy] = useState(false);
  const [shareResult, setShareResult] = useState<{ ok: boolean; text: string } | null>(null);

  const handleShareLink = useCallback(async () => {
    if (!fileProjectId) return;

    setShareBusy(true);
    setShareResult(null);
    try {
      const response = await api.createShareLink(fileProjectId, resolvedPath);
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось создать ссылку');
      }

      const url = `${window.location.origin}${data.url}`;
      const copied = await copyTextToClipboard(url);
      setShareResult({
        ok: true,
        text: copied ? 'Ссылка скопирована, живёт сутки' : url,
      });
    } catch (error) {
      setShareResult({ ok: false, text: getErrorMessage(error) });
    } finally {
      setShareBusy(false);
    }
  }, [fileProjectId, resolvedPath]);

  return {
    content,
    setContent,
    loading,
    saving,
    saveSuccess,
    saveError,
    isBinary,
    previewKind,
    fileProjectId,
    resolvedPath,
    handleSave,
    handleDownload,
    handleShareLink,
    shareBusy,
    shareResult,
    dismissShareResult: useCallback(() => setShareResult(null), []),
  };
};
