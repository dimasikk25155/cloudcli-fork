import React from 'react';
import { useParams } from 'react-router-dom';
import { PanelRightOpen } from 'lucide-react';

import { isCanvasFile } from '../../../../shared/artifacts';
import { useModEnabled } from '../../../hooks/useModEnabled';
import { openWorkbenchTab } from '../useWorkbench';

import { artifactTabForPath } from './artifactModel';

/**
 * «Открыть в холсте» next to a file link in a chat answer (.html/.md/.pdf/
 * .png/.svg…): opens the file as an artifact tab of this chat's canvas.
 * Nothing when «Рабочий стол» is off or the file is of another kind.
 */
export default function OpenInCanvasButton({ filePath }: { filePath: string }) {
  const enabled = useModEnabled('modWorkbench');
  const { sessionId } = useParams<{ sessionId?: string }>();
  if (!enabled || !isCanvasFile(filePath)) return null;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openWorkbenchTab(sessionId ?? null, artifactTabForPath(filePath));
      }}
      title="Открыть в холсте"
      aria-label="Открыть в холсте"
      data-open-in-canvas
      className="ml-1 inline-flex h-5 w-5 translate-y-0.5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <PanelRightOpen className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}
