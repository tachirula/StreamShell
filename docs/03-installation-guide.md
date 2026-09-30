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
2. Use a valid HTTPS OAuth redirect URL (StreamShell uses the app client
   credentials flow, not a browser redirect), select the application
   integration category, and choose a confidential client.
3. Copy its Client ID and generate a Client Secret.
4. Create `electron-app/.env`:

   ```dotenv
   TWITCH_API_ID_CLIENT=<your client id>
   TWITCH_API_SECRET_CLIENT=<your client secret>
   ```

Keep the file local. It is ignored by Git and must never be committed. It
belongs beside `electron-app/package.json`. The startup log reports the number
of variables loaded; a count of zero usually means the file is missing,
misnamed, empty, or in the wrong directory.

Twitch chat itself is read over IRC and does not require a user login. Missing
Helix credentials may prevent identity, badge, or catalog preparation, but
should not be mistaken for a Twitch account sign-in prompt.

## Install and start

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
- **Overlay appearance and history:** overlay-specific settings are propagated
  to GNOME.
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
