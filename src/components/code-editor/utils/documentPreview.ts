import type { CodeEditorFile } from '../types/types';

export function defaultDocumentPreview(file: Pick<CodeEditorFile, 'name' | 'diffInfo'>): 'html' | 'markdown' | 'code' {
  if (file.diffInfo) return 'code';
  if (/\.html?$/i.test(file.name)) return 'html';
  if (/\.(md|markdown)$/i.test(file.name)) return 'markdown';
  return 'code';
}
