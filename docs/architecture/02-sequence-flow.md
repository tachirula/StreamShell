# Message Sequence Flow

This sequence diagram details the critical path of a chat message. It maps the journey from the moment a viewer types in Twitch, through the Electron backend sanitization, across the D-Bus system, and finally rendering on the GNOME OverlayGroup (bypassing full-screen games).

```mermaid
sequenceDiagram
    actor Viewer as Twitch Viewer
    participant Twitch as IRC Server
    participant Electron as StreamShell (Electron)
    participant DBus as D-Bus (Linux OS)
    participant Gnome as GNOME Extension
    participant Clutter as OverlayGroup (Screen)

    Viewer->>Twitch: Types a chat message
    activate Twitch
    Twitch->>Electron: WSS Event (color, text, emotes)
    deactivate Twitch

    activate Electron
    Electron->>Electron: Extracts color, caches emotes
    Electron->>DBus: Emit Signal(user, color, text)
    deactivate Electron

    activate DBus
    DBus->>Gnome: Triggers DBus Listener
    deactivate DBus

    activate Gnome
    Gnome->>Gnome: GLib.markup_escape_text()
    Gnome->>Gnome: Applies Pango Markup (span tags)
    Gnome->>Clutter: clutter_text.set_markup()
    deactivate Gnome

    activate Clutter
    Clutter->>Clutter: Relayout / Recalculate Box
    Clutter-->>Viewer: Render text over fullscreen app
    deactivate Clutter
```
