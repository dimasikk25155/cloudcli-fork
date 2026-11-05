import { useCallback, useEffect, useState } from 'react';

import type { ProviderModelsDefinition } from '../../types/app';

import { fetchAgents, fetchModelCatalog, fetchProjects, type ProjectOption } from './agentsApi';
import { PROVIDERS, type AgentItem, type AgentProvider } from './agentsModel';

export type AgentsData = {
  agents: AgentItem[];
  projects: ProjectOption[];
  catalogs: Partial<Record<AgentProvider, ProviderModelsDefinition | null>>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

/** Агенты, проекты для выпадающего списка и каталоги моделей трёх движков. */
export function useAgents(): AgentsData {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [catalogs, setCatalogs] = useState<AgentsData['catalogs']>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setAgents(await fetchAgents());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить агентов');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    void fetchProjects().then((list) => { if (!cancelled) setProjects(list); }).catch(() => {});
    void Promise.all(PROVIDERS.map(async (provider) => [provider, await fetchModelCatalog(provider)] as const))
      .then((entries) => { if (!cancelled) setCatalogs(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, []);

  return { agents, projects, catalogs, loading, error, reload };
}
