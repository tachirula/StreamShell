# Development log and current behavior

This document summarizes the implemented milestones and the decisions that
still shape the application. It describes current behavior rather than serving
as a chronological record of every intermediate patch. See
[architecture](./README.md) for diagrams and [installation](./03-installation-guide.md)
for setup and operation.

## Runtime foundation

- The control panel is a React/TypeScript Electron renderer. The Electron main
  process owns Twitch connectivity, application preferences, image retrieval,
  the D-Bus service, and GNOME setup checks.
- A narrow preload API mediates renderer-to-main IPC. Chat messages do not pass
  through the renderer: main emits them to the GNOME extension over the user
  session's D-Bus.
- The GNOME extension creates the overlay only while the backend owns its D-Bus
  name. If the backend exits, the extension hides the overlay; if the channel
  disconnects while the app remains open, `ChatCleared` resets the visible
  session.
- The main process reports connection success after Twitch confirms the
  channel `JOIN`, not merely after opening the WebSocket. Join timeout, Twitch
  notices, and connection/disconnection events are surfaced to the panel.

## Chat message pipeline

1. `tmi.js` receives a message and its IRC tags.
2. Main resolves the author, display color, reply metadata, Twitch badges, and
   emote segments. A promise chain preserves arrival order despite asynchronous
   catalog and image work.
3. Twitch emotes are located by IRC character ranges. Third-party emotes are
   recognized in a second, whole-word pass against the active channel catalog.
4. The resolved badge and segment data is JSON-encoded in the string payload of
   the D-Bus `MessageReceived` signal. A reply, when available, accompanies
   the segments as structured metadata; the overlay displays it before the
   replying message.
5. The extension validates local image paths, lays out badges, text, and emote
   actors, and wraps long content. If rich rendering fails, it falls back to
   readable text rather than dropping the message.

The extension does not make external HTTP requests. Main downloads image files
and passes local paths to GNOME. This keeps network and cache behavior outside
the compositor process.

## Emotes, badges, and image downloads

- Twitch Helix supplies global and broadcaster-specific badge catalogs; the
  broadcaster's definitions take precedence where a badge set overlaps.
- BTTV, FFZ, and 7TV catalogs are loaded for the active channel after JOIN.
  The setting **Support BTTV, FFZ and 7TV APIs** is on by default; when off,
  those plain-text codes are not replaced by images.
- Native Twitch emotes use IRC ranges; third-party codes are matched as words.
  Failed image retrieval preserves the emote's visible text.
- Image files are cached by URL under the platform cache directory. In-flight
  requests for a URL are deduplicated. Cache keys use the first 20 hex
  characters of SHA-1(URL); downloads are written to a temporary file and
  renamed into place after completion.
- Downloads use a FIFO queue with configurable concurrency from one to sixteen
  workers (default four). Existing saved values above sixteen are capped at
  sixteen without discarding other valid preferences.
- The 30-second abort is an idle timeout that resets on response arrival and
  each non-empty data chunk. It has no total-duration or byte-size cap. A slow
  but progressing transfer can continue, while a stalled request eventually
  releases its queue slot.
- Animated Twitch assets are preferred when enabled and available, with a
  static variant as fallback. A confirmed missing animated variant is
  negatively cached only for a 404; timeouts and other transient failures
  remain retryable.
- Supported cached formats include PNG, GIF, and WebP. WebP is needed for 7TV
  assets.
- Cache clearing is exposed in settings and is refused while connected to
  Twitch, avoiding disruption to active rendering. Once disconnected, it
  waits for in-flight downloads before deleting cache files and memory indexes.

## Overlay, history, and animation

- The extension uses a message-row layout rather than parsing chat content as
  arbitrary markup. It maintains an in-memory message history for the current
  channel session; channel changes and disconnects clear that session.
- History is capped at 500 in-memory messages, and replay is limited by the
  configured history limit. Scrolling to older messages pauses animation; a
  control returns to the latest messages. History is not persisted across app
  restarts.
- The animator decodes GIFs using GdkPixbuf and paints shared Cairo surfaces.
  One GLib tick services active animations, repeated instances of an emote
  share decoded state, and the number of distinct animated emotes is bounded.
- Animation pauses when the backend is unavailable, the GNOME Activities
  Overview is showing, the user has hidden the overlay, or chat history is
  being browsed. Visibility transitions synchronize the timer so returning to
  the desktop does not permanently freeze animations.
- Animated emotes can be disabled through the extension's GSettings key.

## Preferences and global visibility shortcut

- App preferences are validated and persisted by the main process in its
  Electron `userData` directory. The renderer requests updates through preload
  IPC and saves with a debounced flow.
- Emote image quality can be set to x1, x3, x4, or best available. Best-quality
  mode takes precedence over the explicit scale.
- Image-download concurrency defaults to four and accepts one to sixteen.
- Overlay-specific settings are sent to GNOME in `OverlaySettingsChanged`.
  GNOME stores and observes extension settings through GSettings.
- A configurable global keybinding toggles overlay visibility. Super/Windows
  is reserved by GNOME and cannot be recorded. Fn may be handled by keyboard
  firmware and therefore may not produce a recordable event.

## Operational constraints and known limits

- On Wayland, GNOME Shell does not hot-reload extension JavaScript. Changes to
  extension code or a newly introduced schema key require a logout/login for
  the running Shell to load the update.
- The keybinding's actual availability depends on GNOME and desktop-level
  shortcut reservations. Test it in the target session after installation.
- Third-party catalogs and remote image servers are external dependencies.
  Network errors can leave codes as text or cause a static fallback without
  preventing the Twitch connection itself.
- The Electron panel's locale and the extension's locale are resolved
  separately; the extension uses the GNOME Shell session locale.
- Chat history, badge indexes, and third-party catalogs are in-memory state.
  Preferences, image cache files, and the renderer's avatar cache have separate
  persistence lifetimes.
