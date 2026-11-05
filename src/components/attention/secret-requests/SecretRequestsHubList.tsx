import React from 'react';

import SecretRequestCard from './SecretRequestCard';
import type { SecretRequestEntry } from './secretRequestsStore';

type SecretRequestsHubListProps = {
  entries: SecretRequestEntry[];
  onSave: (id: string, value: string, replace: boolean) => void;
  onDecline: (id: string) => void;
  onOpenSession?: (sessionId: string) => void;
};

/** «Агент просит ключ» section of «Ждут тебя». */
export default function SecretRequestsHubList({ entries, onSave, onDecline, onOpenSession }: SecretRequestsHubListProps) {
  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <SecretRequestCard
          key={entry.request.id}
          entry={entry}
          onSave={(value, replace) => onSave(entry.request.id, value, replace)}
          onDecline={() => onDecline(entry.request.id)}
          onOpenSession={onOpenSession ? () => onOpenSession(entry.request.sessionId) : undefined}
        />
      ))}
    </div>
  );
}
