# Installation & Development Guide

This guide details the exact steps and dependencies required to build and run StreamShell locally, keeping strictly to the boundaries defined in the architecture diagrams.

## Prerequisites
- **Node.js (v18+) & npm:** For the Electron/React backend.
- **GNOME Shell 45+ (Linux):** The overlay is a GNOME Shell extension.
- **glib-compile-schemas:** Usually pre-installed on GNOME systems. Only needed if the app cannot find it on `PATH`; the app will try to compile the schema automatically.

## 1. Electron Backend Initialization
The backend is scaffolded using `electron-vite` with React and TypeScript.

```bash
cd electron-app
npm install
```

### Core Dependencies
- `tmi.js`: Handles the Twitch IRC WebSocket connection asynchronously.
- `dbus-next`: Implements the D-Bus emitter used to broadcast chat messages to the GNOME Shell extension.

## 2. GNOME Extension — Setup Is Automatic

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

## 3. Running in Development

From `electron-app/`:

```bash
npm run dev
```

Expected behavior:

1. The Electron window opens with the control panel.
2. The GNOME extension is enabled and starts watching `org.streamshell.Twitch` on the session bus.
3. As soon as the backend claims the bus name, the overlay appears in the top-right corner with "Esperando conexión a Twitch...".
4. Enter a channel name and click "Conectar al Chat" — the panel turns green once Twitch confirms the JOIN, and chat messages start flowing to the overlay.
5. Close the app (Ctrl+C or the window's close button) — the overlay hides itself automatically. The extension remains enabled but invisible until the app runs again.
