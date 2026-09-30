# StreamShell Documentation & Research

This document serves as the research log, tracking official documentation, technical decisions, and API references used to build StreamShell.

## 1. Twitch Developer (Chat & APIs)
- **Twitch IRC (WebSockets):** Standard protocol for reading live chat and parsing tags. [Official Docs](https://dev.twitch.tv/docs/irc/)
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