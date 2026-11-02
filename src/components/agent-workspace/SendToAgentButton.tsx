import React, { useState } from 'react';

import type { WorkspaceHandoff, WorkspaceSource } from '../../../shared/agent-workspace';

import { stageWorkspaceHandoff, WORKSPACE_CHAT_EVENT } from './handoff';
import { workspaceApi, workspaceJson } from './api';
export default function SendToAgentButton({ projectId, source, instruction, onClose }: {
    projectId: string;
    source: WorkspaceSource;
    instruction?: string;
    onClose?: () => void;
}) {
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const open = async () => {
        setBusy(true);
        setError('');
        try {
            const handoff = await workspaceApi<WorkspaceHandoff>('/handoff', workspaceJson('POST', { projectId, source, instruction }));
            stageWorkspaceHandoff(handoff, localStorage, sessionStorage);
            onClose?.();
            window.dispatchEvent(new CustomEvent('neo3:workspace-close'));
            window.dispatchEvent(new CustomEvent(WORKSPACE_CHAT_EVENT, { detail: { projectId: handoff.projectId } }));
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Не удалось передать материал');
        }
        finally {
            setBusy(false);
        }
    };
    return (
        <span>
            <button type="button" disabled={!projectId || busy} onClick={open} className="rounded border px-3 py-1 text-sm disabled:opacity-50">
                {busy ? 'Открываем чат…' : 'Передать агенту'}
            </button>
            {error && <span role="alert" className="ml-2 text-sm text-red-500">{error}</span>}
        </span>
    );
}
