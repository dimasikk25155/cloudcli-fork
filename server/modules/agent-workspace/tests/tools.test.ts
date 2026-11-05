import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import { AppError } from '@/shared/utils.js';

import { createWorkspaceStore } from '../store.js';
import type { WorkspaceDependencies } from '../dependencies.js';
import { createWorkspaceTools } from '../tools.js';
import { createSecretRequestsService } from '../../secret-requests/index.js';
import { modOffMessage } from '../../../../shared/mods.js';
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
test('artifact.publish / artifact.list: the agent publishes a file of its chat project; outside paths, a foreign chat and the switched-off mod are refused', async () => {
    const { mkdtemp, realpath, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { createArtifactsService } = await import('../../artifacts/index.js');
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'tools-artifacts-')));
    const { db, deps, revoke } = fixture();
    let modOn = true;
    try {
        await writeFile(path.join(root, 'slides.html'), '<section>1</section>');
        const artifacts = createArtifactsService({ store: deps.store, projectPath: id => (id === 'p' ? root : null), canAccessProject: () => true, sessionProjectId: () => 'p', isModOn: () => modOn, snapshotRoot: () => path.join(root, '.snapshots') });
        const tools = createWorkspaceTools(deps, { artifacts });
        const published = await tools.call(1, 'session', { action: 'artifact.publish', data: { path: 'slides.html', title: 'Слайды' } }) as { artifact: { id: string; sessionId: string; title: string; kind: string } };
        assert.equal(published.artifact.sessionId, 'session', 'the source is the agent\'s chat');
        assert.equal(published.artifact.title, 'Слайды');
        assert.equal(published.artifact.kind, 'slides');
        const listed = await tools.call(1, 'session', { action: 'artifact.list' }) as Array<{ id: string }>;
        assert.deepEqual(listed.map(item => item.id), [published.artifact.id]);
        await assert.rejects(Promise.resolve(tools.call(1, 'session', { action: 'artifact.publish', data: { path: '../etc/passwd' } })), (error: { statusCode?: number; constructor: { name: string } }) => error.statusCode === 400 && error.constructor.name === 'WorkspaceError');
        modOn = false;
        await assert.rejects(Promise.resolve(tools.call(1, 'session', { action: 'artifact.list' })), (error: { statusCode?: number }) => error.statusCode === 409);
        modOn = true;
        revoke();
        assert.throws(() => tools.call(1, 'session', { action: 'artifact.list' }), (error: { statusCode?: number }) => error.statusCode === 403);
    }
    finally {
        db.close();
        await rm(root, { recursive: true, force: true });
    }
});
test('group.* / pin.set only arrange; delete actions and unknown actions stay 403; a mod-off refusal keeps its 409', () => {
    const { db, deps } = fixture();
    try {
        const calls: string[] = [];
        const groups = {
            list: () => { calls.push('list'); return { groups: [], pins: [] }; },
            create: (_u: number, i: { name?: unknown }) => { calls.push(`create:${String(i.name)}`); return { groups: [], pins: [] }; },
            update: (_u: number, g: unknown, i: { name?: unknown }) => { calls.push(`rename:${String(g)}:${String(i.name)}`); return { groups: [], pins: [] }; },
            addItem: (_u: number, g: unknown, t: unknown, i: unknown) => { calls.push(`add:${String(g)}:${String(t)}:${String(i)}`); return { groups: [], pins: [] }; },
            removeItem: (_u: number, g: unknown, t: unknown, i: unknown) => { calls.push(`remove:${String(g)}:${String(t)}:${String(i)}`); return { groups: [], pins: [] }; },
            setPin: (_u: number, s: unknown, p: unknown) => { calls.push(`pin:${String(s)}:${String(p)}`); return { groups: [], pins: [] }; },
            remove: () => { calls.push('DELETE'); throw new Error('the agent must never reach group deletion'); },
        } as unknown as import('../../sidebar-groups/index.js').SidebarGroupsService;
        const tools = createWorkspaceTools(deps, { groups });
        tools.call(1, 'session', { action: 'group.list' });
        tools.call(1, 'session', { action: 'group.create', data: { name: 'Клиенты' } });
        tools.call(1, 'session', { action: 'group.rename', data: { id: 'g1', name: 'Новые' } });
        tools.call(1, 'session', { action: 'group.add', data: { id: 'g1', itemType: 'project', itemId: 'p' } });
        tools.call(1, 'session', { action: 'group.remove', data: { id: 'g1', itemType: 'project', itemId: 'p' } });
        tools.call(1, 'session', { action: 'pin.set', data: { sessionId: 's1', pinned: false } });
        tools.call(1, 'session', { action: 'pin.set', data: { pinned: true } });
        assert.deepEqual(calls, ['list', 'create:Клиенты', 'rename:g1:Новые', 'add:g1:project:p', 'remove:g1:project:p', 'pin:s1:false', 'pin:session:true']);
        for (const action of ['group.delete', 'group.destroy', 'project.delete', 'session.delete', 'settings.apply'])
            assert.throws(() => tools.call(1, 'session', { action }), (error: { statusCode?: number }) => error.statusCode === 403);
        assert.equal(calls.includes('DELETE'), false);
        const refused = createWorkspaceTools(deps, { groups: { list: () => { throw new AppError('off', { code: 'MOD_OFF', statusCode: 409 }); } } as unknown as import('../../sidebar-groups/index.js').SidebarGroupsService });
        assert.throws(() => refused.call(1, 'session', { action: 'group.list' }), (error: { statusCode?: number }) => error.statusCode === 409);
    }
    finally {
        db.close();
    }
});
test('settings.propose stores a suggestion through the profile service and changes nothing', async () => {
    const { db, deps } = fixture();
    try {
        const { createSettingsProfileService } = await import('../../settings-profile/index.js');
        const prefs: Record<string, string | number | boolean> = { theme: 'ember' };
        const profile = createSettingsProfileService({ store: deps.store, prefs: { get: () => ({ ...prefs }), update: () => undefined, remove: () => undefined }, isAllowedKey: key => key === 'theme', isModOn: () => true });
        const tools = createWorkspaceTools(deps, { profile });
        const proposal = tools.call(1, 'session', { action: 'settings.propose', data: { changes: { theme: 'glass', token: 'x' }, reason: 'Светлая тема' } }) as { status: string; preview: { changes: unknown[]; dropped: string[] } };
        assert.equal(proposal.status, 'pending');
        assert.equal(proposal.preview.changes.length, 1);
        assert.deepEqual(proposal.preview.dropped, ['token']);
        assert.equal(prefs.theme, 'ember');
        assert.throws(() => tools.call(1, 'session', { action: 'settings.propose', data: { changes: { token: 'x' } } }), (error: { statusCode?: number }) => error.statusCode === 400);
    }
    finally {
        db.close();
    }
});
test('browser.* and safari.show go to the browser with this chat and only browser fields; its refusals keep their status for the agent', async () => {
    const { db, deps, revoke } = fixture();
    try {
        const calls: Array<[number, string, string, Record<string, unknown>]> = [];
        let refusal: AppError | null = null;
        const browser = {
            run: async (userId: number, sessionId: string, action: string, data: Record<string, unknown>) => {
                calls.push([userId, sessionId, action, data]);
                if (refusal) throw refusal;
                return { pageId: 'chat-session', url: 'https://kwork.ru/', title: 'Kwork', message: 'Открыта «Kwork»' };
            },
        };
        const tools = createWorkspaceTools(deps, { browser });
        const opened = await tools.call(1, 'session', { action: 'browser.open', data: { url: 'https://kwork.ru/' } }) as { pageId: string };
        assert.equal(opened.pageId, 'chat-session');
        await tools.call(1, 'session', { action: 'browser.click', data: { selector: '#go', projectId: 'other', sessionId: 'x' } });
        await tools.call(1, 'session', { action: 'browser.type', data: { text: 'q', selector: '#q', submit: true } });
        for (const action of ['browser.press', 'browser.scroll', 'browser.read', 'browser.eval', 'browser.wait', 'browser.screenshot', 'browser.close']) {
            await tools.call(1, 'session', { action });
        }
        await tools.call(1, 'session', { action: 'safari.show', data: { url: 'https://example.com/', windowId: 'chat-x' } });
        assert.deepEqual(calls.slice(0, 3), [
            [1, 'session', 'browser.open', { url: 'https://kwork.ru/' }],
            [1, 'session', 'browser.click', { selector: '#go' }],
            [1, 'session', 'browser.type', { text: 'q', selector: '#q', submit: true }],
        ]);
        assert.deepEqual(calls.at(-1), [1, 'session', 'safari.show', { url: 'https://example.com/', windowId: 'chat-x' }]);
        assert.equal(calls.length, 11);

        refusal = new AppError('Браузер доступен только администратору', { code: 'FORBIDDEN', statusCode: 403 });
        await assert.rejects(Promise.resolve(tools.call(1, 'session', { action: 'browser.read' })), (error: { statusCode?: number; message: string; constructor: { name: string } }) => error.statusCode === 403 && /администратору/.test(error.message) && error.constructor.name === 'WorkspaceError');
        refusal = new AppError('Мод выключен', { code: 'MOD_OFF', statusCode: 409 });
        await assert.rejects(Promise.resolve(tools.call(1, 'session', { action: 'safari.show' })), (error: { statusCode?: number }) => error.statusCode === 409);
        // An unknown browser action is not delegated.
        assert.throws(() => tools.call(1, 'session', { action: 'browser.download' }), (error: { statusCode?: number }) => error.statusCode === 403);

        // A chat the user no longer has access to never reaches the browser.
        revoke();
        assert.throws(() => tools.call(1, 'session', { action: 'browser.open', data: { url: 'https://kwork.ru/' } }), (error: { statusCode?: number }) => error.statusCode === 403);
        assert.equal(calls.length, 13);
    }
    finally {
        db.close();
    }
});
test('agent.list shows the owner\'s team (role = first line); a non-admin gets an empty list with a note; the switched-off mod answers with its text', () => {
    const { db, deps } = fixture();
    try {
        const team = [{ id: 'a1', name: 'Критик', role: 'Ищешь слабые места.\nВторая строка роли', provider: 'claude', model: 'sonnet[1m]' }];
        let modOn = true;
        const agents = { list: (userId: number) => (userId === 1 ? team : []), addRule: () => { throw new Error('not here'); }, agentOfSession: () => null };
        const asAdmin = { ...deps, isAdmin: (id: number) => id === 1 };
        const tools = createWorkspaceTools(asAdmin, { agents: agents as never, isModOn: () => modOn });
        const listed = tools.call(1, 'session', { action: 'agent.list' }) as { agents: unknown[] };
        assert.deepEqual(listed.agents, [{ name: 'Критик', role: 'Ищешь слабые места.', provider: 'claude', model: 'sonnet[1m]' }]);
        const denied = tools.call(2, 'session', { action: 'agent.list' }) as { agents: unknown[]; note: string };
        assert.deepEqual(denied.agents, []);
        assert.match(denied.note, /администратор/);
        modOn = false;
        assert.throws(() => tools.call(1, 'session', { action: 'agent.list' }), (error: { statusCode?: number; message: string }) => error.statusCode === 409 && /выключен/.test(error.message));
    }
    finally {
        db.close();
    }
});
test('agent.remember adds a rule to the agent of this chat as "agent"; a chat without agent and a non-admin are refused', () => {
    const { db, deps } = fixture();
    try {
        const added: Array<[number, string, string, string]> = [];
        const agents = {
            list: () => [],
            agentOfSession: (sessionId: string) => (sessionId === 'agent-chat' ? { id: 'a1', name: 'Художник' } : null),
            addRule: (userId: number, agentId: string, text: string, by: string) => { added.push([userId, agentId, text, by]); return { version: 3 }; },
        };
        const tools = createWorkspaceTools({ ...deps, isAdmin: (id: number) => id === 1 }, { agents: agents as never, isModOn: () => true });
        const done = tools.call(1, 'agent-chat', { action: 'agent.remember', data: { text: '  не писать CDEK на этикетке ' } }) as { message: string };
        assert.match(done.message, /Правило добавлено, версия V3/);
        assert.deepEqual(added, [[1, 'a1', 'не писать CDEK на этикетке', 'agent']]);
        assert.throws(() => tools.call(1, 'plain-chat', { action: 'agent.remember', data: { text: 'x' } }), /не привязан к агенту/);
        assert.throws(() => tools.call(1, 'agent-chat', { action: 'agent.remember', data: { text: '   ' } }), /правил/);
        assert.throws(() => tools.call(2, 'agent-chat', { action: 'agent.remember', data: { text: 'x' } }), (error: { statusCode?: number }) => error.statusCode === 403);
        assert.equal(added.length, 1);
    }
    finally {
        db.close();
    }
});
test('secret.request waits for Dima: the tool answer carries the name, never the value; teammate and switched-off mod are refused', async () => {
    const { db, deps } = fixture();
    const value = 'ghp_FakeToolValue_0123456789abcdefABCDEF';
    try {
        let modOn = true;
        const stored: string[] = [];
        const secretRequests = createSecretRequestsService({
            isAdmin: (id: number) => id === 1,
            isModOn: () => modOn,
            store: async ({ name, value: secret }) => { stored.push(`${name}=${secret}`); return { name }; },
            waitMs: 5_000,
        });
        const tools = createWorkspaceTools({ ...deps, isAdmin: (id: number) => id === 1 }, { secretRequests });
        const asked = Promise.resolve(tools.call(1, 'session', { action: 'secret.request', data: { name: 'FB_PAGE_TOKEN', why: 'постинг Samruk' } }));
        let cards = await secretRequests.list(1);
        for (let i = 0; cards.length === 0 && i < 100; i += 1) {
            await new Promise(resolve => setTimeout(resolve, 5));
            cards = await secretRequests.list(1);
        }
        assert.equal(cards[0].name, 'FB_PAGE_TOKEN');
        await secretRequests.answer(1, cards[0].id, { value });
        const answer = await asked as { status: string; message: string };
        assert.equal(answer.status, 'saved');
        assert.equal(answer.message, 'FB_PAGE_TOKEN сохранён в файле секретов');
        assert.equal(JSON.stringify(answer).includes(value), false);
        assert.deepEqual(stored, [`FB_PAGE_TOKEN=${value}`]);

        await assert.rejects(Promise.resolve(tools.call(1, 'session', { action: 'secret.request', data: { name: 'bad name', why: 'x' } })), (error: { statusCode?: number; constructor: { name: string } }) => error.statusCode === 400 && error.constructor.name === 'WorkspaceError');
        await assert.rejects(Promise.resolve(tools.call(2, 'session', { action: 'secret.request', data: { name: 'FB_PAGE_TOKEN', why: 'x' } })), (error: { statusCode?: number }) => error.statusCode === 403);
        modOn = false;
        await assert.rejects(Promise.resolve(tools.call(1, 'session', { action: 'secret.request', data: { name: 'FB_PAGE_TOKEN', why: 'x' } })), (error: { statusCode?: number; message: string }) => error.statusCode === 409 && error.message === modOffMessage('modSecretRequest'));
    }
    finally {
        db.close();
    }
});
