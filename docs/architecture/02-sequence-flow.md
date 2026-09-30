# Message and settings sequences

## Live message: IRC to overlay

This sequence includes the asynchronous work that must finish before a message
is emitted, while preserving the order in which Twitch delivered messages.

```mermaid
sequenceDiagram
    actor Viewer as Twitch viewer
    participant IRC as Twitch IRC / tmi.js
    participant Main as Electron main
    participant Helix as Twitch Helix
    participant Catalog as Third-party APIs
    participant Cache as Image cache and download queue
    participant Bus as Session D-Bus
    participant Ext as GNOME extension
    participant Animator as EmoteAnimator

    Viewer->>IRC: Send chat message
    IRC->>Main: message(channel, tags, text)
    Main->>Main: Append work to messageChain
    Note over Main: Chain serializes messages in IRC arrival order
    par Resolve badge assets
        Main->>Helix: Resolve badge IDs (catalog cached after JOIN)
        Helix-->>Main: Badge image URLs
    and Parse Twitch emotes
        Main->>Main: Parse emotes tag as Unicode code-point ranges
        Main->>Cache: Resolve native Twitch image variants
        Cache-->>Main: Local image paths or text fallback
    and Prepare third-party matches
        Main->>Main: Wait for active channel catalog readiness
        Note over Main: BTTV / FFZ / 7TV are optional and preference-gated
    end
    Main->>Main: Match third-party codes as whole words
    Main->>Cache: Download/deduplicate matched images (bounded concurrency)
    Cache-->>Main: Local image paths or text fallback
    Main->>Main: Build badges + segments + optional reply JSON
    Main->>Bus: MessageReceived(user, color, payload JSON)
    Bus-->>Ext: Deliver signal
    Ext->>Ext: Validate payload and local paths
    Ext->>Ext: Create row, badges, reply line, and wrapped content
    Ext->>Animator: Register animated actors when available
    Ext-->>Viewer: Render message in overlay
```

If an asset is unavailable, the segmenter keeps its emote code as text. If the
extension cannot build the rich row, it renders a text fallback. These fallbacks
preserve message content and do not retry by issuing network requests from
GNOME Shell.

## Preference update: panel to extension

```mermaid
sequenceDiagram
    actor User
    participant UI as React settings panel
    participant Preload as Preload API
    participant Main as Electron main
    participant Store as preferences.json
    participant Bus as Session D-Bus
    participant Ext as GNOME extension
    participant Settings as GSettings

    User->>UI: Change a preference
    UI->>Preload: Save preference
    Preload->>Main: preferences:set IPC
    Main->>Main: Validate value and update runtime services
    Main->>Store: Persist preferences
    Main->>Bus: OverlaySettingsChanged(JSON)
    Bus-->>Ext: Deliver settings update
    Ext->>Settings: Update supported extension values
    Settings-->>Ext: changed signal
    Ext->>Ext: Apply setting / re-register shortcut
```

Not every app preference belongs to GNOME. For example, download concurrency
and third-party catalog support are backend settings; overlay appearance,
animation, history, and the global shortcut are consumed by the extension.
Refer to [deployment and use cases](./05-deployment-and-use-cases.md) for the
process boundary and [runtime states](./04-runtime-pipelines-and-states.md)
for lifecycle constraints.
