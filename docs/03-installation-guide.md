# Installation & Development Guide

This guide details the exact steps and dependencies required to build and run StreamShell locally, keeping strictly to the boundaries defined in the architecture diagrams.

## Prerequisites
- **Node.js (v18+) & npm:** For the Electron/React backend.
- **glib-compile-schemas:** For compiling GNOME GSettings schemas (usually pre-installed on GNOME systems).

## 1. Electron Backend Initialization
The backend is scaffolded using `electron-vite` with React and TypeScript.

```bash
cd electron-app
npm install
```

### Core Dependencies
- `tmi.js`: Handles the Twitch IRC WebSocket connection asynchronously.
- `dbus-next`: Implements the D-Bus emitter to communicate with the Linux OS.

## 2. GNOME Extension Initialization
The extension requires its GSettings schema to be compiled before it can read visual configuration data (like background opacity) from the Electron panel.

```bash
cd gnome-extension
glib-compile-schemas schemas/
```
