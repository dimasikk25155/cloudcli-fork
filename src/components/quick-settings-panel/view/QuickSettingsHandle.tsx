import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { QuickSettingsHandleStyle } from '../types';

type QuickSettingsHandleProps = {
  isOpen: boolean;
  isDragging: boolean;
  style: QuickSettingsHandleStyle;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onTouchStart: (event: ReactTouchEvent<HTMLButtonElement>) => void;
};

export default function QuickSettingsHandle({
  isOpen,
  isDragging,
  style,
  onClick,
  onMouseDown,
  onTouchStart,
}: QuickSettingsHandleProps) {
  const { t } = useTranslation('settings');

  const placementClass = isOpen ? 'right-64' : 'right-0';
  // Материал — общее стекло темы (`glass-surface`), а не своё размытие. Язычок
  // узкий и полупрозрачный, пока его не трогают: на телефоне он стоит у края
  // экрана поверх текста сообщений. Зона нажатия 44×44 px — из класса
  // `glass-handle` (в px, от плотности темы не зависит).
  const dragClass = isDragging ? 'opacity-100 !border-primary' : 'opacity-60 hover:opacity-100';
  const transitionClass = isDragging
    ? ''
    : 'transition-all duration-150 ease-out';
  const cursorClass = isDragging ? 'cursor-grabbing' : 'cursor-pointer';
  const ariaLabel = isDragging
    ? t('quickSettings.dragHandle.dragging')
    : isOpen
      ? t('quickSettings.dragHandle.closePanel')
      : t('quickSettings.dragHandle.openPanel');
  const title = isDragging
    ? t('quickSettings.dragHandle.draggingStatus')
    : t('quickSettings.dragHandle.toggleAndMove');

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      className={`fixed ${placementClass} z-50 ${transitionClass} glass-surface glass-handle border-r-0 ${dragClass} rounded-l-md rounded-r-none px-1 py-3 ${cursorClass} touch-none`}
      style={{
        ...style,
        touchAction: 'none',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
      }}
      aria-label={ariaLabel}
      title={title}
    >
      {isDragging ? (
        <GripVertical className="h-4 w-4 text-primary" />
      ) : isOpen ? (
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      ) : (
        <ChevronLeft className="h-4 w-4 text-muted-foreground" />
      )}
    </button>
  );
}
