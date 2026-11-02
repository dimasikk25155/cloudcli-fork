import type { WorkspaceSource } from './agent-workspace.js';
export type AssignmentStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export interface Assignment { assigneeId:number; title:string; body:string; dueAt:string|null; status:AssignmentStatus; attachments:WorkspaceSource[]; seen:boolean; intakeId?:string }
export interface AssignmentInput { projectId:string; assigneeId:number; title:string; body:string; dueAt:string|null; attachments:WorkspaceSource[] }
export interface IntakeField { id:string; label:string; type:'text'|'email'|'number'|'choice'; required:boolean; choices?:string[] }
export interface IntakeForm { title:string; fields:IntakeField[]; enabled:boolean; token:string }
export interface IntakeSession { formId:string; fields:IntakeField[]; title:string; capabilityHash:string; answers:Record<string,string|number|null>; next:number; expiresAt:string; assignmentId?:string; requests:number }
export interface PublicIntakeState { title:string; question:IntakeField|null; step:number; total:number; complete:boolean; revision:number; answers:Record<string,string|number|null> }
