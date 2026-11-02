import type { MailDraftInput, MailMessage } from '../../../shared/agent-mail.js';
import { WorkspaceError } from '../agent-workspace/index.js';
export interface MailConfig {
    apiKey: string;
    inboxId: string;
    ownerUserId: number;
    timeoutMs?: number;
}
export interface MailProvider {
    list(page?: string): Promise<{
        messages: {
            message_id: string;
        }[];
        next_page_token?: string;
    }>;
    read(id: string): Promise<MailMessage>;
    attachment(messageId: string, id: string): Promise<{
        download_url: string;
    }>;
    send(input: MailDraftInput, replyMessageId?: string): Promise<{
        message_id: string;
        thread_id: string;
    }>;
}
// Contracts: https://docs.agentmail.to/api-reference/inboxes/messages/{list,get,send,reply,get-attachment}
// No documented send idempotency key is assumed; service persists uncertain attempts.
export function createMailProvider(config: MailConfig, fetchImpl: typeof fetch = fetch): MailProvider {
    const request = async <T>(suffix: string, body?: unknown): Promise<T> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 15000);
        try {
            const response = await fetchImpl('https://api.agentmail.to/v0/inboxes/' + encodeURIComponent(config.inboxId) + suffix, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal, redirect: 'error' });
            if (!response.ok || Number(response.headers.get('content-length')) > 6000000)
                throw new Error();
            const reader = response.body?.getReader();
            if (!reader)
                throw new Error();
            const chunks: Uint8Array[] = [];
            let total = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                total += value.byteLength;
                if (total > 6000000) {
                    await reader.cancel();
                    throw new Error();
                }
                chunks.push(value);
            }
            return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
        }
        catch {
            throw new WorkspaceError('AgentMail не ответил корректно; результат отправки может быть неизвестен', 502);
        }
        finally {
            clearTimeout(timer);
        }
    };
    return {
        list: page => request('/messages?limit=25' + (page ? '&page_token=' + encodeURIComponent(page) : '')),
        async read(id) { const r = await request<Record<string, unknown>>('/messages/' + encodeURIComponent(id)); if (typeof r.message_id !== 'string' || typeof r.thread_id !== 'string')
            throw new WorkspaceError('Некорректное письмо AgentMail', 502); const strings = (v: unknown) => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []; return { inboxId: config.inboxId, messageId: r.message_id, threadId: r.thread_id, from: String(r.from ?? ''), to: strings(r.to), subject: String(r.subject ?? ''), text: String(r.text ?? r.extracted_text ?? r.html ?? ''), timestamp: String(r.timestamp ?? ''), labels: strings(r.labels), attachments: Array.isArray(r.attachments) ? r.attachments.map((a: {
                attachment_id: string;
                filename?: string;
                content_type?: string;
                size: number;
            }) => ({ id: a.attachment_id, filename: a.filename ?? 'Вложение', contentType: a.content_type ?? 'application/octet-stream', size: a.size })) : [] }; },
        attachment: (messageId, id) => request('/messages/' + encodeURIComponent(messageId) + '/attachments/' + encodeURIComponent(id)),
        send(input, replyMessageId) { const { replyToId: _, attachments, ...body } = input; const payload: Record<string, unknown> = { ...body, attachments: attachments.map(a => ({ filename: a.filename, content_type: a.contentType, content: a.content })) }; if (replyMessageId)
            delete payload.subject; return request(replyMessageId ? '/messages/' + encodeURIComponent(replyMessageId) + '/reply' : '/messages/send', payload); },
    };
}
