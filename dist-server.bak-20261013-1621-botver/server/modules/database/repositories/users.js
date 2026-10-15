/**
 * User repository.
 *
 * Provides typed CRUD operations for the `users` table.
 * This is a single-user system, but the schema supports multiple
 * users for forward compatibility.
 */
import { getConnection } from '../../../modules/database/connection.js';
// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export const userDb = {
    /** Returns true if at least one user exists in the database. */
    hasUsers() {
        const db = getConnection();
        const row = db.prepare('SELECT COUNT(*) as count FROM users').get();
        return row.count > 0;
    },
    /** Inserts a new user and returns the created ID + username. */
    createUser(username, passwordHash) {
        const db = getConnection();
        const result = db
            .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
            .run(username, passwordHash);
        return { id: result.lastInsertRowid, username };
    },
    /** Inserts a new user with an explicit role (used by admin-create and first-run setup). */
    createUserWithRole(username, passwordHash, role) {
        const db = getConnection();
        const result = db
            .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
            .run(username, passwordHash, role);
        return { id: result.lastInsertRowid, username, role };
    },
    /** Returns every user (for the admin user-list screen). */
    listUsers() {
        const db = getConnection();
        return db
            .prepare('SELECT id, username, role, is_active, created_at, last_login FROM users ORDER BY id')
            .all();
    },
    /** Updates a user's role. */
    setUserRole(userId, role) {
        const db = getConnection();
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    },
    /** Activates/deactivates a user (deactivated users can no longer log in). */
    setUserActive(userId, isActive) {
        const db = getConnection();
        db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, userId);
    },
    /** Counts active admins (used to block removing the last admin). */
    countActiveAdmins() {
        const db = getConnection();
        const row = db
            .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND is_active = 1")
            .get();
        return row.count;
    },
    /** Resets a user's password hash (admin-initiated reset). */
    setUserPassword(userId, passwordHash) {
        const db = getConnection();
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
    },
    /**
     * Looks up an active user by username.
     * Returns the full row (including password hash) for auth verification.
     */
    getUserByUsername(username) {
        const db = getConnection();
        return db
            .prepare('SELECT * FROM users WHERE username = ? AND is_active = 1')
            .get(username);
    },
    /** Updates the last_login timestamp. Non-fatal — logs but does not throw. */
    updateLastLogin(userId) {
        try {
            const db = getConnection();
            db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('Failed to update last login', { error: message });
        }
    },
    /** Returns public user fields by ID (no password hash). */
    getUserById(userId) {
        const db = getConnection();
        return db
            .prepare('SELECT id, username, created_at, last_login, role FROM users WHERE id = ? AND is_active = 1')
            .get(userId);
    },
    /** Returns the first active user. Used for single-user mode lookups. */
    getFirstUser() {
        const db = getConnection();
        return db
            .prepare('SELECT id, username, created_at, last_login, role FROM users WHERE is_active = 1 LIMIT 1')
            .get();
    },
    /** Stores the user's preferred git name and email. */
    updateGitConfig(userId, gitName, gitEmail) {
        const db = getConnection();
        db.prepare('UPDATE users SET git_name = ?, git_email = ? WHERE id = ?').run(gitName, gitEmail, userId);
    },
    /** Retrieves the user's git identity (name + email). */
    getGitConfig(userId) {
        const db = getConnection();
        return db
            .prepare('SELECT git_name, git_email FROM users WHERE id = ?')
            .get(userId);
    },
    /** Marks onboarding as complete for the given user. */
    completeOnboarding(userId) {
        const db = getConnection();
        db.prepare('UPDATE users SET has_completed_onboarding = 1 WHERE id = ?').run(userId);
    },
    /** Reopens the first-run tour for the given user. */
    resetOnboarding(userId) {
        const db = getConnection();
        db.prepare('UPDATE users SET has_completed_onboarding = 0 WHERE id = ?').run(userId);
    },
    /** Returns true if the user has finished the onboarding flow. */
    hasCompletedOnboarding(userId) {
        const db = getConnection();
        const row = db
            .prepare('SELECT has_completed_onboarding FROM users WHERE id = ?')
            .get(userId);
        return row?.has_completed_onboarding === 1;
    },
};
//# sourceMappingURL=users.js.map