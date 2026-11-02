import React, { useCallback, useEffect, useState } from 'react';

import type { WorkspacePanelProps, WorkspaceRecord, WorkspaceUser, WorkspaceSource } from '../../../../shared/agent-workspace';
import type { Assignment, AssignmentStatus } from '../../../../shared/workspace-team';
import { workspaceApi, workspaceJson } from '../api';
import SendToAgentButton from '../SendToAgentButton';
const fieldClass='w-full rounded border bg-transparent p-2';
export function TeamPanel({projectId,onClose}:WorkspacePanelProps) {
 const [rows,setRows]=useState<WorkspaceRecord<Assignment>[]>([]),[users,setUsers]=useState<WorkspaceUser[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[notice,setNotice]=useState(0);
 const [edit,setEdit]=useState<WorkspaceRecord<Assignment>|null>(null),[title,setTitle]=useState(''),[body,setBody]=useState(''),[assigneeId,setAssigneeId]=useState(''),[dueAt,setDueAt]=useState(''),[attachmentId,setAttachmentId]=useState(''),[attachments,setAttachments]=useState<WorkspaceSource[]>([]);
 const refresh=useCallback(async()=>{try{const query='?projectId='+encodeURIComponent(projectId);const [tasks,people,n]=await Promise.all([workspaceApi<WorkspaceRecord<Assignment>[]>('/team/assignments'+query),workspaceApi<WorkspaceUser[]>('/team/users'+query),workspaceApi<{count:number}>('/team/notifications'+query)]);setRows(tasks);setUsers(people);setNotice(n.count);setError('');}catch(e){setRows([]);setNotice(0);setError((e as Error).message);}finally{setLoading(false);}},[projectId]);
 useEffect(()=>{setRows([]);setEdit(null);setTitle('');setBody('');setDueAt('');setAttachments([]);setAssigneeId('');setLoading(true);void refresh();const timer=setInterval(()=>void refresh(),15000);return()=>clearInterval(timer);},[refresh]);
 const act=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const reset=()=>{setEdit(null);setTitle('');setBody('');setDueAt('');setAttachments([]);};
 const patch=(r:WorkspaceRecord<Assignment>,value:Partial<Assignment>)=>act(()=>workspaceApi('/team/assignments/'+encodeURIComponent(r.id),workspaceJson('PATCH',{revision:r.revision,...value})));
 const startEdit=(r:WorkspaceRecord<Assignment>)=>{setEdit(r);setTitle(r.payload.title);setBody(r.payload.body);setAssigneeId(String(r.payload.assigneeId));setDueAt(r.payload.dueAt??'');setAttachments(r.payload.attachments);};
 return <section className="space-y-4" aria-label="Командные поручения">
 <div role="status" className="rounded border p-3">{notice>0?`Новые поручения для вас: ${notice}`:'Новых поручений нет'}. Обновление каждые 15 секунд.</div>
 {error&&<p role="alert" className="text-red-500">{error}</p>}
 <form className="space-y-2 rounded border p-3" onSubmit={e=>{e.preventDefault();void act(async()=>{const values={title,body,assigneeId:Number(assigneeId),dueAt:dueAt||null,attachments};await workspaceApi(edit?'/team/assignments/'+encodeURIComponent(edit.id):'/team/assignments',workspaceJson(edit?'PATCH':'POST',edit?{revision:edit.revision,...values}:{projectId,...values}));reset();});}}>
 <h3 className="font-medium">{edit?'Редактировать поручение':'Новое поручение'}</h3>
 <label className="block">Название<input required maxLength={500} className={fieldClass} value={title} onChange={e=>setTitle(e.target.value)}/></label>
 <label className="block">Исполнитель<select required className={fieldClass} value={assigneeId} onChange={e=>setAssigneeId(e.target.value)}><option value="">Выберите сотрудника</option>{users.map(u=><option key={u.id} value={u.id}>{u.username}</option>)}</select></label>
 <label className="block">Срок с часовым поясом<input className={fieldClass} placeholder="2026-11-03T18:00:00+03:00" value={dueAt} onChange={e=>setDueAt(e.target.value)}/></label>
 <label className="block">Материалы и описание<textarea maxLength={20000} className={fieldClass} value={body} onChange={e=>setBody(e.target.value)}/></label>
 <label className="block">Файл проекта (относительный путь)<input className={fieldClass} value={attachmentId} onChange={e=>setAttachmentId(e.target.value)}/></label><button type="button" disabled={!attachmentId||attachments.length>=10} onClick={()=>{setAttachments([...attachments,{kind:'file',id:attachmentId}]);setAttachmentId('');}}>Добавить ссылку на материал</button>
 {attachments.map((a,i)=><div key={i}>{a.id} <button type="button" onClick={()=>setAttachments(attachments.filter((_,j)=>j!==i))}>Убрать ссылку</button></div>)}
 <div className="flex gap-3"><button disabled={busy} className="rounded border px-3 py-2" type="submit">{busy?'Сохраняем…':'Сохранить поручение'}</button>{edit&&<button type="button" onClick={reset}>Отмена</button>}</div>
 </form>
 {loading?<p>Загружаем поручения…</p>:rows.length===0?<p>Поручений в этом проекте пока нет.</p>:rows.map(r=><article className="space-y-2 rounded border p-3" key={r.id}><h3 className="font-medium">{r.payload.title}</h3><p>От: {users.find(u=>u.id===r.ownerUserId)?.username??r.ownerUserId} · Кому: {users.find(u=>u.id===r.payload.assigneeId)?.username??r.payload.assigneeId}</p><p>Срок: {r.payload.dueAt?new Date(r.payload.dueAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК':'не задан'}</p><p className="whitespace-pre-wrap">{r.payload.body}</p>
 <label>Статус <select disabled={busy} value={r.payload.status} onChange={e=>void patch(r,{status:e.target.value as AssignmentStatus})}><option value="open">Новое</option><option value="in_progress">В работе</option><option value="done">Готово</option><option value="cancelled">Отменено</option></select></label>
 <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={()=>startEdit(r)}>Редактировать</button>{!r.payload.seen&&<button disabled={busy} onClick={()=>void patch(r,{seen:true})}>Прочитано (получатель)</button>}<SendToAgentButton projectId={projectId} source={{kind:'assignment',id:r.id,version:String(r.revision)}} onClose={onClose}/></div>
 {r.payload.attachments.map((a,i)=><div key={i}>{a.id} <SendToAgentButton projectId={projectId} source={a} onClose={onClose}/></div>)}
 </article>)}
 </section>;
}
export default TeamPanel;
