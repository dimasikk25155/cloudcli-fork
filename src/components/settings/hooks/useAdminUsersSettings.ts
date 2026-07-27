import { useCallback, useEffect, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import type {
  AdminCreateUserResponse,
  AdminProjectAccessResponse,
  AdminProjectItem,
  AdminProjectsResponse,
  AdminUserItem,
  AdminUserRole,
  AdminUsersResponse,
} from '../view/tabs/admin-settings/types';

const getApiError = (payload: { error?: string } | undefined, fallback: string) => (
  payload?.error || fallback
);

export function useAdminUsersSettings() {
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [projects, setProjects] = useState<AdminProjectItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [showNewUserForm, setShowNewUserForm] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<AdminUserRole>('user');
  const [newUserProjectIds, setNewUserProjectIds] = useState<string[]>([]);

  const [managingAccessForUserId, setManagingAccessForUserId] = useState<number | null>(null);
  const [accessDraftProjectIds, setAccessDraftProjectIds] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      const [usersResponse, projectsResponse] = await Promise.all([
        authenticatedFetch('/api/admin/users'),
        authenticatedFetch('/api/admin/projects'),
      ]);

      const [usersPayload, projectsPayload] = await Promise.all([
        usersResponse.json() as Promise<AdminUsersResponse>,
        projectsResponse.json() as Promise<AdminProjectsResponse>,
      ]);

      setUsers(usersPayload.users || []);
      setProjects(projectsPayload.projects || []);
    } catch (error) {
      console.error('Error fetching admin data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const createUser = useCallback(async () => {
    if (!newUsername.trim() || !newPassword.trim()) {
      return;
    }

    try {
      const response = await authenticatedFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
        }),
      });

      const payload = await response.json() as AdminCreateUserResponse;
      if (!response.ok || !payload.success || !payload.user) {
        console.error('Error creating user:', getApiError(payload, 'Failed to create user'));
        return;
      }

      if (newUserProjectIds.length > 0) {
        await authenticatedFetch(`/api/admin/users/${payload.user.id}/project-access`, {
          method: 'PUT',
          body: JSON.stringify({ projectIds: newUserProjectIds }),
        });
      }

      setNewUsername('');
      setNewPassword('');
      setNewRole('user');
      setNewUserProjectIds([]);
      setShowNewUserForm(false);
      await fetchData();
    } catch (error) {
      console.error('Error creating user:', error);
    }
  }, [fetchData, newPassword, newRole, newUserProjectIds, newUsername]);

  const toggleNewUserProjectId = useCallback((projectId: string) => {
    setNewUserProjectIds((prev) => (
      prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId]
    ));
  }, []);

  const setUserActive = useCallback(async (userId: number, isActive: boolean) => {
    try {
      const response = await authenticatedFetch(`/api/admin/users/${userId}/active`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      });

      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        console.error('Error updating user status:', getApiError(payload, 'Failed to update user status'));
        return;
      }

      await fetchData();
    } catch (error) {
      console.error('Error updating user status:', error);
    }
  }, [fetchData]);

  const setUserRole = useCallback(async (userId: number, role: AdminUserRole) => {
    try {
      const response = await authenticatedFetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });

      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        console.error('Error updating user role:', getApiError(payload, 'Failed to update user role'));
        return;
      }

      await fetchData();
    } catch (error) {
      console.error('Error updating user role:', error);
    }
  }, [fetchData]);

  const resetUserPassword = useCallback(async (userId: number, password: string) => {
    try {
      const response = await authenticatedFetch(`/api/admin/users/${userId}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        console.error('Error resetting password:', getApiError(payload, 'Failed to reset password'));
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error resetting password:', error);
      return false;
    }
  }, []);

  const openAccessManager = useCallback(async (userId: number) => {
    setManagingAccessForUserId(userId);
    try {
      const response = await authenticatedFetch(`/api/admin/users/${userId}/project-access`);
      const payload = await response.json() as AdminProjectAccessResponse;
      setAccessDraftProjectIds(payload.projectIds || []);
    } catch (error) {
      console.error('Error fetching project access:', error);
      setAccessDraftProjectIds([]);
    }
  }, []);

  const toggleAccessDraftProjectId = useCallback((projectId: string) => {
    setAccessDraftProjectIds((prev) => (
      prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId]
    ));
  }, []);

  const selectAllAccessDraftProjectIds = useCallback(() => {
    setAccessDraftProjectIds(projects.map((project) => project.projectId));
  }, [projects]);

  const clearAccessDraftProjectIds = useCallback(() => {
    setAccessDraftProjectIds([]);
  }, []);

  const closeAccessManager = useCallback(() => {
    setManagingAccessForUserId(null);
    setAccessDraftProjectIds([]);
  }, []);

  const saveAccessManager = useCallback(async () => {
    if (managingAccessForUserId === null) {
      return;
    }

    try {
      const response = await authenticatedFetch(`/api/admin/users/${managingAccessForUserId}/project-access`, {
        method: 'PUT',
        body: JSON.stringify({ projectIds: accessDraftProjectIds }),
      });

      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        console.error('Error saving project access:', getApiError(payload, 'Failed to save project access'));
        return;
      }

      closeAccessManager();
    } catch (error) {
      console.error('Error saving project access:', error);
    }
  }, [accessDraftProjectIds, closeAccessManager, managingAccessForUserId]);

  const cancelNewUserForm = useCallback(() => {
    setShowNewUserForm(false);
    setNewUsername('');
    setNewPassword('');
    setNewRole('user');
    setNewUserProjectIds([]);
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return {
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
  };
}
