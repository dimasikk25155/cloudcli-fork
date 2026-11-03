import { createHash, randomBytes } from 'node:crypto';

import type { IntakeField, IntakeForm, IntakeSession, PublicIntakeState } from '../../../shared/workspace-team.js';
import { requireWorkspaceProject, WorkspaceError, type WorkspaceDependencies } from '../agent-workspace/index.js';

import { createAssignments } from './service.js';
const secret=()=>randomBytes(32).toString('base64url');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function validateFields(fields:IntakeField[]):IntakeField[] {
 if(!Array.isArray(fields)||fields.length<1||fields.length>20)throw new WorkspaceError('От 1 до 20 вопросов');
 const ids=new Set<string>();
 return fields.map(f=>{
  if(!f||typeof f.id!=='string'||!/^[a-z][a-z0-9_]{0,31}$/.test(f.id)||ids.has(f.id)||['constructor','prototype','__proto__'].includes(f.id))throw new WorkspaceError('Уникальный id поля: латиница, цифры, подчёркивание');ids.add(f.id);
  if(typeof f.label!=='string'||!f.label.trim()||f.label.length>300||typeof f.required!=='boolean'||!['text','email','number','choice'].includes(f.type))throw new WorkspaceError('Некорректный вопрос');
  if(f.type==='choice'&&(!Array.isArray(f.choices)||f.choices.length<1||f.choices.length>20||f.choices.some(c=>typeof c!=='string'||!c.trim()||c.length>200)||new Set(f.choices).size!==f.choices.length))throw new WorkspaceError('Укажите от 1 до 20 уникальных вариантов');
  return {id:f.id,label:f.label.trim(),type:f.type,required:f.required,...(f.type==='choice'?{choices:[...f.choices!]}:{})};
 });
}
export function createIntake(deps:WorkspaceDependencies) {
 const assignments=createAssignments(deps);
 const title=(v:string)=>{if(typeof v!=='string'||!v.trim()||v.length>200)throw new WorkspaceError('Название до 200 знаков');return v.trim();};
 const ownForm=(userId:number,id:string)=>{const r=deps.store.get<IntakeForm>(id);if(!r||r.kind!=='intake-form')throw new WorkspaceError('Анкета не найдена',404);requireWorkspaceProject(deps,userId,r.projectId!);if(r.ownerUserId!==userId)throw new WorkspaceError('Нет доступа',403);return r;};
 const available=(id:string)=>{const r=deps.store.get<IntakeForm>(id);if(!r||r.kind!=='intake-form'||!r.payload.enabled||!deps.getUser(r.ownerUserId)||!deps.getProject(r.projectId!)||!deps.canAccessProject(r.ownerUserId,r.projectId!))throw new WorkspaceError('Анкета недоступна',404);return r;};
 const state=(r:{payload:IntakeSession;revision:number}):PublicIntakeState=>({title:r.payload.title,question:r.payload.fields[r.payload.next]??null,step:r.payload.next,total:r.payload.fields.length,complete:r.payload.next===r.payload.fields.length,revision:r.revision,answers:r.payload.answers});
 const session=(token:string)=>{
  if(typeof token!=='string'||!/^[-\w]{43}$/.test(token))throw new WorkspaceError('Сессия недоступна',404);
  const r=deps.store.get<IntakeSession>('intake-session:'+hash(token));
  if(!r||r.kind!=='intake-session'||r.payload.capabilityHash!==hash(token)||Date.parse(r.payload.expiresAt)<=Date.parse(deps.now()))throw new WorkspaceError('Сессия истекла или недоступна',404);
  available(r.payload.formId);return r;
 };
 const service={
  listForms(userId:number,projectId:string){requireWorkspaceProject(deps,userId,projectId);return deps.store.list<IntakeForm>('intake-form',{ownerUserId:userId,projectId});},
  createForm(userId:number,input:{projectId:string;title:string;fields:IntakeField[]}){
   requireWorkspaceProject(deps,userId,input.projectId);
   if(deps.store.list('intake-form',{ownerUserId:userId}).length>=50)throw new WorkspaceError('Лимит: 50 анкет',429);
   const token=secret();return deps.store.create({id:'intake-form:'+hash(token),kind:'intake-form',ownerUserId:userId,projectId:input.projectId,payload:{title:title(input.title),fields:validateFields(input.fields),enabled:false,token}});
  },
  updateForm(userId:number,id:string,revision:number,patch:Partial<Pick<IntakeForm,'title'|'fields'|'enabled'>>){const r=ownForm(userId,id);if(Object.keys(patch).some(k=>!['title','fields','enabled'].includes(k)))throw new WorkspaceError('Некорректное поле');const value={...r.payload,...patch};if(typeof value.enabled!=='boolean')throw new WorkspaceError('Некорректное состояние');return deps.store.update(id,revision,{...value,title:title(value.title),fields:validateFields(value.fields)});},
  start(token:string){
   if(typeof token!=='string'||!/^[-\w]{43}$/.test(token))throw new WorkspaceError('Анкета недоступна',404);
   const form=available('intake-form:'+hash(token));
   return deps.store.transaction(()=>{
    if(deps.store.list<IntakeSession>('intake-session',{ownerUserId:form.ownerUserId,projectId:form.projectId}).filter(r=>r.payload.formId===form.id).length>=500)throw new WorkspaceError('Приём заявок временно ограничен',429);
    const sessionToken=secret();const payload:IntakeSession={formId:form.id,title:form.payload.title,fields:form.payload.fields,capabilityHash:hash(sessionToken),answers:{},next:0,expiresAt:new Date(Date.parse(deps.now())+7*86400000).toISOString(),requests:0};
    const r=deps.store.create({id:'intake-session:'+hash(sessionToken),kind:'intake-session',ownerUserId:form.ownerUserId,projectId:form.projectId,payload});return {sessionToken,state:state(r)};
   });
  },
  resume(token:string){return state(session(token));},
  answer(token:string,revision:number,fieldId:string,value:unknown){
   const r=session(token);if(revision!==r.revision)throw new WorkspaceError('Ответ изменён; обновите анкету',409);
   if(r.payload.requests>=100)throw new WorkspaceError('Лимит ответов',429);
   const f=r.payload.fields[r.payload.next];if(!f||f.id!==fieldId)throw new WorkspaceError('Ожидается другой вопрос',409);
   let answer:string|number|null=null;
   if(value!==null&&value!==''){
    if(f.type==='number'){if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e12)throw new WorkspaceError('Введите число');answer=value;}
    else{if(typeof value!=='string'||value.length>4000||!value.trim())throw new WorkspaceError('Ответ до 4000 знаков');answer=value.trim();if(f.type==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer))throw new WorkspaceError('Проверьте email');if(f.type==='choice'&&!f.choices?.includes(answer))throw new WorkspaceError('Выберите вариант из списка');}
   }
   if(JSON.stringify({...r.payload.answers,[f.id]:answer}).length>12000)throw new WorkspaceError('Общий объём ответов не больше 12000 знаков');
   if(answer===null&&f.required)throw new WorkspaceError('Обязательный вопрос');
   return state(deps.store.update(r.id,revision,{...r.payload,answers:{...r.payload.answers,[f.id]:answer},next:r.payload.next+1,requests:r.payload.requests+1}));
  },
  listLeads(userId:number,formId:string){const form=ownForm(userId,formId);return deps.store.list<IntakeSession>('intake-session',{ownerUserId:userId,projectId:form.projectId}).filter(r=>r.payload.formId===formId).map(r=>{const {capabilityHash:_secret,...payload}=r.payload;return {...r,payload};});},
  convertLead(userId:number,id:string,input:{assigneeId:number;dueAt:string|null}){
   return deps.store.transaction(()=>{
    const lead=deps.store.get<IntakeSession>(id);if(!lead||lead.kind!=='intake-session')throw new WorkspaceError('Заявка не найдена',404);const form=ownForm(userId,lead.payload.formId);
    if(lead.payload.assignmentId)return assignments.getAssignment(userId,lead.payload.assignmentId);
    if(lead.payload.next!==lead.payload.fields.length)throw new WorkspaceError('Анкета ещё не завершена',409);
    const body=lead.payload.fields.map(f=>f.label+': '+String(lead.payload.answers[f.id]??'Не указано')).join('\n');
    // Assignments bound body to 20KB; intake may carry up to 80KB, so reject rather than silently lose answers.
    const a=assignments.createAssignment(userId,{projectId:form.projectId!,assigneeId:input.assigneeId,dueAt:input.dueAt,title:lead.payload.title,body,attachments:[]},'intake-assignment:'+id,id);
    deps.store.update(id,lead.revision,{...lead.payload,assignmentId:a.id});return a;
   });
  },
 };return service;
}
