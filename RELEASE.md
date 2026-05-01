# lowspot Release Notes

This document defines the macOS release path. It is intentionally conservative until the Spotify auth/quota behavior is stable.

## Release Channels

1. Development builds
- Run locally with `npm run tauri:dev`.
- Use `VITE_LOWSPOT_MOCK=1` for UI work that must not call Spotify.

2. Unsigned local test bundles
- Build with:
  ```bash
  npm run tauri:build
  ```
- Inspect `src-tauri/target/release/bundle/` for generated `.dmg` or `.app` artifacts.
- macOS Gatekeeper will warn because these builds are not signed/notarized.

3. GitHub Releases
- Attach the Tauri-generated macOS artifact to a GitHub release.
- Include setup notes:
  - Spotify Premium is expected.
  - The Spotify app must include `http://127.0.0.1:7878/callback`.
  - Development-mode Spotify apps allow only allowlisted users.
  - Users should stop testing if a cooldown appears.
- For private alpha builds, the Spotify Client ID is baked into the artifact at build time. Add each tester to the Spotify app before distributing the DMG.

4. Signed/notarized releases
- Future production path.
- Requires an Apple Developer account, signing certificate, hardened runtime, and notarization.
- Do not present unsigned builds as production-ready.

## Pre-Release Checklist

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run build:mock`
- Manual mock-mode smoke test:
  - Lean mode renders fixture playback.
  - Expanded mode renders mock Liked Songs, Playlists, Search, Queue, and Settings.
  - Status log records messages.
  - No Spotify network calls are made.
- Live Spotify smoke test only when the client/token is healthy:
  - Login completes through `http://127.0.0.1:7878/callback`.
  - One Liked Songs page loads.
  - No endpoint cooldown is active in Settings.

## Current Distribution Caveats

- There is no auto-updater yet.
- There is no signed/notarized installer yet.
- Developers running from source need a valid Spotify Client ID in `.env`.
- Users installing a DMG use the Client ID baked into that build.
- A shared Spotify app in development mode is limited to allowlisted users.
- A shared app in extended quota mode requires Spotify approval.
- Unsigned/private-alpha distribution should stay small and explicit about Gatekeeper warnings.

## Private Alpha User Instructions

Send testers:

1. The latest DMG from `src-tauri/target/release/bundle/dmg/`.
2. A note that Spotify Premium is expected.
3. A note that their Spotify account must be allowlisted before login.
4. A warning that if lowspot displays a Spotify cooldown, they should stop and report the status-log text.

Do not ask testers to create `.env` files unless they are running from source.

## Artifact Naming

Before publishing, verify the generated bundle names match `lowspot`. If stale artifacts appear under old names, clean Tauri build output before rebuilding:

```bash
rm -rf src-tauri/target/release/bundle
npm run tauri:build
```
