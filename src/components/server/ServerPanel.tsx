import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Boxes,
  CheckCircle2,
  Cpu,
  HardDrive,
  Loader2,
  MemoryStick,
  Monitor,
  Power,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Square,
  Terminal,
} from 'lucide-react';

import { authenticatedFetch } from '../../utils/api';

import AlertsTab from './AlertsTab';
import InstalledTab from './InstalledTab';
import LogsTab from './LogsTab';
import ServicesTab from './ServicesTab';
import { ActionButton, Card, DiagnosisBlock } from './ui';
import {
  HEALTH_STYLE,
  bytes,
  duration,
  readJson,
  tone,
  type AlertSettings,
  type AlertsPayload,
  type Diagnosis,
  type ErrorGroup,
  type Feedback,
  type HostReport,
  type Inventory,
  type Overview,
  type ServiceAction,
  type ServiceInfo,
} from './shared';

// Панель сервера: состояние машины, на которой крутится Neo3.
//
// Порядок вкладок — это порядок вопросов, которые задают в аварию:
// «всё ли живо» → «что сломалось и почему» → «покажи логи» → «предупреди меня».
// Обзор обязан отвечать на первые два без единого клика: сломанный сервис
// показывает не только имя, но и причину падения с последней строкой ошибки.
// Причина считается правилами на сервере, без всяких моделей — панель должна
// отвечать мгновенно и одинаково.

type Tab = 'overview' | 'services' | 'logs' | 'alerts' | 'installed';

const TABS: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Обзор', icon: Activity },
  { id: 'services', label: 'Сервисы', icon: Boxes },
  { id: 'logs', label: 'Логи', icon: ScrollText },
  { id: 'alerts', label: 'Алерты', icon: Bell },
  { id: 'installed', label: 'Что установлено', icon: Terminal },
];

function MetricCard({
  icon: Icon,
  title,
  value,
  sub,
  pct,
}: {
  icon: typeof Cpu;
  title: string;
  value: string;
  sub?: string;
  pct?: number;
}) {
  const color = pct == null ? null : tone(pct);
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span>{title}</span>
      </div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${color?.text ?? 'text-foreground'}`}>{value}</div>
      {pct != null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full transition-all ${color?.bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      )}
      {sub && <div className="mt-1.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function ServerPanel() {
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [hosts, setHosts] = useState<HostReport[]>([]);
  const [alerts, setAlerts] = useState<AlertsPayload | null>(null);
  const [alertsSaving, setAlertsSaving] = useState(false);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [errors, setErrors] = useState<{ total: number; groups: ErrorGroup[] }>({ total: 0, groups: [] });
  const [diagnoses, setDiagnoses] = useState<Record<string, Diagnosis>>({});
  const [logUnit, setLogUnit] = useState<string | null>(null);
  const [busyUnit, setBusyUnit] = useState<string | null>(null);
  // Итог нажатия кнопки живёт до следующего действия: автообновление раз в
  // 5 секунд не должно стирать сообщение, которое пользователь не успел прочесть.
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number>(0);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [nextOverview, nextServices, nextHosts] = await Promise.all([
        readJson('/api/vps/overview'),
        readJson('/api/vps/services'),
        readJson('/api/vps/hosts').catch(() => null),
      ]);
      if (!mounted.current) return;
      setOverview(nextOverview);
      setServices(nextServices?.services ?? []);
      setHosts(nextHosts?.hosts ?? []);
      setUpdatedAt(Date.now());
      setLoadError(null);
    } catch (error) {
      if (mounted.current) setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  // Обзор и сервисы обновляются сами — дашборд показывает «сейчас», а не то,
  // что было в момент открытия. Со скрытой вкладки опрос снимается: панель
  // читает systemd по всем юнитам, и в фоне это лишняя работа для машины.
  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => void refresh(), 5000);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => (document.hidden ? stop() : (void refresh(), start()));
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const broken = useMemo(
    () => services.filter((service) => service.health === 'failed' || service.health === 'flapping'),
    [services],
  );

  const loadDiagnosis = useCallback(async (unit: string) => {
    try {
      const data = await readJson(`/api/vps/diagnose/${encodeURIComponent(unit)}`);
      if (mounted.current && data) setDiagnoses((prev) => ({ ...prev, [unit]: data }));
    } catch {
      // Разбор — это подсказка, а не обязанность: не смогли, значит показываем логи.
    }
  }, []);

  // Разбор аварии подтягивается сам для всего, что сломано: человек не должен
  // ради причины падения куда-то проваливаться.
  useEffect(() => {
    for (const service of broken.slice(0, 8)) {
      if (!diagnoses[service.unit]) void loadDiagnosis(service.unit);
    }
  }, [broken, diagnoses, loadDiagnosis]);

  useEffect(() => {
    if (tab !== 'installed' || inventory) return;
    void readJson('/api/vps/inventory')
      .then((data) => mounted.current && setInventory(data))
      .catch((error) => mounted.current && setLoadError(String(error.message ?? error)));
  }, [tab, inventory]);

  useEffect(() => {
    if (tab !== 'overview') return;
    void readJson('/api/vps/errors?hours=24')
      .then((data) => mounted.current && setErrors({ total: data?.total ?? 0, groups: data?.groups ?? [] }))
      .catch(() => undefined);
  }, [tab]);

  useEffect(() => {
    if (tab !== 'alerts') return;
    void readJson('/api/vps/alerts')
      .then((data) => mounted.current && setAlerts(data))
      .catch((error) => mounted.current && setLoadError(String(error.message ?? error)));
  }, [tab]);

  const patchAlerts = useCallback(async (patch: Partial<AlertSettings>) => {
    setAlertsSaving(true);
    try {
      const response = await authenticatedFetch('/api/vps/alerts', { method: 'PUT', body: JSON.stringify(patch) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message || 'Не удалось сохранить настройки');
      if (mounted.current && body?.data) {
        setAlerts((prev) => (prev ? { ...prev, settings: body.data.settings, chatId: body.data.chatId } : prev));
        setFeedback({ ok: true, text: 'Настройки сохранены' });
      }
    } catch (error) {
      if (mounted.current) setFeedback({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (mounted.current) setAlertsSaving(false);
    }
  }, []);

  const testAlert = useCallback(async () => {
    setAlertsSaving(true);
    try {
      const response = await authenticatedFetch('/api/vps/alerts/test', { method: 'POST' });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message || 'Не удалось отправить');
      setFeedback({ ok: true, text: `Сообщение ушло в чат ${body?.data?.chatId ?? ''}. Проверьте Телеграм.` });
    } catch (error) {
      setFeedback({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (mounted.current) setAlertsSaving(false);
    }
  }, []);

  const openLogs = useCallback((unit: string) => {
    setLogUnit(unit);
    setTab('logs');
  }, []);

  const act = useCallback(
    async (unit: string, action: ServiceAction) => {
      setBusyUnit(unit);
      setFeedback(null);
      const verb =
        action === 'start'
          ? 'запущен'
          : action === 'stop'
            ? 'остановлен'
            : action === 'restart'
              ? 'перезапущен'
              : action === 'enable'
                ? 'будет подниматься после перезагрузки'
                : 'больше не поднимется после перезагрузки';
      try {
        const response = await authenticatedFetch(`/api/vps/services/${encodeURIComponent(unit)}/${action}`, {
          method: 'POST',
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error?.message || body?.error || `Не удалось выполнить ${action}`);
        }
        const name = unit.replace(/\.service$/, '');
        const state = body?.data?.state;
        if (mounted.current) {
          const started = action === 'start' || action === 'restart';
          setFeedback(
            !started || state === 'active'
              ? { ok: true, text: `${name} ${verb}` }
              : {
                  ok: false,
                  text: `${name}: команда прошла, но сервис не поднялся (${state ?? 'состояние неизвестно'}). Посмотрите логи.`,
                },
          );
        }
        // Причина падения после действия могла измениться — перечитываем.
        setDiagnoses((prev) => {
          const next = { ...prev };
          delete next[unit];
          return next;
        });
        await refresh();
      } catch (error) {
        if (mounted.current) setFeedback({ ok: false, text: error instanceof Error ? error.message : String(error) });
      } finally {
        if (mounted.current) setBusyUnit(null);
      }
    },
    [refresh],
  );

  const runningCount = services.filter((service) => service.own && service.health === 'up').length;
  const ownCount = services.filter((service) => service.own).length;
  const worstDisk = useMemo(
    () => [...(overview?.disks ?? [])].sort((a, b) => b.pct - a.pct)[0] ?? null,
    [overview],
  );

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Шапка: одна строка ответа на вопрос «всё ли в порядке» */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${broken.length ? 'bg-red-500' : 'bg-emerald-500'}`} />
          <span className="text-sm font-medium text-foreground">
            {broken.length ? `Проблемы: ${broken.length}` : 'Всё живо'}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {overview?.hostname} · аптайм {duration(overview?.uptimeSec)} · сервисов {runningCount}/{ownCount}
        </span>
        <button
          className="ml-auto flex min-h-[34px] items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => void refresh()}
          title={updatedAt ? `Обновлено в ${new Date(updatedAt).toLocaleTimeString('ru-RU')}` : undefined}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Обновить
        </button>
      </div>

      {/* Вкладки */}
      <div className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex min-h-[34px] flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
              tab === id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {id === 'overview' && broken.length > 0 && (
              <span className="rounded-full bg-red-500/15 px-1.5 text-[10px] text-red-500">{broken.length}</span>
            )}
          </button>
        ))}
      </div>

      {feedback && (
        <div
          className={`mx-4 mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
            feedback.ok
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
              : 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300'
          }`}
        >
          {feedback.ok ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          )}
          <span className="min-w-0 flex-1">{feedback.text}</span>
          <button className="flex-shrink-0 opacity-60 hover:opacity-100" onClick={() => setFeedback(null)}>
            ✕
          </button>
        </div>
      )}

      {loadError && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* ------------------------------------------------------ ОБЗОР */}
        {tab === 'overview' && overview && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard
                icon={Cpu}
                title="Процессор"
                value={`${overview.cpuPct}%`}
                pct={overview.cpuPct}
                sub={`${overview.cpuCores} ядер · load ${overview.loadavg[0].toFixed(2)}`}
              />
              <MetricCard
                icon={MemoryStick}
                title="Память"
                value={`${overview.mem.pct}%`}
                pct={overview.mem.pct}
                sub={`${bytes(overview.mem.usedBytes)} из ${bytes(overview.mem.totalBytes)}`}
              />
              <MetricCard
                icon={HardDrive}
                title="Диск"
                value={`${worstDisk?.pct ?? 0}%`}
                pct={worstDisk?.pct ?? 0}
                sub={worstDisk ? `${bytes(worstDisk.usedBytes)} из ${bytes(worstDisk.totalBytes)}` : undefined}
              />
              <MetricCard
                icon={Activity}
                title="Сеть"
                value={`${bytes(overview.net.rxRate)}/с`}
                sub={`отдача ${bytes(overview.net.txRate)}/с · процессов ${overview.procCount}`}
              />
            </div>

            <div className="rounded-xl border border-border bg-card px-3.5 py-3 text-xs text-muted-foreground">
              {overview.os} · ядро {overview.kernel}
              {overview.swap.totalBytes > 0 && ` · swap ${overview.swap.pct}%`}
            </div>

            {/* Авария целиком: что сломалось, почему и что нажать — без переходов */}
            {broken.length > 0 ? (
              <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-3.5">
                <div className="mb-2.5 flex items-center gap-2 text-sm font-medium text-red-500">
                  <AlertTriangle className="h-4 w-4" />
                  Требуют внимания
                  <span className="text-xs font-normal text-muted-foreground">{broken.length}</span>
                </div>
                <div className="space-y-3">
                  {broken.map((service) => (
                    <div key={service.unit} className="rounded-lg border border-border/60 bg-card p-3">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-sm font-medium text-foreground">{service.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {HEALTH_STYLE[service.health].label}
                          {service.restarts > 0 && ` · перезапусков ${service.restarts}`}
                        </span>
                      </div>

                      {diagnoses[service.unit] ? (
                        <DiagnosisBlock diagnosis={diagnoses[service.unit]} />
                      ) : (
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Разбираю, почему падает…
                        </div>
                      )}

                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        <ActionButton icon={ScrollText} label="Логи" onClick={() => openLogs(service.unit)} />
                        {service.controllable && (
                          <>
                            {/* Первым — «Остановить»: бот с тысячей перезапусков не
                                чинится ещё одним, его надо унять. */}
                            <ActionButton
                              icon={Square}
                              label="Остановить"
                              danger
                              busy={busyUnit === service.unit}
                              onClick={() => void act(service.unit, 'stop')}
                            />
                            <ActionButton
                              icon={RotateCcw}
                              label="Перезапустить"
                              busy={busyUnit === service.unit}
                              onClick={() => void act(service.unit, 'restart')}
                            />
                            {service.enabled === 'enabled' && (
                              <ActionButton
                                icon={Power}
                                label="Не поднимать после ребута"
                                busy={busyUnit === service.unit}
                                onClick={() => void act(service.unit, 'disable')}
                              />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-3 text-sm text-emerald-600 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Все сервисы работают, упавших нет.
              </div>
            )}

            {/* Другие машины: отчёты шлют они сами (Neo3 или ещё «Пульт жизни») */}
            {hosts.map((host) => (
              <div key={host.host} className="rounded-xl border border-border bg-card p-3.5">
                <div className="mb-2.5 flex items-center gap-2">
                  <Monitor className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{host.label}</span>
                  {host.source === 'pulse' && (
                    <span
                      className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      title="Отчёт пришёл через старый «Пульт жизни». После переключения репортёра метка исчезнет."
                    >
                      через Пульс
                    </span>
                  )}
                  <span className={`ml-auto text-[11px] ${host.stale ? 'text-amber-500' : 'text-muted-foreground'}`}>
                    {host.stale ? `молчит ${duration(host.ageSec)}` : `отчёт ${duration(host.ageSec)} назад`}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                  {(
                    [
                      ['CPU', host.cpuPct],
                      ['RAM', host.ramPct],
                      ['Диск', host.diskPct],
                      ['GPU', host.gpuPct],
                    ] as const
                  ).map(([label, value]) =>
                    value == null ? null : (
                      <div key={label} className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">{label}</span>
                        <span className={`tabular-nums ${tone(value).text}`}>{value}%</span>
                      </div>
                    ),
                  )}
                </div>
                {host.services.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {host.services.map((service) => (
                      <span key={service.name} className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-[11px]">
                        <span className={`h-1.5 w-1.5 rounded-full ${service.up ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
                        {service.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Ошибки за сутки — свёрнутые в группы: одна и та же строка тысячу
                раз это одна проблема, а не тысяча. */}
            <Card title="Ошибки за сутки" icon={ScrollText} count={errors.total}>
              {errors.groups.length === 0 ? (
                <div className="text-xs text-muted-foreground">Пусто — ошибок уровня error не было.</div>
              ) : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto">
                  {errors.groups.slice(0, 25).map((group, index) => (
                    <div key={`${group.source}-${index}`} className="flex items-start gap-2 text-[11px]">
                      <span className="min-w-10 flex-shrink-0 rounded bg-muted px-1.5 py-0.5 text-center tabular-nums text-muted-foreground">
                        ×{group.count}
                      </span>
                      <span className="flex-shrink-0 font-medium text-amber-500">{group.source}</span>
                      <span className="min-w-0 break-all font-mono text-muted-foreground">{group.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}

        {tab === 'services' && (
          <ServicesTab
            services={services}
            busyUnit={busyUnit}
            diagnoses={diagnoses}
            onAct={(unit, action) => void act(unit, action)}
            onLogs={openLogs}
            onNeedDiagnosis={(unit) => void loadDiagnosis(unit)}
          />
        )}

        {tab === 'logs' && (
          <LogsTab
            services={services}
            // Пустой экран «выберите сервис» бесполезен: если что-то сломано,
            // человек пришёл сюда именно за этим сервисом.
            initialUnit={logUnit ?? broken[0]?.unit ?? services.find((service) => service.own)?.unit ?? null}
            onFeedback={setFeedback}
          />
        )}

        {tab === 'alerts' && (
          <AlertsTab
            alerts={alerts}
            services={services}
            saving={alertsSaving}
            onPatch={(patch) => void patchAlerts(patch)}
            onTest={() => void testAlert()}
            onFeedback={setFeedback}
          />
        )}

        {tab === 'installed' && <InstalledTab inventory={inventory} />}
      </div>
    </div>
  );
}
