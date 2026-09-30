# Development Log

This document tracks the actual implementation steps, bug fixes, and environment configurations established during development.

## 1. Electron Backend Initialization
- Scaffolded the backend using `electron-vite` (React + TypeScript).
- **Bug Fix (Linux Sandbox):** Addressed the SUID sandbox crash (`setuid_sandbox_host.cc:166`) on Ubuntu by injecting `app.commandLine.appendSwitch('no-sandbox')` for Linux platforms before app initialization.
- **Twitch Integration:** Implemented `tmi.js` using the CommonJS require syntax (`const tmi = require('tmi.js')`) to bypass Vite's ESM resolution issues.
- **Milestone:** Successfully connected to a live high-traffic channel (e.g., `juansguarnizo`) and verified real-time chat data flowing into the Node.js console.

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
