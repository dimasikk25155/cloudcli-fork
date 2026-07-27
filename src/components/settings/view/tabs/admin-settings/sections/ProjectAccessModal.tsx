import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogContent, DialogTitle } from '../../../../../../shared/view/ui';
import type { AdminProjectItem } from '../types';

type ProjectAccessModalProps = {
  open: boolean;
  projects: AdminProjectItem[];
  selectedProjectIds: string[];
  onToggleProjectId: (projectId: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onSave: () => void;
  onClose: () => void;
};

export default function ProjectAccessModal({
  open,
  projects,
  selectedProjectIds,
  onToggleProjectId,
  onSelectAll,
  onClearAll,
  onSave,
  onClose,
}: ProjectAccessModalProps) {
  const { t } = useTranslation('settings');

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="p-6">
        <DialogTitle>{t('admin.accessModal.title')}</DialogTitle>
        <h3 className="mb-4 text-lg font-semibold">{t('admin.accessModal.title')}</h3>

        {projects.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">{t('admin.accessModal.noProjects')}</p>
        ) : (
          <>
            <div className="mb-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={onSelectAll}>
                {t('admin.accessModal.selectAll')}
              </Button>
              <Button size="sm" variant="outline" onClick={onClearAll}>
                {t('admin.accessModal.clearAll')}
              </Button>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2">
              {projects.map((project) => (
                <label key={project.projectId} className="flex items-center gap-3 px-1 py-1">
                  <input
                    type="checkbox"
                    checked={selectedProjectIds.includes(project.projectId)}
                    onChange={() => onToggleProjectId(project.projectId)}
                    className="h-4 w-4 rounded border-input bg-card text-primary focus:ring-2 focus:ring-primary"
                  />
                  <span className="text-sm">{project.customProjectName || project.path}</span>
                </label>
              ))}
            </div>
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{t('admin.accessModal.cancelButton')}</Button>
          <Button onClick={onSave}>{t('admin.accessModal.saveButton')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
