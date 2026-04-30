# lowspot Manual Testing

## Prerequisites

- For live Spotify testing, a Spotify Premium account.
- Spotify Developer app configured with redirect URI:
  - `http://127.0.0.1:7878/callback` for Tauri desktop testing
  - `http://127.0.0.1:5173/callback`
- `.env` created from `.env.example` with `VITE_SPOTIFY_CLIENT_ID`.

## Safe Testing Protocol

- Prefer mock mode for UI and interaction testing:
  ```bash
  VITE_LOWSPOT_MOCK=1 npm run tauri:dev
  ```
- Use live Spotify only for API-specific verification.
- Do not continue clicking Spotify-backed views after a 429.
- If the status log shows `Retry-After`/cooldown, stop live testing until it expires.
- Never restore full-library eager fetching; library hydration should remain capped.
- Keep Web Playback SDK connection opt-in so startup does not spend API/device calls.

## Mock Mode Matrix

1. Launch with `VITE_LOWSPOT_MOCK=1 npm run tauri:dev`.
2. Confirm the app opens signed in as a mock user without Spotify login.
3. Confirm lean mode displays a mock track.
4. Expand and visit:
- Now Playing
- Search
- Liked Songs
- Liked Albums
- Playlists
- Queue
- Recently Played
- Settings
5. Confirm search returns fixture rows without network errors.
6. Confirm previous/play/next/shuffle/repeat/volume update local UI state.
7. Confirm no Spotify API calls appear in logs/network inspection.

## Test Matrix

1. Login and token lifecycle
- Launch app.
- Confirm login screen appears when no token exists.
- Log in with Spotify and authorize scopes.
- Confirm app returns to lowspot and shows signed-in state.
- Restart app and confirm session restores from stored refresh token.

2. Lean bar mode
- Confirm default mode after login is lean bar.
- Validate controls: previous, play/pause, next, like/unlike.
- Confirm current track title and artist text update.
- Confirm no album artwork appears.
- Confirm quick search from lean bar opens expanded mode with results.

3. Expanded mode
- Toggle expanded mode via button and Cmd/Ctrl+B.
- Confirm left menu includes:
  - Now Playing
  - Search
  - Liked Songs
  - Liked Albums
  - Playlists
  - Podcasts
  - Audiobooks
  - Queue
  - Recently Played
  - Settings
- Confirm data appears as rows/tables only.
- Confirm no image/card UI appears.

4. Playback and library data
- Confirm playback polling updates every few seconds while active.
- Confirm queue loads when endpoint/device supports it.
- Confirm recently played list loads.
- Confirm liked songs/albums/playlists load.
- Confirm selecting row + Enter or double-click plays track/context.

5. Keyboard interactions
- Space toggles play/pause when not typing in input.
- Cmd/Ctrl+K focuses search.
- Cmd/Ctrl+L toggles like/unlike for current track.
- Cmd/Ctrl+B toggles lean/expanded mode.
- Arrow keys move selected row.
- Enter plays selected row.
- Esc collapses search state and returns to lean mode.

6. Error/limitation handling
- Disable active Spotify device and confirm controller errors are concise and app stays usable.
- If queue endpoint fails, confirm app displays short message and continues.
- If Web Playback SDK fails, confirm app still controls existing active Spotify devices.

7. Window sizing
- Confirm Tauri minimum size is enforced around 360x64.
- Confirm lean dimensions are compact and expanded dimensions are larger.

8. No-art compliance
- Inspect all views and verify no album art, thumbnails, cards, or hero sections are rendered.
