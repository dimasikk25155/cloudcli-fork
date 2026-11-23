import React from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';

type HomeSearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  /** Focus in / out of the field (Home holds its rows while it is focused). */
  onFocusChange?: (focused: boolean) => void;
};

/** The glass pill search field of Home (computer) and the «All projects» folder. */
export default function HomeSearchField({ value, onChange, onFocusChange }: HomeSearchFieldProps) {
  const { t } = useTranslation();

  return (
    <div className="glass-surface relative mx-auto flex h-10 w-full max-w-sm items-center rounded-full focus-within:ring-2 focus-within:ring-ring">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocusChange ? () => onFocusChange(true) : undefined}
        onBlur={onFocusChange ? () => onFocusChange(false) : undefined}
        placeholder={t('mainContent.searchProjects', 'Find a project')}
        className="h-full w-full appearance-none rounded-full border-0 bg-transparent pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-0 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onChange('')}
          aria-label={t('buttons.clear', 'Clear')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
