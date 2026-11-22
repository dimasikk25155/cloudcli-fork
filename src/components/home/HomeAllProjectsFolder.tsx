import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid } from 'lucide-react';

import type { Project } from '../../types/app';
import PanelModal from '../panels/PanelModal';

import HomeProjectTile from './HomeProjectTile';
import HomeSearchField from './HomeSearchField';
import { buildAllProjects, matchesProjectQuery } from './homeProjectsModel';
import { useProjectTileMenu } from './useProjectTileMenu';

type HomeAllProjectsFolderProps = {
  projects: Project[];
  onClose: () => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject?: (projectId: string) => void;
};

/** «All projects» as an OS folder: full screen, search, every project's neon icon. */
export default function HomeAllProjectsFolder({
  projects,
  onClose,
  onProjectSelect,
  onToggleStarProject,
}: HomeAllProjectsFolderProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const menu = useProjectTileMenu(onToggleStarProject);

  const all = useMemo(() => buildAllProjects(projects), [projects]);
  const shown = useMemo(() => all.filter((project) => matchesProjectQuery(project, query)), [all, query]);

  const open = (project: Project) => {
    onProjectSelect(project);
    onClose();
  };

  return (
    <PanelModal
      title={t('mainContent.homeAllProjectsTitle', 'All projects')}
      icon={LayoutGrid}
      onClose={onClose}
    >
      <div className="flex min-h-full flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))]" data-home-folder="all">
        <div className="sticky top-0 z-[2] bg-background/85 px-5 pb-3 pt-4 backdrop-blur-md sm:px-8">
          <HomeSearchField value={query} onChange={setQuery} />
        </div>
        {shown.length === 0 ? (
          <p className="mx-auto mt-6 max-w-sm px-6 text-center text-sm text-muted-foreground">
            {t('mainContent.noMatchingProjects', 'No matching projects')}
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-x-4 gap-y-6 px-5 pt-2 sm:grid-cols-6 sm:gap-x-5 sm:gap-y-7 sm:px-8 lg:grid-cols-8">
            {shown.map((project) => (
              <HomeProjectTile key={project.projectId} project={project} menu={menu} onOpen={open} />
            ))}
          </div>
        )}
      </div>
      {menu.layer}
    </PanelModal>
  );
}
