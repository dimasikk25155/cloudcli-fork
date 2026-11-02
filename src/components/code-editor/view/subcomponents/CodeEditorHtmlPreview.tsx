import React from 'react';

type Props = {
  url: string | null;
  name: string;
  error: string | null;
  onRetry: () => void;
  hasRootReferences: boolean;
};

export default function CodeEditorHtmlPreview({ url, name, error, onRetry, hasRootReferences }: Props) {
  return (
    <div className="flex h-full flex-col bg-white">
      {hasRootReferences && (
        <p className="border-b bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Страница использует адреса от корня сайта. Если часть оформления не загрузилась, откройте запущенный сайт.
        </p>
      )}
      {error ? (
        <div role="alert" className="m-auto space-y-3 p-6 text-center text-gray-900">
          <p>{error}</p>
          <button type="button" onClick={onRetry} className="rounded border px-3 py-2">Повторить</button>
        </div>
      ) : url ? (
        <iframe title={`Превью: ${name}`} src={url} sandbox="allow-scripts" referrerPolicy="no-referrer" className="min-h-0 w-full flex-1 border-0" />
      ) : <p role="status" className="m-auto p-6 text-gray-700">Открываем страницу…</p>}
    </div>
  );
}
