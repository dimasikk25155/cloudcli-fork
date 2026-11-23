import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Star } from 'lucide-react';

import type { Project } from '../../types/app';
import { cn } from '../../lib/utils';
import { fileToIconDataUrl, writeProjectIcon } from '../app-icon/projectIconStorage';

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 12;

type IconMenu = {
  project: Project;
  left: number;
  top: number;
};

export type ProjectTileButtonProps = Pick<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick' | 'onContextMenu' | 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onPointerLeave'
>;

export type ProjectTileMenu = {
  /** Tap opens the project; hold or right-click opens the menu. */
  tileProps: (project: Project, onOpen: (project: Project) => void) => ProjectTileButtonProps;
  toggleStar: ((project: Project) => void) | null;
  /** The menu (portalled above dialogs) and the hidden file picker; render once. */
  layer: ReactNode;
};

function clampMenuPosition(x: number, y: number) {
  const menuWidth = 220;
  const menuHeight = 120;
  const left = Math.min(Math.max(12, x - 20), window.innerWidth - menuWidth - 12);
  const top = Math.min(Math.max(12, y - 8), window.innerHeight - menuHeight - 12);
  return { left, top };
}

/**
 * Long-press menu of a project tile (pin / custom picture), shared by Home and
 * the «All projects» folder.
 */
export function useProjectTileMenu(onToggleStarProject?: (projectId: string) => void): ProjectTileMenu {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pressTimerRef = useRef<number | null>(null);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const [iconTarget, setIconTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<IconMenu | null>(null);

  const clearPressTimer = () => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressStartRef.current = null;
  };

  const openMenu = (project: Project, x: number, y: number) => {
    clearPressTimer();
    suppressClickRef.current = true;
    setMenu({ project, ...clampMenuPosition(x, y) });
  };

  const openIconPicker = (projectId: string) => {
    setMenu(null);
    setIconTarget(projectId);
    fileInputRef.current?.click();
  };

  const handleIconFile = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    const projectId = iconTarget;
    setIconTarget(null);
    if (!file || !projectId) return;
    try {
      const dataUrl = await fileToIconDataUrl(file);
      writeProjectIcon(projectId, dataUrl);
    } catch {
      // Ignore a dropped non-image — the existing icon stays.
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const toggleStar = onToggleStarProject
    ? (project: Project) => {
        setMenu(null);
        onToggleStarProject(project.projectId);
      }
    : null;

  useEffect(() => {
    if (!menu) return undefined;

    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const tileProps = (project: Project, onOpen: (project: Project) => void): ProjectTileButtonProps => ({
    onClick: () => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      onOpen(project);
    },
    onContextMenu: (event) => {
      event.preventDefault();
      openMenu(project, event.clientX, event.clientY);
    },
    onPointerDown: (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      clearPressTimer();
      const { clientX, clientY } = event;
      pressStartRef.current = { x: clientX, y: clientY };
      pressTimerRef.current = window.setTimeout(() => {
        openMenu(project, clientX, clientY);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event) => {
      const start = pressStartRef.current;
      if (!start || pressTimerRef.current === null) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if ((dx * dx) + (dy * dy) > MOVE_CANCEL_PX * MOVE_CANCEL_PX) {
        clearPressTimer();
      }
    },
    onPointerUp: clearPressTimer,
    onPointerCancel: clearPressTimer,
    onPointerLeave: clearPressTimer,
  });

  // Above PanelModal (z-[10000]), so the folder's tiles get the same menu.
  const menuElement = menu && typeof document !== 'undefined'
    ? createPortal(
        <div className="fixed inset-0 z-[10001]" onPointerDown={() => setMenu(null)}>
          <div
            role="menu"
            className="glass-surface absolute min-w-[200px] overflow-hidden py-1"
            style={{ left: menu.left, top: menu.top }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {toggleStar && (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-foreground hover:bg-accent/70"
                onClick={() => toggleStar(menu.project)}
              >
                <Star className={cn('h-4 w-4', menu.project.isStarred && 'fill-current text-warning')} />
                {menu.project.isStarred
                  ? t('mainContent.unpinProject', 'Unpin')
                  : t('mainContent.pinProject', 'Pin')}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-foreground hover:bg-accent/70"
              onClick={() => openIconPicker(menu.project.projectId)}
            >
              <ImagePlus className="h-4 w-4" />
              {t('mainContent.setProjectIcon', 'Set a custom icon')}
            </button>
          </div>
        </div>,
        document.body,
      )
    : null;

  const layer = (
    <>
      {menuElement}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleIconFile(event.target.files);
        }}
      />
    </>
  );

  return { tileProps, toggleStar, layer };
}
