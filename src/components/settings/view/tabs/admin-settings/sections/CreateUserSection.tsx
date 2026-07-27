import { Plus, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '../../../../../../shared/view/ui';
import type { AdminProjectItem, AdminUserRole } from '../types';

type CreateUserSectionProps = {
  projects: AdminProjectItem[];
  showForm: boolean;
  onShowFormChange: (value: boolean) => void;
  username: string;
  onUsernameChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  role: AdminUserRole;
  onRoleChange: (value: AdminUserRole) => void;
  selectedProjectIds: string[];
  onToggleProjectId: (projectId: string) => void;
  onCreate: () => void;
  onCancel: () => void;
};

export default function CreateUserSection({
  projects,
  showForm,
  onShowFormChange,
  username,
  onUsernameChange,
  password,
  onPasswordChange,
  role,
  onRoleChange,
  selectedProjectIds,
  onToggleProjectId,
  onCreate,
  onCancel,
}: CreateUserSectionProps) {
  const { t } = useTranslation('settings');

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserPlus className="h-5 w-5" />
          <h3 className="text-lg font-semibold">{t('admin.createUser.title')}</h3>
        </div>
        <Button size="sm" onClick={() => onShowFormChange(!showForm)}>
          <Plus className="mr-1 h-4 w-4" />
          {t('admin.createUser.newButton')}
        </Button>
      </div>

      {showForm && (
        <div className="mb-4 space-y-3 rounded-lg border bg-card p-4">
          <Input
            placeholder={t('admin.createUser.usernamePlaceholder')}
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
          />
          <Input
            placeholder={t('admin.createUser.passwordPlaceholder')}
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('admin.createUser.passwordHint')}</p>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={role === 'admin'}
              onChange={(event) => onRoleChange(event.target.checked ? 'admin' : 'user')}
              className="h-4 w-4 rounded border-input bg-card text-primary focus:ring-2 focus:ring-primary"
            />
            <span className="text-sm">{t('admin.createUser.makeAdmin')}</span>
          </label>

          {projects.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">{t('admin.createUser.projectAccessLabel')}</p>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
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
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={onCreate}>{t('admin.createUser.createButton')}</Button>
            <Button variant="outline" onClick={onCancel}>
              {t('admin.createUser.cancelButton')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
