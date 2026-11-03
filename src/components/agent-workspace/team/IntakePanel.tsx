import React, { useCallback, useEffect, useState } from 'react';

import type { WorkspacePanelProps, WorkspaceRecord, WorkspaceUser } from '../../../../shared/agent-workspace';
import type { IntakeField, IntakeForm, IntakeSession } from '../../../../shared/workspace-team';
import { workspaceApi, workspaceJson } from '../api';
import SendToAgentButton from '../SendToAgentButton';
type Lead=WorkspaceRecord<Omit<IntakeSession,'capabilityHash'>>;
const fieldClass='w-full rounded border bg-transparent p-2';
export function IntakePanel({projectId,onClose}:WorkspacePanelProps) {
 const [forms,setForms]=useState<WorkspaceRecord<IntakeForm>[]>([]),[selected,setSelected]=useState<WorkspaceRecord<IntakeForm>|null>(null),[leads,setLeads]=useState<Lead[]>([]),[users,setUsers]=useState<WorkspaceUser[]>([]),[assignee,setAssignee]=useState(''),[due,setDue]=useState('');
 const [title,setTitle]=useState(''),[fields,setFields]=useState<IntakeField[]>([{id:'field1',label:'',type:'text',required:true}]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const refresh=useCallback(async()=>{try{const query='?projectId='+encodeURIComponent(projectId);setForms(await workspaceApi('/team/forms'+query));setUsers(await workspaceApi('/team/users'+query));}catch(e){setForms([]);setError((e as Error).message);}finally{setLoading(false);}},[projectId]);
 useEffect(()=>{setSelected(null);setLeads([]);setLoading(true);void refresh();},[refresh]);
 const getLeads=async(id:string)=>{setLeads(await workspaceApi('/team/forms/'+encodeURIComponent(id)+'/leads'));};
 const act=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const choose=(form:WorkspaceRecord<IntakeForm>)=>{setSelected(form);setTitle(form.payload.title);setFields(form.payload.fields);setLeads([]);void act(()=>getLeads(form.id));};
 const reset=()=>{setSelected(null);setTitle('');setFields([{id:'field1',label:'',type:'text',required:true}]);setLeads([]);};
 const change=(index:number,patch:Partial<IntakeField>)=>setFields(fields.map((f,i)=>i===index?{...f,...patch}:f));
 return <section className="space-y-4" aria-label="Приём заявок">
 {error&&<p role="alert" className="text-red-500">{error}</p>}
 <p>Пошаговая анкета собирает бриф. Новая ссылка выключена, пока вы явно не разрешите приём. Сессия посетителя хранится 7 дней; максимум 500 сессий на анкету.</p>
 {loading?<p>Загружаем анкеты…</p>:forms.length===0?<p>Анкет пока нет. Добавьте вопросы ниже.</p>:<div className="flex flex-wrap gap-2">{forms.map(f=><button className="rounded border p-2" key={f.id} onClick={()=>choose(f)}>{f.payload.title} · {f.payload.enabled?'Приём открыт':'Выключена'}</button>)}</div>}
 <button onClick={reset}>Новая анкета</button>
 <form className="space-y-3 rounded border p-3" onSubmit={e=>{e.preventDefault();void act(async()=>{const result=await workspaceApi<WorkspaceRecord<IntakeForm>>(selected?'/team/forms/'+encodeURIComponent(selected.id):'/team/forms',workspaceJson(selected?'PATCH':'POST',selected?{revision:selected.revision,title,fields}:{projectId,title,fields}));setSelected(result);await getLeads(result.id);});}}>
 <label className="block">Название анкеты<input className={fieldClass} required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
 {fields.map((f,i)=><fieldset key={f.id} className="space-y-2 rounded border p-2"><legend>Вопрос {i+1}</legend><label className="block">Текст вопроса<input required maxLength={300} className={fieldClass} value={f.label} onChange={e=>change(i,{label:e.target.value})}/></label><label>Тип <select value={f.type} onChange={e=>change(i,{type:e.target.value as IntakeField['type'],choices:[]})}><option value="text">Текст</option><option value="email">Email</option><option value="number">Число</option><option value="choice">Выбор из списка</option></select></label>{f.type==='choice'&&<label className="block">Варианты, каждый с новой строки<textarea required className={fieldClass} value={(f.choices??[]).join('\n')} onChange={e=>change(i,{choices:e.target.value.split('\n')})}/></label>}<label className="block"><input type="checkbox" checked={f.required} onChange={e=>change(i,{required:e.target.checked})}/> Обязательный</label><button type="button" disabled={fields.length===1} onClick={()=>setFields(fields.filter((_,j)=>j!==i))}>Удалить вопрос</button></fieldset>)}
 <button type="button" disabled={fields.length>=20} onClick={()=>setFields([...fields,{id:'field'+Date.now(),label:'',type:'text',required:true}])}>Добавить вопрос</button><br/><button type="submit" className="rounded border px-3 py-2" disabled={busy}>{busy?'Сохраняем…':'Сохранить вопросы'}</button>
 </form>
 {selected&&<div className="space-y-3 rounded border p-3"><p>{selected.payload.enabled?'Приём заявок открыт':'Ссылка выключена'}</p><button disabled={busy} className="rounded border p-2" onClick={()=>void act(async()=>{const updated=await workspaceApi<WorkspaceRecord<IntakeForm>>('/team/forms/'+encodeURIComponent(selected.id),workspaceJson('PATCH',{revision:selected.revision,enabled:!selected.payload.enabled}));setSelected(updated);})}>{selected.payload.enabled?'Выключить ссылку':'Включить публичный приём заявок'}</button>
 {selected.payload.enabled&&<label className="block">Ссылка для посетителей<input className={fieldClass} readOnly value={window.location.origin+'/neo3-intake.html#'+selected.payload.token} onFocus={e=>e.target.select()}/></label>}
 <button onClick={()=>void act(()=>getLeads(selected.id))}>Обновить заявки</button><p>Изменение вопросов действует на новые сессии. Начатые используют сохранённые вопросы.</p>
 <label className="block">Исполнитель для нового поручения<select className={fieldClass} value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="">Выберите сотрудника</option>{users.map(u=><option key={u.id} value={u.id}>{u.username}</option>)}</select></label><label className="block">Срок с часовым поясом<input className={fieldClass} value={due} onChange={e=>setDue(e.target.value)} placeholder="2026-11-03T18:00:00+03:00"/></label>
 {leads.length===0?<p>Ответов пока нет.</p>:leads.map(lead=><article key={lead.id} className="space-y-2 rounded border p-3"><h3>{lead.payload.title} · {lead.payload.next===lead.payload.fields.length?'Бриф завершён':'Заполняется'}</h3><p>{new Date(lead.createdAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК</p><dl>{lead.payload.fields.map(f=><React.Fragment key={f.id}><dt className="font-medium">{f.label}</dt><dd className="whitespace-pre-wrap">{String(lead.payload.answers[f.id]??'Не указано')}</dd></React.Fragment>)}</dl>{lead.payload.assignmentId?<><p>Поручение создано</p><SendToAgentButton projectId={projectId} source={{kind:'assignment',id:lead.payload.assignmentId}} onClose={onClose}/></>:<button disabled={busy||!assignee||lead.payload.next!==lead.payload.fields.length} onClick={()=>void act(async()=>{await workspaceApi('/team/leads/'+encodeURIComponent(lead.id)+'/convert',workspaceJson('POST',{assigneeId:Number(assignee),dueAt:due||null}));await getLeads(selected.id);})}>Создать поручение из брифа</button>}</article>)}
 </div>}
 </section>;
}
export default IntakePanel;
