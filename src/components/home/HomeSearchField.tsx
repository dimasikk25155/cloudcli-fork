import React from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';

type HomeSearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
};

/** The pill search field of Home and the «All projects» folder. */
export default function HomeSearchField({ value, onChange }: HomeSearchFieldProps) {
  const { t } = useTranslation();

  return (
    <div className="relative mx-auto w-full max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('mainContent.searchProjects', 'Find a project')}
        className="h-9 w-full rounded-full border-0 bg-background/40 pl-9 pr-9 text-sm text-foreground shadow-[0_4px_16px_rgba(0,0,0,0.18)] ring-1 ring-white/10 backdrop-blur-md placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {value && (
        <button
          type="button"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
          onClick={() => onChange('')}
          aria-label={t('buttons.clear', 'Clear')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
