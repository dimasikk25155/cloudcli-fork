import type { LLMProvider } from '@/shared/types.js';

/**
 * Static, backend-owned description of what one provider integration supports.
 *
 * The frontend renders its composer UI (permission mode picker, image upload,
 * abort button, ...) purely from this shape, which is what keeps the frontend
 * free of per-provider conditionals. New provider features should be exposed
 * here instead of branching on the provider id in React components.
 */
type ProviderCapabilities = {
  provider: LLMProvider;
  /** Permission modes the provider runtime understands, in cycle order. */
  permissionModes: string[];
  defaultPermissionMode: string;
  /** Whether image attachments can be included in a chat.send. */
  supportsImages: boolean;
  /** Whether an in-flight run can be cancelled via chat.abort. */
  supportsAbort: boolean;
  /** Whether interactive tool permission prompts can reach the UI. */
  supportsPermissionRequests: boolean;
  /** Whether the token-usage endpoint has data for this provider. */
  supportsTokenUsage: boolean;
  /** Whether the provider runtime can accept model-level reasoning effort. */
  supportsEffort: boolean;
  /**
   * Whether the runtime can carry a work mode (the "how much do you check in
   * with me" chip). It rides on a system-prompt append, so a runtime qualifies
   * only if it has a hook for that: the Claude SDK's appendSystemPrompt, or
   * Grok Build's `--rules`.
   */
  supportsWorkMode: boolean;
};

/**
 * The capability matrix mirrors what each runtime actually implements today:
 * - permission modes match the option sets accepted by each CLI/SDK.
 * - only the Claude SDK integration surfaces interactive permission requests.
 * - Cursor has no token usage endpoint support (its store.db has no usage rows).
 *
 * Only three modes are offered on purpose — default (ask), bypassPermissions
 * (never ask) and plan (read-only). `acceptEdits` and `auto` were dropped:
 * they sit between "ask me" and "don't ask me" and still interrupt an
 * unattended run, which is the one thing the bypass mode exists to prevent.
 * The runtimes still understand them (see the resolve*Permission* helpers), so
 * re-adding a mode here is enough to bring it back.
 */
const PROVIDER_CAPABILITIES: Record<LLMProvider, ProviderCapabilities> = {
  claude: {
    provider: 'claude',
    permissionModes: ['default', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsAbort: true,
    supportsPermissionRequests: true,
    supportsTokenUsage: true,
    supportsEffort: true,
    supportsWorkMode: true,
  },
  cursor: {
    provider: 'cursor',
    permissionModes: ['default', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: false,
    supportsEffort: false,
    supportsWorkMode: false,
  },
  codex: {
    provider: 'codex',
    // No plan mode: the Codex CLI has no read-only agent to map it onto.
    permissionModes: ['default', 'bypassPermissions'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: true,
    supportsEffort: true,
    supportsWorkMode: false,
  },
  opencode: {
    provider: 'opencode',
    // Mapped by the runtime onto OpenCode's controls: `--agent plan` (plan)
    // and `--auto` (bypassPermissions).
    // See resolveOpenCodePermissionOptions in opencode-cli.js.
    permissionModes: ['default', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: true,
    supportsEffort: true,
    supportsWorkMode: false,
  },
  kimi: {
    provider: 'kimi',
    // Headless `kimi -p` always auto-approves tool calls and rejects every
    // permission flag ("Cannot combine --prompt with --yolo/--auto/--plan"),
    // so only the default mode exists. Token usage is not exposed on the
    // stream-json stdout, and effort is a TUI-only control (K3 low/high/max)
    // with no headless flag. See resolveKimiPermissionOptions in kimi-cli.js.
    permissionModes: ['default'],
    defaultPermissionMode: 'default',
    supportsImages: false,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: false,
    supportsEffort: false,
    supportsWorkMode: false,
  },
  gemini: {
    provider: 'gemini',
    // Gemini takes `--approval-mode` even in headless mode, but its own
    // `default` mode prompts for approval — with no TTY that would stall the
    // run — so it is mapped onto `auto_edit` and the interactive-only value is
    // not offered. `plan` (read-only) and `yolo` (bypassPermissions) map
    // straight across. See resolveGeminiApprovalMode in gemini-cli.js.
    permissionModes: ['default', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: false,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: false,
    supportsEffort: false,
    supportsWorkMode: false,
  },
  grok: {
    provider: 'grok',
    // Grok Build takes `--permission-mode` in headless mode, but a run that
    // hits a permission gate does not stall — it ends immediately as
    // error_during_execution/cancelled with no answer text. Measured on 1.0.5:
    // `default` and `dontAsk` both cancelled on the first terminal command,
    // `auto` finished (end_turn), `bypassPermissions` finished. So the UI
    // `default` maps to `auto`, and `plan` is offered because its cancellation
    // IS the read-only gate. See resolveGrokPermissionMode in grok-cli.js.
    permissionModes: ['default', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    // Wired 24.08.2026: `--prompt-json` ACP content blocks (not Claude's
    // `{source:{type:base64}}` shape — that dies with "missing field `data`").
    supportsImages: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    // The `result` event carries a full Anthropic-shaped usage payload
    // (input/output/cache_read/cache_creation), so the token badge works.
    supportsTokenUsage: true,
    // `--reasoning-effort` takes low/medium/high (+ xhigh on 4.6 only) —
    // confirmed on 1.0.5, see grok-models.provider.ts. The CLI rejects any
    // other value at argv parse time and the run dies before it starts, so
    // resolveGrokEffort in grok-cli.js drops the composer's `default`
    // sentinel and any level the selected model does not list.
    supportsEffort: true,
    supportsWorkMode: true,
  },
};

/**
 * Application service exposing the provider capability matrix.
 */
export const providerCapabilitiesService = {
  getProviderCapabilities(provider: LLMProvider): ProviderCapabilities {
    return PROVIDER_CAPABILITIES[provider];
  },

  listAllProviderCapabilities(): ProviderCapabilities[] {
    return Object.values(PROVIDER_CAPABILITIES);
  },
};
