import { Download, FileQuestion, FolderOpen, MessageSquarePlus } from 'lucide-react';

import { fileDownloadUrl } from '../../utils/fileDownload';
import { sendToComposer } from '../../utils/composerDraft';
import PanelModal from '../panels/PanelModal';

// Экран «такого файла нет».
//
// Раньше на его месте был редактор с текстом `// Error loading file: 404`, то
// есть сообщение об ошибке, притворяющееся содержимым файла. Человеку с него
// нечего взять. Здесь тот же факт, но словами и с выходом: почти всегда путь
// ошибочен в середине, а файл с таким именем лежит рядом — сервер его уже нашёл.

export type PathMatch = { path: string; name: string; size?: number | null; mtime?: number | null };

const formatSize = (size?: number | null): string => {
  if (size == null) return '';
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
};

export default function MissingFileModal({
  projectId,
  reference,
  matches,
  onOpenFile,
  onOpenFolder,
  onClose,
}: {
  projectId: string;
  reference: string;
  matches: PathMatch[];
  onOpenFile: (filePath: string) => void;
  onOpenFolder: (dirPath: string) => void;
  onClose: () => void;
}) {
  const parentFolder = reference.replace(/[\\/][^\\/]*$/, '') || '/';
  const fileName = reference.split(/[\\/]/).pop() || reference;

  const askAgent = () => {
    sendToComposer(
      `Ссылка на файл не открывается: ${reference}\n` +
        'Проверь, где он на самом деле лежит (или создай его, если ещё не создан), и скажи точный путь.',
    );
    onClose();
  };

  return (
    <PanelModal title="Файл не найден" icon={FileQuestion} onClose={onClose}>
      <div className="space-y-4 p-4">
        <div className="rounded-xl border border-border bg-card p-3.5">
          <div className="text-sm font-medium text-foreground">Такого файла на сервере нет</div>
          <div className="mt-1.5 break-all rounded-lg bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
            {reference}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Обычно это значит одно из двух: агент назвал путь до того, как создал файл, — или файл лежит
            в другом месте.
          </div>
        </div>

        {matches.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-3.5">
            <div className="mb-2 text-sm font-medium text-foreground">
              Файлы с именем «{fileName}» нашлись здесь
            </div>
            <div className="space-y-1">
              {matches.map((match) => (
                <div key={match.path} className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-accent/60">
                  <button
                    onClick={() => onOpenFile(match.path)}
                    className="flex min-w-0 flex-1 flex-col items-start text-left"
                  >
                    <span className="w-full break-all text-xs text-foreground">{match.path}</span>
                    {match.size != null && (
                      <span className="text-[11px] text-muted-foreground">{formatSize(match.size)}</span>
                    )}
                  </button>
                  <a
                    href={fileDownloadUrl(projectId, match.path)}
                    download={match.name}
                    className="flex min-h-[34px] flex-shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Скачать
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onOpenFolder(parentFolder)}
            className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <FolderOpen className="h-4 w-4" />
            Открыть папку
          </button>
          <button
            onClick={askAgent}
            className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-primary/50 px-3 py-2 text-xs text-foreground transition-colors hover:bg-primary/10"
          >
            <MessageSquarePlus className="h-4 w-4" />
            Спросить агента
          </button>
        </div>
      </div>
    </PanelModal>
  );
}
