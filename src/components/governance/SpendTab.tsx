import {
  ACTOR_LABELS,
  formatMoscowTime,
  formatTokens,
  formatUsd,
  projectName,
  type SpendSummary,
} from './types';

// Деньги. Пока ничего не блокируется — это витрина, на которую потом встанет
// потолок трат. Числа те же самые, что будет сравнивать спенд-кап, поэтому
// когда он появится, сюрприза не будет.

function Window({
  title,
  usd,
  runs,
  tokensIn,
  tokensOut,
  hint,
}: {
  title: string;
  usd: number;
  runs: number;
  tokensIn: number;
  tokensOut: number;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] text-muted-foreground">{title}</p>
      <p className="mt-1 text-2xl tabular-nums text-foreground">{formatUsd(usd)}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {runs} {runs === 1 ? 'прогон' : 'прогонов'} · вход {formatTokens(tokensIn)} · выход{' '}
        {formatTokens(tokensOut)}
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground/70">{hint}</p>
    </div>
  );
}

export default function SpendTab({ spend }: { spend: SpendSummary | null }) {
  if (!spend) {
    return <p className="py-8 text-center text-xs text-muted-foreground">Данных о тратах пока нет.</p>;
  }

  const nothingPriced = spend.week.usd === 0 && spend.week.runs > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Window
          title={`Сегодня (${spend.day})`}
          usd={spend.today.usd}
          runs={spend.today.runs}
          tokensIn={spend.today.tokensIn}
          tokensOut={spend.today.tokensOut}
          hint="Московские сутки"
        />
        <Window
          title="За неделю"
          usd={spend.week.usd}
          runs={spend.week.runs}
          tokensIn={spend.week.tokensIn}
          tokensOut={spend.week.tokensOut}
          hint="Последние 7 суток, включая сегодня"
        />
      </div>

      <p className="text-[11px] text-muted-foreground">
        Цена — сколько стоила бы та же работа по прайсу API, не по подписке. Кэш дешевле свежего
        входа, поэтому сумма меньше, чем «все токены × цена входа».
      </p>

      {nothingPriced && (
        <p className="rounded-lg border border-border bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
          Прогоны за неделю есть, а цена нулевая: скорее всего работа шла на движке без
          опубликованных тарифов (Kimi, Gemini). Токены такие прогоны пишут, цену — нет.
        </p>
      )}

      <section>
        <h3 className="mb-1.5 text-xs text-foreground">Самые дорогие прогоны за неделю</h3>
        {spend.topRuns.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Пока пусто.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {spend.topRuns.map((run) => (
              <div
                key={run.runId ?? run.ts}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-[11px]"
              >
                <span className="w-[86px] flex-shrink-0 tabular-nums text-muted-foreground">
                  {formatMoscowTime(run.ts)}
                </span>
                <span className="w-[110px] flex-shrink-0 text-muted-foreground">
                  {ACTOR_LABELS[run.actor] ?? run.actor}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {projectName(run.projectPath)}
                  {run.model && <span className="ml-2 text-muted-foreground">{run.model}</span>}
                </span>
                <span className="flex-shrink-0 tabular-nums text-foreground">{formatUsd(run.usd)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-xs text-foreground">По проектам за неделю</h3>
        {spend.byProject.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Пока пусто.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {spend.byProject.map((entry) => (
              <div
                key={entry.projectId ?? entry.projectPath ?? 'unknown'}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-[11px]"
              >
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {projectName(entry.projectPath)}
                </span>
                <span className="flex-shrink-0 text-muted-foreground">
                  {entry.runs} {entry.runs === 1 ? 'прогон' : 'прогонов'}
                </span>
                <span className="hidden flex-shrink-0 text-muted-foreground sm:inline">
                  вход {formatTokens(entry.tokensIn ?? 0)} · выход {formatTokens(entry.tokensOut ?? 0)}
                </span>
                <span className="w-[70px] flex-shrink-0 text-right tabular-nums text-foreground">
                  {formatUsd(entry.usd)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
