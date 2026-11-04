import React, { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, FolderPlus, Pencil, Trash2 } from 'lucide-react';

import { arrangeProjects, groupOfProject, moveGroup } from './groupsModel';
import { sidebarGroupsStore, useSidebarGroups } from './useSidebarGroups';

type GroupedProjectListProps<P extends { projectId: string }> = {
  projects: P[];
  renderProject: (project: P) => React.ReactNode;
};

const smallButton = 'grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground';

/**
 * Projects of the sidebar laid out by the user's groups («Группы и закрепы»).
 * Mod off, or no group yet and no "+" used: the plain list. A group only
 * orders projects; it grants nothing and deleting it deletes nothing else.
 */
export default function GroupedProjectList<P extends { projectId: string }>({ projects, renderProject }: GroupedProjectListProps<P>) {
  const { enabled, tree } = useSidebarGroups();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  if (!enabled) return <>{projects.map(renderProject)}</>;

  const sections = arrangeProjects(projects, tree);
  const memberOf = (projectId: string) => groupOfProject(tree, projectId);
  const moveTo = (projectId: string, targetGroupId: string) => {
    if (!targetGroupId) {
      const current = memberOf(projectId);
      const group = tree.groups.find((item) => item.id === current);
      if (group) void sidebarGroupsStore.setItems(group.id, group.items.filter((item) => !(item.type === 'project' && item.id === projectId)));
      return;
    }
    const target = tree.groups.find((item) => item.id === targetGroupId);
    if (target) void sidebarGroupsStore.setItems(target.id, [...target.items, { type: 'project', id: projectId }]);
  };
  const finishRename = (groupId: string) => {
    const name = draft.trim();
    setRenaming(null);
    if (name) void sidebarGroupsStore.rename(groupId, name);
  };
  const addGroup = () => {
    const name = window.prompt('Название группы');
    if (name?.trim()) void sidebarGroupsStore.create(name.trim());
  };

  const withMenu = (project: P) => (
    <div key={project.projectId} className="group/pm relative">
      {renderProject(project)}
      {tree.groups.length > 0 && (
        <select
          aria-label="Перенести проект в группу"
          title="В группу"
          value={memberOf(project.projectId) ?? ''}
          onChange={(event) => moveTo(project.projectId, event.target.value)}
          className="absolute right-9 top-2 h-6 max-w-[6.5rem] rounded border border-border bg-background px-1 text-[11px] text-muted-foreground opacity-0 focus:opacity-100 group-hover/pm:opacity-100"
        >
          <option value="">Без группы</option>
          {tree.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
      )}
    </div>
  );

  return (
    <div data-sidebar-groups>
      {sections.map((section) => {
        if (!section.group) return <React.Fragment key="ungrouped">{section.projects.map(withMenu)}</React.Fragment>;
        const { group } = section;
        return (
          <section key={group.id} className="mb-1" data-sidebar-group={group.id}>
            <div className="group/gh mx-1 flex items-center gap-1 px-1 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <button
                type="button"
                className={smallButton}
                aria-expanded={!group.collapsed}
                aria-label={group.collapsed ? 'Развернуть группу' : 'Свернуть группу'}
                onClick={() => void sidebarGroupsStore.setCollapsed(group.id, !group.collapsed)}
              >
                {group.collapsed ? <ChevronRight className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />}
              </button>
              {renaming === group.id ? (
                <input
                  autoFocus
                  value={draft}
                  maxLength={60}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => finishRename(group.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') finishRename(group.id);
                    if (event.key === 'Escape') setRenaming(null);
                  }}
                  className="min-w-0 flex-1 rounded border border-border bg-background px-1 text-xs normal-case text-foreground"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate">{group.name}<span className="ml-1 opacity-60">{section.projects.length}</span></span>
              )}
              <span className="flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/gh:opacity-100">
                <button type="button" className={smallButton} title="Выше" aria-label="Группу выше" onClick={() => void sidebarGroupsStore.reorder(moveGroup(tree, group.id, -1))}><ArrowUp className="h-3 w-3" aria-hidden /></button>
                <button type="button" className={smallButton} title="Ниже" aria-label="Группу ниже" onClick={() => void sidebarGroupsStore.reorder(moveGroup(tree, group.id, 1))}><ArrowDown className="h-3 w-3" aria-hidden /></button>
                <button type="button" className={smallButton} title="Переименовать" aria-label="Переименовать группу" onClick={() => { setDraft(group.name); setRenaming(group.id); }}><Pencil className="h-3 w-3" aria-hidden /></button>
                <button
                  type="button"
                  className={smallButton}
                  title="Удалить группу (проекты и чаты останутся)"
                  aria-label="Удалить группу"
                  onClick={() => {
                    if (window.confirm(`Удалить группу «${group.name}»? Проекты и чаты останутся на месте.`)) void sidebarGroupsStore.remove(group.id);
                  }}
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
              </span>
            </div>
            {!group.collapsed && (section.projects.length > 0
              ? <div className="ml-2 border-l border-border pl-1">{section.projects.map(withMenu)}</div>
              : <p className="px-3 py-1 text-xs text-muted-foreground">Пусто: перенесите сюда проект через список «В группу».</p>)}
          </section>
        );
      })}
      <button
        type="button"
        onClick={addGroup}
        className="mx-2 mt-1 flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <FolderPlus className="h-3 w-3" aria-hidden />
        Новая группа
      </button>
    </div>
  );
}

