import React from 'react';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';

import type { Project } from '../../types/app';
import { cn } from '../../lib/utils';
import ProjectIcon from '../app-icon/ProjectIcon';

import type { ProjectTileMenu } from './useProjectTileMenu';

type HomeProjectTileProps = {
  project: Project;
  menu: ProjectTileMenu;
  onOpen: (project: Project) => void;
};

/** One project of Home or the «All projects» folder: neon icon + name, hold for the menu. */
export default function HomeProjectTile({ project, menu, onOpen }: HomeProjectTileProps) {
  const { t } = useTranslation();
  const { toggleStar } = menu;

  return (
    <div className="group relative min-w-0" data-home-project={project.projectId}>
      <button
        type="button"
        className="flex w-full flex-col items-center gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={t('mainContent.homeIconHint', 'Tap to open. Hold to pin or set an icon.')}
        {...menu.tileProps(project, onOpen)}
      >
        <span className="relative flex transition-transform duration-150 ease-out group-hover:-translate-y-0.5 group-active:scale-95">
          <ProjectIcon project={project} size="lg" starred={Boolean(project.isStarred)} />
        </span>
        {/* The label lies on the theme's wallpaper (video, photo): a soft halo
            of the theme background keeps it readable there, and is invisible
            on the flat themes. */}
        <span className="line-clamp-2 w-full text-center text-[11px] leading-tight text-foreground/90 [text-shadow:0_1px_3px_hsl(var(--background)/0.8)] sm:text-xs">
          {project.displayName}
        </span>
      </button>
      {toggleStar && (
        <button
          type="button"
          className={cn(
            'absolute right-1 top-0 z-[3] hidden h-6 w-6 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm ring-1 ring-border md:flex',
            project.isStarred
              ? 'text-warning opacity-100'
              : 'opacity-0 group-hover:opacity-100',
          )}
          onClick={() => toggleStar(project)}
          title={project.isStarred
            ? t('mainContent.unpinProject', 'Unpin')
            : t('mainContent.pinProject', 'Pin')}
        >
          <Star className={cn('h-3 w-3', project.isStarred && 'fill-current')} />
        </button>
      )}
    </div>
  );
}
