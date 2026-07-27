import { Bot, SquareTerminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PillBar, Pill } from '../../../../shared/view/ui';

export type ShellMode = 'agent' | 'plain';

type Props = {
  mode: ShellMode;
  onChange: (mode: ShellMode) => void;
};

/**
 * Switches the Terminal tab between the agent CLI session and a real interactive
 * shell on the server. Each mode keeps its own PTY, so switching does not kill
 * the other one.
 */
export default function ShellModeSwitcher({ mode, onChange }: Props) {
  const { t } = useTranslation();

  const options: { id: ShellMode; label: string; icon: typeof Bot }[] = [
    { id: 'agent', label: t('shellMode.agent'), icon: Bot },
    { id: 'plain', label: t('shellMode.plain'), icon: SquareTerminal },
  ];

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <PillBar>
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <Pill
              key={option.id}
              isActive={mode === option.id}
              onClick={() => onChange(option.id)}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{option.label}</span>
            </Pill>
          );
        })}
      </PillBar>
    </div>
  );
}
