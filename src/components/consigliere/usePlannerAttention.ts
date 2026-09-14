import { useEffect, useState } from 'react';

import { authenticatedFetch } from '../../utils/api';
import {
  PLANNER_CHANGED_EVENT,
  pickAttentionItems,
  type AttentionItem,
} from './plannerAttention';

const POLL_MS = 60_000;

type AttentionState = {
  items: AttentionItem[];
  loading: boolean;
};

let state: AttentionState = { items: [], loading: true };
const listeners = new Set<() => void>();
let timer: number | null = null;
let inFlight = false;

function emit(): void {
  for (const listener of listeners) listener();
}

export async function refreshPlannerAttention(): Promise<void> {
  await refresh();
}

async function refresh(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const response = await authenticatedFetch('/api/sticky-push/planner');
    if (!response.ok) {
      state = { items: [], loading: false };
      emit();
      return;
    }
    const json = await response.json().catch(() => ({}));
    state = {
      items: pickAttentionItems(json?.data ?? json),
      loading: false,
    };
    emit();
  } catch {
    state = { items: state.items, loading: false };
    emit();
  } finally {
    inFlight = false;
  }
}

function start(): void {
  if (timer != null) return;
  void refresh();
  timer = window.setInterval(() => {
    void refresh();
  }, POLL_MS);
}

function stop(): void {
  if (timer == null) return;
  window.clearInterval(timer);
  timer = null;
}

export function usePlannerAttention(): AttentionState {
  const [, bump] = useState(0);

  useEffect(() => {
    const onChange = () => bump((n) => n + 1);
    listeners.add(onChange);
    start();
    const onPlanner = () => {
      void refresh();
    };
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener(PLANNER_CHANGED_EVENT, onPlanner);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener(PLANNER_CHANGED_EVENT, onPlanner);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      if (listeners.size === 0) stop();
    };
  }, []);

  return state;
}
