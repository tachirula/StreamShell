# StreamShell Documentation & Research

This document serves as the research log, tracking official documentation, technical decisions, and API references used to build StreamShell.

## 1. Twitch Developer (Chat & APIs)
- **Twitch IRC (WebSockets):** Standard protocol for reading live chat and parsing tags. [Official Docs](https://dev.twitch.tv/docs/irc/)
- **IRC Tags Reference:** Every chat message carries metadata (badges, color, display-name, emotes, ...). [Tags Reference](https://dev.twitch.tv/docs/irc/tags/)
- **Twitch EventSub:** Recommended alternative for advanced event tracking. [EventSub Docs](https://dev.twitch.tv/docs/eventsub/)
- **Twitch API Reference:** General endpoint reference for Helix. [API Reference](https://dev.twitch.tv/docs/api/reference)
- **Channel Emotes API:** Used to fetch custom emote URLs and cache them locally. [Emotes Endpoint](https://dev.twitch.tv/docs/api/reference/#get-channel-emotes)

## 2. GNOME Shell, GJS & GSettings (Configuration & UI)
- **GJS Documentation Root:** Main entry point for GNOME JavaScript APIs. [GJS Docs](https://gjs-docs.gnome.org/gio20~2.0/)
- **Gio.Settings API Reference:** Low-level methods for handling extension settings. [Gio.Settings](https://gjs-docs.gnome.org/gio20~2.0/gio.settings)
- **GSettings Guide (GJS Guide):** Step-by-step documentation on defining XML schemas. [GJS GSettings Guide](https://gjs.guide/guides/gio/gsettings.html)
- **GTK Settings Reference:** Supplementary styling and configuration references. [GTK Settings](https://gjs.guide/guides/gtk/3/16-settings.html)

## 3. D-Bus IPC (Real-Time Communication)
- **Gio.DBusConnection Reference:** Native Linux Inter-Process Communication reference in JavaScript. [Gio.DBusConnection](https://gjs-docs.gnome.org/gio20~2.0/gio.dbusconnection)
- **GJS D-Bus Guide:** How to export objects and emit signals within GNOME Shell. [GJS D-Bus Guide](https://gjs.guide/guides/gio/dbus.html)

## 4. Internationalization (i18n)
- **MDN — Navigator.language:** Standard used by the renderer to detect the OS locale. [Navigator.language](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/language)
- **GLib.get_language_names():** Canonical way for GNOME Shell extensions to read the system language. [GLib Reference](https://docs.gtk.org/glib/func.get_language_names.html)
- **GNU gettext (GJS):** Planned long-term path for the extension once packaged as `.deb`. [GJS gettext Guide](https://gjs.guide/guides/gjs/internationalization.html)

## 5. Twitch Authentication & Helix (Avatar Fetching)
- **Twitch Developer Console:** Where the OAuth client (Client ID + Client Secret) is created. [Console Apps](https://dev.twitch.tv/console/apps)
- **Client Credentials Grant:** Server-to-server OAuth flow used to obtain an App Access Token. No user login required. [OAuth Docs](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#client-credentials-grant-flow)
- **Get Users Endpoint:** Helix endpoint `GET /helix/users` used to fetch `profile_image_url` for a channel. [Get Users](https://dev.twitch.tv/docs/api/reference/#get-users)
- **Rate Limits:** 800 points/min per client ID for app tokens. Plenty for our on-demand avatar lookups. [Rate Limits](https://dev.twitch.tv/docs/api/guide/#rate-limits)
- **dotenv:** Node library used to load `.env` files into `process.env` without hardcoding secrets. [dotenv](https://github.com/motdotla/dotenv)

## 6. Chat Assets — Badges and Emotes

### Badges
- **Get Global Chat Badges:** `GET /helix/chat/badges/global` — the authoritative badge list for the platform. [Endpoint](https://dev.twitch.tv/docs/api/reference/#get-global-chat-badges)
- **Get Channel Chat Badges:** `GET /helix/chat/badges?broadcaster_id={id}` — per-channel override for shared set_ids (subscriber tiers, etc.). [Endpoint](https://dev.twitch.tv/docs/api/reference/#get-channel-chat-badges)
- **Badge Tag Format:** The IRC `badges` tag only carries ids (`moderator/1`, `subscriber/12`); the images come from Helix. Documented in the IRC Tags Reference above.

### Emotes
- **Emote CDN URL Scheme:** `https://static-cdn.jtvnw.net/emoticons/v2/<id>/<format>/dark/<scale>` where format is `static` (PNG) or `animated` (GIF). This is the canonical way to build an emote URL from the id in the IRC `emotes` tag. Not formally documented as a public API, but stable and used by every third-party client.
- **IRC `emotes` tag format:** `emote_id:start-end,start-end/emote_id:...`. **Ranges are Unicode code points, not UTF-16 units** — a single emoji occupies 1 code point but 2 UTF-16 units. This is the source of the "why Array.from, not substring" comment in `chat-segments.ts`.

### Animated GIF decoding inside GNOME Shell
- **GdkPixbuf.PixbufAnimation:** Decodes animated GIFs frame by frame. [GdkPixbuf Reference](https://docs.gtk.org/gdk-pixbuf/class.PixbufAnimation.html)
- **Cairo.ImageSurface / Cairo.Context:** Where each frame is uploaded so multiple actors can share the same bitmap. [Cairo API](https://www.cairographics.org/manual/)
- **GLib.timeout_add:** Single source timer used by the animator instead of one timer per emote. [GLib Main Loop](https://docs.gtk.org/glib/main-loop.html)