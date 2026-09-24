import { useEffect, useMemo, useState } from 'react';

import { SELECTABLE_PROVIDERS } from '../../../../../utils/providerSelectionPolicy';
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
      return ['account', 'defaults', 'mcp'];
    }
    if (selectedAgent === 'kimi') {
      return ['account', 'defaults', 'mcp', 'skills'];
    }
    // Gemini: MCP is fully implemented (settings.json), but its skills reader
    // is still a stub and headless runs have no pickable permission mode.
    if (selectedAgent === 'gemini') {
      return ['account', 'defaults', 'mcp'];
    }
    return ['account', 'defaults', 'permissions', 'mcp', 'skills'];
  }, [selectedAgent]);

  const visibleAgents = useMemo<AgentProvider[]>(() => [...SELECTABLE_PROVIDERS], []);

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
    grok: {
      authStatus: providerAuthStatus.grok,
      onLogin: () => onProviderLogin('grok'),
    },
  }), [
    onProviderLogin,
    providerAuthStatus.claude,
    providerAuthStatus.codex,
    providerAuthStatus.cursor,
    providerAuthStatus.opencode,
    providerAuthStatus.kimi,
    providerAuthStatus.gemini,
    providerAuthStatus.grok,
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
