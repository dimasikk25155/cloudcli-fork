import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

/**
 * Grok Build's catalog comes straight from `grok models` on a logged-in box:
 *
 *   Default model: grok-4.6
 *   Available models:
 *     * grok-4.6 (default)
 *     - grok-4.5
 *
 * Both ride the SuperGrok / X Premium+ subscription through the OAuth token in
 * ~/.grok/auth.json and never touch the Claude Max limit. The ids are passed to
 * `grok -m <id>` verbatim.
 *
 * The effort levels are MODEL-SPECIFIC and were measured on 1.0.5 by feeding
 * the CLI a bogus level and reading what it lists back:
 *   grok-4.6 --effort bogus -> "use one of: xhigh, high, medium, low"
 *   grok-4.5 --effort bogus -> "use one of: high, medium, low"
 * So `xhigh` on 4.5 is a hard argv error, not a downgrade. xAI documents no
 * default level, hence no `effort.default` here.
 */
/**
 * Режимы, как их видит Дима на grok.com — и что за ними стоит на самом деле.
 *
 * У веб-Grok'а в пикере пять пунктов (Авто / Быстрый / Эксперт / Build / Тяжёлый),
 * а у CLI ровно две модели и флаг усилия. Поэтому режим здесь — это пресет
 * «модель + уровень размышления (+ правило)», который разворачивается ровно в
 * одном месте: buildGrokArgs в server/grok-cli.js. Через него идут все три
 * диспетчера (чат, agent-run, /api/agent), поэтому псевдо-id `grok-mode-*`
 * физически не может утечь в argv — а утёк бы, CLI ответил бы
 * "unknown model id" и прогон умер бы до похода в xAI.
 *
 * Честность подписей важнее сходства с grok.com: «Тяжёлого» (группы экспертов)
 * у CLI нет вообще, это эмуляция параллельными сабагентами, и в описании так и
 * написано. Иначе Дима будет думать, что купил SuperGrok Heavy за $30.
 */
export type GrokModePreset = {
  /** Реальный id для `grok -m` */
  model: string;
  /** Уровень для `--reasoning-effort`; null — не передавать флаг вообще */
  effort: string | null;
  /** Необязательная приписка к --rules */
  rule?: string;
};

export const GROK_MODE_PRESETS: Record<string, GrokModePreset> = {
  'grok-mode-auto': { model: 'grok-4.6', effort: null },
  'grok-mode-fast': { model: 'grok-4.5', effort: 'low' },
  'grok-mode-expert': { model: 'grok-4.5', effort: 'high' },
  'grok-mode-build': { model: 'grok-4.6', effort: 'high' },
  'grok-mode-heavy': {
    model: 'grok-4.6',
    effort: 'xhigh',
    rule: [
      'HEAVY MODE: WORK AS A PANEL, NOT AS ONE HEAD.',
      'Split the task into 3-5 genuinely independent angles and launch them as parallel subagents in a single batch',
      'with the `task` tool — different angles, not the same question asked five times.',
      'Then read every answer, resolve the disagreements yourself, and reply with one synthesis:',
      'what they agreed on, where they clashed, what you concluded. Never paste the raw subagent output as the answer.',
      'If the task is plainly small, say so in one line and just do it — a panel on a one-liner is a waste of the quota.',
    ].join(' '),
  },
};

export function resolveGrokModePreset(model?: string | null): GrokModePreset | null {
  // hasOwn, не просто индексация: `GROK_MODE_PRESETS['constructor']` вернул бы
  // функцию из прототипа, а из неё в argv уехало бы `-m undefined`.
  return typeof model === 'string' && Object.hasOwn(GROK_MODE_PRESETS, model)
    ? GROK_MODE_PRESETS[model]
    : null;
}

export const GROK_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'grok-mode-auto',
      label: 'Авто',
      description: 'Уровень размышления выбирает сам движок · Grok 4.6',
    },
    {
      value: 'grok-mode-fast',
      label: 'Быстрый',
      description: 'Быстрые ответы · Grok 4.5',
    },
    {
      value: 'grok-mode-expert',
      label: 'Эксперт',
      description: 'Глубокое размышление · Grok 4.5',
    },
    {
      value: 'grok-mode-build',
      label: 'Build',
      description: 'Пишет приложения и сайты · Grok 4.6',
    },
    {
      value: 'grok-mode-heavy',
      label: 'Тяжёлый',
      description: 'Группа экспертов · эмуляция: параллельные сабагенты Grok 4.6 · ест квоту в разы быстрее',
    },
    // Сырые модели остаются рабочими, но из списка убраны: режим выше уже
    // задаёт и модель, и уровень. Старые чаты и localStorage с этими id
    // продолжают работать — вернуть в пикер = снять hidden.
    {
      value: 'grok-4.6',
      label: 'Grok 4.6',
      description: 'Флагман xAI · 500K контекст, текст+картинки · подписка SuperGrok, не тратит лимит Claude',
      hidden: true,
      effort: {
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'grok-4.5',
      label: 'Grok 4.5',
      description: 'Предыдущее поколение Grok · подписка SuperGrok',
      hidden: true,
      effort: {
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
      },
    },
  ],
  DEFAULT: 'grok-mode-build',
};

export class GrokProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return GROK_FALLBACK_MODELS;
  }

  async getCurrentActiveModel(_sessionId?: string): Promise<ProviderCurrentActiveModel> {
    // Grok records the model inside each session's summary.json, but the app's
    // own per-session override is the authoritative answer here, same as the
    // other CLI providers.
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('grok', input);
  }
}
