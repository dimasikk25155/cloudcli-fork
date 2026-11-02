import React, { useEffect, useState } from 'react';

import type { WorkspacePanelProps } from '../../../../shared/agent-workspace';
import type { KnowledgeHit } from '../../../../shared/managed-documents';
import SendToAgentButton from '../SendToAgentButton';
import { workspaceApi } from '../api';
export function KnowledgePanel({projectId,onClose}:WorkspacePanelProps){
 const [query,setQuery]=useState(''),[hits,setHits]=useState<KnowledgeHit[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[searched,setSearched]=useState(false);
 useEffect(()=>{setHits([]);setSearched(false);setError('');},[projectId]);
 const search=async()=>{setBusy(true);setError('');try{setHits(await workspaceApi<KnowledgeHit[]>('/documents/search?projectId='+encodeURIComponent(projectId)+'&q='+encodeURIComponent(query)));setSearched(true);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <section className="space-y-3" aria-label="Знания проекта"><p>Поиск только по документам, которые владелец включил в знания проекта. Включение — в карточке документа.</p><form className="flex gap-2" onSubmit={e=>{e.preventDefault();void search();}}><input aria-label="Поиск в знаниях" className="w-full rounded border bg-transparent p-2" maxLength={200} value={query} onChange={e=>setQuery(e.target.value)}/><button className="rounded border px-3 py-1" disabled={busy||!query.trim()}>{busy?'Ищем…':'Найти'}</button></form>{error&&<p role="alert" className="text-red-500">{error}</p>}{searched&&!hits.length&&<p>Совпадений нет.</p>}{hits.map(hit=><article key={hit.documentId} className="space-y-2 rounded border p-3"><h3>{hit.title}</h3><p className="break-all text-xs">Источник: {hit.documentId} · версия {hit.versionId}</p><p className="whitespace-pre-wrap">{hit.excerpt}</p><SendToAgentButton projectId={projectId} source={{kind:'document',id:hit.documentId,version:hit.versionId,selection:hit.excerpt}} onClose={onClose}/></article>)}</section>;
}
