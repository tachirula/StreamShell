# Deployment and user use cases

This document adds deployment and use-case views to the component, message
sequence, class/data, activity, and state-machine diagrams. It describes the
Linux desktop deployment target; StreamShell does not run the overlay inside
the Twitch website or Electron renderer.

## UML deployment diagram

```mermaid
flowchart LR
  subgraph Desktop["Linux desktop"]
    subgraph Session["User session"]
      subgraph Electron["Electron application"]
        renderer["React control panel"]
        preload["Preload bridge"]
        main["Electron main process"]
        prefs[("preferences.json<br/>(Electron userData)")]
        imageCache[("Image cache<br/>(XDG_CACHE_HOME or ~/.cache)")]
        avatarCache[("Avatar cache<br/>(renderer localStorage)")]
      end

      subgraph Shell["GNOME Shell process"]
        extension["chat-overlay@test<br/>extension.js"]
        animator["animator.js"]
        schema["GSettings schema<br/>XML + compiled schema"]
      end

      gsettings[("GSettings values<br/>(dconf)")]
      dbus(["☁ D-Bus session bus"])
    end
  end

  subgraph Twitch["☁ Twitch"]
    irc["IRC WebSocket"]
    helix["Helix API"]
  end

  subgraph Providers["☁ Third-party emote providers"]
    bttv["BTTV"]
    ffz["FFZ"]
    seventv["7TV"]
  end

  ShellNote["Note: On Wayland, Shell does not hot-reload<br/>extension code or newly added schema keys.<br/>A logout/login loads these updates."]

  renderer -->|contextBridge API| preload
  preload -->|Electron IPC| main
  main -->|validated preferences| prefs
  renderer -->|cached avatar metadata| avatarCache
  main -->|downloaded image assets| imageCache
  main -->|chat messages| irc
  main -->|user identity and badges| helix
  main -->|optional catalog and CDN| bttv
  main -->|optional catalog and CDN| ffz
  main -->|optional catalog and CDN| seventv
  main -->|owns name and emits signals| dbus
  dbus -->|chat and settings signals| extension
  extension -->|schema lookup| schema
  extension <-->|read/update extension values| gsettings
  extension -->|local animation module| animator
  extension -->|render local image files| imageCache
  Shell -.- ShellNote
```

The Electron app and GNOME Shell extension are separate processes in the same
user session. The extension reads downloaded image files by local path; it
does not download them itself. The session bus is the runtime bridge, while
settings are persisted through the relevant owner: Electron `userData` for
app preferences and GSettings for extension settings.

## UML use-case diagram

```mermaid
flowchart LR
  User["Streamer / viewer"]
  Twitch["Twitch"]
  EmoteAPIs["Third-party emote APIs"]
  Shell["GNOME Shell"]

  subgraph System["StreamShell"]
    Connect(["Connect to channel"])
    Catalogs(["Load channel badge and<br/>emote catalogs"])
    ViewChat(["View live chat overlay"])
    RichChat(["View badges, replies,<br/>and emotes"])
    History(["Browse recent session<br/>messages"])
    Toggle(["Toggle overlay visibility"])
    Assets(["Configure emote quality<br/>and download concurrency"])
    ThirdParty(["Enable or disable<br/>third-party emote APIs"])
    OverlayPrefs(["Configure animation<br/>and overlay behavior"])
    Shortcut(["Record or clear<br/>global shortcut"])
    ClearCache(["Clear image cache<br/>(while disconnected)"])
  end

  User --- Connect
  User --- ViewChat
  User --- History
  User --- Toggle
  User --- Assets
  User --- ThirdParty
  User --- OverlayPrefs
  User --- Shortcut
  User --- ClearCache
  Twitch --- Connect
  Twitch --- Catalogs
  Twitch --- ViewChat
  EmoteAPIs --- Catalogs
  Shell --- ViewChat
  Shell --- Toggle

  ViewChat -.->|"«include»"| RichChat
  Connect -.->|"«include»"| Catalogs
```

The global shortcut is registered by GNOME Shell, so it can toggle the overlay
without Electron having focus. Super/Windows is reserved, and some key
combinations may be intercepted by the desktop environment. Cache clearing is
not available while a Twitch session is connected.

## Applying the diagrams

- On **X11 and Wayland**, Electron and the extension communicate over the same
  session bus. On Wayland, extension code/schema changes require a new Shell
  session; ordinary preference changes are live after the extension has loaded
  the relevant schema keys.
- A missing external provider or network path affects catalog/image loading,
  not extension deployment. Emote text remains visible when an image cannot be
  resolved.
- The deployment does not include a remote server or a persistent chat
  database. Message history is bounded in-memory session state.
