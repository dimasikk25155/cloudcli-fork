/**
 * State of the `advisor` canvas tab. Lives outside the component: the canvas
 * renders only the active tab, so switching tabs must not lose the questions,
 * answers or a call that is still running.
 */

export type AdvisorEntry = {
  id: number;
  question: string;
  status: 'pending' | 'done' | 'error';
  answer?: string;
  error?: string;
};

export function createAdvisorStore() {
  const bySession = new Map<string, AdvisorEntry[]>();
  const listeners = new Set<() => void>();
  let nextId = 1;
  const empty: AdvisorEntry[] = [];

  const emit = () => listeners.forEach((listener) => listener());
  const update = (sessionId: string, id: number, patch: Partial<AdvisorEntry>) => {
    const list = bySession.get(sessionId);
    if (!list) return;
    bySession.set(sessionId, list.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
    emit();
  };

  return {
    entries: (sessionId: string): AdvisorEntry[] => bySession.get(sessionId) ?? empty,
    hasPending: (sessionId: string) => (bySession.get(sessionId) ?? empty).some((entry) => entry.status === 'pending'),
    start(sessionId: string, question: string): number {
      const id = nextId;
      nextId += 1;
      bySession.set(sessionId, [...(bySession.get(sessionId) ?? empty), { id, question, status: 'pending' }]);
      emit();
      return id;
    },
    resolve: (sessionId: string, id: number, answer: string) => update(sessionId, id, { status: 'done', answer }),
    fail: (sessionId: string, id: number, error: string) => update(sessionId, id, { status: 'error', error }),
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const advisorStore = createAdvisorStore();
