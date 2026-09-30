````markdown
# Runtime roles and message data model

The earlier diagram implied an inheritance hierarchy and a D-Bus proxy class
that do not exist in the implementation. This view instead documents the
module/service relationships and the message data contract. Elements marked
with stereotypes are architectural roles, not claims that each module exports
a TypeScript class.

```mermaid
classDiagram
    namespace ElectronMain {
        class MainProcess {
            <<process>>
            +connectToTwitch(channel)
            +handleDisconnect()
            +emitOverlaySignal()
        }
        class TwitchAPI {
            <<module>>
            +getUserInfo(channel)
            +getStreamerAvatar(channel)
        }
        class BadgeResolver {
            <<module>>
            +preloadBadges(broadcasterId)
            +resolveBadges(tags, broadcasterId)
        }
        class ThirdPartyCatalog {
            <<module>>
            +loadThirdPartyEmotes(channel)
            +getThirdPartyEmote(code)
        }
        class SegmentBuilder {
            <<module>>
            +buildSegments(message, emotes, options)
        }
        class ImageCache {
            <<module>>
            +cacheImage(url)
            +cacheEmote(id, mode)
        }
        class PreferencesStore {
            <<module>>
            +loadPreferences()
            +savePreferences()
        }
    }

    namespace MessagePayload {
        class MessageEnvelope {
            +user: string
            +color: string
            +payloadJson: string
        }
        class Payload {
            +badges: string[]
            +segments: Segment[]
        }
        class Segment {
            <<union>>
            +t: string
        }
        class TextSegment {
            +t: text
            +v: string
        }
        class EmoteSegment {
            +t: emote
            +path: string
            +name: string
        }
        class ReplyMetadata {
            +mentionedUser: string
            +quotedText: string
        }
    }

    namespace GnomeExtension {
        class ChatOverlay {
            <<process role>>
            +receiveMessage()
            +renderHistory()
            +toggleVisibility()
        }
        class EmoteAnimator {
            <<module>>
            +registerActor()
            +setPaused()
            +setEnabled()
            +destroy()
        }
    }

    MainProcess --> TwitchAPI : resolves user identity
    MainProcess --> BadgeResolver : resolves badges
    MainProcess --> ThirdPartyCatalog : loads/matches codes
    MainProcess --> SegmentBuilder : builds message segments
    MainProcess --> PreferencesStore : persists settings
    BadgeResolver --> ImageCache : caches badge images
    SegmentBuilder --> ImageCache : caches Twitch / third-party images
    SegmentBuilder ..> ThirdPartyCatalog : looks up whole-word codes
    MainProcess --> MessageEnvelope : emits over D-Bus
    MessageEnvelope *-- Payload
    Payload *-- Segment
    Payload o-- "0..1" ReplyMetadata : reply
    Segment <|-- TextSegment
    Segment <|-- EmoteSegment
    ChatOverlay --> MessageEnvelope : decodes signal payload
    ChatOverlay --> EmoteAnimator : registers animated actors
```

## Data and lifecycle ownership

| Data | Owner | Lifetime |
|---|---|---|
| Preferences | Electron main | Persistent in Electron `userData` |
| Image files and missing-animation markers | Electron image cache | Persistent in the platform cache directory |
| Avatar lookup cache | Renderer local storage | Persistent and separate from the image cache |
| Twitch client, broadcaster ID, badge indexes, third-party catalog, message chain | Electron main | Process/channel session |
| Chat history | Electron main | In memory, capped at 500; reset for channel change/disconnect |
| Overlay actors, scroll position, visibility, animator state | GNOME extension | Extension/backend session |
| Animation and shortcut settings | GNOME GSettings | GNOME user settings |

The D-Bus wire signature for a live message remains a tuple of strings. The
third string is JSON with badge paths, segment records, and optional reply
metadata. The class view uses the implementation's conceptual contract fields;
it does not imply a separate runtime `MessageEnvelope` class. Do not treat the
JSON as a generic Pango markup string: the extension creates actors from
validated local paths and text values.
````
