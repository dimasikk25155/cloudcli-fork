/**
 * Canvas tab kinds of artifacts: «Результаты» (the list) and one artifact.
 * Imported once from `src/components/workbench/index.ts`.
 */
import React from 'react';
import { FileImage, FolderOpen } from 'lucide-react';

import { registerWorkbenchTabKind } from '../workbenchTabs';

import ArtifactsList from './ArtifactsList';
import ArtifactView from './ArtifactView';
import { pendingArtifactPath } from './artifactModel';
import PendingArtifact from './PendingArtifact';

registerWorkbenchTabKind('artifacts', {
  defaultTitle: 'Результаты',
  icon: <FolderOpen className="h-3.5 w-3.5" aria-hidden />,
  inMenu: true,
  render: (_tab, context) => <ArtifactsList context={context} />,
});

registerWorkbenchTabKind('artifact', {
  defaultTitle: 'Артефакт',
  icon: <FileImage className="h-3.5 w-3.5" aria-hidden />,
  render: (tab, context) => {
    const filePath = pendingArtifactPath(tab.ref);
    if (filePath) return <PendingArtifact filePath={filePath} context={context} />;
    if (!tab.ref) return <p className="p-6 text-sm text-muted-foreground">Артефакт не указан.</p>;
    return <ArtifactView artifactId={tab.ref} context={context} />;
  },
});
