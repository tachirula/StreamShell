# Research and technical references

This document records the external protocols and implementation decisions used
by StreamShell. For an overview of how these pieces fit together, see the
[architecture index](./README.md).

## Twitch chat and Helix

- [Twitch IRC documentation](https://dev.twitch.tv/docs/irc/) describes the
  WebSocket chat protocol used through `tmi.js`.
- [IRC tags reference](https://dev.twitch.tv/docs/irc/tags/) documents the
  message metadata StreamShell consumes, including `display-name`, `color`,
  `badges`, `emotes`, and reply-related tags.
- [Twitch API reference](https://dev.twitch.tv/docs/api/reference) covers the
  Helix endpoints used for user identity and chat badges:
  - `GET /helix/users` resolves a channel login to its broadcaster ID and
    profile image.
  - `GET /helix/chat/badges/global` loads global badge definitions.
  - `GET /helix/chat/badges?broadcaster_id=...` loads channel badge overrides.
- [OAuth token validation](https://dev.twitch.tv/docs/authentication/validate-tokens/)
  is performed at startup and periodically while the app is running. Desktop
  sign-in uses Twitch's Device Code Flow in the system browser; no localhost
  callback, redirect URI, or client secret is required.
- [Client credentials grant](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#client-credentials-grant-flow)
  is an optional fallback for Helix requests when no Twitch user session is
  available. Public user and badge lookups use the signed-in User Access Token.
  A client secret is not required for Device Code Flow and must never ship in
  the public Electron app.
- One Device Code authorization requests `chat:read` and `chat:edit`, avoiding
  a second authorization when the user enables message sending later. The
  interactive-chat feature remains opt-in even though its scope is granted.
  Tokens are stored with Electron `safeStorage`. Existing sessions with only
  `chat:read` need one authorization to add `chat:edit`.

### IRC emote ranges

The IRC `emotes` tag maps Twitch emote IDs to inclusive character ranges in the
original message. The parser uses Unicode code points (`Array.from`) so these
ranges remain correct when a message contains astral Unicode characters.
Twitch emote assets are requested from the CDN as animated or static variants;
the cache inspects the downloaded bytes to determine the local image extension.

## Third-party emote catalogs

Third-party emotes are plain text in IRC messages, so StreamShell loads a
channel catalog and performs a word-based second pass after parsing Twitch's
position-tagged emotes.

- **BetterTTV:** channel/shared catalog endpoint
  `https://api.betterttv.net/3/cached/users/twitch/{broadcasterId}` and image
  CDN `https://cdn.betterttv.net/emote/{emoteId}/{scale}x`.
- **FrankerFaceZ:** room endpoint
  `https://api.frankerfacez.com/v1/room/id/{broadcasterId}`. The service may
  return protocol-relative image paths.
- **7TV:** Twitch-user endpoint
  `https://7tv.io/v3/users/twitch/{broadcasterId}` and image CDN
  `https://cdn.7tv.app/emote/{emoteId}/{scale}x.webp`.

The catalogs are held in process memory and scoped to the active channel.
Third-party support is an explicit preference and is enabled by default. When
disabled, these codes are left as ordinary text. Catalog requests are
independent and run concurrently; failures are logged and do not prevent the
Twitch connection. Startup message processing waits for the catalog-loading
task to settle, and a failed provider simply contributes no matches.
Each catalog request has a 15-second timeout.

The image downloader also supports WebP, used by 7TV, in addition to PNG and
GIF. Availability and exact image variants are controlled by each provider's
current API/CDN behavior; these endpoints are external dependencies rather
than a stability guarantee from Twitch.

## Image download and cache policy

- The Electron downloader uses a FIFO queue and a configurable worker count.
  The preference defaults to four workers and accepts 1–16. Requests for the
  same URL share one in-flight promise. There is no separate fairness policy
  beyond FIFO admission.
- The 30-second abort is an **idle timeout**, not a total deadline. It starts
  before the request and resets when the response arrives and as non-empty
  response chunks are received. There is no hard total-duration or byte-size
  limit in the downloader.
- Cache filenames use the first 20 hexadecimal characters of SHA-1(URL), with
  the extension detected from the bytes (`gif`, `webp`, or fallback `png`).
  Files are written to a PID-suffixed temporary path and renamed into place.
- Only a Twitch animated-emote 404 is negatively cached (`noanim-<id>`).
  Other image failures, including timeouts, remain retryable.
- Clearing the image cache is rejected while a Twitch channel is active. Once
  disconnected, the clear operation waits for in-flight work before removing
  files and in-memory indexes.

## GNOME Shell, GJS, and GSettings

- [GJS documentation](https://gjs.guide/) and the
  [GNOME Shell extension guide](https://gjs.guide/extensions/) cover extension
  lifecycle and Shell APIs.
- [GSettings guide](https://gjs.guide/guides/gio/gsettings.html) describes
  schema definitions, compilation, and live settings.
- [Gio.Settings API](https://docs.gtk.org/gio/class.Settings.html) is the
  settings API used by the extension to observe animation and shortcut
  preferences.
- [GdkPixbuf.PixbufAnimation](https://docs.gtk.org/gdk-pixbuf/class.PixbufAnimation.html)
  decodes animated image frames.
- GdkPixbuf `get_pixels()` exposes frame data as a byte array accepted by
  Cogl's introspected upload methods.
- [Cogl pixel formats](https://mutter.gnome.org/cogl/enum.PixelFormat.html)
  define the byte ordering used to transfer RGB/RGBA data.
- [Clutter actor content scaling filters](https://mutter.gnome.org/clutter/method.Actor.set_content_scaling_filters.html)
  control how the shared image is sampled by actors.
- [GLib main loop](https://docs.gtk.org/glib/main-loop.html) provides the
  animator's shared tick source.

The extension is loaded into GNOME Shell and therefore runs on the compositor
main thread. For each distinct emote, the animator shares one `Cogl.Texture2D`
through `Clutter.TextureContent`, updates its data with GdkPixbuf-scaled frame
bytes, and invalidates the content so actors repaint. The GPU draws the image;
JavaScript does not loop over individual pixels. One timer, a cap on distinct
active animations, and pause gates bound runtime work. API introspection and
syntax checks do not replace testing inside the target GNOME Shell session.

## D-Bus and process communication

- [GJS D-Bus guide](https://gjs.guide/guides/gio/dbus.html) explains exported
  names, signals, and subscriptions.
- [D-Bus specification](https://dbus.freedesktop.org/doc/dbus-specification.html)
  defines the session bus and signal model.
- [`dbus-next`](https://github.com/dbusjs/node-dbus-next) is the Node library
  used by Electron main to own the StreamShell session-bus name and emit
  signals.

Chat messages and overlay settings travel from Electron main to the extension
as D-Bus signals. Renderer requests instead cross the Electron preload bridge
using IPC. GSettings is owned and consumed by GNOME; Electron does not write
the extension's GSettings values directly.

## Electron and renderer

- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
  describes the main/renderer separation.
- [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
  explains the narrow preload API boundary.
- [Vite](https://vite.dev/guide/) and [electron-vite](https://electron-vite.org/)
  provide the development/build workflow.
- [MDN `Navigator.language`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/language)
  documents the locale source used by the renderer.
- [GLib `get_language_names`](https://docs.gtk.org/glib/func.get_language_names.html)
  documents the locale source used by the extension.

The renderer and extension maintain separate translation dictionaries because
they execute in separate processes and use different locale sources.
