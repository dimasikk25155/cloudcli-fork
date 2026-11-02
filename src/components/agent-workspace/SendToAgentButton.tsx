import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { WorkspaceHandoff, WorkspaceSource } from '../../../shared/agent-workspace';
import { authenticatedFetch } from '../../utils/api';

import { workspaceApi, workspaceJson } from './api';
export const HANDOFF_STORAGE_PREFIX='neo3:workspace-handoff:';
export default function SendToAgentButton({projectId,source,instruction,onClose}:{projectId:string;source:WorkspaceSource;instruction?:string;onClose?:()=>void}) {
 const navigate=useNavigate();const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const open=async()=>{setBusy(true);setError('');try{
  const handoff=await workspaceApi<WorkspaceHandoff>('/handoff',workspaceJson('POST',{projectId,source,instruction}));
  const response=await authenticatedFetch('/api/providers/sessions',{method:'POST',body:JSON.stringify({provider:'grok',projectPath:handoff.projectPath})});
  const body=await response.json();const sessionId=body.data?.sessionId;
  if(!response.ok||!sessionId)throw new Error('Не удалось открыть чат');
  sessionStorage.setItem(HANDOFF_STORAGE_PREFIX+sessionId,JSON.stringify(handoff));
  onClose?.();window.dispatchEvent(new CustomEvent('neo3:workspace-close'));navigate('/session/'+sessionId);
 }catch(e){setError(e instanceof Error?e.message:'Не удалось передать материал');}finally{setBusy(false);}};
 return <span><button type="button" disabled={!projectId||busy} onClick={open} className="rounded border px-3 py-1 text-sm disabled:opacity-50">{busy?'Открываем чат…':'Передать агенту'}</button>{error&&<span role="alert" className="ml-2 text-sm text-red-500">{error}</span>}</span>;
}
