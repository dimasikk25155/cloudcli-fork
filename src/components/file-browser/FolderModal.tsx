import { useCallback, useEffect, useState } from 'react';
import { ArrowUp, Download, Folder, FolderOpen, Loader2, Package } from 'lucide-react';
import JSZip from 'jszip';

import { api } from '../../utils/api';
import { fileDownloadUrl } from '../../utils/fileDownload';
import PanelModal from '../panels/PanelModal';

// Проводник по одной папке.
//
// Нужен ровно для одного сценария: агент положил куда-то файл, а Дима хочет его
// забрать и переслать. До этой панели пути не было — файловое дерево показывает
// только выбранный проект, а папка из сообщения могла лежать где угодно.
// Поэтому здесь не файловый менеджер, а «открыть, посмотреть, скачать».

type Entry = { path: string; name: string; size?: number | null; modified?: string | null };

const formatSize = (size?: number | null): string => {
  if (size == null) return '';
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} МБ`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} ГБ`;
};

const formatDate = (value?: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

export default function FolderModal({
  projectId,
  path,
  onClose,
  onOpenFile,
}: {
  projectId: string;
  path: string;
  onClose: () => void;
  onOpenFile: (filePath: string) => void;
}) {
  const [currentPath, setCurrentPath] = useState(path);
  const [parent, setParent] = useState<string | null>(null);
  const [folders, setFolders] = useState<Entry[]>([]);
  const [files, setFiles] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);

  useEffect(() => {
    setCurrentPath(path);
  }, [path]);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.browseFolder(target);
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось открыть папку');
      }
      setFolders(data.suggestions ?? []);
      setFiles(data.files ?? []);
      setParent(data.parent ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setFolders([]);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(currentPath);
  }, [currentPath, load]);

  // Архив собирается только из файлов этой папки — без вложенных. Так честнее:
  // рекурсивный обход чужого дерева легко упирается в гигабайты node_modules.
  const downloadAllAsZip = useCallback(async () => {
    setZipping(true);
    setError(null);
    try {
      const zip = new JSZip();
      for (const file of files) {
        const response = await api.readFileBlob(projectId, file.path);
        if (!response.ok) throw new Error(`Не смог прочитать «${file.name}»`);
        zip.file(file.name, await response.arrayBuffer());
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${currentPath.split(/[\\/]/).filter(Boolean).pop() || 'files'}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (zipError) {
      setError(zipError instanceof Error ? zipError.message : String(zipError));
    } finally {
      setZipping(false);
    }
  }, [currentPath, files, projectId]);

  return (
    <PanelModal title="Папка" icon={FolderOpen} onClose={onClose}>
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="min-w-0 flex-1 break-all text-xs text-muted-foreground">{currentPath}</span>
          {parent && (
            <button
              onClick={() => setCurrentPath(parent)}
              className="flex min-h-[34px] items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowUp className="h-3.5 w-3.5" />
              Наверх
            </button>
          )}
          {files.length > 0 && (
            <button
              onClick={() => void downloadAllAsZip()}
              disabled={zipping}
              className="flex min-h-[34px] items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
              Файлы папки архивом ({files.length})
            </button>
          )}
        </div>

        {error && (
          <div className="mx-4 mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-300">
            {error}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : folders.length === 0 && files.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">Папка пустая.</div>
          ) : (
            <div className="space-y-0.5">
              {folders.map((folder) => (
                <button
                  key={folder.path}
                  onClick={() => setCurrentPath(folder.path)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent"
                >
                  <Folder className="h-4 w-4 flex-shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{folder.name}</span>
                </button>
              ))}

              {files.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-accent/60"
                >
                  <button
                    onClick={() => onOpenFile(file.path)}
                    className="flex min-w-0 flex-1 flex-col items-start text-left"
                  >
                    <span className="w-full truncate text-sm text-foreground">{file.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {[formatSize(file.size), formatDate(file.modified)].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                  {/* Обычная ссылка, а не fetch: браузер сам покажет прогресс и
                      сохранит файл своим менеджером загрузок — это важно на телефоне. */}
                  <a
                    href={fileDownloadUrl(projectId, file.path)}
                    download={file.name}
                    className="flex min-h-[34px] flex-shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Скачать
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PanelModal>
  );
}
