# Development Log

This document tracks the actual implementation steps, bug fixes, and environment configurations established during development.

## 1. Electron Backend Initialization
- Scaffolded the backend using `electron-vite` (React + TypeScript).
- **Bug Fix (Linux Sandbox):** Addressed the SUID sandbox crash (`setuid_sandbox_host.cc:166`) on Ubuntu by injecting `app.commandLine.appendSwitch('no-sandbox')` for Linux platforms before app initialization.
- **Twitch Integration:** Implemented `tmi.js` using the CommonJS require syntax (`const tmi = require('tmi.js')`) to bypass Vite's ESM resolution issues.
- **Milestone:** Successfully connected to a live high-traffic channel (e.g., `hashiruta`) and verified real-time chat data flowing into the Node.js console.

## 2. GNOME Extension Configurations
- **GSettings Implementation:** Defined and compiled the local schema (`org.gnome.shell.extensions.chat-overlay.gschema.xml`).
- **Dynamic Styling:** Modified `extension.js` to observe the `changed::background-opacity` signal, allowing real-time CSS updates without restarting the extension.
- **Symlink Development:** Established the industry-standard workflow by symlinking the repository folder directly to `~/.local/share/gnome-shell/extensions/` to ensure real-time synchronization with the `--devkit` session.

## 3. GNOME Overview Bug Fix (Alpha Compositing)
- **Issue:** Ghosting artifacts appeared on the overlay background when switching to the GNOME Activities Overview.
- **Root Cause:** A known Alpha Compositing bug in Clutter's rendering engine when applying `text-shadow` to `St.Label` actors placed over semi-transparent backgrounds. The overview cloner flattens the alpha channels incorrectly, baking the shadow into the background.
- **Resolution:** Removed the `text-shadow` CSS property from the main layout. The baseline variant relies strictly on standard text rendering, ensuring 100% stability during UI transitions.

## 4. Renderer UI — Window Background & Layout

### 4.1 White Stripe on the Window Edges
- **Issue:** A thin white stripe appeared along one edge of the Electron window.
- **Root Cause:** `BrowserWindow` defaults to a white `backgroundColor`, which is what the OS compositor shows before the renderer paints its first frame. No amount of CSS on `html` / `body` / `#root` can cover it — it is a native window property, not a DOM issue.
- **Resolution:**
  - `BrowserWindow` now receives `backgroundColor: '#18181b'` in its constructor.
  - Reinforced with `mainWindow.setBackgroundColor('#18181b')` immediately after creation.
  - The same color is declared inline in `index.html` (`<html>`, `<body>`, `#root`) so the document is already dark before Vite/React boot.
  - `base.css` unifies `--color-background` to `#18181b` (it was `#1b1b1f` before, which produced a subtle mismatch on antialiased edges).

### 4.2 Panel Centering
- **Issue:** After fixing the background, the panel drifted to the left.
- **Root Cause:** The root `<div>` in `App.tsx` had `width: 100%`, which made it fill the entire window and left `#root` (which centers via flex) with nothing to center.
- **Resolution:** Removed `width` / `height` from the root `<div>`. `#root` handles centering, and the dark background is provided by `html` / `body` / `#root` instead of the panel itself.

### 4.3 Input Width
- The channel input was previously sized with `maxWidth: 350px`, which shrank and produced a jittery look. Switched to a fixed `width: 350px` with `maxWidth: 100%` fallback.

## 5. Bidirectional IPC — Real Connection Status

### 5.1 Problem
- `App.tsx` flipped the UI to `connected` via a hardcoded `setTimeout(1200)` right after firing `window.api.setChannel(channel)`. The renderer was never informed by the backend.
- The main process did emit a log line (`[StreamShell Backend] Conectado exitosamente a: ...`) but that never crossed back over IPC, so failures, slow networks or invalid channels were invisible to the UI.

### 5.2 Design
A bidirectional IPC bridge built on top of the existing `set-twitch-channel` / `disconnect-twitch` channels:

| Direction | Channel | Payload |
|---|---|---|
| renderer → main | `set-twitch-channel` | `string` (channel name) |
| renderer → main | `disconnect-twitch` | — |
| main → renderer | `twitch:connected` | `{ channel }` |
| main → renderer | `twitch:error` | `{ message }` |
| main → renderer | `twitch:disconnected` | `{ reason }` |

### 5.3 Implementation
- **`src/main/index.ts`**
  - Promoted `mainWindow` to a module-scoped variable so Twitch event handlers can reach it.
  - Added `sendToRenderer(channel, payload)` with a `isDestroyed()` guard.
  - Wired `tmi.js` events: `join` → `twitch:connected`, `disconnected` → `twitch:disconnected`, and `notice` / `.connect().catch()` → `twitch:error`.
  - Added an 8-second JOIN timeout as a safety net for silent failures.
  - Cleared the `mainWindow` reference on `'closed'` to avoid holding a stale object.

- **`src/preload/index.ts`**
  - Exposed `onTwitchConnected`, `onTwitchError`, `onTwitchDisconnected`.
  - Each returns a cleanup function so `useEffect` can unsubscribe on unmount.

- **`src/renderer/src/App.tsx`**
  - Added a `useEffect` subscribing to the three events with proper cleanup.
  - Removed the fake `setTimeout(1200)`.
  - Added an `'error'` status + `errorMsg` state so the actual failure reason surfaces in the UI.
  - The connect button becomes "Reintentar conexión" when in `'error'`, and the input re-enables so the user can fix the channel name.

### 5.4 Why `join` and not `connected`

The initial implementation used the `connected` event from `tmi.js`, which only means the WebSocket to `irc-ws.chat.twitch.tv:443` is open. Twitch can still reject the subsequent `JOIN` if the channel does not exist or is suspended. This produced a false positive: an invalid channel showed "Conectado exitosamente" in the backend log while the UI silently claimed success.

- **Fix:** moved the `twitch:connected` emission to the `join` handler (with `self === true`), which is the actual confirmation that Twitch accepted us into the channel.
- **Payload:** dropped `addr` and `port` because they aren't available at JOIN time; the payload is now just `{ channel }`.
- **Extra safety:** Twitch `NOTICE` messages (channel not found, suspended, rate limit) are now propagated as `twitch:error`, and an 8-second timeout triggers an error if the JOIN never arrives.

### 5.5 Result
The UI now reflects the true state of the Twitch connection: the panel only says `connected` after Twitch confirms the JOIN, and any failure (bad channel, network, auth) is shown inline instead of being silently hidden behind an optimistic timeout.

## 6. GNOME Extension Lifecycle & Dev Setup

### 6.1 Problem
- The extension used to create its overlay box unconditionally in `enable()`. Once enabled, it stayed visible forever with the "Esperando conexión a Twitch..." placeholder, even when the user was not streaming or the Electron backend was closed.
- Manually enabling/disabling the extension per dev session (`gnome-extensions enable/disable`) was the only workaround. Not acceptable for a packaged `.deb` target.
- The relative path from the built `out/main/index.js` to the repo's `gnome-extension/` folder was hardcoded (`'../../../../gnome-extension'`), which broke silently if the build depth or repo layout changed.

### 6.2 Extension: react to backend presence instead of always showing
- Replaced the unconditional box creation with `Gio.bus_watch_name` on `org.streamshell.Twitch`:
  - `appeared` → `_showBox()` builds and adds the overlay to `uiGroup`.
  - `vanished` → `_hideBox()` destroys the box and clears the line buffer.
- D-Bus names are tied to their owning connection, so the `vanished` callback fires reliably when the Electron process dies (Ctrl+C, window close, crash, SIGKILL).
- `enable()` no longer touches the UI, only wires signals. The overlay only becomes visible while a StreamShell backend is running.

### 6.3 Main: auto-enable the extension on startup
- `ensureGnomeExtensionEnabled()` spawns `gnome-extensions enable chat-overlay@test` (idempotent, non-fatal) from `app.whenReady()`.
- No user-facing terminal command is ever required.

### 6.4 Main: dev-setup checks + warning banner
- New module `src/main/gnome-setup.ts` runs on startup and returns a `GnomeCheckResult` (`warnings`, `errors`, `needsRelogin`, `isWayland`).
- **Symlink check (dev only):** ensures `~/.local/share/gnome-shell/extensions/chat-overlay@test` exists and points at the repo.
- **Schema compile (dev only):** recompiles `gschemas.compiled` when the XML is newer than the compiled file.
- **Stale detection:** compares `extension.js` mtime against `gnome-shell`'s process start time. If the file is newer, the JS loaded in memory is stale, which on Wayland means only a relogin will pick up the changes.
- **Repo path resolution:** `resolveRepoExtensionPath()` walks up from `__dirname` looking for the marker file `gnome-extension/extension.js`, which only exists at the repo root. `STREAMSHELL_REPO_ROOT` is honored as an explicit override (useful for CI or unusual layouts). The old hardcoded relative path is kept only as a last-resort fallback.
- **Renderer:** subscribes to a new `gnome:status` IPC channel and renders the warnings in a dismissible amber banner at the top of the panel. Dismissed state is per session.

### 6.5 Wayland caveat
Wayland does not support hot-reloading GNOME Shell extensions. Editing `extension.js` requires a logout/login for the running shell to pick up the new version. The stale detection exists precisely to remind the developer when this is the case — otherwise the symptom (old behavior, new code) is indistinguishable from a bug.

### 6.6 Resetting the overlay on disconnect
- **Issue:** After clicking "Cancelar conexión" the panel returned to `idle`, but the GNOME overlay kept the messages from the previous session frozen on screen. The placeholder "Esperando conexión a Twitch..." only reappeared after closing and reopening the app.
- **Root cause:** The main process only tore down the `tmi.js` client; the extension had no way to know that the session had ended, so its line buffer stayed intact.
- **Resolution:**
  - Added a second D-Bus signal, `ChatCleared` (no arguments), to `StreamShellInterface`.
  - The main emits it in two places: at the top of `connectToTwitch()` (so connecting to a new channel starts clean) and in the `disconnect-twitch` IPC handler (after teardown).
  - The extension subscribes to `ChatCleared` and, on receipt, resets `this._lines` and re-renders the `WAITING_MARKUP` in the label. The box stays visible — only its contents are cleared.

## 7. Internationalization (i18n)

### 7.1 Scope
Two independent processes render text that the user sees, and each detects the locale through a different mechanism:

| Layer | Locale source | Fallback |
|---|---|---|
| Renderer (React panel) | `navigator.language` (Chromium reads it from the OS) | `en` |
| GNOME extension (overlay) | `GLib.get_language_names()` (locale of the running GNOME Shell) | `en` |

There is no shared translation catalog between the two. This is deliberate: they don't share a process, and a runtime bridge would add complexity for zero benefit when there are fewer than a dozen strings on each side.

### 7.2 Renderer — `src/renderer/src/i18n.ts`
- Minimal module, no dependency on `i18next` or similar. ~70 lines total.
- Exports `t(key, params?)` and `getLocale()`.
- Keys are flat strings (`panel.connect`, `gnome.warn.repoNotFound`, ...). Interpolation uses `{name}` placeholders.
- Resolution order: current locale → `en` → raw key (so typos are visible without crashing the UI).
- Adding a language is: extend `Locale`, extend `dictionaries`. Two edits.

### 7.3 Main — warning keys instead of strings
- `gnome-setup.ts` used to produce human-readable Spanish strings, which leaked user-facing text into the main process and made it impossible to translate.
- Changed `GnomeCheckResult.warnings` from `string[]` to `GnomeWarning[]`:
```ts
  interface GnomeWarning { key: GnomeWarningKey; params?: Record<string, string> }
```
- The main process only knows the key (`'repoNotFound'`, `'staleWayland'`, ...) and the params (`{ path, expected, actual, message, schemaDir }`).
- The renderer translates: `t('gnome.warn.' + w.key, w.params)`. Adding a new warning means adding one key + one dictionary entry per language, and the main process stays untouched.

### 7.4 Extension — minimal inline dictionary
- The waiting placeholder is the only user-visible string in the extension.
- Translated with a small `TRANSLATIONS` object + `GLib.get_language_names()` iteration. Falls back to `en` if the system locale isn't in the dictionary.
- **Long-term path**: once we package as `.deb`, replace the inline dictionary with gettext (`locale/<lang>/LC_MESSAGES/<uuid>.mo`). The rest of the code doesn't change — only `T()` becomes a gettext wrapper. This is why the extension-side solution is intentionally a stopgap.

### 7.5 What this does *not* translate
- Console logs (`[StreamShell Backend] WebSocket abierto con ...`). These are developer-facing and staying in one language avoids confusion when grepping across sessions.
- Twitch chat messages. Obviously.
- Error payloads coming back from Twitch (`No response from Twitch.`) — those are surfaced verbatim. Translating external error messages is a losing game.

### 7.6 Wayland note
The renderer respects `LANG=...` at launch (`LANG=es_ES.UTF-8 npm run dev`), because Chromium reads the locale from the environment. The extension does **not**: it reads the locale that GNOME Shell had when it started, which is fixed per session. Testing the extension in a different language requires a system-level language change and a full logout/login. This is expected behavior, not a bug.

## 8. Streamer Avatar (Helix Integration)

### 8.1 Goal
Display the streamer's Twitch profile picture next to the channel input, making the panel feel more polished and giving immediate visual feedback that the typed channel actually exists.

### 8.2 Auth — Client Credentials Grant
- The avatar lookup hits `GET /helix/users?login={channel}`, which requires a Bearer token.
- We use the **Client Credentials Grant** (server-to-server OAuth): no user login, no OAuth redirect, no scopes. The app authenticates as itself.
- Credentials (`TWITCH_API_ID_CLIENT` and `TWITCH_API_SECRET_CLIENT`) come from a Twitch Developer Console app, loaded via `dotenv` from `electron-app/.env` (dev only, git-ignored).
- The App Access Token is cached in `twitch-api.ts` until 5 minutes before expiry (`expires_in - 300`). Twitch tokens last ~60 days, so in practice the auth endpoint is hit once per process lifetime.

### 8.3 Loading `.env` — the hoisting trap
- Initial attempt: `import { config } from 'dotenv'; config()` at the top of `main/index.ts`. This **does not work**: TypeScript hoists all `import` statements above any other code in the compiled output, so `config()` ran after electron and every other module had already been evaluated. `process.env.TWITCH_API_*` were undefined everywhere.
- **Fix:** the call was moved to `electron-app/src/main/load-env.ts`, and `main/index.ts` imports it as the very first statement (`import './load-env'`). Module load order is now deterministic and the env vars are populated before any other module reads them.
- Diagnostic in the terminal on startup: `◇ injected env (2) from .env`. The number is the count of variables loaded — a hard check that the file was found and parsed.
- **Pitfall:** the `.env` must live in `electron-app/` (next to the `package.json` that owns the code), because `process.cwd()` in dev is `electron-app/`. Putting it at the repo root silently loads 0 variables.

### 8.4 Backend — `src/main/twitch-api.ts`
- `getStreamerAvatar(channel)` validates the channel name against a Twitch-username regex, checks the in-memory cache, then (if needed) obtains a token and calls Helix.
- Failures of any kind (bad channel, network, expired token, rate limit) resolve to `null`. The renderer treats `null` as "no avatar available" and keeps the initial-letter placeholder.
- Results are cached in a `Map<channel, url|null>` for the process lifetime, so repeat lookups of the same channel are instant and free (0 Helix requests).
- A second cache level lives in the renderer (see 8.6) so the avatar survives restarts.

### 8.5 IPC bridge
- New `ipcMain.handle('get-streamer-avatar', ...)` in `main/index.ts`, delegating to `getStreamerAvatar`.
- Exposed via `ipcRenderer.invoke` in the preload as `window.api.getStreamerAvatar(channel)`.
- Uses `invoke`/`handle` (promise-based) instead of `send`/`on`: the renderer needs the return value, not a fire-and-forget.

### 8.6 Renderer — debounce + persistent cache
- **Debounce:** the lookup is debounced by 2 seconds. 400ms was initially tried and proved far too short — humans type Twitch usernames at ~100–200ms per character, so a 400ms debounce fires mid-word and spams the API. 2s is long enough to catch natural pauses and short enough to feel responsive.
- **Blur trigger:** `onBlur` on the input bumps a `avatarLookupNonce` counter, which forces the `useEffect` to run again immediately, bypassing the debounce. Effect: type the channel, click elsewhere → avatar appears at once.
- **Persistent cache:** `avatar-cache.ts` stores `{ url, fetchedAt }` entries in `localStorage` under `streamshell.avatar-cache.v1`, with a 24h TTL.
  - On lookup: if a cached value exists, it's rendered *immediately* (no loading flicker), and a background refresh runs in parallel.
  - The TTL matters: if the streamer changes their profile picture, users see the new one within a day without us hitting the API on every keystroke.
  - `getCachedAvatar` returns three distinct values: `undefined` (never fetched), `null` (fetched, confirmed not to exist), or `string` (URL). This lets the UI show a loading pulse only on the first cold lookup.
- **Stable across status changes:** the avatar `useEffect` deliberately does *not* depend on `status`. Toggling Connect/Cancel no longer re-triggers a lookup, so the image stays put during normal use.

### 8.7 UX
- 44×44 square with 8px rounded corners, matching the input's `border-radius`. Border is dark grey by default, Twitch purple (`#9146FF`) when a real avatar is loaded.
- While loading a cold lookup, the placeholder initial pulses (subtle opacity animation). Once a real image or `null` result arrives, the pulse stops.
- Empty input → grey `?`. Non-empty input with no avatar → first letter of the channel, in Twitch purple.

### 8.8 What we don't do (yet)
- No rate limit handling beyond "return null on 429". Our usage is a handful of requests per dev session — nowhere near Twitch's 800 points/min budget.
- No user OAuth. We don't need to read private data, so we don't ask users to authorize anything.
- No avatar for chatters (only the channel owner). That would need per-user lookups on every message, which is a different design discussion.

## 9. Badges, Emotes and Animated Emotes

### 9.1 Goal
Make the overlay render chat messages the way a user expects from a
Twitch client: badge icons before the username, emote images inline,
animated emotes actually moving, and long messages wrapping cleanly
inside the box.

### 9.2 Two sources of image assets
- **Badges:** the IRC `badges` tag only carries ids (`moderator: '1'`,
  `subscriber: '12'`). The actual images come from Helix, via two
  endpoints: `/chat/badges/global` and `/chat/badges?broadcaster_id=`.
  Channel entries override global ones with the same `set_id`, so the
  resolver merges both indexes with the channel taking precedence.
  Both are cached for the process lifetime and warmed right after JOIN
  (`preloadBadges`) so the first message doesn't wait on two round trips.
- **Emotes:** the IRC `emotes` tag carries id → position ranges. The
  URL is built from the id (see research section 6). Twitch exposes
  both a static PNG and an animated GIF for emotes that have one, at
  slightly different paths. `emote-cache.ts` tries animated first and
  falls back to static.

### 9.3 Disk cache with content-based extensions
- Main process downloads each image once to
  `~/.cache/streamshell/images/` (`XDG_CACHE_HOME` honored, falls back
  to `~/.cache`). The extension only ever sees local file paths — it
  never makes network calls.
- Cache key is `sha1(url)`. Twitch image URLs are immutable, so no
  invalidation logic is needed.
- **The extension is chosen from the actual bytes, not the URL.** The
  animated and static emote URLs are almost identical; only the response
  body (GIF magic bytes `GIF`) tells them apart. `detectExt` checks the
  first three bytes and picks `.gif` or `.png` accordingly.
- Writes go through a temp file plus `rename`, so a crash mid-write
  never leaves a truncated image treated as a valid cache hit.
- Concurrent requests for the same URL are deduped with an in-flight
  promise map.
- **Negative caching:** a `noanim-<id>` marker on disk remembers
  emote ids whose animated variant returns 404, so the animated URL is
  not requested again in future sessions. Timeouts and 5xx do *not*
  create a marker — those are retried next time.

### 9.4 Message pipeline — segment parsing
- New module `chat-segments.ts` splits the message text into typed
  segments: `{ t: 'text', v }` and `{ t: 'emote', path, name }`.
- **Critical detail:** Twitch ranges are in Unicode code points, not
  UTF-16 units. A single emoji counts as 1 for Twitch but 2 for
  JavaScript's `String.length`. The message is therefore split with
  `Array.from(message)` — using `substring()` would corrupt any message
  that contains an astral-plane character (emoji, some CJK extensions).
- Malformed or out-of-bounds ranges are dropped instead of throwing.
- Adjacent text chunks are merged so the output has no empty text
  segments.
- Emotes are fetched in parallel via `Promise.all`; if a download
  fails, the emote's name is emitted as plain text, so no message
  content is ever lost.

### 9.5 Message pipeline — ordering and resilience
- Two async operations happen per message: badge resolution (Helix
  calls, potentially cached) and segment building (emote downloads).
  Both can be slow on cold caches.
- **Ordering:** if we let every message run its own async chain, two
  messages arriving 10ms apart could resolve in reverse order and
  appear swapped in the overlay. A single `messageChain` promise
  serializes processing — each message waits for the previous one to
  finish before emitting its D-Bus signal. This keeps the visible
  order exactly the arrival order.
- **Failure isolation:** the per-message body is wrapped in a try/catch
  so a badge hiccup degrades to a plain-text message instead of
  skipping it. The outer `.catch` on the chain prevents an unhandled
  rejection from poisoning every subsequent message.

### 9.6 D-Bus payload — still `'sss'`
- The `MessageReceived` signal signature stays `'sss'`. The third
  argument is still a string — it's just JSON now:
  `{ badges: string[], segments: Segment[] }`.
- **No schema change, no preload change, no renderer change.** The
  renderer never touches chat messages; only main → extension flows
  this data. Keeping the signature unchanged means the update is
  backward-compatible at the D-Bus layer.

### 9.7 Extension-side rendering
- The old single `St.Label` with Pango markup was replaced by a
  vertical `St.BoxLayout` of message rows. Each row is a horizontal
  `St.BoxLayout` containing: badge icons (18px), the colored username,
  and the message content as a sequence of text labels and emote icons
  (24px).
- **Word wrapping is manual.** Clutter's `FlowLayout` is a
  column-aligned grid, not inline text flow. The renderer appends each
  child to the current row, measures the row, and moves that child to
  a new row if the row exceeds `ROW_WIDTH`. This requires the message
  box to be already attached to the stage so widths are measured with
  the real theme, which is why `_onMessageReceived` adds the box first
  and populates it second.
- `MAX_WORD_LEN` splits unbreakable words (URLs, spam) so they can't
  overflow the box.
- `_makeIcon` validates that every path is absolute and ends in
  `.png`/`.gif` — defense in depth against a malformed payload.
- `_parsePayload` falls back to treating the third D-Bus argument as
  plain text if JSON parsing fails, so an older backend running
  alongside a newer extension (or vice versa) degrades gracefully.
- `_onMessageReceived` catches layout errors and falls back to a
  single wrapped label showing emote names in place of the missing
  images. The user always sees the message content, even when the
  fancy layout fails.

### 9.8 Animated emotes — the engine
GNOME Shell runs all extension JS in the compositor's main thread. A
naive per-emote `GLib.timeout_add` would freeze the desktop the moment
ten animated emotes appear on screen. `gnome-extension/animator.js`
keeps the cost bounded with five rules:

  1. **One timer for everything.** A single `GLib.timeout_add` drives
     every animated emote. It is removed as soon as nothing needs
     animating (last actor destroyed or animation disabled).
  2. **One Cairo surface per distinct emote, shared by every actor.**
     Fourteen copies of Kappa on screen cost one frame upload per
     tick, not fourteen. Actors are `St.DrawingArea` that repaint from
     the shared surface; the animator just calls `queue_repaint()` on
     each after uploading a new frame.
  3. **Pause while hidden.** The timer stops while the backend is gone
     or the Activities Overview is open. Frames are selected by wall
     clock (`iter.advance(null)`), so animations resume **in sync**
     rather than restarting from frame 0. The pause state is derived
     from two sources via a single `_syncAnimatorPause()` helper, so
     there's only one place that decides whether the timer runs.
  4. **Cap on distinct animated emotes.** `maxAnimated: 16`. Beyond
     it, new emotes render as a still (first frame) so they never cost
     CPU. This prevents a "spam 100 distinct animated emotes" scenario
     from degrading the compositor.
  5. **Full disable via GSettings.** `setEnabled(false)` stops the
     timer and rewinds every entry to its first frame. Wired to the
     `animated-emotes` boolean in the schema, so users can turn it off
     from dconf without a relogin.

Robustness details:
- Frames are drawn with a per-row RLE blit instead of assuming a fixed
  Cairo stride. Pixbufs from different GTK themes have different
  channel counts and row padding, and Cairo's `ImageSurface` has its
  own stride. Copying byte-for-byte would produce garbage on some
  systems.
- Animations whose frame dimensions change mid-playback are logged
  once and skipped, instead of corrupting the shared surface.
- `_warnOnce` caps journal noise: a malformed GIF doesn't log on every
  frame.
- `destroy()` releases the GLib source and both caches, so disabling
  the extension doesn't leave timers or references behind.

### 9.9 Extension — integration
- `EmoteAnimator` is imported dynamically (`import('./animator.js')`).
  If anything in the Shell environment is missing (GdkPixbuf typelib
  not installed, for instance), the promise rejects, the extension
  logs once, and emotes degrade to static `St.Icon` actors. The rest
  of the overlay keeps working.
- The GSettings schema is probed with `has_key` before reading the
  `animated-emotes` key. **Reading an unknown key aborts gnome-shell** —
  a stale `.compiled` file would take the whole desktop down. Probing
  means a stale schema fails safe (animation stays on) instead of
  crashing. The check exists because anyone who pulls this change
  must run `glib-compile-schemas` before launching Shell.
- The animator pauses on `_onBackendAppeared` / `_onBackendVanished`
  and on Activities Overview show/hide, and resumes on the reverse
  transitions.

### 9.10 What we don't do (yet)
- **No third-party emotes** (BTTV / 7TV / FFZ). That requires per-channel
  dictionaries, another cache layer, and a different URL scheme.
  A TODO is left in `emote-cache.ts`.
- **No Unicode-range emote layout.** Emotes are rendered as icons in
  the row layout, not as inline glyphs. Mixed text/emote wrapping is
  approximate: an emote that lands at the boundary wraps as a whole
  icon rather than splitting the surrounding text.
- **No animation frame interpolation.** GIFs play at their native
  frame rate (tick is ~40ms, most GIFs use 50–100ms delays). Rendered
  smoothness on Wayland depends on the compositor's repaint timing,
  not ours.