import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import { createWorkspaceStore } from '../store.js';
import type { WorkspaceDependencies } from '../dependencies.js';
import { createWorkspaceTools } from '../tools.js';
function fixture() {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE workspace_records(id TEXT PRIMARY KEY,kind TEXT,owner_user_id INTEGER,project_id TEXT,revision INTEGER,payload TEXT,created_at TEXT,updated_at TEXT)');
    let allowed = true;
    const deps: WorkspaceDependencies = { store: createWorkspaceStore(db), now: () => new Date().toISOString(), getUser: id => ({ id, username: 'user' }), getProject: id => ({ id, name: id, path: '/tmp' }), listUsers: () => [], listProjects: () => [], isAdmin: () => false, canAccessProject: () => allowed, handoffs: new Map(), sessionProject: () => allowed ? 'p' : null };
    return { db, deps, revoke: () => { allowed = false; } };
}
test('agent tools create a document in authoritative session project, reject cross-project and human-only operations, recheck revocation', () => {
    const { db, deps, revoke } = fixture();
    try {
        const tools = createWorkspaceTools(deps);
        const document = tools.call(1, 'session', { action: 'document.create', data: { projectId: 'other', title: 'Brief', text: 'Selected material' } }) as {
            id: string;
            projectId: string;
        };
        assert.equal(document.projectId, 'p');
        assert.throws(() => tools.call(1, 'session', { action: 'document.approve', id: document.id }), /человек/);
        deps.store.create({ id: 'other-doc', kind: 'managed-document', ownerUserId: 1, projectId: 'other', payload: {} });
        assert.throws(() => tools.call(1, 'session', { action: 'document.read', id: 'other-doc' }), /проект/);
        revoke();
        assert.throws(() => tools.call(1, 'session', { action: 'document.list' }), /доступ/);
    }
    finally {
        db.close();
    }
});
import { bindWorkspaceHandoff, resolveWorkspaceHandoff, hasWorkspaceSessionGrant } from '../service.js';
import { createMailService, registerMailHandoff } from '../../agent-mail/index.js';
import { createDocumentsService } from '../../managed-documents/index.js';
import { createTeamService } from '../../workspace-team/index.js';
import type { MailMessage, MailDraftInput } from '../../../../shared/agent-mail.js';
import type { MailOptions } from '../../agent-mail/index.js';
test('selected email → session grant → agent draft/document → human approval → fake send → reply, and intake → assignment', async () => {
    const { db, deps, revoke } = fixture();
    try {
        let sends = 0;
        const message: MailMessage = { inboxId: 'inbox', messageId: 'incoming', threadId: 'thread', from: 'client@example.test', to: ['owner@example.test'], subject: 'Brief', text: 'Prepare a brief', timestamp: deps.now(), labels: [], attachments: [] };
        const provider: NonNullable<MailOptions['provider']> = { list: async () => ({ messages: [{ message_id: 'incoming' }] }), read: async () => message, attachment: async () => ({ download_url: 'https://example.test/file' }), send: async () => { sends++; return { message_id: 'sent', thread_id: 'thread' }; } };
        const options = { config: { apiKey: '', inboxId: 'inbox', ownerUserId: 1 }, provider };
        const mail = createMailService(deps, options), tools = createWorkspaceTools(deps, options);
        registerMailHandoff(deps, options);
        await mail.sync(1);
        const source = mail.messages(1)[0];
        assert.throws(() => tools.call(1, 'session', { action: 'mail.read', id: source.id }), /передайте/);
        assert.equal(hasWorkspaceSessionGrant(deps, 1, 'session'), false, 'threads off without grant must not issue workspace token');
        const handoff = await resolveWorkspaceHandoff(deps, 1, { projectId: 'p', source: { kind: 'mail-message', id: source.id } });
        assert.throws(() => bindWorkspaceHandoff(deps, 2, handoff.grantId, 'session'), /найдена/);
        bindWorkspaceHandoff(deps, 1, handoff.grantId, 'session');
        assert.equal(hasWorkspaceSessionGrant(deps, 1, 'session'), true, 'bound grant permits workspace identity with threads off');
        assert.equal(hasWorkspaceSessionGrant(deps, 1, 'another-session'), false);
        assert.throws(() => bindWorkspaceHandoff(deps, 1, handoff.grantId, 'another-session'), /использована/);
        assert.equal((tools.call(1, 'session', { action: 'mail.read', id: source.id }) as {
            id: string;
        }).id, source.id);
        assert.throws(() => tools.call(1, 'another-session', { action: 'mail.read', id: source.id }), /передайте/);
        const doc = tools.call(1, 'session', { action: 'document.create', data: { title: 'Brief', text: source.payload.text } }) as {
            id: string;
            revision: number;
            payload: {
                currentVersionId: string;
            };
        };
        const docs = createDocumentsService(deps);
        const approval = docs.startApproval(1, doc.id, doc.revision, doc.payload.currentVersionId, [1]);
        docs.approve(1, doc.id, approval.revision, doc.payload.currentVersionId);
        const input: MailDraftInput = { to: ['client@example.test'], cc: [], bcc: [], subject: 'Brief', text: 'Prepared brief', attachments: [], replyToId: source.id };
        const draft = tools.call(1, 'session', { action: 'mail.draft', data: input as unknown as Record<string, unknown> }) as {
            id: string;
            revision: number;
        };
        assert.throws(() => tools.call(1, 'session', { action: 'mail.send', id: draft.id }), /человек/);
        const approved = mail.approve(1, draft.id, draft.revision);
        await mail.send(1, draft.id, approved.revision);
        await mail.send(1, draft.id, approved.revision);
        assert.equal(sends, 1);
        provider.read = async () => ({ ...message, messageId: 'reply', text: 'Thank you' });
        await mail.sync(1);
        assert.equal(mail.thread(1, 'thread').length, 3);
        const team = createTeamService(deps);
        const form = team.createForm(1, { projectId: 'p', title: 'Intake', fields: [{ id: 'brief', label: 'Brief', type: 'text', required: true }] });
        team.updateForm(1, form.id, 1, { enabled: true });
        const visitor = team.start(form.payload.token);
        team.answer(visitor.sessionToken, 1, 'brief', 'Need a brief');
        const lead = team.listLeads(1, form.id)[0];
        const assignment = team.convertLead(1, lead.id, { assigneeId: 2, dueAt: null });
        assert.equal(team.listAssignments(2, 'p')[0].id, assignment.id);
        revoke();
        assert.equal(hasWorkspaceSessionGrant(deps, 1, 'session'), false);
        assert.throws(() => tools.call(1, 'session', { action: 'mail.read', id: source.id }), /доступ/);
    }
    finally {
        db.close();
    }
});
