# lowspot

lowspot is a text-first, low-noise Spotify desktop client built with Tauri, React, TypeScript, Vite, and Zustand.

It is intentionally compact:

- Lean mode is a small playback/search control bar.
- Expanded mode is a dense list browser for search, library, queue, and settings.
- No album art, thumbnails, recommendation walls, cards, or visual-heavy home screen.

## Current Status

lowspot is under active development. The app recently triggered a long Spotify Web API cooldown while testing library hydration. Treat live Spotify calls as scarce during development.

Use mock mode for UI work:

```bash
npm run tauri:dev:mock
```

Mock mode bypasses Spotify auth and uses local fixture data for playback, search, liked songs, albums, playlists, queue, and recently played.

## Spotify Requirements

For the full desktop app:

- Spotify Premium is expected.
- The Spotify Developer app must be in development mode or extended quota mode.
- Development mode allows up to 5 allowlisted Spotify users.
- Playback control and Web Playback SDK behavior require Premium and can fail without an active Spotify device.
- Library/search endpoints use the Spotify Web API and require a valid user token with the right scopes.

## Spotify Dashboard Setup

Create a Spotify Developer app and copy its Client ID.

Add these Redirect URIs:

```text
http://127.0.0.1:7878/callback
http://127.0.0.1:5173/callback
```

The desktop app uses `http://127.0.0.1:7878/callback` through a local Tauri OAuth callback server. The `5173` URI is only for browser preview development.

`lowspot://callback` is not used by the current auth flow.

## Environment

Create `.env`:

```bash
cp .env.example .env
```

Set:

```text
VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id
VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/callback
VITE_LOWSPOT_MOCK=0
```

Set `VITE_LOWSPOT_MOCK=1` only when you want fixture-backed UI development with no Spotify API calls.

## Required Scopes

lowspot currently requests:

```text
user-read-private
user-read-email
user-read-playback-state
user-modify-playback-state
user-read-currently-playing
user-library-read
user-library-modify
playlist-read-private
playlist-read-collaborative
user-read-recently-played
streaming
```

Liked Songs uses Spotify's `GET /me/tracks` endpoint and requires `user-library-read`.

## Install

For development:

```bash
npm install
```

## Quick Install For Allowlisted Users

This path is for a small private alpha using your Spotify Developer app.

Before sending a build:

1. Add the user in Spotify Dashboard under your app's user management.
2. Confirm the app has this Redirect URI:
   ```text
   http://127.0.0.1:7878/callback
   ```
3. Build the macOS bundle:
   ```bash
   npm run tauri:build
   ```
4. Share the generated DMG from:
   ```text
   src-tauri/target/release/bundle/dmg/
   ```

For the user:

1. Install from the DMG.
2. If macOS blocks the unsigned app, right-click `lowspot.app` and choose Open.
3. Log in with the allowlisted Spotify account.
4. Approve the requested Spotify permissions.
5. Stop using live Spotify views if the status log shows a cooldown.

Users installing a DMG do not need `.env`; the Spotify Client ID is baked into the build. Developers running from source do need `.env`.

## Development

Preferred safe UI development:

```bash
npm run tauri:dev:mock
```

Live Spotify desktop development:

```bash
npm run tauri:dev
```

Browser-only preview:

```bash
npm run dev
```

## Build

Web build:

```bash
npm run build
```

Mock build:

```bash
npm run build:mock
```

Desktop build:

```bash
npm run tauri:build
```

## Quota Safety

Spotify may return `429 Too Many Requests` with a `Retry-After` header. lowspot persists endpoint cooldowns per client ID and short-circuits matching requests before hitting Spotify again.

Rules for live testing:

- Do not repeatedly relaunch and click through failing Spotify views.
- If the status log shows a cooldown, wait for it.
- Prefer mock mode for UI work.
- Keep initial library hydration capped; do not fetch an entire large library in one burst.
- Avoid automatic SDK/device connection on startup.

## Token Storage

- Browser preview uses localStorage fallback.
- Tauri desktop uses the Tauri Store plugin at:

```text
~/Library/Application Support/com.cfiorelli.lowspot/lowspot_tokens.json
```

To force a fresh desktop login:

```bash
rm -f "$HOME/Library/Application Support/com.cfiorelli.lowspot/lowspot_tokens.json"
```

Do not run live Spotify tests while a known cooldown is active.

## Keyboard Shortcuts

- Space: play/pause when not typing
- Cmd/Ctrl+K: focus search
- Cmd/Ctrl+L: like/unlike current track
- Cmd/Ctrl+B: toggle lean/expanded mode
- Arrow Up/Down: navigate rows
- Enter: play selected row
- Esc: collapse search/reset to lean mode

## Troubleshooting

- Missing Client ID: confirm `.env` exists and `VITE_SPOTIFY_CLIENT_ID` is set.
- OAuth redirect error: confirm `http://127.0.0.1:7878/callback` is in Spotify Dashboard.
- Liked Songs 429: stop live testing and wait for the displayed cooldown, or use mock mode.
- No active playback: start playback in Spotify on an existing device, then use lowspot as controller.
- Queue fails: Spotify queue availability varies by device/account context.

## Beads Workflow

This repo uses Beads:

```bash
bd ready --json
```

Use beads for discovered work and close issues only after implementation and verification.
