/** Bodies of the /doctor and /skill-doctor result windows (read-only reports). */
import React from 'react';

import type { DoctorCommandData, SkillDoctorCommandData } from '../../hooks/useChatComposerState';

const STATUS_LABEL: Record<string, string> = { ok: 'в порядке', warn: 'внимание', fail: 'сбой', unknown: 'неизвестно' };
const STATUS_TONE: Record<string, string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300',
  fail: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300',
  unknown: 'border-border/70 bg-muted text-muted-foreground',
};
const KIND_LABEL: Record<string, string> = {
  duplicate: 'Дубли',
  no_description: 'Нет описания',
  broken_link: 'Битые ссылки',
  conflict: 'Конфликты имён',
};

export function DoctorContent({ data }: { data: DoctorCommandData }) {
  const checks = data.report?.checks ?? [];
  return (
    <div className="h-full space-y-2 overflow-y-auto" data-doctor-report>
      {checks.length === 0 && <p className="text-sm text-muted-foreground">Проверок нет.</p>}
      {checks.map((check) => (
        <div key={check.id} className="flex items-start justify-between gap-3 rounded-xl border border-border/70 bg-background/75 px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{check.title}</p>
            <p className="break-words text-xs text-muted-foreground">{check.detail}</p>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[check.status] ?? STATUS_TONE.unknown}`}>
            {STATUS_LABEL[check.status] ?? check.status}
          </span>
        </div>
      ))}
      <p className="pt-1 text-xs text-muted-foreground">Это отчёт: ничего не исправлено. Починку можно попросить отдельно.</p>
    </div>
  );
}

export function SkillDoctorContent({ data }: { data: SkillDoctorCommandData }) {
  const skills = data.report?.skills ?? [];
  const issues = data.report?.issues ?? [];
  const kinds = Object.keys(KIND_LABEL).filter((kind) => issues.some((issue) => issue.kind === kind));
  return (
    <div className="h-full space-y-3 overflow-y-auto" data-skill-doctor-report>
      <p className="text-sm text-foreground">
        Навыков: {skills.length}. Замечаний: {issues.length}.
      </p>
      {issues.length === 0 && <p className="text-sm text-muted-foreground">Всё чисто.</p>}
      {kinds.map((kind) => (
        <section key={kind}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{KIND_LABEL[kind]}</p>
          <ul className="space-y-1">
            {issues.filter((issue) => issue.kind === kind).map((issue, index) => (
              <li key={`${issue.skill}-${index}`} className="rounded-lg border border-border/70 bg-background/75 px-3 py-1.5 text-sm">
                <span className="font-medium text-foreground">{issue.skill}</span>
                <span className="text-muted-foreground">: {issue.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="pt-1 text-xs text-muted-foreground">Это отчёт: ничего не удалено и не изменено.</p>
    </div>
  );
}
