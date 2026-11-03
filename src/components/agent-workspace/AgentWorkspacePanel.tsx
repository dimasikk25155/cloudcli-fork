import React, { useEffect, useState } from 'react';

import type { WorkspaceProject, WorkspacePanelProps } from '../../../shared/agent-workspace';

import { workspaceApi } from './api';
import DailyPanel from './daily/DailyPanel';
import SendToAgentButton from './SendToAgentButton';
import MailPanel from './mail/MailPanel';
import { DocumentsPanel, KnowledgePanel } from './documents';
import { TeamPanel, IntakePanel } from './team';
const defaultPanels = { mail: MailPanel, documents: DocumentsPanel, knowledge: KnowledgePanel, team: TeamPanel, intake: IntakePanel };
export type WorkspacePanels = Partial<Record<'mail' | 'documents' | 'knowledge' | 'team' | 'intake', React.ComponentType<WorkspacePanelProps>>>;
export default function AgentWorkspacePanel({ onClose, panels = defaultPanels }: {
    onClose?: () => void;
    panels?: WorkspacePanels;
}) {
    const [projects, setProjects] = useState<WorkspaceProject[]>([]), [projectId, setProjectId] = useState(''), [section, setSection] = useState('daily'), [error, setError] = useState(''), [file, setFile] = useState('');
    useEffect(() => { workspaceApi<WorkspaceProject[]>('/projects').then(p => { setProjects(p); setProjectId(p[0]?.id || ''); }).catch(e => setError(String(e))); }, []);
    const FeaturePanel = panels[section as keyof WorkspacePanels];
    const sections = [['daily', 'Мой день'], ['mail', 'Почта'], ['documents', 'Документы'], ['knowledge', 'Знания'], ['team', 'Команда'], ['intake', 'Заявки']] as const;
    return (
        <div className="space-y-4 p-4">
            <label className="flex items-center gap-2">
                Проект
                <select value={projectId} onChange={event => {setProjectId(event.target.value);setFile('');}} className="min-w-0 flex-1 rounded border bg-background p-2">
                    <option value="">Выберите проект</option>
                    {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
            </label>
            {error && <p role="alert">{error}</p>}
            <nav className="flex flex-wrap gap-2" aria-label="Рабочее пространство">
                {sections.map(([id, title]) => (
                    <button key={id} onClick={() => setSection(id)} aria-pressed={section === id}
                        className={'rounded border px-3 py-2 ' + (section === id ? 'bg-muted font-semibold' : '')}>
                        {title}
                    </button>
                ))}
            </nav>
            {section === 'daily' ? (
                <DailyPanel projectId={projectId} onClose={onClose}/>
            ) : FeaturePanel ? (
                <FeaturePanel key={projectId + ':' + section} projectId={projectId} onClose={onClose}/>
            ) : <p className="rounded border p-4 text-sm text-muted-foreground">Раздел ещё не подключён.</p>}
            <details className="rounded border p-3">
                <summary>Передать файл проекта</summary>
                <p className="my-2 text-xs">Текстовый файл до 100 КБ. Откроется черновик обычного чата.</p>
                <input aria-label="Путь файла в проекте" placeholder="docs/brief.md"
                    className="mr-2 rounded border bg-background p-2" value={file} onChange={event => setFile(event.target.value)}/>
                <SendToAgentButton key={projectId} projectId={file ? projectId : ''} source={{kind:'file',id:file}} onClose={onClose}/>
            </details>
        </div>
    );
}
