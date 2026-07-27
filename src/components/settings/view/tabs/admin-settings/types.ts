export type AdminUserRole = 'admin' | 'user';

export type AdminUserItem = {
  id: number;
  username: string;
  role: AdminUserRole;
  isActive: boolean;
  createdAt: string;
  lastLogin: string | null;
};

export type AdminUsersResponse = {
  success?: boolean;
  users?: AdminUserItem[];
  error?: string;
};

export type AdminProjectItem = {
  projectId: string;
  path: string;
  customProjectName: string | null;
};

export type AdminProjectsResponse = {
  success?: boolean;
  projects?: AdminProjectItem[];
  error?: string;
};

export type AdminCreateUserResponse = {
  success?: boolean;
  user?: { id: number; username: string; role: AdminUserRole };
  error?: string;
};

export type AdminProjectAccessResponse = {
  success?: boolean;
  projectIds?: string[];
  error?: string;
};
