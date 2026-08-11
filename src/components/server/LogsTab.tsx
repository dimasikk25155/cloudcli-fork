import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, Download, Loader2, RefreshCw } from 'lucide-react';

import { ActionButton, Empty } from './ui';
import { HEALTH_STYLE, readJson, type LogLine, type ServiceInfo } from './shared';

// Логи сервиса. Задача вкладки — чтобы человек за секунду увидел ПОСЛЕДНЮЮ
// ошибку, а не «выберите сервис» на пустом экране.
//
// Два неочевидных момента, стоивших крови:
//  1. Половина ботов пишет не в журнал, а в свой файл — сервер это понимает и
//     сам подставляет файл, вкладка лишь честно подписывает источник.
//  2. У падающего бота 90% журнала — служебные «restart counter is at N».
//     По умолчанию они скрыты, иначе настоящая ошибка тонет в шуме.

const LEVELS = [
  ['info', 'Всё'],
  ['warn', 'Предупреждения'],
  ['error', 'Только ошибки'],
] as const;

type Level = (typeof LEVELS)[number][0];

export default function LogsTab({
  services,
  initialUnit,
  onFeedback,
}: {
  services: ServiceInfo[];
  initialUnit: string | null;
  onFeedback: (feedback: { ok: boolean; text: string }) => void;
}) {
  const [unit, setUnit] = useState<string | null>(initialUnit);
  const [level, setLevel] = useState<Level>('info');
  const [system, setSystem] = useState(false);
  const [follow, setFollow] = useState(false);
  const [lineCount, setLineCount] = useState(300);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<{ lines: LogLine[]; note?: string; source?: string; path?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Родитель мог прислать сервис позже (кнопка «Логи» из карточки аварии).
  useEffect(() => {
    if (initialUnit) setUnit(initialUnit);
  }, [initialUnit]);

  const load = useCallback(
    async (quiet = false) => {
      if (!unit) return;
      if (!quiet) setLoading(true);
      try {
        const result = await readJson(
          `/api/vps/logs/${encodeURIComponent(unit)}?lines=${lineCount}&level=${level}&system=${system ? 1 : 0}`,
        );
        setData({ lines: result?.lines ?? [], note: result?.note, source: result?.source, path: result?.path });
      } catch (error) {
        setData({ lines: [], note: error instanceof Error ? error.message : String(error) });
      } finally {
        setLoading(false);
      }
    },
    [unit, level, system, lineCount],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // «Живой хвост»: тихое дообновление, чтобы экран не моргал спиннером.
  useEffect(() => {
    if (!follow || !unit) return;
    const timer = setInterval(() => void load(true), 3000);
    return () => clearInterval(timer);
  }, [follow, unit, load]);

  const filtered = search.trim()
    ? (data?.lines ?? []).filter((line) => line.text.toLowerCase().includes(search.trim().toLowerCase()))
    : (data?.lines ?? []);

  // Свежие строки внизу — без автоскролла живой хвост бесполезен.
  useLayoutEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [filtered.length, unit]);

  const asText = () => filtered.map((line) => `${line.ts} ${line.text}`).join('\n');

  const copy = () => {
    void navigator.clipboard?.writeText(asText());
    onFeedback({ ok: true, text: `Скопировано строк: ${filtered.length}` });
  };

  const download = () => {
    const blob = new Blob([asText()], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${unit?.replace(/\.service$/, '') ?? 'logs'}.log`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={unit ?? ''}
          onChange={(event) => setUnit(event.target.value || null)}
          className="min-h-[34px] w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary sm:w-56"
        >
          <option value="">Выберите сервис…</option>
          {services
            .filter((service) => service.own)
            .map((service) => (
              <option key={service.unit} value={service.unit}>
                {service.health === 'up' ? '' : `${HEALTH_STYLE[service.health].label} · `}
                {service.name}
              </option>
            ))}
        </select>

        {LEVELS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setLevel(key)}
            className={`min-h-[34px] rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
              level === key ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
            }`}
          >
            {label}
          </button>
        ))}

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск по строкам"
          className="min-h-[34px] w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary sm:ml-auto sm:w-40"
        />
      </div>

      {unit && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFollow(!follow)}
            className={`flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
              follow
                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                : 'border-border text-muted-foreground hover:bg-accent'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${follow ? 'animate-pulse bg-emerald-500' : 'bg-muted-foreground/50'}`} />
            {follow ? 'Живой хвост включён' : 'Живой хвост'}
          </button>
          <ActionButton icon={RefreshCw} label="Обновить" busy={loading} onClick={() => void load()} />
          <button
            onClick={() => setSystem(!system)}
            className={`min-h-[34px] rounded-lg border border-border px-2.5 py-1.5 text-xs transition-colors ${
              system ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent'
            }`}
            title="Строки самого systemd: «запущен», «остановлен», «перезапуск №N»"
          >
            {system ? 'Служебные видны' : 'Служебные скрыты'}
          </button>
          <button
            onClick={() => setLineCount(lineCount === 300 ? 1000 : 300)}
            className="min-h-[34px] rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            {lineCount} строк
          </button>
          <ActionButton icon={Copy} label="Копировать" onClick={copy} />
          <ActionButton icon={Download} label="Скачать" onClick={download} />
        </div>
      )}

      {!unit ? (
        <Empty text="Выберите сервис, чтобы посмотреть его логи" />
      ) : loading && !data ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {data?.note && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-300">
              {data.note}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>
              строк {filtered.length}
              {search.trim() && ` из ${data?.lines.length ?? 0}`}
            </span>
            {data?.source === 'file' && data.path && <span className="font-mono">файл {data.path}</span>}
            {data?.source === 'journal' && <span>источник: системный журнал</span>}
          </div>

          {filtered.length === 0 ? (
            <Empty
              text={
                search.trim()
                  ? 'По этому запросу ничего нет'
                  : level === 'error'
                    ? 'Ошибок нет — переключитесь на «Всё»'
                    : 'Записей нет'
              }
            />
          ) : (
            <div
              ref={boxRef}
              className="max-h-[55vh] overflow-y-auto rounded-xl border border-border bg-card p-3 font-mono text-[11px] leading-relaxed"
            >
              {filtered.map((line, index) => (
                <div
                  key={index}
                  className={`flex gap-2 ${
                    line.level === 'error'
                      ? 'text-red-500'
                      : line.level === 'warn'
                        ? 'text-amber-500'
                        : line.level === 'system'
                          ? 'text-muted-foreground/50'
                          : 'text-muted-foreground'
                  }`}
                >
                  {line.ts && (
                    // Время без даты: 300 строк лога укладываются в минуты, а
                    // дата съедает половину узкого экрана. Полная метка — в подсказке.
                    <span className="flex-shrink-0 text-muted-foreground/50" title={line.ts}>
                      {line.ts.slice(11, 19) || line.ts.slice(0, 8)}
                    </span>
                  )}
                  <span className="min-w-0 whitespace-pre-wrap break-all">{line.text}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
