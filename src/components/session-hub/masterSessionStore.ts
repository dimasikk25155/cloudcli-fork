import { useSyncExternalStore } from 'react';

import { fetchMasterQuestions, prepareMasterDrafts, sendMasterAnswers } from './masterSessionApi';
import {
  applyDrafts,
  buildSendItems,
  newBatchId,
  setAnswer,
  type MasterAnswers,
  type MasterQuestion,
  type MasterSendResult,
} from './masterSessionModel';

/**
 * Состояние мастер-сессии на вкладку: одно на панель диалогов и секцию в
 * «Ждут тебя», чтобы закрытие панели не теряло набранные ответы.
 */
export type MasterSessionPhase = 'edit' | 'review' | 'done';

export type MasterSessionState = {
  questions: MasterQuestion[];
  answers: MasterAnswers;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  drafting: boolean;
  draftError: string | null;
  phase: MasterSessionPhase;
  /** Одно нажатие «Отправить всё»: тот же id при повторе — сервер не шлёт дважды. */
  batchId: string | null;
  sending: boolean;
  sendError: string | null;
  results: MasterSendResult[];
};

let state: MasterSessionState = {
  questions: [],
  answers: {},
  loading: false,
  loaded: false,
  error: null,
  drafting: false,
  draftError: null,
  phase: 'edit',
  batchId: null,
  sending: false,
  sendError: null,
  results: [],
};
const listeners = new Set<() => void>();

function update(patch: Partial<MasterSessionState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export const masterSessionStore = {
  getSnapshot: (): MasterSessionState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  async refresh(): Promise<void> {
    if (state.loading) return;
    update({ loading: true, error: null });
    try {
      update({ questions: await fetchMasterQuestions(), loading: false, loaded: true });
    } catch (error) {
      update({ loading: false, loaded: true, error: (error as Error).message });
    }
  },

  answer(question: MasterQuestion, patch: { choice?: string; text?: string }): void {
    update({ answers: setAnswer(state.answers, question, patch) });
  },

  async prepareDrafts(): Promise<void> {
    if (state.drafting || state.questions.length === 0) return;
    update({ drafting: true, draftError: null });
    try {
      const drafts = await prepareMasterDrafts(state.questions.map((question) => question.sessionId));
      update({ drafting: false, answers: applyDrafts(state.answers, state.questions, drafts) });
    } catch (error) {
      update({ drafting: false, draftError: (error as Error).message });
    }
  },

  review(): void {
    if (buildSendItems(state.questions, state.answers).length === 0) return;
    update({ phase: 'review', batchId: state.batchId ?? newBatchId(), sendError: null, results: [] });
  },

  backToEdit(): void {
    // Пачка не ушла — правки после проверки = новое нажатие.
    update({ phase: 'edit', batchId: state.results.length > 0 ? null : state.batchId, sendError: null });
  },

  async sendAll(): Promise<void> {
    if (state.sending || !state.batchId) return;
    const items = buildSendItems(state.questions, state.answers);
    if (items.length === 0) return;
    update({ sending: true, sendError: null });
    try {
      const results = await sendMasterAnswers(state.batchId, items);
      const sent = new Set(results.filter((result) => result.status === 'sent').map((result) => result.sessionId));
      const answers = Object.fromEntries(Object.entries(state.answers).filter(([sessionId]) => !sent.has(sessionId)));
      update({ sending: false, results, answers, phase: 'done' });
    } catch (error) {
      // Сеть оборвалась: батч тот же, повтор безопасен.
      update({ sending: false, sendError: (error as Error).message });
    }
  },

  finish(): void {
    update({ phase: 'edit', batchId: null, results: [], sendError: null });
    void masterSessionStore.refresh();
  },
};

export function useMasterSession(): MasterSessionState {
  return useSyncExternalStore(masterSessionStore.subscribe, masterSessionStore.getSnapshot, masterSessionStore.getSnapshot);
}
