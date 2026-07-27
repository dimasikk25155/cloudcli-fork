import { useState } from 'react';
import { KeyRound, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Input } from '../../../../../../shared/view/ui';
import type { AdminUserItem, AdminUserRole } from '../types';

type UserListSectionProps = {
  users: AdminUserItem[];
  onToggleActive: (userId: number, isActive: boolean) => void;
  onSetRole: (userId: number, role: AdminUserRole) => void;
  onManageAccess: (userId: number) => void;
  onResetPassword: (userId: number, password: string) => Promise<boolean>;
};

export default function UserListSection({
  users,
  onToggleActive,
  onSetRole,
  onManageAccess,
  onResetPassword,
}: UserListSectionProps) {
  const { t } = useTranslation('settings');
  const [resettingUserId, setResettingUserId] = useState<number | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');

  const startReset = (userId: number) => {
    setResettingUserId(userId);
    setResetPasswordValue('');
  };

  const submitReset = async (userId: number) => {
    if (resetPasswordValue.length < 6) {
      return;
    }
    const ok = await onResetPassword(userId, resetPasswordValue);
    if (ok) {
      setResettingUserId(null);
      setResetPasswordValue('');
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Users className="h-5 w-5" />
        <h3 className="text-lg font-semibold">{t('admin.users.title')}</h3>
      </div>

      <div className="space-y-2">
        {users.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">{t('admin.users.empty')}</p>
        ) : (
          users.map((user) => (
            <div key={user.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{user.username}</span>
                  <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                    {user.role === 'admin' ? t('admin.users.roleAdmin') : t('admin.users.roleUser')}
                  </Badge>
                  {!user.isActive && (
                    <Badge variant="destructive">{t('admin.users.inactive')}</Badge>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onSetRole(user.id, user.role === 'admin' ? 'user' : 'admin')}
                  >
                    {user.role === 'admin' ? t('admin.users.makeUser') : t('admin.users.makeAdmin')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onManageAccess(user.id)}>
                    {t('admin.users.manageAccess')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => startReset(user.id)}>
                    <KeyRound className="mr-1 h-4 w-4" />
                    {t('admin.users.resetPassword')}
                  </Button>
                  <Button
                    size="sm"
                    variant={user.isActive ? 'outline' : 'secondary'}
                    onClick={() => onToggleActive(user.id, !user.isActive)}
                  >
                    {user.isActive ? t('admin.users.deactivate') : t('admin.users.activate')}
                  </Button>
                </div>
              </div>

              {resettingUserId === user.id && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
                  <Input
                    placeholder={t('admin.users.newPasswordPlaceholder')}
                    value={resetPasswordValue}
                    onChange={(event) => setResetPasswordValue(event.target.value)}
                    className="max-w-xs"
                  />
                  <Button size="sm" onClick={() => void submitReset(user.id)}>
                    {t('admin.users.confirmReset')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setResettingUserId(null)}>
                    {t('admin.users.cancel')}
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
