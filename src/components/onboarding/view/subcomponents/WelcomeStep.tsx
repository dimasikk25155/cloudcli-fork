import { FolderKanban, MessageSquare, PenLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type WelcomeStepProps = {
  step: 0 | 1 | 2;
};

const STEPS = [
  { icon: MessageSquare, key: 'notChat' },
  { icon: FolderKanban, key: 'words' },
  { icon: PenLine, key: 'task' },
] as const;

export default function WelcomeStep({ step }: WelcomeStepProps) {
  const { t } = useTranslation('common');
  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto mb-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-inset ring-primary/20">
        <Icon className="h-7 w-7 text-primary" />
      </div>
      <h2 className="text-xl font-bold tracking-tight text-foreground">
        {t(`onboarding.welcome.${current.key}.title`)}
      </h2>
      <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
        {t(`onboarding.welcome.${current.key}.body`)}
      </p>
    </div>
  );
}
