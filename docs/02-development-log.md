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
| main → renderer | `twitch:connected` | `{ channel, addr, port }` |
| main → renderer | `twitch:error` | `{ message }` |
| main → renderer | `twitch:disconnected` | `{ reason }` |

### 5.3 Implementation
- **`src/main/index.ts`**
  - Promoted `mainWindow` to a module-scoped variable so Twitch event handlers can reach it.
  - Added `sendToRenderer(channel, payload)` with a `isDestroyed()` guard.
  - Wired `tmi.js` events: `connected` → `twitch:connected`, `disconnected` → `twitch:disconnected`, and the `.connect().catch()` path → `twitch:error`.
  - Cleared the `mainWindow` reference on `'closed'` to avoid holding a stale object.

- **`src/preload/index.ts`**
  - Exposed `onTwitchConnected`, `onTwitchError`, `onTwitchDisconnected`.
  - Each returns a cleanup function so `useEffect` can unsubscribe on unmount.

- **`src/renderer/src/App.tsx`**
  - Added a `useEffect` subscribing to the three events with proper cleanup.
  - Removed the fake `setTimeout(1200)`.
  - Added an `'error'` status + `errorMsg` state so the actual failure reason surfaces in the UI.
  - The connect button becomes "Reintentar conexión" when in `'error'`, and the input re-enables so the user can fix the channel name.

### 5.4 Result
The UI now reflects the true state of the Twitch connection: the panel only says `connected` after `tmi.js` has actually established the WebSocket, and any failure (DNS, invalid channel, auth) is shown inline instead of being silently hidden behind an optimistic timeout.