import type { Assignment, AssignmentInput } from '../../../shared/workspace-team.js';
import { requireWorkspaceProject, requireWorkspaceUser, WorkspaceError, type WorkspaceDependencies } from '../agent-workspace/index.js';
export function createAssignments(deps:WorkspaceDependencies) {
 const get=(userId:number,id:string)=>{
  requireWorkspaceUser(deps,userId);const row=deps.store.get<Assignment>(id);
  if(!row||row.kind!=='assignment')throw new WorkspaceError('Поручение не найдено',404);
  if(row.ownerUserId!==userId&&row.payload.assigneeId!==userId)throw new WorkspaceError('Нет доступа',403);
  requireWorkspaceProject(deps,row.ownerUserId,row.projectId!);requireWorkspaceProject(deps,row.payload.assigneeId,row.projectId!);return row;
 };
 const validate=(value:Assignment):Assignment=>{
  if(typeof value.title!=='string'||!value.title.trim()||value.title.length>500||typeof value.body!=='string'||value.body.length>20000)throw new WorkspaceError('Название до 500, материалы до 20000 знаков');
  if(value.dueAt!==null&&(typeof value.dueAt!=='string'||!Number.isFinite(Date.parse(value.dueAt))))throw new WorkspaceError('Некорректный срок');
  if(!['open','in_progress','done','cancelled'].includes(value.status)||typeof value.seen!=='boolean')throw new WorkspaceError('Некорректный статус');
  if(!Array.isArray(value.attachments)||value.attachments.length>10||value.attachments.some(a=>!a||typeof a.id!=='string'||a.id.length>1000||typeof a.kind!=='string'||!['file','document','assignment'].includes(a.kind)||a.version!==undefined&&typeof a.version!=='string'))throw new WorkspaceError('Некорректные ссылки на материалы');
  return {...value,title:value.title.trim(),dueAt:value.dueAt===null?null:new Date(value.dueAt).toISOString(),attachments:value.attachments.map(a=>({kind:a.kind,id:a.id,...(a.version?{version:a.version}:{})}))};
 };
 const service={
  getAssignment:get,
  users(userId:number,projectId:string){requireWorkspaceProject(deps,userId,projectId);return deps.listUsers().filter(u=>deps.canAccessProject(u.id,projectId));},
  listAssignments(userId:number,projectId:string){requireWorkspaceProject(deps,userId,projectId);return deps.store.list<Assignment>('assignment',{projectId}).filter(r=>(r.ownerUserId===userId||r.payload.assigneeId===userId)&&deps.getUser(r.ownerUserId)&&deps.getUser(r.payload.assigneeId)&&deps.canAccessProject(r.ownerUserId,projectId)&&deps.canAccessProject(r.payload.assigneeId,projectId));},
  createAssignment(userId:number,input:AssignmentInput,id?:string,intakeId?:string){
   requireWorkspaceProject(deps,userId,input.projectId);requireWorkspaceProject(deps,input.assigneeId,input.projectId);
   return deps.store.create({id,kind:'assignment',ownerUserId:userId,projectId:input.projectId,payload:validate({assigneeId:input.assigneeId,title:input.title,body:input.body,dueAt:input.dueAt,status:'open',attachments:input.attachments,seen:false,...(intakeId?{intakeId}:{})})});
  },
  updateAssignment(userId:number,id:string,revision:number,patch:Partial<Assignment>){
   const row=get(userId,id);const allowed=row.ownerUserId===userId?['title','body','dueAt','status','attachments','assigneeId','seen']:['status','seen'];
   if(Object.keys(patch).some(k=>!allowed.includes(k)))throw new WorkspaceError('Нет доступа к изменению поля',403);
   if(patch.seen!==undefined&&userId!==row.payload.assigneeId)throw new WorkspaceError('Отметить прочитанным может получатель',403);
   const value=validate({...row.payload,...patch});requireWorkspaceProject(deps,value.assigneeId,row.projectId!);
   if(value.assigneeId!==row.payload.assigneeId)value.seen=false;
   return deps.store.update(id,revision,value);
  },
  notifications(userId:number,projectId:string){const records=service.listAssignments(userId,projectId).filter(r=>r.payload.assigneeId===userId&&!r.payload.seen&&r.payload.status!=='done'&&r.payload.status!=='cancelled');return {count:records.length,ids:records.map(r=>r.id)};},
 };
 return service;
}
export function registerTeamHandoff(deps:WorkspaceDependencies) {
 deps.handoffs.set('assignment',({userId,projectId,source})=>{const row=createAssignments(deps).getAssignment(userId,source.id);if(row.projectId!==projectId)throw new WorkspaceError('Другой проект',403);return {text:JSON.stringify({title:row.payload.title,body:row.payload.body,dueAt:row.payload.dueAt,status:row.payload.status,attachments:row.payload.attachments}),version:String(row.revision)};});
}
