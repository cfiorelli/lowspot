# lowspot

Text-first, low-noise Spotify desktop client for macOS. Compact by design — a slim playback bar with search, library, and queue when you need them.

---

## Install from DMG (macOS)

If someone sent you a `.dmg` file:

1. Open the DMG and drag **lowspot** into your Applications folder.
2. On first launch macOS may block the app because it is unsigned. **Right-click lowspot → Open → Open** to allow it.
3. Log in with the Spotify account your host has added to their Spotify Developer app.
4. Approve the requested Spotify permissions.
5. Click **lowspot off** in the bottom-left corner to switch it **on** — this connects lowspot as your Spotify playback device. Then hit Play or search for something.

> **Requirements:** Spotify Premium account. macOS 11+.

---

## Quick Start (build from source)

**Prerequisites:** Spotify Premium, macOS, Node.js 18+, Rust toolchain.

**Prerequisites:** Spotify Premium account, macOS for the desktop app, Node.js 18+, and the Rust toolchain.

### Step 1: Create a Spotify Developer app

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and create an app.
2. In the app settings, add these two Redirect URIs:
   ```
   http://127.0.0.1:7878/callback
   http://127.0.0.1:5173/callback
   ```
3. Copy your **Client ID**.

### Step 2: Clone and configure

```bash
git clone https://github.com/cfiorelli/lowspot.git
cd lowspot
cp -f .env.example .env
```

Open `.env` and paste your Client ID:

```
VITE_SPOTIFY_CLIENT_ID=your_client_id_here
VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/callback
```

### Step 3: Install dependencies

```bash
npm install
```

### Step 4: Run

**Desktop app (recommended):**
```bash
npm run tauri:dev
```

**Browser preview only:**
```bash
npm run dev
```

### Step 5: Log in and play

- Click **Log in with Spotify** and approve the permissions.
- The app opens in the compact collapsed view.
- Click **lowspot off** to switch to **lowspot on** when you want lowspot to drive Spotify playback.
- Search from the box and press Enter, or click **Expand** to browse library views.
- Liked Songs and Liked Albums show cached data immediately. Partial caches fill gently in the background.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / pause |
| `Cmd/Ctrl+B` | Toggle lean / expanded |
| `Cmd/Ctrl+K` | Focus search |
| `Cmd/Ctrl+L` | Like / unlike current track |
| `Up / Down` | Navigate rows |
| `Enter` | Play selected row |
| `Esc` | Collapse to lean mode |

---

## Alpha Distribution (DMG)

To share a build with an allowlisted Spotify user:

1. Add the user in [Spotify Dashboard](https://developer.spotify.com/dashboard) under your app's User Management.
2. Build:
   ```bash
   npm run tauri:build
   ```
3. Share the DMG from `src-tauri/target/release/bundle/dmg/`.
4. Recipient: right-click `lowspot.app`, then choose **Open** to bypass the unsigned-app warning.

DMG users do not need `.env`. The Client ID is baked into the build.

> **Note:** Spotify Developer apps start in Development Mode, which restricts access to allowlisted accounts. To distribute beyond your allowlist, apply for Extended Quota Mode in the Spotify Dashboard.

---

## Development

```bash
npm run tauri:dev          # Live desktop with real Spotify
npm run tauri:dev:mock     # Desktop with fixture data (no API calls)
npm run dev:mock           # Browser preview with fixture data
npm run dev                # Browser-only preview
npm run build              # Production web build
npm run tauri:build        # Production desktop bundle
```

Mock mode is useful for UI work. It bypasses auth and serves local fixtures for playback, search, liked songs, albums, playlists, queue, and recently played.

## Local Data

Tauri desktop stores tokens at:
```
~/Library/Application Support/com.cfiorelli.lowspot/lowspot_tokens.json
```

The durable library cache is stored next to it:
```
~/Library/Application Support/com.cfiorelli.lowspot/lowspot_library_cache.json
```

To force a fresh login: `rm -f "$HOME/Library/Application Support/com.cfiorelli.lowspot/lowspot_tokens.json"`

## Client ID Safety

- `.env` is ignored by git and should hold your real Spotify Client ID.
- `.env.example` is tracked and contains only placeholders.
- DMG builds bake in the Client ID used at build time, but source users configure their own local `.env`.

## Rate Limit Safety

Spotify Web API calls are treated as scarce. lowspot prefers cached library data, uses conservative playback polling, records request diagnostics, and trickles large library cache fills instead of hydrating everything in one burst.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Missing Client ID | Confirm `.env` exists with `VITE_SPOTIFY_CLIENT_ID` set |
| OAuth redirect error | Confirm `http://127.0.0.1:7878/callback` is in Spotify Dashboard |
| 429 rate limit | Wait for the displayed cooldown, or switch to mock mode |
| Playback buttons disabled | Click **lowspot off** so it becomes **lowspot on**, then choose music |
| macOS blocks app | Right-click, then choose **Open** on first launch |

## Spotify Scopes

lowspot requests: `user-read-private`, `user-read-email`, `user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing`, `user-library-read`, `user-library-modify`, `playlist-read-private`, `playlist-read-collaborative`, `user-read-recently-played`, and `streaming`.
