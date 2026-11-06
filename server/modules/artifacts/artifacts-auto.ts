import path from 'node:path';

import type { NormalizedMessage } from '@/shared/types.js';

import { CODEX_FILE_TOOL, isAutoArtifactPath, toolChangedPaths } from '../../../shared/artifacts.js';

/** The part of a chat run the auto-publish needs. */
export type AutoPublishRun = {
  runId: string;
  appSessionId: string;
  userId: string | number | null;
  projectId: string | null;
};

export type ArtifactAutoPublishDependencies = {
  /** `artifactsService.publish`: idempotent — the same path only gets a new version when the file changed. */
  publish(userId: number, projectId: string, input: { path: string; sessionId: string }): Promise<unknown>;
  projectPath(projectId: string): string | null;
  /** Pause after a write before publishing: a burst of edits is published once. */
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

type RunState = {
  run: AutoPublishRun;
  /** Pages the run wrote successfully (relative paths) — published once more when the turn ends. */
  all: Set<string>;
  /** Written and waiting for the next publish. */
  pending: Set<string>;
  /** toolId → paths of a write whose result has not arrived yet. */
  byTool: Map<string, string[]>;
  timer: unknown;
  /** One publish at a time per run: a new file is never created twice. */
  chain: Promise<void>;
};

/** Path relative to the project root; null — outside the project. */
function relativeToProject(root: string, filePath: string): string | null {
  const absolute = path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(root, filePath);
  const relative = path.relative(path.resolve(root), absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

/**
 * «Результаты» fill themselves: an HTML page or SVG the agent writes in a
 * chat (Claude, Codex, Grok — every engine's events pass the run registry) is
 * published as an artifact of that chat, without a path typed by hand or a
 * `workspace_action artifact.publish` call.
 *
 * A write is published after its tool result (Codex reports the change done),
 * debounced; the turn's end publishes every page of the run again, which only
 * adds a version where the file really changed. Failures (mod off, no access,
 * private or missing file) are silent: the chat never breaks over this.
 */
export function createArtifactAutoPublish(deps: ArtifactAutoPublishDependencies) {
  const delayMs = deps.delayMs ?? 1500;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => {
    const handle = setTimeout(fn, ms);
    handle.unref?.();
    return handle;
  });
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const states = new Map<string, RunState>();

  function publishAll(state: RunState, paths: string[]): Promise<void> {
    const { run } = state;
    const userId = Number(run.userId);
    if (!run.projectId || !Number.isFinite(userId) || !paths.length) return state.chain;
    const projectId = run.projectId;
    state.chain = state.chain.then(async () => {
      for (const relPath of paths) {
        try {
          await deps.publish(userId, projectId, { path: relPath, sessionId: run.appSessionId });
        } catch {
          // Mod off, no access, a private or deleted file: nothing to show.
        }
      }
    });
    return state.chain;
  }

  function flush(state: RunState): Promise<void> {
    if (state.timer !== null) clearTimer(state.timer);
    state.timer = null;
    const paths = [...state.pending];
    state.pending.clear();
    return publishAll(state, paths);
  }

  function schedule(state: RunState): void {
    if (!state.pending.size) return;
    if (state.timer !== null) clearTimer(state.timer);
    state.timer = setTimer(() => {
      state.timer = null;
      void flush(state);
    }, delayMs);
  }

  function stateOf(run: AutoPublishRun): RunState | null {
    let state = states.get(run.runId);
    if (!state) {
      if (!run.projectId) return null;
      state = { run, all: new Set(), pending: new Set(), byTool: new Map(), timer: null, chain: Promise.resolve() };
      states.set(run.runId, state);
    }
    return state;
  }

  return {
    /**
     * One outbound event of a run. Returns the publish of the turn's end
     * (tests await it); other events return nothing.
     */
    observe(run: AutoPublishRun, message: NormalizedMessage): Promise<void> | undefined {
      if (message.kind === 'tool_use') {
        if (!run.projectId) return undefined;
        const root = deps.projectPath(run.projectId);
        if (!root) return undefined;
        const pages = toolChangedPaths(message.toolName, message.toolInput)
          .map((filePath) => relativeToProject(root, filePath))
          .filter((relPath): relPath is string => relPath !== null && isAutoArtifactPath(relPath));
        if (!pages.length) return undefined;
        const state = stateOf(run);
        if (!state) return undefined;
        // Codex reports a file change once it is applied — no result follows.
        if (message.toolName === CODEX_FILE_TOOL || !message.toolId) {
          for (const page of pages) {
            state.all.add(page);
            state.pending.add(page);
          }
          schedule(state);
        } else {
          state.byTool.set(message.toolId, pages);
        }
        return undefined;
      }

      if (message.kind === 'tool_result') {
        const state = states.get(run.runId);
        const pages = state && message.toolId ? state.byTool.get(message.toolId) : undefined;
        if (!state || !pages) return undefined;
        state.byTool.delete(message.toolId!);
        if (message.isError || message.toolResult?.isError) return undefined;
        for (const page of pages) {
          state.all.add(page);
          state.pending.add(page);
        }
        schedule(state);
        return undefined;
      }

      if (message.kind === 'complete') {
        const state = states.get(run.runId);
        if (!state) return undefined;
        states.delete(run.runId);
        if (state.timer !== null) clearTimer(state.timer);
        state.timer = null;
        state.pending.clear();
        // Writes whose result never came (an engine without results) count as done.
        for (const pages of state.byTool.values()) for (const page of pages) state.all.add(page);
        return publishAll(state, [...state.all]);
      }
      return undefined;
    },

    /** Runs being watched (tests). */
    size(): number {
      return states.size;
    },
  };
}

export type ArtifactAutoPublish = ReturnType<typeof createArtifactAutoPublish>;
