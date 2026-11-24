import type { AdminProjectItem } from './types';

/** The text the access picker shows for a project. */
export const adminProjectLabel = (project: AdminProjectItem): string => (
  project.customProjectName || project.path
);

const collator = new Intl.Collator(['en', 'ru'], { sensitivity: 'base', numeric: true });

/**
 * Alphabetical order of the admin access picker: by the shown label,
 * case-insensitive, Latin then Cyrillic; equal labels fall back to the path.
 */
export function sortAdminProjects(projects: AdminProjectItem[]): AdminProjectItem[] {
  return [...projects].sort((a, b) => (
    collator.compare(adminProjectLabel(a), adminProjectLabel(b))
    || collator.compare(a.path, b.path)
  ));
}
