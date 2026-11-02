import React, { useEffect, useState } from 'react';

import type { MailDraft, MailDraftInput, MailMessage } from '../../../../shared/agent-mail';
import type { WorkspacePanelProps, WorkspaceRecord } from '../../../../shared/agent-workspace';
import { workspaceApi, workspaceJson } from '../api';
import SendToAgentButton from '../SendToAgentButton';
const empty = (): MailDraftInput => ({ to: [], cc: [], bcc: [], subject: '', text: '', attachments: [] });
const labels = { draft: 'Черновик', approved: 'Утверждён', sending: 'Отправляется / итог ещё не подтверждён', accepted: 'Принято AgentMail — доставка не подтверждена', uncertain: 'Итог неизвестен. Не отправляйте повторно; проверьте ящик AgentMail.' };
export function MailPanel({ projectId, onClose }: WorkspacePanelProps) {
    const [configured, setConfigured] = useState<boolean | null>(null), [messages, setMessages] = useState<WorkspaceRecord<MailMessage>[]>([]), [drafts, setDrafts] = useState<WorkspaceRecord<MailDraft>[]>([]), [selected, setSelected] = useState<WorkspaceRecord<MailMessage> | null>(null), [draft, setDraft] = useState<WorkspaceRecord<MailDraft> | null>(null), [input, setInput] = useState<MailDraftInput>(empty), [error, setError] = useState(''), [busy, setBusy] = useState(false), [nextPage, setNextPage] = useState<string | null>(null), [dirty, setDirty] = useState(false);
    const refresh = async () => { const status = await workspaceApi<{
        configured: boolean;
    }>('/mail/status'); setConfigured(status.configured); if (status.configured) {
        const [m, d] = await Promise.all([workspaceApi<WorkspaceRecord<MailMessage>[]>('/mail/messages'), workspaceApi<WorkspaceRecord<MailDraft>[]>('/mail/drafts')]);
        setMessages(m);
        setDrafts(d);
    } };
    const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try {
        await fn();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка почты');
    }
    finally {
        setBusy(false);
    } };
    useEffect(() => { void run(refresh); }, []);
    const load = (d: WorkspaceRecord<MailDraft>) => { setDraft(d); setInput(d.payload.input); setDirty(false); };
    const change = (patch: Partial<MailDraftInput>) => { setInput(v => ({ ...v, ...patch })); setDirty(true); };
    const locked = !!draft && !['draft', 'approved'].includes(draft.payload.state);
    return <section className="space-y-3"><h3 className="text-lg font-semibold">Почта</h3>{error && <p role="alert" className="text-red-500">{error}</p>}{configured === null ? <p>Загрузка…</p> : !configured ? <p>Почта не подключена. Настройте на сервере AGENTMAIL_API_KEY, AGENTMAIL_INBOX_ID и AGENTMAIL_OWNER_USER_ID. Не вставляйте ключ в чат.</p> : <>
 <div className="flex gap-2"><button disabled={busy} onClick={() => void run(async () => { const result = await workspaceApi<{
            nextPage: string | null;
        }>('/mail/sync', workspaceJson('POST', {})); setNextPage(result.nextPage); await refresh(); })}>Синхронизировать</button>{nextPage && <button disabled={busy} onClick={() => void run(async () => { const result = await workspaceApi<{
            nextPage: string | null;
        }>('/mail/sync', workspaceJson('POST', { page: nextPage })); setNextPage(result.nextPage); await refresh(); })}>Следующие 25 писем</button>}<button disabled={busy} onClick={() => { setDraft(null); setInput(empty()); setDirty(true); }}>Новое письмо</button></div>
 {!messages.length && <p>Сохранённых писем пока нет.</p>}<ul>{messages.map(m => <li key={m.id}><button className="text-left underline" onClick={() => setSelected(m)}>{m.payload.subject || 'Без темы'} · {m.payload.from}</button></li>)}</ul>
 {selected && <article className="space-y-2 rounded border p-3"><h4>{selected.payload.subject}</h4><p>От: {selected.payload.from} → {selected.payload.to.join(', ')}</p><pre className="whitespace-pre-wrap break-words">{selected.payload.text}</pre><ul>{selected.payload.attachments.map(a => <li key={a.id}><button disabled={busy} onClick={() => void run(async () => { const { url } = await workspaceApi<{
            url: string;
        }>('/mail/messages/' + encodeURIComponent(selected.id) + '/attachments/' + encodeURIComponent(a.id)); const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.click(); })}>{a.filename} ({a.size} байт) — открыть вложение</button></li>)}</ul><div><h5>Письма этой цепочки</h5>{messages.filter(m => m.payload.threadId === selected.payload.threadId).map(m => <button className="block underline" key={m.id} onClick={() => setSelected(m)}>{m.payload.from} · {m.payload.timestamp}</button>)}</div><button onClick={() => { setDraft(null); setInput({ ...empty(), subject: selected.payload.subject, to: [selected.payload.from.match(/<([^>]+)>/)?.[1] ?? selected.payload.from], replyToId: selected.id }); setDirty(true); }}>Ответить в этой цепочке</button><SendToAgentButton projectId={projectId} source={{ kind: 'mail-message', id: selected.id, version: String(selected.revision) }} onClose={onClose}/></article>}
 <h4>Черновики</h4><ul>{drafts.map(d => <li key={d.id}><button onClick={() => load(d)}>{d.payload.input.subject || 'Без темы'} · {labels[d.payload.state]}</button></li>)}</ul>
 <fieldset disabled={busy || locked} className="space-y-2 rounded border p-3"><legend>{draft ? 'Редактирование' : 'Новое письмо'}</legend>{(['to', 'cc', 'bcc'] as const).map((key, i) => <label className="block" key={key}>{['Кому', 'Копия', 'Скрытая копия'][i]}<input className="w-full rounded border bg-transparent p-2" value={input[key].join(', ')} onChange={e => change({ [key]: e.target.value ? e.target.value.split(',').map(s => s.trim()) : [] })}/></label>)}<label className="block">Тема<input className="w-full rounded border bg-transparent p-2" disabled={!!input.replyToId} value={input.subject} onChange={e => change({ subject: e.target.value })}/></label><label className="block">Текст<textarea className="w-full rounded border bg-transparent p-2" rows={6} value={input.text} onChange={e => change({ text: e.target.value })}/></label><label className="block">Вложения (всего до 1,5 МБ)<input type="file" multiple onChange={e => { const files = Array.from(e.target.files ?? []); void run(async () => { if (files.reduce((n, f) => n + f.size, 0) > 1500000 || files.length > 10)
            throw new Error('Выберите до 10 файлов общим размером до 1,5 МБ'); const attachments = await Promise.all(files.map(file => new Promise<MailDraftInput['attachments'][number]>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('Не удалось прочитать файл')); reader.onload = () => resolve({ filename: file.name, contentType: file.type || 'application/octet-stream', content: String(reader.result).split(',')[1] }); reader.readAsDataURL(file); }))); change({ attachments }); }); }}/></label><ul>{input.attachments.map((a, i) => <li key={i}>{a.filename} <button onClick={() => change({ attachments: input.attachments.filter((_, n) => n !== i) })}>Убрать</button></li>)}</ul><button onClick={() => void run(async () => { const d = await workspaceApi<WorkspaceRecord<MailDraft>>('/mail/drafts' + (draft ? '/' + encodeURIComponent(draft.id) : ''), workspaceJson(draft ? 'PATCH' : 'POST', draft ? { revision: draft.revision, input } : input)); load(d); await refresh(); })}>Сохранить черновик</button></fieldset>
 {draft && <div className="space-y-2"><p>{labels[draft.payload.state]}</p>{dirty && <p>Есть несохранённые изменения. Сначала сохраните черновик.</p>}{draft.payload.state === 'draft' && <button disabled={busy || dirty} onClick={() => void run(async () => { load(await workspaceApi('/mail/drafts/' + encodeURIComponent(draft.id) + '/approve', workspaceJson('POST', { revision: draft.revision }))); await refresh(); })}>Утвердить адресатов, текст и вложения</button>}{draft.payload.state === 'approved' && <button disabled={busy || dirty} onClick={() => void run(async () => { load(await workspaceApi('/mail/drafts/' + encodeURIComponent(draft.id) + '/send', workspaceJson('POST', { revision: draft.revision }))); await refresh(); })}>Отправить утверждённое письмо</button>}<button disabled={busy} onClick={() => void run(async () => { load(await workspaceApi('/mail/drafts/' + encodeURIComponent(draft.id))); await refresh(); })}>Обновить статус</button></div>}
 </>}</section>;
}
export default MailPanel;
