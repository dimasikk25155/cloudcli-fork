import { Boxes, ChevronRight, CircleDot, Loader2 } from 'lucide-react';

import { Card } from './ui';
import { bytes, type Inventory } from './shared';

// «Что установлено»: справка о машине — контейнеры, порты, версии, кто ест
// память и место. Смотрят сюда редко, поэтому вкладка грузится по открытию.

export default function InstalledTab({ inventory }: { inventory: Inventory | null }) {
  if (!inventory) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(inventory.runtimes).map(([name, version]) => (
          <div key={name} className="rounded-xl border border-border bg-card p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{name}</div>
            <div className="mt-0.5 truncate text-xs text-foreground">{version ?? 'не установлен'}</div>
          </div>
        ))}
      </div>

      <Card title="Контейнеры Docker" icon={Boxes} count={inventory.containers.length}>
        {inventory.containers.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            {inventory.dockerAvailable
              ? 'Запущенных контейнеров нет.'
              : inventory.dockerInstalled
                ? 'Docker установлен, но панели закрыт доступ к нему — добавьте пользователя в группу docker.'
                : 'Docker не установлен.'}
          </div>
        ) : (
          <div className="space-y-1.5 text-xs">
            {inventory.containers.map((container) => (
              <div key={container.name} className="flex flex-wrap items-center gap-2">
                <CircleDot className="h-3 w-3 flex-shrink-0 text-emerald-500" />
                <span className="text-foreground">{container.name}</span>
                <span className="text-muted-foreground/70">{container.image}</span>
                <span className="ml-auto text-muted-foreground">{container.status}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Тяжёлые процессы">
          <div className="space-y-1 text-xs">
            {inventory.topProcesses.map((process) => (
              <div key={process.pid} className="flex items-center gap-2">
                <span className="w-14 flex-shrink-0 text-muted-foreground/60">{process.pid}</span>
                <span className="min-w-0 flex-1 truncate text-foreground">{process.name}</span>
                <span className="tabular-nums text-muted-foreground">{bytes(process.rssBytes)}</span>
                <span className="w-12 text-right tabular-nums text-muted-foreground">{process.cpu}%</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Место в /opt">
          {!inventory.foldersAvailable && (
            <div className="text-xs text-muted-foreground">
              Размер папок посчитать не удалось — у панели нет доступа на чтение /opt.
            </div>
          )}
          <div className="space-y-1 text-xs">
            {inventory.folders.map((folder) => (
              <div key={folder.path} className="flex items-center gap-2">
                <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground/50" />
                <span className="min-w-0 flex-1 truncate text-foreground">{folder.path.replace('/opt/', '')}</span>
                <span className="tabular-nums text-muted-foreground">{folder.sizeMb} МБ</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Открытые порты" count={inventory.ports.length}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          {inventory.ports.map((port, index) => (
            <div key={`${port.addr}-${index}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{port.addr}</span>
              {port.proc && <span className="flex-shrink-0 text-foreground/70">{port.proc}</span>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
