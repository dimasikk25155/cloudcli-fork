import { createHash } from 'node:crypto';

import { Router } from 'express';

import type { MailDraft, MailDraftInput, MailMessage } from '../../../shared/agent-mail.js';
import { type WorkspaceDependencies, WorkspaceError, requireWorkspaceUser, requireWorkspaceProject, workspaceHandler, workspaceUserId } from '../agent-workspace/index.js';

import { createMailProvider, type MailConfig, type MailProvider } from './provider.js';
export interface MailOptions {
    config?: MailConfig | null;
    provider?: MailProvider;
}
function environment(deps: WorkspaceDependencies): MailConfig | null { const apiKey = process.env.AGENTMAIL_API_KEY, inboxId = process.env.AGENTMAIL_INBOX_ID; const admins = deps.listUsers().filter(u => deps.isAdmin(u.id)); const ownerUserId = process.env.AGENTMAIL_OWNER_USER_ID ? Number(process.env.AGENTMAIL_OWNER_USER_ID) : admins.length === 1 ? admins[0].id : 0; return apiKey && inboxId && ownerUserId && deps.getUser(ownerUserId) ? { apiKey, inboxId, ownerUserId } : null; }
export function createMailService(deps: WorkspaceDependencies, options: MailOptions = {}) {
    const config = options.config === undefined ? environment(deps) : options.config, provider = config ? (options.provider ?? createMailProvider(config, deps.fetch)) : null;
    const owner = (userId: number) => { requireWorkspaceUser(deps, userId); if (!config || !provider)
        throw new WorkspaceError('Почта не подключена: настройте AGENTMAIL_API_KEY, AGENTMAIL_INBOX_ID и владельца', 503); if (userId !== config.ownerUserId)
        throw new WorkspaceError('Ящик доступен только владельцу', 403); return config; };
    const own = <T>(userId: number, id: string, kind: string) => { const c = owner(userId), row = deps.store.get<T & {
        inboxId: string;
    }>(id); if (!row || row.kind !== kind)
        throw new WorkspaceError('Запись не найдена', 404); if (row.ownerUserId !== userId || row.payload.inboxId !== c.inboxId)
        throw new WorkspaceError('Нет доступа', 403); return row; };
    const validate = (userId: number, value: MailDraftInput): MailDraftInput => {
        if (!value || typeof value.text !== 'string' || value.text.length > 100000 || typeof value.subject !== 'string' || value.subject.length > 998 || /[\r\n]/.test(value.subject))
            throw new WorkspaceError('Некорректный текст или тема');
        for (const key of ['to', 'cc', 'bcc'] as const)
            if (!Array.isArray(value[key]) || value[key].length > 50 || value[key].some(s => typeof s !== 'string' || s.length > 254 || !/^\S+@[^\s@]+\.[^\s@]+$/.test(s)))
                throw new WorkspaceError('Проверьте адресатов');
        if (!value.to.length)
            throw new WorkspaceError('Укажите получателя');
        if (!Array.isArray(value.attachments) || value.attachments.length > 10 || value.attachments.some(a => !a || typeof a.filename !== 'string' || !a.filename || a.filename.length > 255 || typeof a.contentType !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(a.contentType) || typeof a.content !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.content)) || value.attachments.reduce((n, a) => n + a.content.length, 0) > 2000000)
            throw new WorkspaceError('Вложения: до 10 файлов, всего до 1,5 МБ');
        if (value.replyToId) {
            const original = own<MailMessage>(userId, value.replyToId, 'mail-message');
            if (value.subject !== original.payload.subject)
                throw new WorkspaceError('Ответ сохраняет тему исходной цепочки');
        }
        return structuredClone({ to: value.to, cc: value.cc, bcc: value.bcc, subject: value.subject, text: value.text, attachments: value.attachments.map(a => ({ filename: a.filename, contentType: a.contentType, content: a.content })), ...(value.replyToId ? { replyToId: value.replyToId } : {}) });
    };
    const service = {
        status(userId: number) { requireWorkspaceUser(deps, userId); if (!config)
            return { configured: false }; owner(userId); return { configured: true }; },
        messages(userId: number) { const c = owner(userId); return deps.store.list<MailMessage>('mail-message', { ownerUserId: userId }).filter(r => r.payload.inboxId === c.inboxId); },
        read(userId: number, id: string) { return own<MailMessage>(userId, id, 'mail-message'); },
        thread(userId: number, id: string) { return service.messages(userId).filter(r => r.payload.threadId === id); },
        async sync(userId: number, page?: string) { const c = owner(userId); if (page && (typeof page !== 'string' || page.length > 4096))
            throw new WorkspaceError('Некорректная страница'); const result = await provider!.list(page); if (!Array.isArray(result.messages) || result.messages.length > 25)
            throw new WorkspaceError('Некорректная страница AgentMail', 502); for (const item of result.messages) {
            const message = await provider!.read(item.message_id);
            owner(userId);
            const id = 'mail:' + createHash('sha256').update(JSON.stringify([c.ownerUserId, c.inboxId, message.messageId])).digest('hex');
            const existing = deps.store.get(id);
            if (existing) {
                if (JSON.stringify(existing.payload) !== JSON.stringify(message))
                    deps.store.update(id, existing.revision, message);
            }
            else
                deps.store.create({ id, kind: 'mail-message', ownerUserId: userId, payload: message });
        } return { count: result.messages.length, nextPage: result.next_page_token ?? null }; },
        async attachment(userId: number, id: string, attachmentId: string) { const row = service.read(userId, id); if (!row.payload.attachments.some(a => a.id === attachmentId))
            throw new WorkspaceError('Вложение не найдено', 404); const result = await provider!.attachment(row.payload.messageId, attachmentId); owner(userId); let url: URL; try {
            url = new URL(result.download_url);
        }
        catch {
            throw new WorkspaceError('Некорректная ссылка вложения', 502);
        } if (url.protocol !== 'https:' || url.username || url.password)
            throw new WorkspaceError('Некорректная ссылка вложения', 502); return { url: url.href }; },
        drafts(userId: number) { const c = owner(userId); return deps.store.list<MailDraft>('mail-draft', { ownerUserId: userId }).filter(r => r.payload.inboxId === c.inboxId); },
        draft(userId: number, id: string) { return own<MailDraft>(userId, id, 'mail-draft'); },
        create(userId: number, input: MailDraftInput) { const c = owner(userId); return deps.store.create<MailDraft>({ kind: 'mail-draft', ownerUserId: userId, payload: { inboxId: c.inboxId, input: validate(userId, input), state: 'draft' } }); },
        update(userId: number, id: string, revision: number, input: MailDraftInput) { const row = service.draft(userId, id); if (!['draft', 'approved'].includes(row.payload.state))
            throw new WorkspaceError('Отправляемое письмо нельзя менять', 409); return deps.store.update<MailDraft>(id, revision, { inboxId: row.payload.inboxId, input: validate(userId, input), state: 'draft' }); },
        approve(userId: number, id: string, revision: number) { const row = service.draft(userId, id); if (row.payload.state !== 'draft')
            throw new WorkspaceError('Черновик уже утверждён или отправляется', 409); return deps.store.update<MailDraft>(id, revision, { ...row.payload, state: 'approved', approval: { userId, at: deps.now(), snapshot: validate(userId, row.payload.input) } }); },
        async send(userId: number, id: string, revision: number) { const row = service.draft(userId, id); if (['sending', 'accepted', 'uncertain'].includes(row.payload.state))
            return row; if (row.revision !== revision || row.payload.state !== 'approved' || !row.payload.approval || JSON.stringify(row.payload.approval.snapshot) !== JSON.stringify(row.payload.input))
            throw new WorkspaceError('Утвердите актуальную версию письма', 409); const input = validate(userId, row.payload.approval.snapshot); const reply = input.replyToId ? service.read(userId, input.replyToId).payload : undefined; const locked = deps.store.update<MailDraft>(id, revision, { ...row.payload, state: 'sending' }); try {
            const sent = await provider!.send(input, reply?.messageId);
            if (!sent.message_id || !sent.thread_id || reply && sent.thread_id !== reply.threadId)
                throw new Error();
            const sentId = 'mail:' + createHash('sha256').update(JSON.stringify([userId, config!.inboxId, sent.message_id])).digest('hex');
            if (!deps.store.get(sentId))
                deps.store.create<MailMessage>({ id: sentId, kind: 'mail-message', ownerUserId: userId, payload: { inboxId: config!.inboxId, messageId: sent.message_id, threadId: sent.thread_id, from: 'Исходящее письмо', to: input.to, subject: input.subject, text: input.text, timestamp: deps.now(), attachments: [], labels: ['sent'] } });
            return deps.store.update<MailDraft>(id, locked.revision, { ...locked.payload, state: 'accepted', messageId: sent.message_id, threadId: sent.thread_id });
        }
        catch {
            return deps.store.update<MailDraft>(id, locked.revision, { ...locked.payload, state: 'uncertain' });
        } },
    };
    return service;
}
export function registerMailHandoff(deps: WorkspaceDependencies, options: MailOptions = {}) { const service = createMailService(deps, options); deps.handoffs.set('mail-message', ({ userId, projectId, source }) => { requireWorkspaceProject(deps, userId, projectId); const row = service.read(userId, source.id); return { text: JSON.stringify({ from: row.payload.from, to: row.payload.to, subject: row.payload.subject, text: row.payload.text, attachments: row.payload.attachments }), version: String(row.revision) }; }); }
export function createMailRouter(deps: WorkspaceDependencies, options: MailOptions = {}) { const router = Router(), service = createMailService(deps, options); const route = workspaceHandler; router.get('/status', route((req, res) => res.json(service.status(workspaceUserId(req))))); router.get('/messages', route((req, res) => res.json(service.messages(workspaceUserId(req))))); router.post('/sync', route(async (req, res) => res.json(await service.sync(workspaceUserId(req), req.body?.page)))); router.get('/messages/:id', route((req, res) => res.json(service.read(workspaceUserId(req), String(req.params.id))))); router.get('/threads/:id', route((req, res) => res.json(service.thread(workspaceUserId(req), String(req.params.id))))); router.get('/messages/:id/attachments/:attachmentId', route(async (req, res) => res.json(await service.attachment(workspaceUserId(req), String(req.params.id), String(req.params.attachmentId))))); router.get('/drafts', route((req, res) => res.json(service.drafts(workspaceUserId(req))))); router.get('/drafts/:id', route((req, res) => res.json(service.draft(workspaceUserId(req), String(req.params.id))))); router.post('/drafts', route((req, res) => res.status(201).json(service.create(workspaceUserId(req), req.body)))); router.patch('/drafts/:id', route((req, res) => res.json(service.update(workspaceUserId(req), String(req.params.id), req.body.revision, req.body.input)))); router.post('/drafts/:id/approve', route((req, res) => res.json(service.approve(workspaceUserId(req), String(req.params.id), req.body.revision)))); router.post('/drafts/:id/send', route(async (req, res) => res.json(await service.send(workspaceUserId(req), String(req.params.id), req.body.revision)))); return router; }
