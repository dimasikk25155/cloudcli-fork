import { useEffect, useMemo, useState } from 'react';

import type { AgentCategory, AgentProvider } from '../../../types/types';

import type { AgentContext, AgentsSettingsTabProps } from './types';
import AgentCategoryContentSection from './sections/AgentCategoryContentSection';
import AgentCategoryTabsSection from './sections/AgentCategoryTabsSection';
import AgentSelectorSection from './sections/AgentSelectorSection';

export default function AgentsSettingsTab({
  providerAuthStatus,
  onProviderLogin,
  claudePermissions,
  onClaudePermissionsChange,
  cursorPermissions,
  onCursorPermissionsChange,
  codexPermissionMode,
  onCodexPermissionModeChange,
  projects,
}: AgentsSettingsTabProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentProvider>('claude');
  const [selectedCategory, setSelectedCategory] = useState<AgentCategory>('account');
  // Only list a category that actually renders something for this agent:
  // AgentCategoryContentSection implements Permissions for claude/cursor/codex
  // and Skills for everyone but opencode, so offering those tabs elsewhere
  // opened a blank panel. Kimi is headless-only (`kimi -p` always auto-
  // approves — there is no permission mode to pick), hence no Permissions tab.
  const visibleCategories = useMemo<AgentCategory[]>(() => {
    if (selectedAgent === 'opencode') {
      return ['account', 'mcp'];
    }
    if (selectedAgent === 'kimi') {
      return ['account', 'mcp', 'skills'];
    }
    // Gemini: MCP is fully implemented (settings.json), but its skills reader
    // is still a stub and headless runs have no pickable permission mode.
    if (selectedAgent === 'gemini') {
      return ['account', 'mcp'];
    }
    return ['account', 'permissions', 'mcp', 'skills'];
  }, [selectedAgent]);

  const visibleAgents = useMemo<AgentProvider[]>(() => {
    // Kimi re-added 2026-07-26 — bring-your-own-login engine alongside the
    // others (each user signs in with their own Kimi account, like Cursor).
    // 'gemini' intentionally excluded — Google killed free personal-account
    // login for Gemini CLI/Code Assist on 2026-06-18 (confirmed by a live
    // login attempt: OAuth succeeds, then Code Assist itself rejects with
    // "This client is no longer supported ... migrate to Antigravity").
    // Backend/types/i18n all stay in place; re-add only once there's a real
    // login path (paid GCP Vertex AI, or a from-scratch Antigravity CLI
    // integration — see wiki/concepts/cloudcli-gemini-engine.md).
    return ['claude', 'codex', 'cursor', 'opencode', 'kimi'];
  }, []);

  const agentContextById = useMemo<Record<AgentProvider, AgentContext>>(() => ({
    claude: {
      authStatus: providerAuthStatus.claude,
      onLogin: () => onProviderLogin('claude'),
    },
    cursor: {
      authStatus: providerAuthStatus.cursor,
      onLogin: () => onProviderLogin('cursor'),
    },
    codex: {
      authStatus: providerAuthStatus.codex,
      onLogin: () => onProviderLogin('codex'),
    },
    opencode: {
      authStatus: providerAuthStatus.opencode,
      onLogin: () => onProviderLogin('opencode'),
    },
    kimi: {
      authStatus: providerAuthStatus.kimi,
      onLogin: () => onProviderLogin('kimi'),
    },
    gemini: {
      authStatus: providerAuthStatus.gemini,
      onLogin: () => onProviderLogin('gemini'),
    },
  }), [
    onProviderLogin,
    providerAuthStatus.claude,
    providerAuthStatus.codex,
    providerAuthStatus.cursor,
    providerAuthStatus.opencode,
    providerAuthStatus.kimi,
    providerAuthStatus.gemini,
  ]);

  useEffect(() => {
    if (!visibleCategories.includes(selectedCategory)) {
      setSelectedCategory(visibleCategories[0] ?? 'account');
    }
  }, [selectedCategory, visibleCategories]);

  return (
    <div className="-mx-4 -mb-4 -mt-2 flex min-h-[300px] min-w-0 flex-col overflow-hidden md:-mx-6 md:-mb-6 md:-mt-2 md:min-h-[500px]">
      <AgentSelectorSection
        agents={visibleAgents}
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
        agentContextById={agentContextById}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AgentCategoryTabsSection
          categories={visibleCategories}
          selectedAgent={selectedAgent}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
        />

        <AgentCategoryContentSection
          selectedAgent={selectedAgent}
          selectedCategory={selectedCategory}
          agentContextById={agentContextById}
          claudePermissions={claudePermissions}
          onClaudePermissionsChange={onClaudePermissionsChange}
          cursorPermissions={cursorPermissions}
          onCursorPermissionsChange={onCursorPermissionsChange}
          codexPermissionMode={codexPermissionMode}
          onCodexPermissionModeChange={onCodexPermissionModeChange}
          projects={projects}
        />
      </div>
    </div>
  );
}
