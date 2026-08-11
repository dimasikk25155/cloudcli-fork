import { useState } from 'react';
import { Bell, BellOff, Copy, Eye, EyeOff, Loader2 } from 'lucide-react';

import { ActionButton, Card } from './ui';
import { type AlertSettings, type AlertsPayload, type ServiceInfo } from './shared';

// Алерты в Телеграм: когда писать, куда писать и о чём молчать.

export default function AlertsTab({
  alerts,
  services,
  saving,
  onPatch,
  onTest,
  onFeedback,
}: {
  alerts: AlertsPayload | null;
  services: ServiceInfo[];
  saving: boolean;
  onPatch: (patch: Partial<AlertSettings>) => void;
  onTest: () => void;
  onFeedback: (feedback: { ok: boolean; text: string }) => void;
}) {
  // Токен спрятан не «на всякий случай»: панель постоянно попадает на
  // скриншоты, а этим токеном чужая машина может слать сюда отчёты.
  const [tokenShown, setTokenShown] = useState(false);

  if (!alerts) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const muted = new Set(alerts.settings.muted);
  const noisy = services.filter((service) => service.health === 'failed' || service.health === 'flapping');
  const mutedMissing = alerts.settings.muted.filter((unit) => !noisy.some((service) => service.unit === unit));

  const toggleMute = (unit: string) => {
    const next = muted.has(unit) ? alerts.settings.muted.filter((item) => item !== unit) : [...alerts.settings.muted, unit];
    onPatch({ muted: next });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-3.5">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={alerts.settings.enabled}
            disabled={saving}
            onChange={(event) => onPatch({ enabled: event.target.checked })}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">Писать в Телеграм, когда что-то ломается</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Раз в минуту проверяю сервисы, диски и другие машины. Сообщение приходит один раз — когда сломалось и
              когда починилось, а не каждую минуту.
            </span>
          </span>
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
          <span className="text-muted-foreground">Чат:</span>
          <span className="font-mono text-foreground">{alerts.chatId ?? 'не выбран'}</span>
          <span className="ml-auto">
            <ActionButton icon={Bell} label="Проверить связь" busy={saving} onClick={onTest} />
          </span>
        </div>
        {!alerts.chatId && (
          <div className="mt-2 text-xs text-amber-600 dark:text-amber-300">
            Чат не привязан. Вставьте токен бота в Настройки → Telegram и напишите боту — он привяжется сам.
          </div>
        )}
      </div>

      <Card title="Когда считать это проблемой">
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['diskPct', 'Диск занят более, %'],
              ['ramPct', 'Память занята более, %'],
              ['restarts', 'Перезапусков подряд'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-xs">
              <span className="mb-1 block text-muted-foreground">{label}</span>
              <input
                type="number"
                className="min-h-[34px] w-full rounded-lg border border-border bg-background px-2.5 py-1.5 outline-none focus:border-primary"
                defaultValue={alerts.settings[key]}
                disabled={saving}
                onBlur={(event) => {
                  const value = Number(event.target.value);
                  if (value !== alerts.settings[key]) onPatch({ [key]: value });
                }}
              />
            </label>
          ))}
        </div>
      </Card>

      <Card title="Что вижу прямо сейчас" count={alerts.problems.length}>
        {alerts.problems.length === 0 ? (
          <div className="text-xs text-muted-foreground">Проблем нет.</div>
        ) : (
          <div className="space-y-1 text-xs">
            {alerts.problems.map((problem) => (
              <div key={problem.key} className="text-foreground">
                {/* Текст размечен для Телеграма — на экране теги не нужны. */}• {problem.text.replace(/<[^>]+>/g, '')}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Сломанный и заведомо неисправимый сейчас сервис не должен долбить в
          чат. Глушилка — рядом со списком проблем, а не в отдельных настройках. */}
      {(noisy.length > 0 || mutedMissing.length > 0) && (
        <Card title="О чём не сообщать" icon={BellOff}>
          <div className="space-y-1.5">
            {noisy.map((service) => (
              <label key={service.unit} className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={muted.has(service.unit)}
                  disabled={saving}
                  onChange={() => toggleMute(service.unit)}
                />
                <span className="text-foreground">{service.name}</span>
                <span className="text-muted-foreground">
                  {muted.has(service.unit) ? 'молчу про него' : 'сообщаю'}
                </span>
              </label>
            ))}
            {mutedMissing.map((unit) => (
              <label key={unit} className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked
                  disabled={saving}
                  onChange={() => toggleMute(unit)}
                />
                <span className="text-muted-foreground">{unit.replace(/\.service$/, '')} — сейчас в порядке</span>
              </label>
            ))}
          </div>
        </Card>
      )}

      <Card title="Отчёты с других машин">
        <div className="text-xs text-muted-foreground">
          Чтобы Windows слала отчёты сюда, а не в старый «Пульт», в её репортёре укажите адрес
          <span className="mx-1 font-mono text-foreground">/api/vps/ingest</span>и этот токен в заголовке{' '}
          <span className="font-mono text-foreground">X-Token</span>:
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-2.5 py-1.5 font-mono text-[11px] text-foreground">
            {tokenShown ? alerts.ingestToken : '•'.repeat(32)}
          </code>
          <ActionButton
            icon={tokenShown ? EyeOff : Eye}
            label={tokenShown ? 'Скрыть' : 'Показать'}
            onClick={() => setTokenShown(!tokenShown)}
          />
          <ActionButton
            icon={Copy}
            label="Копировать"
            onClick={() => {
              void navigator.clipboard?.writeText(alerts.ingestToken);
              onFeedback({ ok: true, text: 'Токен скопирован' });
            }}
          />
        </div>
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          Токен скрыт специально: панель часто попадает на скриншоты.
        </div>
      </Card>

      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3.5 text-xs text-muted-foreground">
        <span className="font-medium text-amber-600 dark:text-amber-300">Важно про сторожа. </span>
        Эти алерты шлёт сам Neo3. Если ляжет он — сообщения не придёт, потому что писать будет некому. Проверку «Neo3
        вообще отвечает?» должен делать кто-то снаружи — например ServerGuardian на Windows-машине.
      </div>
    </div>
  );
}
