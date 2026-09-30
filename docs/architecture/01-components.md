# Component architecture

StreamShell is a multi-process Linux application. The Electron main process
owns networking and application state; the renderer is a control surface; and
the GNOME Shell extension owns on-screen chat rendering. The session bus is the
boundary between Electron and GNOME.

```plantuml
@startuml
skinparam componentStyle rectangle

cloud "Twitch" {
  component "IRC chat\nWebSocket" as IRC
  component "Helix API\nusers and badges" as Helix
}
cloud "BTTV / FFZ / 7TV\ncatalog APIs and CDNs" as Catalogs

package "Electron application" {
  component "React renderer\nsettings and connection UI" as UI
  component "Preload API\nnarrow context bridge" as Preload
  component "Electron main\nTwitch session, ordering,\npreferences and D-Bus" as Main
  component "chat-segments\nTwitch ranges, third-party words,\nreply metadata" as Segmenter
  component "twitch-badges\ncatalog and resolver" as Badges
  component "third-party-emotes\nper-channel catalog" as ThirdParty
  component "emote-cache\nbounded downloads and disk cache" as Cache
  component "preferences\nvalidation and userData persistence" as Prefs
}

node "Linux user session" {
  component "D-Bus session bus" as Bus
  component "GSettings API" as GSettings

  package "GNOME Shell extension" {
    component "extension.js\nlifecycle, overlay, history,\nsettings and keybinding" as Extension
    component "animator.js\nshared animated frames" as Animator
    component "St / Clutter actors\nmessage rows and icons" as Actors
  }
}

UI <--> Preload : typed IPC API
Preload <--> Main : Electron IPC
Main --> Segmenter
Main --> Badges
Main --> ThirdParty
Segmenter --> Cache : resolve image
Badges --> Cache : cache badge image
Cache ..> Segmenter : return local paths
Cache ..> Badges : return local paths
Segmenter --> ThirdParty : whole-word code lookup
Main --> Prefs
IRC --> Main : chat messages
Helix --> Main : broadcaster and badge data
ThirdParty --> Catalogs : load catalogs
Cache --> Catalogs : fetch emote assets
Main --> Bus : MessageReceived, ChatCleared,\nHistoryMessageReceived,\nOverlaySettingsChanged
Bus --> Extension : signals
Extension <--> GSettings : read, update, observe
Extension --> Animator
Extension --> Actors
Animator --> Actors
@enduml
```

## Ownership and boundaries

- **Renderer:** channel input, connection status, preferences UI, avatar display,
  and user feedback. It does not parse IRC or render chat messages.
- **Preload:** exposes only the app operations and event subscriptions required
  by the renderer; it does not expose raw Node or D-Bus objects.
- **Electron main:** owns the Twitch client, message-ordering chain, in-memory
  chat history, preference validation/persistence, asset downloads, and
  D-Bus signal emission.
- **GNOME extension:** creates/destroys the overlay as the backend bus name
  appears or vanishes, lays out message content, manages history navigation
  and visibility, and bridges D-Bus settings updates to GSettings.
- **Animator:** runs in GNOME Shell, not Electron. It decodes local animated
  assets and coordinates frame redraws with overlay visibility.

Chat payloads and image paths cross D-Bus. Image bytes and HTTP requests stay
in Electron. GSettings belongs to GNOME Shell; Electron does not modify its
registry directly.

## Main D-Bus contract

The main process owns `org.streamshell.Twitch` and exports the chat interface
at `/org/streamshell/Twitch/Chat`. Signals used by the overlay include:

| Signal | Purpose |
|---|---|
| `MessageReceived` | One live message, including author, color, and JSON-encoded badges/segments/reply data |
| `ChatCleared` | Reset visible/session chat state on a new channel or disconnect |
| `HistoryMessageReceived` | Replay an in-memory message while the user navigates history |
| `OverlaySettingsChanged` | Send overlay-related preferences to the extension |

The third `MessageReceived` argument remains a string at the D-Bus type level;
its JSON payload is an application-level contract. Keep the sender, extension
parser, and these docs in sync when changing that shape.

## Failure containment

- Failed catalog or image requests degrade emotes to text or a static asset;
  they do not move network retrieval into GNOME.
- A malformed rich payload or row-layout failure falls back to readable text.
- If the session-bus service cannot initialize, the control panel can still
  start, but the GNOME overlay bridge is unavailable; the backend logs the
  setup failure.
- When the Electron bus name disappears, the extension hides the overlay and
  releases session-owned UI state.
