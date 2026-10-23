import React from 'react';

import { requestHubPanel } from '../hub/hubPanels';

import DuetDecisionCard from './DuetDecisionCard';
import type { DuetDecision } from './duetModel';

/** Блок «Дуэт» в хабе «Ждут тебя»: открытые решения + вход в окно Дуэта. */
export default function DuetHubList({ decisions, onChanged }: { decisions: readonly DuetDecision[]; onChanged: () => void }) {
  return (
    <div className="space-y-2">
      {decisions.map((decision) => (
        <DuetDecisionCard key={decision.id} decision={decision} onChanged={onChanged} />
      ))}
      <button
        type="button"
        onClick={() => requestHubPanel('duet')}
        className="text-xs text-primary hover:underline"
      >
        Открыть Дуэт
      </button>
    </div>
  );
}
