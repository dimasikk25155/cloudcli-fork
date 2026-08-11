import { useMemo, useState } from 'react';
import { ChevronDown, Play, Power, RotateCcw, ScrollText, Square } from 'lucide-react';

import { ActionButton, DiagnosisBlock, Empty } from './ui';
import { HEALTH_STYLE, serviceStats, type Diagnosis, type ServiceAction, type ServiceInfo } from './shared';

// Список сервисов машины. Строка отвечает на «жив ли», раскрытие — на
// «почему упал и что нажать». Голых иконок без подписей здесь нет: панель
// открывают и с телефона, где угадывать смысл значка не по чему.

export default function ServicesTab({
  services,
  busyUnit,
  diagnoses,
  onAct,
  onLogs,
  onNeedDiagnosis,
}: {
  services: ServiceInfo[];
  busyUnit: string | null;
  diagnoses: Record<string, Diagnosis>;
  onAct: (unit: string, action: ServiceAction) => void;
  onLogs: (unit: string) => void;
  onNeedDiagnosis: (unit: string) => void;
}) {
  const [filter, setFilter] = useState<'own' | 'problems' | 'all'>('own');
  const [search, setSearch] = useState('');
  const [openUnit, setOpenUnit] = useState<string | null>(null);

  const brokenCount = services.filter((s) => s.health === 'failed' || s.health === 'flapping').length;
  const ownCount = services.filter((s) => s.own).length;

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return services
      .filter((service) => {
        if (filter === 'own' && !service.own) return false;
        if (filter === 'problems' && service.health !== 'failed' && service.health !== 'flapping') return false;
        if (query && !`${service.name} ${service.description}`.toLowerCase().includes(query)) return false;
        return true;
      })
      .sort((a, b) => {
        const rank = (service: ServiceInfo) =>
          service.health === 'failed' ? 0 : service.health === 'flapping' ? 1 : service.health === 'up' ? 2 : 3;
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      });
  }, [services, filter, search]);

  const toggle = (service: ServiceInfo) => {
    const next = openUnit === service.unit ? null : service.unit;
    setOpenUnit(next);
    if (next && !diagnoses[service.unit]) onNeedDiagnosis(service.unit);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['own', `Мои (${ownCount})`],
            ['problems', `Проблемы (${brokenCount})`],
            ['all', `Все (${services.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`min-h-[34px] rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
              filter === key ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
            }`}
          >
            {label}
          </button>
        ))}
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск по названию"
          className="ml-auto min-h-[34px] w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary sm:w-44"
        />
      </div>

      {visible.length === 0 ? (
        <Empty text="Ничего не найдено" />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {visible.map((service) => {
            const open = openUnit === service.unit;
            const running = service.health === 'up' || service.health === 'flapping';
            return (
              <div key={service.unit} className="bg-card">
                <button
                  onClick={() => toggle(service)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/40"
                >
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${HEALTH_STYLE[service.health].dot}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{service.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {HEALTH_STYLE[service.health].label}
                      {serviceStats(service) && ` · ${serviceStats(service)}`}
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
                  />
                </button>

                {open && (
                  <div className="border-t border-border/60 bg-background/40 px-3 py-3">
                    <div className="text-[11px] text-muted-foreground">{service.description}</div>

                    {(service.health === 'failed' || service.health === 'flapping') && (
                      <DiagnosisBlock diagnosis={diagnoses[service.unit]} />
                    )}

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <ActionButton icon={ScrollText} label="Логи" onClick={() => onLogs(service.unit)} />
                      {service.controllable ? (
                        <>
                          {running ? (
                            <ActionButton
                              icon={Square}
                              label="Остановить"
                              danger
                              busy={busyUnit === service.unit}
                              onClick={() => onAct(service.unit, 'stop')}
                            />
                          ) : (
                            <ActionButton
                              icon={Play}
                              label="Запустить"
                              busy={busyUnit === service.unit}
                              onClick={() => onAct(service.unit, 'start')}
                            />
                          )}
                          <ActionButton
                            icon={RotateCcw}
                            label="Перезапустить"
                            busy={busyUnit === service.unit}
                            onClick={() => onAct(service.unit, 'restart')}
                          />
                          <ActionButton
                            icon={Power}
                            label={service.enabled === 'enabled' ? 'Не поднимать после ребута' : 'Поднимать после ребута'}
                            busy={busyUnit === service.unit}
                            onClick={() => onAct(service.unit, service.enabled === 'enabled' ? 'disable' : 'enable')}
                          />
                        </>
                      ) : (
                        <span className="self-center text-[11px] text-muted-foreground">
                          Системный сервис — управление из панели отключено, чтобы не отрубить себе доступ.
                        </span>
                      )}
                    </div>

                    <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span>автозапуск: {service.enabled === 'enabled' ? 'включён' : service.enabled}</span>
                      {service.pid ? <span>pid {service.pid}</span> : null}
                      <span className="font-mono">{service.unit}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
