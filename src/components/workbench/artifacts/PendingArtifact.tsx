import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import type { WorkbenchRenderContext } from '../workbenchTabs';

import ArtifactView from './ArtifactView';
import { artifactsApi } from './artifactsApi';

/** A file link opened in the canvas: publish the file (source = this chat), then show it. */
export default function PendingArtifact({ filePath, context }: { filePath: string; context: WorkbenchRenderContext }) {
  const projectId = context.project.projectId;
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setArtifactId(null);
    setError(null);
    artifactsApi.publish(projectId, { path: filePath, sessionId: context.sessionId })
      .then((result) => { if (!cancelled) setArtifactId(result.artifact.id); })
      .catch((publishError: unknown) => {
        if (!cancelled) setError(publishError instanceof Error ? publishError.message : 'Не удалось открыть файл');
      });
    return () => { cancelled = true; };
  }, [projectId, filePath, context.sessionId]);

  if (error) {
    return (
      <div role="alert" className="m-6 space-y-1 rounded-xl border border-border bg-card p-4 text-sm">
        <p className="text-foreground">{error}</p>
        <p className="break-all font-mono text-xs text-muted-foreground">{filePath}</p>
      </div>
    );
  }
  if (!artifactId) {
    return <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Открываем файл…</p>;
  }
  return <ArtifactView artifactId={artifactId} context={context} />;
}
