/**
 * «Новая вкладка»: how each canvas kind looks as an iOS-style app icon — a
 * big white glyph on a squircle tile with a top-lit gradient. One table, so a
 * colour changes in one place; the colours follow Apple's system palette.
 */
import {
  BarChart3,
  FileImage,
  Folder,
  FolderOpen,
  Gauge,
  Info,
  LayoutGrid,
  Lightbulb,
  MessageCircleQuestion,
  MessagesSquare,
  Plane,
  Puzzle,
  ScrollText,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';

import type { WorkbenchTabKind } from './workbenchTabs';

export type LauncherStyle = { Icon: LucideIcon; gradient: string };

/** Light top → system colour bottom, the way home-screen icons are lit. */
const tile = (top: string, bottom: string): string => `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`;

const GRADIENTS = {
  blue: tile('#5AA9FF', '#0A6CFF'),
  orange: tile('#FFB547', '#FF8A00'),
  purple: tile('#D88BFF', '#A23FE0'),
  green: tile('#6BE38A', '#25B04A'),
  amber: tile('#FFDA5C', '#FFA800'),
  graphite: tile('#4A4A4E', '#26262A'),
  cyan: tile('#7FD9FF', '#1FA6EB'),
  pink: tile('#FF7A90', '#F2294F'),
  indigo: tile('#8C89FF', '#4F4BD8'),
  teal: tile('#5EDDD3', '#13A39B'),
  gray: tile('#B4B4BB', '#77777F'),
} as const;

/** Plugins and kinds this build does not know: neutral grey with a puzzle piece. */
const FALLBACK: LauncherStyle = { Icon: Puzzle, gradient: GRADIENTS.gray };

const STYLES: Partial<Record<WorkbenchTabKind, LauncherStyle>> = {
  inspector: { Icon: Info, gradient: GRADIENTS.blue },
  limits: { Icon: Gauge, gradient: GRADIENTS.orange },
  artifacts: { Icon: FolderOpen, gradient: GRADIENTS.purple },
  artifact: { Icon: FileImage, gradient: GRADIENTS.purple },
  chat: { Icon: MessagesSquare, gradient: GRADIENTS.green },
  btw: { Icon: MessageCircleQuestion, gradient: GRADIENTS.green },
  advisor: { Icon: Lightbulb, gradient: GRADIENTS.amber },
  terminal: { Icon: SquareTerminal, gradient: GRADIENTS.graphite },
  files: { Icon: Folder, gradient: GRADIENTS.cyan },
  stats: { Icon: BarChart3, gradient: GRADIENTS.pink },
  autopilot: { Icon: Plane, gradient: GRADIENTS.indigo },
  report: { Icon: ScrollText, gradient: GRADIENTS.teal },
  newtab: { Icon: LayoutGrid, gradient: GRADIENTS.gray },
  plugin: FALLBACK,
};

/** `ref` names the plugin; every plugin shares the neutral tile for now. */
export function launcherStyleFor(kind: WorkbenchTabKind, _ref?: string): LauncherStyle {
  return STYLES[kind] ?? FALLBACK;
}
