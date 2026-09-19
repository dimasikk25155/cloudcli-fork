import { Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { LLMProvider } from '../../../types/app';
import { authenticatedFetch } from '../../../utils/api';
import { useProviderAuthStatus } from '../../provider-auth/hooks/useProviderAuthStatus';
import ProviderLoginModal from '../../provider-auth/view/ProviderLoginModal';

import AgentConnectionsStep from './subcomponents/AgentConnectionsStep';
import OnboardingStepProgress from './subcomponents/OnboardingStepProgress';
import WelcomeStep from './subcomponents/WelcomeStep';
import { readErrorMessageFromResponse } from './utils';

type OnboardingProps = {
  onComplete?: () => void | Promise<void>;
};

const LAST_STEP = 3;

export default function Onboarding({ onComplete }: OnboardingProps) {
  const { t } = useTranslation('common');
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [activeLoginProvider, setActiveLoginProvider] = useState<LLMProvider | null>(null);
  const {
    providerAuthStatus,
    checkProviderAuthStatus,
    refreshProviderAuthStatuses,
  } = useProviderAuthStatus();

  const previousActiveLoginProviderRef = useRef<LLMProvider | null | undefined>(undefined);

  useEffect(() => {
    void refreshProviderAuthStatuses();
  }, [refreshProviderAuthStatuses]);

  useEffect(() => {
    const previousProvider = previousActiveLoginProviderRef.current;
    previousActiveLoginProviderRef.current = activeLoginProvider;

    const didCloseModal = previousProvider !== undefined
      && previousProvider !== null
      && activeLoginProvider === null;

    if (didCloseModal) {
      void refreshProviderAuthStatuses();
    }
  }, [activeLoginProvider, refreshProviderAuthStatuses]);

  const handleProviderLoginOpen = (provider: LLMProvider) => {
    setActiveLoginProvider(provider);
  };

  const handleLoginComplete = (exitCode: number) => {
    if (exitCode === 0 && activeLoginProvider) {
      void checkProviderAuthStatus(activeLoginProvider);
    }
  };

  const handleFinish = async () => {
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const response = await authenticatedFetch('/api/user/complete-onboarding', { method: 'POST' });
      if (!response.ok) {
        const message = await readErrorMessageFromResponse(response, t('onboarding.error'));
        throw new Error(message);
      }

      await onComplete?.();
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : t('onboarding.error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNextStep = () => {
    setErrorMessage('');
    if (currentStep >= LAST_STEP) {
      void handleFinish();
      return;
    }
    setCurrentStep((previous) => previous + 1);
  };

  const handlePreviousStep = () => {
    setErrorMessage('');
    setCurrentStep((previous) => previous - 1);
  };

  const stepLabels = [
    t('onboarding.steps.notChat'),
    t('onboarding.steps.words'),
    t('onboarding.steps.task'),
    t('onboarding.steps.claude'),
  ];

  return (
    <>
      <div className="relative h-screen overflow-y-auto bg-background">
        <div aria-hidden className="pointer-events-none fixed inset-0">
          <div className="absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -bottom-32 -left-24 h-[26rem] w-[26rem] rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute inset-0 bg-[radial-gradient(hsl(var(--foreground)/0.04)_1px,transparent_1px)] opacity-60 [background-size:22px_22px]" />
        </div>

        <button
          type="button"
          onClick={() => void handleFinish()}
          disabled={isSubmitting}
          className="absolute right-4 top-4 z-10 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {t('onboarding.skip')}
        </button>

        <div className="relative mx-auto flex min-h-full w-full max-w-2xl items-center justify-center p-4">
          <div className="w-full py-6">
          <OnboardingStepProgress currentStep={currentStep} labels={stepLabels} />

          <div className="rounded-2xl border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_-20px_hsl(var(--foreground)/0.18)] ring-1 ring-foreground/5 backdrop-blur-xl">
            {currentStep < LAST_STEP ? (
              <WelcomeStep step={currentStep as 0 | 1 | 2} />
            ) : (
              <AgentConnectionsStep
                providerStatuses={providerAuthStatus}
                onOpenProviderLogin={handleProviderLoginOpen}
              />
            )}

              {errorMessage && (
                <div
                  role="alert"
                  className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5"
                >
                  <p className="text-sm text-destructive">{errorMessage}</p>
                </div>
              )}

            <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
              <button
                onClick={handlePreviousStep}
                disabled={currentStep === 0 || isSubmitting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
                {t('onboarding.back')}
              </button>

              <button
                onClick={handleNextStep}
                disabled={isSubmitting}
                className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-200 hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('onboarding.completing')}
                  </>
                ) : currentStep < LAST_STEP ? (
                  <>
                    {t('onboarding.next')}
                    <ChevronRight className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    {t('onboarding.start')}
                  </>
                )}
              </button>
            </div>
          </div>
          </div>
        </div>
      </div>

      {activeLoginProvider && (
        <ProviderLoginModal
          isOpen={Boolean(activeLoginProvider)}
          onClose={() => setActiveLoginProvider(null)}
          provider={activeLoginProvider}
          onComplete={handleLoginComplete}
        />
      )}
    </>
  );
}
