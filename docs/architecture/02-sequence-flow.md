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
interactive chat, clickable profiles, animation, history, and the global
shortcut are consumed by the extension.
Refer to [deployment and use cases](./05-deployment-and-use-cases.md) for the
process boundary and [runtime states](./04-runtime-pipelines-and-states.md)
for lifecycle constraints.

## Twitch account sign-in

```mermaid
sequenceDiagram
    actor User
    participant Main as Electron main
    participant Auth as Twitch OAuth
    participant Browser as System browser
    participant UI as React panel
    participant Store as Electron safeStorage

    Main->>Store: Load encrypted token if present
    opt Saved token exists
        Main->>Auth: Validate saved token
    end
    Main-->>UI: Publish optional account status
    Note over User,UI: Channel chat remains available anonymously
    opt User chooses to sign in from Settings
        Main->>Auth: Request device code and scopes
        Auth-->>Main: Return user code, verification URI, interval, expiry
        Main-->>UI: Publish code and clickable activation link
        User->>Browser: Open twitch.tv/activate and enter code
        Browser->>Auth: Authorize requested scopes
        loop Respect Twitch polling interval
            Main->>Auth: Poll device-code token endpoint
            Auth-->>Main: authorization_pending or tokens
        end
        Main->>Auth: Validate access token
        Auth-->>Main: Account identity and expiry
        Main->>Store: Encrypt and persist token
        Main-->>UI: Publish username/authentication status (never token)
    end
```

The device flow does not open the browser automatically or use a redirect
listener. Access tokens are refreshed with Twitch's rotating, one-time-use
refresh tokens; each replacement is persisted before continuing. The Client
Secret is not part of the public desktop login flow.

## Optional overlay interactions

```mermaid
sequenceDiagram
    actor User
    participant Ext as GNOME overlay
    participant Bus as Session D-Bus
    participant Main as Electron main
    participant IRC as Authenticated Twitch IRC
    participant Helix as Twitch Helix
    participant Cache as Local image cache

    opt Interactive chat is enabled
        User->>Ext: Enter message and press Enter
        Ext->>Bus: SendChatMessage(text)
        Bus->>Main: Validate setting, account, channel, and text
        Main->>IRC: Send message
        IRC-->>Main: Message echo
        Main-->>Ext: Publish normal chat message
    end
    opt Clickable profiles are enabled
        User->>Ext: Click username
        Ext->>Bus: GetUserProfile(login)
        Bus->>Main: Resolve profile and filter retained session log
        Main->>Helix: Look up public profile
        Helix-->>Main: Display name, avatar URL, description
        Main->>Cache: Cache avatar locally
        Main-->>Ext: Profile details, local image path, bounded messages
    end
```

Both interaction settings are off by default. Profile messages use the
existing capped in-memory channel history and are searched on click; there is
no per-user index or public historical chat log.
