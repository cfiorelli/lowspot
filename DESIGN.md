# lowspot Design Rules

lowspot is a text-first Spotify desktop client. The UI is intentionally compact and low-noise.

## UX Principles

- No album art, thumbnails, hero banners, cards, or recommendation walls.
- Lean bar is the default post-login mode and remains useful at very small dimensions.
- Expanded mode behaves like a dense list-based client, closer to an email/RSS/iTunes table than a media gallery.
- Information hierarchy favors text: title, artist/owner/publisher, type, and playback state.
- Keyboard-first interactions are first-class, with explicit focus behavior and row selection.
- Dark theme uses muted contrast, subtle borders, and row shading rather than loud accent blocks.

## Visual Density Target

- Target density is around 4/10 where Lynx-style minimal text UI is 1 and modern Spotify desktop is 10.
- Rows are compact and scannable.
- Section chrome is minimal and utilitarian.

## Interaction Notes

- Lean mode and expanded mode are two sizes of one app window, not separate apps.
- Search is command-like and text-first.
- API failures are non-fatal and shown as concise status text so control flow can continue.

## Current UX Audit

This audit reflects the app after adding quota protection, mock mode, persistent status logging, and stable control sizing.

### Strong Fits

- The app remains text-first: tables, status lines, and controls carry the experience without artwork.
- The lean/expanded split matches the product idea well: lean mode is daily control, expanded mode is inspection and navigation.
- The status log is consistent with the low-noise operator-tool direction. It gives debugging depth without becoming a visual feature wall.
- Mock mode supports design work without Spotify API pressure, which is now a core development constraint.

### Consistency Risks

- Settings is becoming the operational/debug surface. Keep it dense and textual; do not turn it into a card dashboard.
- Playback controls still use text labels instead of icons. This fits lowspot for now, but labels must stay fixed-width to avoid layout movement.
- The sidebar includes Podcasts and Audiobooks before those sections have real content. Empty sections are acceptable, but they should say "not implemented" or "no fixture data" rather than generic emptiness.
- Login setup copy is functional but not yet polished. It should keep the Premium/redirect constraints explicit while sounding less like a build error.

### State Language

Use section-specific state messages:

- Loading: "Loading liked songs..." or "Searching for ..."
- Empty: "Spotify returned 0 liked songs for this account/token."
- Partial: "Loaded 50 of 4237 liked songs. More pages are paused to protect Spotify quota."
- Cooldown: "Spotify is rate limiting lowspot on /me/tracks. Try again in 17h 4m."
- Mock: "Mock mode loaded 6 liked songs."

Avoid "No items for this section yet" except as a final generic fallback.

### Control Behavior

- Buttons should never resize when state changes.
- Pending states should preserve the same footprint as resting states.
- A click that only focuses/activates the window should not be visually indistinguishable from a command in progress; use pending text and the status log.
- Playback commands should log start/failure/success once the live Spotify path is testable again.

### Navigation

- Search should behave like a command palette result list: submit query, switch to Search, show loading, then show rows or an explicit empty state.
- Settings should expose diagnostics that do not make Spotify calls: mock mode state, cooldowns, redirect URIs, SDK state, and token scope metadata when safe.
- Sidebar rows should remain plain buttons with selected state; avoid decorative badges unless they communicate state.

### Visual Boundaries

- Keep cards out of the main layout. Repeated row items are table rows, not cards.
- Use borders, row shading, and compact spacing for hierarchy.
- Preserve muted dark neutrals with the green accent as a state/action color, not a background theme.
- The log panel should stay compact enough that it supports the app instead of becoming the app.
