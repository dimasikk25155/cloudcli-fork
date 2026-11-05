import React, { useMemo, useState } from 'react';
import { ArrowLeft, Loader2, MessageSquare, Pencil, Plus, Trash2, Users } from 'lucide-react';

import { cn } from '../../lib/utils';

import {
  addRule,
  AgentsApiError,
  createAgent,
  deleteAgent,
  fetchRules,
  removeRule,
  startChat,
  updateAgent,
} from './agentsApi';
import {
  canStartChat,
  effortChoices,
  emptyForm,
  fieldOfErrorCode,
  formFromAgent,
  historyLine,
  modelChoices,
  PROVIDER_LABELS,
  PROVIDERS,
  roleSummary,
  ruleOrigin,
  toPayload,
  validateForm,
  versionLabel,
  type AgentForm,
  type AgentItem,
  type AgentProvider,
  type AgentRules,
  type FormErrors,
  type FormField,
} from './agentsModel';
import { useAgents } from './useAgents';

// Панель «Агенты»: именованные «сотрудники» с ролью, проверкой результата,
// движком, папкой проекта, файлами-знаниями и памятью правил с версиями.
// Данные — /api/agents (админ, мод modAgents).

const INPUT = 'w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring';
const BUTTON = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50';
const PRIMARY = `${BUTTON} bg-primary text-primary-foreground hover:bg-primary/90`;
const SECONDARY = `${BUTTON} border border-border text-foreground hover:bg-accent/60`;

type View = { kind: 'list' } | { kind: 'form'; agent: AgentItem | null } | { kind: 'detail'; id: string };

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-muted-foreground/80">{hint}</span>}
      {error && <span role="alert" className="block text-xs text-destructive">{error}</span>}
    </label>
  );
}

type AgentFormViewProps = {
  agent: AgentItem | null;
  data: ReturnType<typeof useAgents>;
  onCancel: () => void;
  onSaved: (agent: AgentItem) => void;
};

function AgentFormView({ agent, data, onCancel, onSaved }: AgentFormViewProps) {
  const [form, setForm] = useState<AgentForm>(() => (agent ? formFromAgent(agent) : emptyForm(data.projects[0]?.fullPath ?? '')));
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const models = useMemo(() => modelChoices(form.provider, data.catalogs[form.provider]), [form.provider, data.catalogs]);
  const efforts = useMemo(
    () => effortChoices(form.provider, form.model, data.catalogs[form.provider]),
    [form.provider, form.model, data.catalogs],
  );
  // Сохранённая папка может уже не быть в списке проектов — оставляем её видимой.
  const projectOptions = data.projects.some((project) => project.fullPath === form.projectPath) || !form.projectPath
    ? data.projects
    : [{ fullPath: form.projectPath, displayName: form.projectPath }, ...data.projects];

  const set = <K extends keyof AgentForm>(key: K, value: AgentForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const changeProvider = (provider: AgentProvider) => {
    const first = modelChoices(provider, data.catalogs[provider])[0]?.value ?? '';
    setForm((current) => ({ ...current, provider, model: first, effort: '' }));
  };

  const changeModel = (model: string) => {
    setForm((current) => ({
      ...current,
      model,
      effort: effortChoices(current.provider, model, data.catalogs[current.provider]).includes(current.effort) ? current.effort : '',
    }));
  };

  const submit = async () => {
    const local = validateForm(form);
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length > 0) return;
    setSaving(true);
    try {
      const saved = agent ? await updateAgent(agent.id, toPayload(form)) : await createAgent(toPayload(form));
      await data.reload();
      onSaved(saved);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось сохранить агента';
      const field: FormField | null = error instanceof AgentsApiError ? fieldOfErrorCode(error.code) : null;
      if (field) setErrors({ [field]: message });
      else setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <button type="button" className={SECONDARY} onClick={onCancel}><ArrowLeft className="h-4 w-4" />Назад</button>
        <h3 className="text-sm font-semibold">{agent ? `Агент «${agent.name}»` : 'Новый агент'}</h3>
      </div>

      <Field label="Имя" error={errors.name}>
        <input className={INPUT} value={form.name} maxLength={80} onChange={(event) => set('name', event.target.value)} placeholder="Например, Художник" />
      </Field>
      <Field label="Роль" hint="Что агент делает и как. Уходит ему в начале каждого чата." error={errors.role}>
        <textarea className={cn(INPUT, 'min-h-28')} value={form.role} onChange={(event) => set('role', event.target.value)} />
      </Field>
      <Field
        label="Проверка результата"
        hint="Правила самопроверки: агент сверяет по ним ответ и заканчивает строкой «ВЕРДИКТ: OK» или «ВЕРДИКТ: FAIL — причина»."
        error={errors.checks}
      >
        <textarea className={cn(INPUT, 'min-h-20')} value={form.checks} onChange={(event) => set('checks', event.target.value)} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Движок" error={errors.provider}>
          <select className={INPUT} value={form.provider} onChange={(event) => changeProvider(event.target.value as AgentProvider)}>
            {PROVIDERS.map((provider) => <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>)}
          </select>
        </Field>
        <Field label="Модель" error={errors.model}>
          <select className={INPUT} value={form.model} onChange={(event) => changeModel(event.target.value)}>
            {models.some((model) => model.value === form.model) ? null : <option value={form.model}>{form.model}</option>}
            {models.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
          </select>
        </Field>
        <Field label="Усилие (effort)" error={errors.effort}>
          <select className={INPUT} value={form.effort} onChange={(event) => set('effort', event.target.value)} disabled={efforts.length === 0}>
            <option value="">по умолчанию</option>
            {efforts.map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Папка проекта" error={errors.projectPath}>
        {projectOptions.length > 0 ? (
          <select className={INPUT} value={form.projectPath} onChange={(event) => set('projectPath', event.target.value)}>
            {!form.projectPath && <option value="">— выбери проект —</option>}
            {projectOptions.map((project) => <option key={project.fullPath} value={project.fullPath}>{project.displayName}</option>)}
          </select>
        ) : (
          <input className={INPUT} value={form.projectPath} onChange={(event) => set('projectPath', event.target.value)} placeholder="/путь/к/проекту" />
        )}
      </Field>

      <Field
        label="Файлы-знания"
        hint="По пути в строке, до 20. Агент прочитает их перед работой; внутрь сообщения они не вставляются. Файл должен лежать в папке проекта."
        error={errors.files}
      >
        <textarea className={cn(INPUT, 'min-h-20 font-mono text-xs')} value={form.filesText} onChange={(event) => set('filesText', event.target.value)} placeholder="docs/style.md" />
      </Field>

      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
      <div className="flex gap-2">
        <button type="button" className={PRIMARY} onClick={() => void submit()} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}Сохранить
        </button>
        <button type="button" className={SECONDARY} onClick={onCancel} disabled={saving}>Отмена</button>
      </div>
    </div>
  );
}

function MemorySection({ agent, onChanged }: { agent: AgentItem; onChanged: () => void }) {
  const [rules, setRules] = useState<AgentRules | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  React.useEffect(() => {
    let cancelled = false;
    fetchRules(agent.id)
      .then((value) => { if (!cancelled) setRules(value); })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить память'); });
    return () => { cancelled = true; };
  }, [agent.id]);

  const run = async (action: () => Promise<AgentRules>) => {
    setBusy(true);
    setError(null);
    try {
      setRules(await action());
      onChanged();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Не получилось');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Память <span className="font-normal text-muted-foreground">· {versionLabel(rules?.version ?? agent.rulesVersion)}</span></h4>
        {rules && rules.history.length > 0 && (
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => setShowHistory((value) => !value)}>
            {showHistory ? 'Скрыть историю' : 'История версий'}
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Правила идут агенту в каждом новом чате. Агент может дописать правило сам — оно помечено.</p>
      {rules && rules.rules.length === 0 && <p className="text-sm text-muted-foreground">Правил пока нет.</p>}
      <ul className="space-y-1">
        {rules?.rules.map((rule) => (
          <li key={rule.id} className="flex items-start gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm">
            <span className="min-w-0 flex-1 break-words">{rule.text}</span>
            <span className={cn('flex-shrink-0 text-[11px]', rule.addedBy === 'agent' ? 'text-primary' : 'text-muted-foreground')}>
              V{rule.versionAdded} · {ruleOrigin(rule.addedBy)}
            </span>
            <button type="button" aria-label="Удалить правило" title="Удалить правило" disabled={busy} className="flex-shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-50" onClick={() => void run(() => removeRule(agent.id, rule.id))}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim()) return;
          void run(() => addRule(agent.id, text.trim())).then(() => setText(''));
        }}
      >
        <input className={INPUT} value={text} maxLength={500} onChange={(event) => setText(event.target.value)} placeholder="Новое правило, например: до 4 переделок" />
        <button type="submit" className={SECONDARY} disabled={busy || !text.trim()}><Plus className="h-4 w-4" />Добавить</button>
      </form>
      {showHistory && rules && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {rules.history.map((entry, index) => <li key={`${entry.version}-${index}`}>{historyLine(entry)}</li>)}
        </ul>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  );
}

type DetailProps = {
  agent: AgentItem;
  onBack: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  onChanged: () => void;
  onOpenChat?: (sessionId: string) => void;
};

function AgentDetail({ agent, onBack, onEdit, onDeleted, onChanged, onOpenChat }: DetailProps) {
  const [task, setTask] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const begin = async () => {
    if (!canStartChat(task)) return;
    setStarting(true);
    setError(null);
    try {
      const sessionId = await startChat(agent.id, task.trim());
      setTask('');
      onOpenChat?.(sessionId);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Не удалось начать чат');
    } finally {
      setStarting(false);
    }
  };

  const remove = async () => {
    try {
      await deleteAgent(agent.id);
      onDeleted();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Не удалось удалить агента');
    }
  };

  return (
    <div className="space-y-5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={SECONDARY} onClick={onBack}><ArrowLeft className="h-4 w-4" />Назад</button>
        <h3 className="min-w-0 flex-1 truncate text-base font-semibold">{agent.name}</h3>
        <button type="button" className={SECONDARY} onClick={onEdit}><Pencil className="h-4 w-4" />Изменить</button>
        {confirmDelete ? (
          <>
            <button type="button" className={`${BUTTON} bg-destructive text-destructive-foreground`} onClick={() => void remove()}>Точно удалить</button>
            <button type="button" className={SECONDARY} onClick={() => setConfirmDelete(false)}>Нет</button>
          </>
        ) : (
          <button type="button" className={SECONDARY} onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" />Удалить</button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {PROVIDER_LABELS[agent.provider]} · {agent.model}{agent.effort ? ` · ${agent.effort}` : ''} · {agent.projectPath}
      </p>

      <section className="space-y-2 rounded-xl border border-border p-3">
        <h4 className="text-sm font-semibold">Новый чат с агентом</h4>
        <textarea className={cn(INPUT, 'min-h-20')} value={task} onChange={(event) => setTask(event.target.value)} placeholder="Задача: что нужно сделать" />
        <button type="button" className={PRIMARY} onClick={() => void begin()} disabled={starting || !canStartChat(task)}>
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}Начать чат
        </button>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </section>

      <section className="space-y-1">
        <h4 className="text-sm font-semibold">Роль</h4>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{agent.role}</p>
      </section>
      {agent.checks && (
        <section className="space-y-1">
          <h4 className="text-sm font-semibold">Проверка результата</h4>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{agent.checks}</p>
        </section>
      )}
      {agent.files.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-sm font-semibold">Файлы-знания</h4>
          <ul className="space-y-0.5 font-mono text-xs text-muted-foreground">
            {agent.files.map((file) => <li key={file} className="break-all">{file}</li>)}
          </ul>
        </section>
      )}

      <MemorySection agent={agent} onChanged={onChanged} />
    </div>
  );
}

export default function AgentsPanel({ onOpenChat }: { onOpenChat?: (sessionId: string) => void }) {
  const data = useAgents();
  const [view, setView] = useState<View>({ kind: 'list' });

  if (view.kind === 'form') {
    return (
      <div className="h-full overflow-y-auto">
        <AgentFormView
          agent={view.agent}
          data={data}
          onCancel={() => setView(view.agent ? { kind: 'detail', id: view.agent.id } : { kind: 'list' })}
          onSaved={(saved) => setView({ kind: 'detail', id: saved.id })}
        />
      </div>
    );
  }

  if (view.kind === 'detail') {
    const agent = data.agents.find((item) => item.id === view.id);
    if (agent) {
      return (
        <div className="h-full overflow-y-auto">
          <AgentDetail
            agent={agent}
            onBack={() => setView({ kind: 'list' })}
            onEdit={() => setView({ kind: 'form', agent })}
            onDeleted={() => { void data.reload(); setView({ kind: 'list' }); }}
            onChanged={() => void data.reload()}
            onOpenChat={onOpenChat}
          />
        </div>
      );
    }
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Помощники с ролью, памятью и своим движком. Штаб зовёт их по имени.</p>
        <button type="button" className={PRIMARY} onClick={() => setView({ kind: 'form', agent: null })}><Plus className="h-4 w-4" />Новый агент</button>
      </div>
      {data.loading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загружаю…</p>}
      {data.error && <p role="alert" className="text-sm text-destructive">{data.error}</p>}
      {!data.loading && !data.error && data.agents.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          <Users className="mx-auto mb-2 h-6 w-6" />
          Агентов пока нет. Создай первого: имя, роль и папка проекта — этого достаточно.
        </div>
      )}
      <ul className="space-y-2">
        {data.agents.map((agent) => (
          <li key={agent.id}>
            <button
              type="button"
              className="flex w-full items-start gap-3 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
              onClick={() => setView({ kind: 'detail', id: agent.id })}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{agent.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{roleSummary(agent.role)}</span>
              </span>
              <span className="flex-shrink-0 text-right text-[11px] text-muted-foreground">
                <span className="block">{PROVIDER_LABELS[agent.provider]} · {agent.model}</span>
                <span className="block">память {versionLabel(agent.rulesVersion)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
