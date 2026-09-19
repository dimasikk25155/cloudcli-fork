import { useEffect, useState } from 'react';
import type { Project } from '../../types/app';
import AppIcon, { type AppIconSize } from './AppIcon';
import { resolveProjectIcon } from './projectIconSpec';
import { PROJECT_ICON_CHANGED_EVENT, readProjectIcon } from './projectIconStorage';

type ProjectIconProps = {
  project: Pick<Project, 'projectId' | 'displayName' | 'fullPath'>;
  size?: AppIconSize;
  starred?: boolean;
  className?: string;
};

export default function ProjectIcon({ project, size = 'sm', starred = false, className }: ProjectIconProps) {
  const spec = resolveProjectIcon(project.displayName, project.fullPath);
  const [src, setSrc] = useState<string | null>(() => readProjectIcon(project.projectId));

  useEffect(() => {
    setSrc(readProjectIcon(project.projectId));
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (!detail?.projectId || detail.projectId === project.projectId) {
        setSrc(readProjectIcon(project.projectId));
      }
    };
    window.addEventListener(PROJECT_ICON_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PROJECT_ICON_CHANGED_EVENT, refresh);
  }, [project.projectId]);

  return (
    <AppIcon
      background={spec.background}
      foreground={spec.foreground}
      glyph={spec.glyph}
      letter={spec.letter}
      src={src}
      size={size}
      starred={starred}
      className={className}
    />
  );
}
