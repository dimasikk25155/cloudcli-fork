import type { WorkspaceRecord } from './agent-workspace.js';
export interface DocumentField { key: string; label: string; required: boolean }
export interface ManagedDocument { title: string; type: 'template' | 'document'; currentVersionId: string; approvedTemplateVersionId: string | null; knowledge: boolean; approval: DocumentApproval | null }
export interface DocumentVersion { documentId: string; title: string; text: string; fields: DocumentField[]; templateVersionId?: string; restoredFrom?: string }
export interface DocumentApproval { versionId: string; actors: number[]; approved: { userId: number; at: string }[] }
export interface DocumentDetail { record: WorkspaceRecord<ManagedDocument>; versions: WorkspaceRecord<DocumentVersion>[] }
export interface KnowledgeHit { documentId: string; title: string; versionId: string; excerpt: string }
export interface CreateDocumentInput { projectId: string; title: string; text: string; type: 'template' | 'document'; fields?: DocumentField[] }
