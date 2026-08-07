import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../../shared/view/ui';

// Shell for the feature panels reachable from the sidebar footer.
//
// This MUST render through Dialog (which portals into document.body). A plain
// `position: fixed` box does not work here: the sidebar subtree has ancestors
// with `backdrop-blur-sm` (SidebarContent) and `transform` (the mobile drawer
// in AppContent), and either one makes itself the containing block for fixed
// descendants — so `inset-0` resolved to the ~288px sidebar instead of the
// viewport and every panel was squeezed into an unusable column.

export default function PanelModal({
  title,
  icon: Icon,
  onClose,
  children,
}: {
  title: string;
  icon: LucideIcon;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden rounded-none border-0 bg-background p-0 text-foreground shadow-2xl md:h-[min(90dvh,52rem)] md:w-[calc(100vw-2rem)] md:max-w-5xl md:rounded-2xl md:border md:border-border">
        <DialogTitle>{title}</DialogTitle>

        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className="h-4 w-4 flex-shrink-0 text-primary" />
            <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          </div>
          <button
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg hover:bg-accent"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
