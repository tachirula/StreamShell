# Deployment and user use cases

This document adds deployment and use-case views to the component, message
sequence, class/data, activity, and state-machine diagrams. It describes the
Linux desktop deployment target; StreamShell does not run the overlay inside
the Twitch website or Electron renderer.

## UML deployment diagram

```plantuml
@startuml
skinparam componentStyle rectangle

node "Linux desktop" {
  node "User session" {
    node "Electron application" as electron {
      artifact "React control panel" as renderer
      artifact "Preload bridge" as preload
      artifact "Electron main process" as main
      database "preferences.json\n(Electron userData)" as prefs
      database "Image cache\n(XDG_CACHE_HOME or ~/.cache)" as imageCache
      database "Avatar cache\n(renderer localStorage)" as avatarCache
    }

    node "GNOME Shell process" as shell {
      artifact "chat-overlay@test\nextension.js" as extension
      artifact "animator.js" as animator
      artifact "GSettings schema\nXML + compiled schema" as schema
    }

    database "GSettings values\n(dconf)" as gsettings
    cloud "D-Bus session bus" as dbus
  }
}

cloud "Twitch" as twitch {
  component "IRC WebSocket" as irc
  component "Helix API" as helix
}

cloud "Third-party emote providers" as providers {
  component "BTTV" as bttv
  component "FFZ" as ffz
  component "7TV" as seventv
}

renderer --> preload : contextBridge API
preload --> main : Electron IPC
main --> prefs : validated preferences
renderer --> avatarCache : cached avatar metadata
main --> imageCache : downloaded image assets
main --> irc : chat messages
main --> helix : user identity and badges
main --> bttv : optional catalog and CDN
main --> ffz : optional catalog and CDN
main --> seventv : optional catalog and CDN
main --> dbus : owns name and emits signals
dbus --> extension : chat and settings signals
extension --> schema : schema lookup
extension <--> gsettings : read/update extension values
extension --> animator : local animation module
extension --> imageCache : render local image files

note right of shell
  On Wayland, Shell does not hot-reload
  extension code or newly added schema keys.
  A logout/login loads these updates.
end note
@enduml
```

The Electron app and GNOME Shell extension are separate processes in the same
user session. The extension reads downloaded image files by local path; it
does not download them itself. The session bus is the runtime bridge, while
settings are persisted through the relevant owner: Electron `userData` for
app preferences and GSettings for extension settings.

## UML use-case diagram

```plantuml
@startuml
left to right direction

actor "Streamer / viewer" as User
actor "Twitch" as Twitch
actor "Third-party emote APIs" as EmoteAPIs
actor "GNOME Shell" as Shell

rectangle "StreamShell" {
  usecase "Connect to channel" as Connect
  usecase "Load channel badge and\nemote catalogs" as Catalogs
  usecase "View live chat overlay" as ViewChat
  usecase "View badges, replies,\nand emotes" as RichChat
  usecase "Browse recent session\nmessages" as History
  usecase "Toggle overlay visibility" as Toggle
  usecase "Configure emote quality\nand download concurrency" as Assets
  usecase "Enable or disable\nthird-party emote APIs" as ThirdParty
  usecase "Configure animation\nand overlay behavior" as OverlayPrefs
  usecase "Record or clear\nglobal shortcut" as Shortcut
  usecase "Clear image cache\n(while disconnected)" as ClearCache
}

User --> Connect
User --> ViewChat
User --> History
User --> Toggle
User --> Assets
User --> ThirdParty
User --> OverlayPrefs
User --> Shortcut
User --> ClearCache
Twitch --> Connect
Twitch --> Catalogs
Twitch --> ViewChat
EmoteAPIs --> Catalogs
Shell --> ViewChat
Shell --> Toggle

ViewChat ..> RichChat : <<include>>
Connect ..> Catalogs : <<include>>
@enduml
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
