import express from 'express';
import bcrypt from 'bcrypt';
import { userDb, projectsDb, userProjectAccessDb } from '../modules/database/index.js';

const router = express.Router();

const SALT_ROUNDS = 12;
const VALID_ROLES = ['admin', 'user'];

function validateUsernamePassword(username, password) {
  if (!username || !password) {
    return 'Username and password are required';
  }
  if (username.length < 3 || password.length < 6) {
    return 'Username must be at least 3 characters, password at least 6 characters';
  }
  return null;
}

// List all users
router.get('/users', (req, res) => {
  try {
    const users = userDb.listUsers().map((user) => ({
      id: user.id,
      username: user.username,
      role: user.role,
      isActive: Boolean(user.is_active),
      createdAt: user.created_at,
      lastLogin: user.last_login
    }));
    res.json({ success: true, users });
  } catch (error) {
    console.error('Admin list users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new employee account
router.post('/users', async (req, res) => {
  try {
    const { username, password, role } = req.body;

    const validationError = validateUsernamePassword(username, password);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const resolvedRole = role === 'admin' ? 'admin' : 'user';
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = userDb.createUserWithRole(username, passwordHash, resolvedRole);

    res.json({
      success: true,
      user: { id: user.id, username: user.username, role: user.role }
    });
  } catch (error) {
    console.error('Admin create user error:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Change a user's role
router.patch('/users/:id/role', (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { role } = req.body;

    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Role must be "admin" or "user"' });
    }

    if (role !== 'admin' && userId === req.user.id && userDb.countActiveAdmins() <= 1) {
      return res.status(400).json({ error: 'Cannot remove the last admin' });
    }

    userDb.setUserRole(userId, role);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin set role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Activate/deactivate a user
router.patch('/users/:id/active', (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    if (!isActive && userDb.countActiveAdmins() <= 1) {
      const targetUser = userDb.listUsers().find((user) => user.id === userId);
      if (targetUser && targetUser.role === 'admin') {
        return res.status(400).json({ error: 'Cannot deactivate the last active admin' });
      }
    }

    userDb.setUserActive(userId, isActive);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin set active error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset a user's password
router.patch('/users/:id/password', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    userDb.setUserPassword(userId, passwordHash);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a user's granted projects
router.get('/users/:id/project-access', (req, res) => {
  try {
    const userId = Number(req.params.id);
    const projectIds = userProjectAccessDb.getAccessibleProjectIds(userId);
    res.json({ success: true, projectIds });
  } catch (error) {
    console.error('Admin get project access error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Replace a user's granted projects
router.put('/users/:id/project-access', (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { projectIds } = req.body;

    if (!Array.isArray(projectIds) || !projectIds.every((id) => typeof id === 'string')) {
      return res.status(400).json({ error: 'projectIds must be an array of strings' });
    }

    userProjectAccessDb.setAccessibleProjectIds(userId, projectIds, req.user.id);
    res.json({ success: true, projectIds });
  } catch (error) {
    console.error('Admin set project access error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List all projects (for the access-picker checkboxes)
router.get('/projects', (req, res) => {
  try {
    const projects = projectsDb.getProjectPaths().map((project) => ({
      projectId: project.project_id,
      path: project.project_path,
      customProjectName: project.custom_project_name
    }));
    res.json({ success: true, projects });
  } catch (error) {
    console.error('Admin list projects error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
