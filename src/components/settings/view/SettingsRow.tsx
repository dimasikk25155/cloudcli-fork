import React from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import SettingsToggle from './SettingsToggle';

type SettingsRowLayout = 'stacked' | 'inline';

type SettingsRowProps = {
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /**
   * `stacked` — на телефоне подпись и описание на всю ширину, элемент под ними;
   * `inline` — элемент справа от текста на любой ширине. По умолчанию переключатель
   * стоит в ряду (он узкий), всё остальное — список, кнопка, поле — под текстом:
   * справа оно отъедало до двух третей ширины и сжимало описание в столбик.
   */
  layout?: SettingsRowLayout;
};

const layoutFor = (children: ReactNode): SettingsRowLayout =>
  React.isValidElement(children) && children.type === SettingsToggle ? 'inline' : 'stacked';

export default function SettingsRow({ label, description, children, className, layout }: SettingsRowProps) {
  const resolved = layout ?? layoutFor(children);
  const stacked = resolved === 'stacked';

  return (
    <div
      data-row-layout={resolved}
      className={cn(
        'px-4 py-3.5 md:py-4',
        stacked
          ? 'flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between md:gap-4'
          : 'flex items-center justify-between gap-4',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && (
          <div className="mt-0.5 text-sm text-muted-foreground">{description}</div>
        )}
      </div>
      <div className={stacked ? 'min-w-0 md:flex-shrink-0' : 'flex-shrink-0'}>{children}</div>
    </div>
  );
}
