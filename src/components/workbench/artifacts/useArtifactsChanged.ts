import { useEffect, useRef } from 'react';

import { useWebSocket } from '../../../contexts/WebSocketContext';

import { isArtifactsChangeFor } from './artifactModel';

/**
 * Calls `onChange` when the server says an artifact of the project got a new
 * version (`artifacts_changed`: the agent wrote a page, published or restored
 * one, a manual edit) — or only this artifact, when `artifactId` is given.
 * Bursts are merged into one call.
 */
export function useArtifactsChanged(projectId: string, onChange: () => void, artifactId?: string): void {
  const { subscribe } = useWebSocket();
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = subscribe((event) => {
      if (!isArtifactsChangeFor(event, projectId, artifactId)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => latest.current(), 300);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [artifactId, projectId, subscribe]);
}
