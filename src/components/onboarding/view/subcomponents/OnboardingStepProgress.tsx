type OnboardingStepProgressProps = {
  currentStep: number;
  labels: string[];
};

export default function OnboardingStepProgress({ currentStep, labels }: OnboardingStepProgressProps) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-center gap-2">
        {labels.map((label, index) => (
          <div
            key={label}
            className={`h-1.5 w-10 rounded-full transition-colors duration-200 ${
              index <= currentStep ? 'bg-primary' : 'bg-border'
            }`}
          />
        ))}
      </div>
      <p className="mt-3 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {labels[currentStep]}
      </p>
    </div>
  );
}
