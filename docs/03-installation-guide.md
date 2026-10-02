# Installation and development guide

StreamShell consists of an Electron control panel and a GNOME Shell extension.
The extension renders chat as an overlay; the Electron main process connects to
Twitch, resolves assets, and communicates with GNOME over the session D-Bus.
See the [architecture diagrams](./README.md) for process and message flows.

## Requirements

- Linux with GNOME Shell 45 or newer.
- Node.js 18 or newer and npm.
- `glib-compile-schemas` for compiling the extension's GSettings schema.
- A Twitch developer application for the Helix client credentials used by
  avatar, broadcaster ID, and badge lookups.
- A running GNOME user session with a session D-Bus.

## Configure Twitch API credentials

1. Create an application in the [Twitch Developer Console](https://dev.twitch.tv/console/apps).
2. Select the application integration category. Device Code Flow does not use
   an OAuth redirect URL.
3. Copy its Client ID. Device Code Flow does not need a Client Secret.
4. Create `electron-app/.env`:

   ```dotenv
   TWITCH_API_ID_CLIENT=<your client id>
   ```

Keep the file local. It is ignored by Git and must never be committed. It
belongs beside `electron-app/package.json`. The startup log reports the number
of variables loaded; a count of zero usually means the file is missing,
misnamed, empty, or in the wrong directory.

The app embeds the Client ID into the Electron main bundle at build time; it is
public application metadata, not a secret. StreamShell offers optional Twitch
sign-in below **Connect to Chat** and in Settings. Reading channel chat does
not require signing in; Twitch uses an anonymous IRC identity until the user
connects an account. StreamShell
then displays a single-use device code and a clickable `twitch.tv/activate`
link; it does not open the browser automatically. The user completes
authorization in their regular browser, and StreamShell polls Twitch for the
result. Access and
rotating refresh tokens are encrypted with Electron `safeStorage`, validated
with Twitch, and not written to `preferences.json`. One authorization requests
both `chat:read` and `chat:edit` so enabling message sending later does not
require another sign-in. Interactive chat itself remains off until enabled in
Settings. Existing sessions issued with only `chat:read` require a one-time
authorization to add `chat:edit`.

Helix public user and badge requests use the authenticated User Access Token.
An optional `TWITCH_API_SECRET_CLIENT` enables an App Access Token fallback
when there is no user session; it is not needed for normal signed-in use and
must never be bundled in a public release.

The home screen displays an orange optional sign-in notice only after the
account status has loaded and confirmed the account is signed out. Signing in
grants the scopes needed by account-backed features and chat sending. If an
older account session lacks `chat:edit`, Settings offers a permission-grant
flow instead of incorrectly describing the account as signed out. A
signed-out user can still read public channel chat anonymously. Without an
authenticated user token or the optional app-token fallback, Helix-backed
streamer avatars, profile details, and badges may be unavailable; third-party
emotes use independent provider APIs.

## Install and start

On Linux, the development command runs Electron Vite with its `--noSandbox`
option to work around Chromium startup failures observed in some local
environments. This applies only to `npm run dev`; packaged builds do not use
that development option. The app does not change `/dev/shm` or `/tmp`
permissions.

```bash
cd electron-app
npm install
npm run dev
```

The dev startup attempts to:

1. Locate the repository's `gnome-extension/` directory (or use
   `STREAMSHELL_REPO_ROOT` if a nonstandard checkout requires it).
2. Set up the local extension link and compile the GSettings schema when
   necessary.
3. Enable `chat-overlay@test` and report setup warnings in the panel.
4. Start Electron and claim the session-bus name watched by the extension.

Type a Twitch channel login and connect. The panel reports success only after
Twitch confirms the `JOIN`. The extension creates the overlay while the main
process owns its D-Bus name, and hides it when the backend exits.

### Manual GNOME setup

If automatic setup cannot link or enable the extension:

```bash
ln -sfn "$(pwd)/../gnome-extension" \
  ~/.local/share/gnome-shell/extensions/chat-overlay@test
cd ../gnome-extension
glib-compile-schemas schemas/
gnome-extensions enable chat-overlay@test
```

Run the link command from `electron-app/`. If the extension schema changes, it
must be compiled before Shell loads the new key set:

```bash
cd gnome-extension
glib-compile-schemas --strict schemas/
```

### Wayland and extension updates

Wayland does not allow GNOME Shell to hot-reload extension JavaScript. After
installing an update that changes `extension.js`, `animator.js`, or adds a
GSettings schema key (including the configurable global shortcut), log out
and back in once. Changing an already-loaded preference later does not itself
require another logout. The panel may display a warning if it detects that the
running Shell has an older extension loaded.

## Settings

The control panel provides persistent preferences for:

- **Emote quality:** x1, x3, x4, or best available. Best available mode
  overrides the explicit scale.
- **Concurrent image downloads:** choose from one to sixteen workers (default
  four). Higher values allow more downloads to proceed at once and use more
  network bandwidth and system resources; lower values reduce parallel load.
- **Third-party emote APIs:** enabled by default. Turn this off to leave BTTV,
  FFZ, and 7TV codes as plain text.
- **Animated emotes:** can be switched off through the extension setting.
- **Overlay appearance and history:** adjust the chat width, background opacity
  (0–100%), visible messages, and session history in Settings. Appearance
  changes are applied live to the GNOME overlay. Chat viewport height is fixed
  by the configured visible-message count and available monitor space, so
  incoming messages do not resize the overlay or move the composer. The overlay
  follows new messages unless the user scrolls into older history; while
  browsing, new messages preserve the reading position and **Jump to latest**
  returns to the newest message. In a sufficiently large app
  window, Settings align to the left and reflow into columns to use the
  available space; the compact layout remains centered in smaller windows.
- **Interactive chat:** disabled by default. Sign in and enable it to show an
  input field in the GNOME overlay; Enter sends a message to the active Twitch
  channel.
- **Clickable profiles:** disabled by default. When enabled, clicking a
  username opens its public profile details and matching messages from the
  current in-memory channel session. New messages from that user appear in the
  open profile in real time. The profile message limit is configurable up to
  500. Twitch does not provide a public historical chat-log endpoint; no
  per-user message index is stored, and the existing bounded session log is
  searched only when a profile is opened.
- **Global show/hide shortcut:** record a modifier and key combination. The
  same shortcut toggles visibility. Super/Windows is reserved by GNOME; Fn is
  often handled by keyboard firmware and may not be detectable. Desktop-level
  shortcuts can also reserve individual combinations.

After installing the extension/schema changes on Wayland, log out and back in
once before testing the global shortcut. The shortcut is registered by GNOME
Shell and is independent of whether the Electron panel has focus.

## Caches

- **Image cache:** downloaded badges and emotes are stored under
  `$XDG_CACHE_HOME/streamshell/images/`, or `~/.cache/streamshell/images/`
  when `XDG_CACHE_HOME` is unset on Linux. The application exposes a cache
  clearing action in settings; disconnect from Twitch first, because clearing
  while connected is intentionally rejected.
- **Avatar cache:** renderer-side local storage is separate from the image
  cache. Clearing image files does not necessarily clear the avatar entry.
- **Session data:** chat history, loaded catalogs, and related message state
  are kept in memory for the current process/channel (history is capped at 500
  messages), not as a persistent transcript.

For quality or asset troubleshooting, disconnect and use the cache-clearing
control, then reconnect. Avoid deleting cache directories while the application
is running.

## Localization

The control panel and overlay currently support English and Spanish. The
renderer resolves its locale from Chromium/OS language; GNOME resolves the
extension's locale from the running Shell session. Overriding `LANG` when
starting Electron can change the panel language, but does not change the
already-running Shell locale. To test a different overlay language, change the
GNOME session language and log out/in.

## Useful checks

From the repository root:

```bash
node --check gnome-extension/extension.js
glib-compile-schemas --strict gnome-extension/schemas/
```

From `electron-app/`:

```bash
npm run typecheck
npx electron-vite build
```

`npm run build` runs typechecking before the Electron/Vite production build.
If TypeScript reports that `ignoreDeprecations: "6.0"` is invalid, the
installed compiler does not support the setting in the current TypeScript
configuration; treat that as a toolchain/configuration mismatch rather than an
application compile error.
