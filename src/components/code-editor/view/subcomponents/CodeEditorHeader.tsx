import { Code2, Download, Eye, Link2, Loader2, Maximize2, Minimize2, Save, Settings as SettingsIcon, X } from 'lucide-react';

import type { CodeEditorFile } from '../../types/types';

type CodeEditorHeaderProps = {
  file: CodeEditorFile;
  isSidebar: boolean;
  isFullscreen: boolean;
  isMarkdownFile: boolean;
  isHtmlPreviewFile: boolean;
  markdownPreview: boolean;
  saving: boolean;
  saveSuccess: boolean;
  onToggleMarkdownPreview: () => void;
  onOpenHtmlPreview: () => void;
  onOpenSettings: () => void;
  onDownload: () => void;
  onShareLink?: () => void;
  shareBusy?: boolean;
  onSave: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
  labels: {
    showingChanges: string;
    editMarkdown: string;
    previewMarkdown: string;
    previewHtml: string;
    settings: string;
    download: string;
    save: string;
    saving: string;
    saved: string;
    fullscreen: string;
    exitFullscreen: string;
    close: string;
  };
};

export default function CodeEditorHeader({
  file,
  isSidebar,
  isFullscreen,
  isMarkdownFile,
  isHtmlPreviewFile,
  markdownPreview,
  saving,
  saveSuccess,
  onToggleMarkdownPreview,
  onOpenHtmlPreview,
  onOpenSettings,
  onDownload,
  onShareLink,
  shareBusy = false,
  onSave,
  onToggleFullscreen,
  onClose,
  labels,
}: CodeEditorHeaderProps) {
  const saveTitle = saveSuccess ? labels.saved : saving ? labels.saving : labels.save;

  return (
    <div className="flex min-w-0 flex-shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
      {/* File info - can shrink */}
      <div className="flex min-w-0 flex-1 shrink items-center gap-2">
        <div className="min-w-0 shrink">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-medium text-foreground">{file.name}</h3>
            {file.diffInfo && (
              <span className="shrink-0 whitespace-nowrap rounded-ui-sm bg-info/15 px-1.5 py-0.5 text-[10px] text-info">
                {labels.showingChanges}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">{file.path}</p>
        </div>
      </div>

      {/* Buttons - don't shrink, always visible */}
      <div className="flex shrink-0 items-center gap-0.5">
        {isMarkdownFile && (
          <button
            type="button"
            onClick={onToggleMarkdownPreview}
            className={`flex items-center justify-center rounded-ui-md p-1.5 transition-colors duration-fast ease-ui ${
              markdownPreview
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
            title={markdownPreview ? labels.editMarkdown : labels.previewMarkdown}
          >
            {markdownPreview ? <Code2 className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}

        {isHtmlPreviewFile && (
          <button
            type="button"
            onClick={onOpenHtmlPreview}
            className="flex items-center justify-center rounded-ui-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title={labels.previewHtml}
          >
            <Eye className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center justify-center rounded-ui-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title={labels.settings}
        >
          <SettingsIcon className="h-4 w-4" />
        </button>

        {/* Скачать и «ссылка для друга» — с подписями: это то, ради чего файл
            чаще всего и открывают, а голую иконку на телефоне никто не находит. */}
        <button
          type="button"
          onClick={onDownload}
          className="flex min-h-[32px] items-center gap-1.5 rounded-ui-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={labels.download}
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Скачать</span>
        </button>

        {onShareLink && (
          <button
            type="button"
            onClick={onShareLink}
            disabled={shareBusy}
            className="flex min-h-[32px] items-center gap-1.5 rounded-ui-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            title="Ссылка для друга — работает сутки, вход в Neo3 не нужен"
          >
            {shareBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Ссылка</span>
          </button>
        )}

        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className={`flex items-center justify-center rounded-ui-md p-1.5 transition-colors duration-fast ease-ui disabled:opacity-50 ${
            saveSuccess
              ? 'bg-success/10 text-success'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
          title={saveTitle}
        >
          {saveSuccess ? (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <Save className="h-4 w-4" />
          )}
        </button>

        {!isSidebar && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="flex items-center justify-center rounded-ui-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title={isFullscreen ? labels.exitFullscreen : labels.fullscreen}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center rounded-ui-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title={labels.close}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
