import { useTranslation } from 'react-i18next';
import { useAdminUsersSettings } from '../../../hooks/useAdminUsersSettings';
import UserListSection from './sections/UserListSection';
import CreateUserSection from './sections/CreateUserSection';
import ProjectAccessModal from './sections/ProjectAccessModal';

export default function AdminSettingsTab() {
  const { t } = useTranslation('settings');
  const {
    users,
    projects,
    loading,
    showNewUserForm,
    setShowNewUserForm,
    newUsername,
    setNewUsername,
    newPassword,
    setNewPassword,
    newRole,
    setNewRole,
    newUserProjectIds,
    toggleNewUserProjectId,
    createUser,
    cancelNewUserForm,
    setUserActive,
    setUserRole,
    resetUserPassword,
    managingAccessForUserId,
    accessDraftProjectIds,
    openAccessManager,
    toggleAccessDraftProjectId,
    selectAllAccessDraftProjectIds,
    clearAccessDraftProjectIds,
    closeAccessManager,
    saveAccessManager,
  } = useAdminUsersSettings();

  if (loading) {
    return <div className="text-muted-foreground">{t('admin.loading')}</div>;
  }

  return (
    <div className="space-y-8">
      <CreateUserSection
        projects={projects}
        showForm={showNewUserForm}
        onShowFormChange={setShowNewUserForm}
        username={newUsername}
        onUsernameChange={setNewUsername}
        password={newPassword}
        onPasswordChange={setNewPassword}
        role={newRole}
        onRoleChange={setNewRole}
        selectedProjectIds={newUserProjectIds}
        onToggleProjectId={toggleNewUserProjectId}
        onCreate={createUser}
        onCancel={cancelNewUserForm}
      />

      <UserListSection
        users={users}
        onToggleActive={setUserActive}
        onSetRole={setUserRole}
        onManageAccess={openAccessManager}
        onResetPassword={resetUserPassword}
      />

      <ProjectAccessModal
        open={managingAccessForUserId !== null}
        projects={projects}
        selectedProjectIds={accessDraftProjectIds}
        onToggleProjectId={toggleAccessDraftProjectId}
        onSelectAll={selectAllAccessDraftProjectIds}
        onClearAll={clearAccessDraftProjectIds}
        onSave={saveAccessManager}
        onClose={closeAccessManager}
      />
    </div>
  );
}
