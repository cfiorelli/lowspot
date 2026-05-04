# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**GitHub promotion policy overrides any older push-at-session-end guidance.** GitHub `main` represents the stable/shared version.

1. File issues for remaining work.
2. Run quality gates when code changed.
3. Update/close Beads issues for completed local work.
4. Commit local changes when they are useful to preserve.
5. Do **not** push to GitHub unless the user explicitly says to push or confirms the dev build should be promoted to stable.
6. When the user does approve promotion, run:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
7. After a successful `git push`, **always publish a new GitHub Release with a fresh DMG build**:
   ```bash
   npm run tauri:build
   # Bump the patch version (v0.1.0 → v0.1.1, etc.) — check latest with: gh release list
   gh release create vX.Y.Z src-tauri/target/release/bundle/dmg/*.dmg \
     --title "lowspot vX.Y.Z" \
     --notes "See git log for changes."
   ```
   The README's download link points to `/releases/latest`, so the new release becomes the live download immediately.
8. Hand off with whether changes are local-only or pushed, and whether a release was published.

**Critical rules:**
- Never say code is on GitHub unless `git push` succeeded.
- Never push experimental/debug work just because a session is ending.
- If a push is approved and fails, resolve and retry until it succeeds or clearly report the blocker.
<!-- END BEADS INTEGRATION -->


## Build & Test

```bash
npm run typecheck
npm run build
npm run lint
npm run tauri:build
```

## Architecture Overview

lowspot is a Tauri 2 desktop app with a React/TypeScript/Vite frontend.

- GitHub `main` is the stable/shared source. Use `npm run tauri:dev` for active development testing, and only promote with `npm run tauri:build` plus a GitHub push after the user approves the dev build as stable.
- Tokens live in Tauri Store (`lowspot_tokens.json`) so login survives packaged app installs.
- Spotify library cache lives in Tauri Store (`lowspot_library_cache.json`) with IndexedDB/localStorage only as migration/fallback. Do not move durable library cache back to WebView-only storage.
- WebView storage origins differ between `tauri dev`, browser preview, and packaged installs. A cache visible in dev may not exist in the installed app.
- The app starts in collapsed mode, called `lean` in code. Expanded mode is entered by user action and resizes the Tauri window to the expanded default.

## Conventions & Patterns

- Spotify Web API requests are scarce. The app must prefer cached data, lazy loading, and user-triggered fetches over background hydration.
- Do not automatically retry `429` responses. Record the cooldown, surface it to the UI, and stop. Repeated `429`s on the same endpoint should increase local backoff.
- Do not silently wait through a persisted Spotify cooldown and then call the endpoint. Return a local cooldown error so the UI can explain what is happening.
- Do not fetch queue, playlists, liked songs, liked albums, or recently played data unless the user opens the relevant view or cached data is stale by design.
- Library pages should be persisted as they load. Anything already downloaded with Spotify quota should not need to be downloaded again.
- Keep first-launch/collapsed view cheap: playback state is acceptable, but no proactive full library hydration.
- If rate-limit behavior changes, preserve diagnostics that distinguish local protective cooldowns from actual Spotify `429` responses.
- Be cautious with helper text. Do not add labels, status copy, instructional phrases, or duplicate titles unless the UI would be ambiguous without them; prefer clear controls and existing context over explanatory text.
