# Fork notes (dima/fork-customizations)

This checkout is a customized fork of [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui).
All work lives on the branch **`dima/fork-customizations`**; local `main` mirrors upstream.

- `origin` → upstream siteboon (fetch/merge only — never push)
- `backup` → https://github.com/dimasikk25155/cloudcli-fork (private; push after every change batch)

## Why the in-app update is disabled

The stock updater (`POST /api/system/update`) runs `git checkout main && git pull && npm install`,
which abandons this branch and pulls upstream over the customizations. The endpoint now returns
501 in git mode and the sidebar update banner / upgrade modal were removed. Version info is still
visible in Settings → About.

## Manual upstream merge runbook

```bash
cd cloudcli-fork
git fetch origin
git merge origin/main        # on dima/fork-customizations
# resolve conflicts, then:
npm install
npm run typecheck && npm run build
launchctl kickstart -k gui/$(id -u)/com.dimasik.cloudcli
git push backup dima/fork-customizations
```

Known conflict hotspots vs our deltas: `server/index.js` (upload-images region),
`src/components/chat/hooks/useChatComposerState.ts`, `SidebarSessionItem.tsx`,
and `sidebar.json` across all 10 locales.

## Intentional fork deltas

- Branding: "Claude CLI" naming, Claude palette, crab mascot, regenerated icons/PWA assets
- Removed: project/session delete buttons, Discord/report/star links, conversations mode,
  update banner + upgrade modal (see above)
- Keychain auth provider for Claude credentials (macOS)
- Session rename fixes (web UI + custom-title sync from jsonl)
- Sidebar search across session names/summaries
- Image upload MIME fallback by extension (Android WebView)
- Nightshift module: `/api/nightshift` + "Запуски" modal (launchd runs history)
- TWA: Digital Asset Links served for the Android app
- Composer model switcher + per-session override keyed by provider-native id
