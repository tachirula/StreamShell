# Installation & Development Guide

This guide details the exact steps and dependencies required to build and run StreamShell locally, keeping strictly to the boundaries defined in the architecture diagrams.

## Prerequisites
- **Node.js (v18+) & npm:** For the Electron/React backend.
- **GNOME Shell 45+ (Linux):** The overlay is a GNOME Shell extension.
- **glib-compile-schemas:** Usually pre-installed on GNOME systems. Only needed if the app cannot find it on `PATH`; the app will try to compile the schema automatically.
- **Twitch Developer account:** Needed to obtain the Client ID and Client Secret used for the avatar feature.

## 1. Electron Backend Initialization
The backend is scaffolded using `electron-vite` with React and TypeScript.

```bash
cd electron-app
npm install
```

### Core Dependencies
- `tmi.js`: Handles the Twitch IRC WebSocket connection asynchronously.
- `dbus-next`: Implements the D-Bus emitter used to broadcast chat messages to the GNOME Shell extension.
- `dotenv`: Loads `electron-app/.env` into `process.env` at startup.

## 2. Twitch Developer App (for the avatar feature)

The panel shows the streamer's profile picture next to the channel input. That lookup uses the Twitch Helix API, which requires an OAuth client.

### One-time setup

1. Go to the [Twitch Developer Console](https://dev.twitch.tv/console/apps) and log in with your Twitch account.
2. Click **Register Your Application**.
3. Fill the form:
   - **Name:** any name not already taken globally (e.g. `StreamShell-<yourname>`). Twitch requires app names to be unique across the entire platform; `StreamShell` alone is likely taken.
   - **OAuth Redirect URL:** `https://localhost` — we don't use the redirect flow, but Twitch requires a syntactically valid HTTPS URL.
   - **Category:** `Application Integration`.
   - **Client Type:** **Confidential**.
4. Click **Create**.
5. Copy the **Client ID** shown on the resulting page.
6. Click **New Secret** and copy the generated **Client Secret** immediately — Twitch only displays it once.

### Local `.env` file

Create `electron-app/.env`:

```
TWITCH_API_ID_CLIENT=<your client id>
TWITCH_API_SECRET_CLIENT=<your client secret>
```

Rules:
- No spaces around `=`.
- No quotes.
- One variable per line.
- The file must live next to `electron-app/package.json`, because `dotenv` reads it from `process.cwd()`.

`.env` is already in `.gitignore`. **Never commit it.**

### Verification

When you start the app, look for this line in the terminal:

```
◇ injected env (2) from .env
```

The `(2)` is the number of variables loaded. If it says `(0)`, the file wasn't found or was empty. Common causes:
- The file is at the repo root instead of `electron-app/`.
- A typo in the filename (`.env.txt`, `.env.local`, `env`).
- A BOM at the start of the file (usually from a Windows editor). Check with `cat -A .env`.

## 3. GNOME Extension — Setup Is Automatic

Unlike previous iterations, **no manual `gnome-extensions enable` or `glib-compile-schemas` step is required.** On startup the app performs the following (dev mode only):

1. Ensures `~/.local/share/gnome-shell/extensions/chat-overlay@test` is a symlink pointing at this repository.
2. Compiles the GSettings schema if the XML is newer than the compiled file.
3. Runs `gnome-extensions enable chat-overlay@test` (idempotent — safe to call repeatedly).
4. Reports any issue through a dismissible amber banner in the renderer.

### What the app cannot do for you

**Wayland does not hot-reload GNOME Shell extensions.** After editing `extension.js`, you must log out and log back in once so the shell picks up the new code. The app detects this situation (compares `extension.js` mtime against `gnome-shell`'s start time) and shows a banner reminding you to relogin.

### Manual setup (only needed if the automatic setup fails)

If for some reason the app cannot create the symlink or compile the schema, do it by hand:

```bash
# Create the symlink (usually done automatically)
ln -sfn "$(pwd)/../gnome-extension" ~/.local/share/gnome-shell/extensions/chat-overlay@test

# Compile the schema (usually done automatically)
cd ../gnome-extension
glib-compile-schemas schemas/

# Enable the extension (usually done automatically by the app)
gnome-extensions enable chat-overlay@test
```

## 4. Running in Development

From `electron-app/`:

```bash
npm run dev
```

Expected behavior:

1. Terminal prints `◇ injected env (2) from .env`.
2. The Electron window opens with the control panel, in the language of your OS (`navigator.language`).
3. The GNOME extension is enabled and starts watching `org.streamshell.Twitch` on the session bus.
4. As soon as the backend claims the bus name, the overlay appears in the top-right corner with a localized "Waiting for Twitch connection..." / "Esperando conexión a Twitch..." placeholder.
5. Type a channel name. After ~2s (or immediately on blur), the streamer's avatar appears next to the input.
6. Click the connect button — the panel turns green once Twitch confirms the JOIN, and chat messages start flowing to the overlay.
7. Close the app (Ctrl+C or the window's close button) — the overlay hides itself automatically. The extension remains enabled but invisible until the app runs again.

### Overriding the locale

The renderer reads its locale from the environment, so you can force a language without touching the system settings:

```bash
LANG=es_ES.UTF-8 npm run dev      # panel in Spanish
LANG=en_US.UTF-8 npm run dev      # panel in English
```

Verify what Chromium is seeing by opening DevTools (`Ctrl+Shift+I`) and running `navigator.language` in the console.

**The GNOME overlay does not follow this override.** It reads the locale from `GLib.get_language_names()`, which reflects the language of the running GNOME Shell session. To test the overlay in a different language you must change the system language and log out / log back in. This is a GNOME limitation, not a StreamShell one.

### Supported languages

Currently: **English** and **Spanish**. Adding a language requires two small edits:

1. Renderer: extend `Locale` and `dictionaries` in `src/renderer/src/i18n.ts`.
2. Extension: extend `TRANSLATIONS` in `gnome-extension/extension.js`.

Both are intentionally kept as flat dictionaries for now. Once the extension moves to a gettext-based build (planned for the `.deb` target), the extension side will switch to standard `.po`/`.mo` files.

### Avatar cache

The streamer avatar is cached in two places:

- **Main process (in-memory):** valid for the process lifetime.
- **Renderer (localStorage):** valid for 24h, survives restarts.

To force a refresh during development, open DevTools → Application → Local Storage → delete the `streamshell.avatar-cache.v1` key, then reload.