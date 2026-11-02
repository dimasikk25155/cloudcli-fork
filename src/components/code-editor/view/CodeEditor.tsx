import { EditorView } from '@codemirror/view';
import { unifiedMergeView } from '@codemirror/merge';
import type { Extension } from '@codemirror/state';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { defaultDocumentPreview } from '../utils/documentPreview';
import { useHtmlPreview } from '../hooks/useHtmlPreview';
import { usePaletteOps } from '../../../contexts/PaletteOpsContext';
import { useTheme } from '../../../contexts/ThemeContext';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { useCodeEditorDocument } from '../hooks/useCodeEditorDocument';
import { useCodeEditorSettings } from '../hooks/useCodeEditorSettings';
import { useEditorKeyboardShortcuts } from '../hooks/useEditorKeyboardShortcuts';
import type { CodeEditorFile } from '../types/types';
import { createMinimapExtension, createScrollToFirstChunkExtension, getLanguageExtensions } from '../utils/editorExtensions';
import { getEditorStyles } from '../utils/editorStyles';
import { createEditorToolbarPanelExtension } from '../utils/editorToolbarPanel';

import CodeEditorHtmlPreview from './subcomponents/CodeEditorHtmlPreview';
import CodeEditorFooter from './subcomponents/CodeEditorFooter';
import CodeEditorHeader from './subcomponents/CodeEditorHeader';
import CodeEditorLoadingState from './subcomponents/CodeEditorLoadingState';
import CodeEditorSurface from './subcomponents/CodeEditorSurface';
import CodeEditorBinaryFile from './subcomponents/CodeEditorBinaryFile';
import CodeEditorMediaPreview from './subcomponents/CodeEditorMediaPreview';

type CodeEditorProps = {
  file: CodeEditorFile;
  onClose: () => void;
  projectPath?: string;
  isSidebar?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (() => void) | null;
  onPopOut?: (() => void) | null;
};

function CodeEditorDocument({
  file,
  onClose,
  projectPath,
  isSidebar = false,
  isExpanded = false,
  onToggleExpand = null,
  onPopOut = null,
}: CodeEditorProps) {
  const { t } = useTranslation('codeEditor');
  const paletteOps = usePaletteOps();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showDiff, setShowDiff] = useState(Boolean(file.diffInfo));
  // Markdown открывается сразу читаемым видом: файл открывают, чтобы понять,
  // что в нём, а решётки и звёздочки этому мешают. Правка — в одно нажатие.
  const [markdownPreview, setMarkdownPreview] = useState(() => defaultDocumentPreview(file) === 'markdown');

  const [htmlPreview, setHtmlPreview] = useState(() => defaultDocumentPreview(file) === 'html');

  // The code editor follows the app-wide theme; it has no theme of its own.
  const { isDarkMode } = useTheme();

  const {
    wordWrap,
    minimapEnabled,
    showLineNumbers,
    fontSize,
  } = useCodeEditorSettings();

  const {
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
    dismissShareResult,
  } = useCodeEditorDocument({
    file,
    projectPath,
  });

  // «Копировать» забирает весь файл в буфер: выделять текст руками на телефоне
  // почти невозможно, а файлы открывают в том числе чтобы вставить их куда-то.
  const [copySuccess, setCopySuccess] = useState(false);
  const handleCopyContent = useCallback(async () => {
    const copied = await copyTextToClipboard(content);
    if (copied) {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  }, [content]);

  const isMarkdownFile = useMemo(() => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    return extension === 'md' || extension === 'markdown';
  }, [file.name]);

  const isHtmlPreviewFile = useMemo(() => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    return extension === 'html' || extension === 'htm';
  }, [file.name]);

  const html = useHtmlPreview(fileProjectId, resolvedPath, isHtmlPreviewFile && !file.diffInfo && !loading);
  const openHtmlPreview = useCallback(() => {
    if (html.url) window.open(html.url, '_blank', 'noopener,noreferrer');
  }, [html.url]);

  const minimapExtension = useMemo(
    () => (
      createMinimapExtension({
        file,
        showDiff,
        minimapEnabled,
        isDarkMode,
      })
    ),
    [file, isDarkMode, minimapEnabled, showDiff],
  );

  const scrollToFirstChunkExtension = useMemo(
    () => createScrollToFirstChunkExtension({ file, showDiff }),
    [file, showDiff],
  );

  const toolbarPanelExtension = useMemo(
    () => (
      createEditorToolbarPanelExtension({
        file,
        showDiff,
        isSidebar,
        isExpanded,
        onToggleDiff: () => setShowDiff((previous) => !previous),
        onPopOut,
        onToggleExpand,
        labels: {
          changes: t('toolbar.changes'),
          previousChange: t('toolbar.previousChange'),
          nextChange: t('toolbar.nextChange'),
          hideDiff: t('toolbar.hideDiff'),
          showDiff: t('toolbar.showDiff'),
          collapse: t('toolbar.collapse'),
          expand: t('toolbar.expand'),
        },
      })
    ),
    [file, isExpanded, isSidebar, onPopOut, onToggleExpand, showDiff, t],
  );

  const extensions = useMemo(() => {
    const allExtensions: Extension[] = [
      ...getLanguageExtensions(file.name),
      ...toolbarPanelExtension,
    ];

    if (file.diffInfo && showDiff && file.diffInfo.old_string !== undefined) {
      allExtensions.push(
        unifiedMergeView({
          original: file.diffInfo.old_string,
          mergeControls: false,
          highlightChanges: true,
          syntaxHighlightDeletions: false,
          gutter: true,
        }),
      );
      allExtensions.push(...minimapExtension);
      allExtensions.push(...scrollToFirstChunkExtension);
    }

    if (wordWrap) {
      allExtensions.push(EditorView.lineWrapping);
    }

    return allExtensions;
  }, [
    file.diffInfo,
    file.name,
    minimapExtension,
    scrollToFirstChunkExtension,
    showDiff,
    toolbarPanelExtension,
    wordWrap,
  ]);

  useEditorKeyboardShortcuts({
    onSave: handleSave,
    onClose,
    dependency: content,
  });

  if (loading) {
    return (
      <CodeEditorLoadingState
        isDarkMode={isDarkMode}
        isSidebar={isSidebar}
        loadingText={t('loading', { fileName: file.name })}
      />
    );
  }

  // Natively previewable media (image/pdf/audio/video) is rendered inline
  // instead of showing the generic "cannot be displayed" placeholder.
  if (previewKind) {
    return (
      <CodeEditorMediaPreview
        file={file}
        kind={previewKind}
        projectId={fileProjectId}
        isSidebar={isSidebar}
        isFullscreen={isFullscreen}
        onClose={onClose}
        onToggleFullscreen={() => setIsFullscreen((previous) => !previous)}
        labels={{
          loading: t('filePreview.loading', 'Loading preview...'),
          error: t('filePreview.error', 'Unable to display this file.'),
          openInNewTab: t('filePreview.openInNewTab', 'Open in new tab'),
          fullscreen: t('actions.fullscreen', 'Fullscreen'),
          exitFullscreen: t('actions.exitFullscreen', 'Exit fullscreen'),
          close: t('actions.close', 'Close'),
        }}
      />
    );
  }

  // Binary file display
  if (isBinary) {
    return (
      <CodeEditorBinaryFile
        file={file}
        isSidebar={isSidebar}
        isFullscreen={isFullscreen}
        onClose={onClose}
        onToggleFullscreen={() => setIsFullscreen((previous) => !previous)}
        onDownload={handleDownload}
        onShareLink={fileProjectId ? () => void handleShareLink() : undefined}
        shareBusy={shareBusy}
        shareResult={shareResult}
        title={t('binaryFile.title', 'Binary File')}
        message={t('binaryFile.message', 'The file "{{fileName}}" cannot be displayed in the text editor because it is a binary file.', { fileName: file.name })}
      />
    );
  }

  const outerContainerClassName = isSidebar
    ? 'w-full h-full flex flex-col'
    : `fixed inset-0 z-[9999] md:bg-black/50 md:flex md:items-center md:justify-center md:p-4 ${isFullscreen ? 'md:p-0' : ''}`;

  const innerContainerClassName = isSidebar
    ? 'bg-background flex flex-col w-full h-full'
    : `bg-background shadow-2xl flex flex-col w-full h-full md:rounded-lg md:shadow-2xl${
      isFullscreen ? ' md:w-full md:h-full md:rounded-none' : ' md:w-full md:max-w-6xl md:h-[80vh] md:max-h-[80vh]'
    }`;

  return (
    <>
      <style>{getEditorStyles(isDarkMode)}</style>
      <div className={outerContainerClassName}>
        <div className={innerContainerClassName}>
          <CodeEditorHeader
            file={file}
            isSidebar={isSidebar}
            isFullscreen={isFullscreen}
            isMarkdownFile={isMarkdownFile}
            isHtmlPreviewFile={isHtmlPreviewFile && !file.diffInfo}
            htmlPreview={htmlPreview}
            htmlPreviewReady={Boolean(html.url)}
            onToggleHtmlPreview={() => { setHtmlPreview((previous) => !previous); html.retry(); }}
            markdownPreview={markdownPreview}
            saving={saving}
            saveSuccess={saveSuccess}
            onToggleMarkdownPreview={() => setMarkdownPreview((previous) => !previous)}
            onOpenHtmlPreview={openHtmlPreview}
            onOpenSettings={() => paletteOps.openSettings('appearance')}
            onCopyContent={() => void handleCopyContent()}
            copySuccess={copySuccess}
            onDownload={handleDownload}
            onShareLink={fileProjectId ? () => void handleShareLink() : undefined}
            shareBusy={shareBusy}
            onSave={handleSave}
            onToggleFullscreen={() => setIsFullscreen((previous) => !previous)}
            onClose={onClose}
            labels={{
              showingChanges: t('header.showingChanges'),
              editMarkdown: t('actions.editMarkdown'),
              previewMarkdown: t('actions.previewMarkdown'),
              previewHtml: t('actions.previewHtml', 'Open HTML preview in new tab'),
              settings: t('toolbar.settings'),
              download: t('actions.download'),
              save: t('actions.save'),
              saving: t('actions.saving'),
              saved: t('actions.saved'),
              fullscreen: t('actions.fullscreen'),
              exitFullscreen: t('actions.exitFullscreen'),
              close: t('actions.close'),
            }}
          />

          {saveError && (
            <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
              {saveError}
            </div>
          )}

          {shareResult && (
            <div
              className={`flex items-start gap-2 border-b px-3 py-1.5 text-xs ${
                shareResult.ok
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
              }`}
            >
              <span className="min-w-0 flex-1 break-all">{shareResult.text}</span>
              <button className="flex-shrink-0 opacity-60 hover:opacity-100" onClick={dismissShareResult}>
                ✕
              </button>
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {htmlPreview && isHtmlPreviewFile ? (
              <CodeEditorHtmlPreview url={html.url} name={file.name} error={html.error} onRetry={html.retry}
                hasRootReferences={/(?:src|href|action)\s*=\s*["']\/(?!\/)|url\(\s*["']?\/(?!\/)/i.test(content)} />
            ) : <CodeEditorSurface
              content={content}
              onChange={setContent}
              markdownPreview={markdownPreview}
              isMarkdownFile={isMarkdownFile}
              isDarkMode={isDarkMode}
              fontSize={fontSize}
              showLineNumbers={showLineNumbers}
              extensions={extensions}
            />}
          </div>

          <CodeEditorFooter
            content={content}
            linesLabel={t('footer.lines')}
            charactersLabel={t('footer.characters')}
            shortcutsLabel={t('footer.shortcuts')}
          />
        </div>
      </div>
    </>
  );
}

// A different file is a different document: reset preview, buffers and pending requests together.
export default function CodeEditor(props: CodeEditorProps) {
  return <CodeEditorDocument key={`${props.file.projectId ?? props.projectPath}:${props.file.path}:${Boolean(props.file.diffInfo)}`} {...props} />;
}
