# Runtime pipelines and state machines

This document covers two critical areas not visible in the component view:
the asynchronous message/asset path and the state conditions controlling the
overlay and animated emotes.

## UML activity: ordered message delivery

After JOIN, broadcaster lookup starts badge preload and optional third-party
catalog loading concurrently. The BTTV, FFZ, and 7TV requests also run
concurrently, each with a 15-second request timeout. Messages wait for the
third-party catalog-loading task to settle before segment construction.

```mermaid
flowchart TD
  Start(["Start"])

  subgraph Main["Electron main"]
    A1["Receive IRC message and tags"]
    A2["Append to messageChain"]
    A3["Wait for thirdPartyEmotesReady"]
    Fork(["Fork (parallel branches)"])

    B1["Resolve badge IDs to<br/>cached/local image paths"]

    C1["Parse Twitch emote<br/>code-point ranges"]
    C2["Match third-party codes<br/>as whole words"]
    C3["Resolve images via FIFO workers<br/>(configured concurrency)"]
    D1{"Image asset available?"}
    D2["Use local image path"]
    D3["Keep emote code as text"]

    Join(["Join"])
    E1["Build JSON payload with badges,<br/>segments, and optional reply metadata"]
    E2["Emit MessageReceived(user, color, JSON)"]
  end

  subgraph Ext["GNOME extension"]
    G1["Receive D-Bus signal"]
    G2["Validate payload and local paths"]
    G3["Build reply line, badge row,<br/>text, and emote actors"]
    H1{"Rich layout succeeds?"}
    H2["Render wrapped message row"]
    H3["Render readable text fallback"]
  end

  Stop(["End"])

  Start --> A1 --> A2 --> A3 --> Fork
  Fork --> B1
  Fork --> C1
  C1 --> C2 --> C3 --> D1
  D1 -->|yes| D2
  D1 -->|no| D3
  B1 --> Join
  D2 --> Join
  D3 --> Join
  Join --> E1 --> E2
  E2 --> G1 --> G2 --> G3 --> H1
  H1 -->|yes| H2
  H1 -->|no| H3
  H2 --> Stop
  H3 --> Stop
```

The worker count bounds simultaneous image downloads; the queue is FIFO and
same-URL requests share an in-flight promise. The 30-second abort is an idle
timeout that resets on data progress, not a total-download deadline. Separately,
`messageChain` serializes message emissions so a later fast message cannot
overtake an earlier slow one. A slow asset can therefore delay its message and
subsequent D-Bus emissions while other admitted downloads continue.

## UML state machine: extension and overlay lifecycle

The extension stays enabled when the Electron app is closed, but it creates no
visible overlay until the backend owns the session-bus name. The Overview and
the user's toggle shortcut are independent visibility gates.

```mermaid
stateDiagram-v2
    [*] --> Disabled
    Disabled --> WaitingForBackend: enable / watch D-Bus name
    WaitingForBackend --> WaitingForChat: backend appeared / create overlay
    WaitingForChat --> WaitingForChat: ChatCleared / show waiting state
    WaitingForChat --> LiveChat: MessageReceived
    LiveChat --> WaitingForChat: ChatCleared
    LiveChat --> BrowsingHistory: scroll to older messages
    BrowsingHistory --> LiveChat: jump to latest

    WaitingForChat --> UserHidden: toggle shortcut
    LiveChat --> UserHidden: toggle shortcut
    BrowsingHistory --> UserHidden: toggle shortcut
    UserHidden --> WaitingForChat: toggle shortcut / no chat
    UserHidden --> LiveChat: toggle shortcut / latest view
    UserHidden --> BrowsingHistory: toggle shortcut / restore older view

    WaitingForChat --> OverviewHidden: Activities Overview showing
    LiveChat --> OverviewHidden: Activities Overview showing
    BrowsingHistory --> OverviewHidden: Activities Overview showing
    OverviewHidden --> WaitingForChat: Overview hidden / no chat
    OverviewHidden --> LiveChat: Overview hidden / latest view
    OverviewHidden --> BrowsingHistory: Overview hidden / older history

    WaitingForChat --> WaitingForBackend: backend vanished / hide and clear
    LiveChat --> WaitingForBackend: backend vanished / hide and clear
    BrowsingHistory --> WaitingForBackend: backend vanished / hide and clear
    UserHidden --> WaitingForBackend: backend vanished / clear hidden state
    OverviewHidden --> WaitingForBackend: backend vanished / clear view state
    WaitingForBackend --> Disabled: disable extension / release signals and actors
```

Shortcut/Overview transitions are orthogonal in the implementation to the
content mode; this compact state view shows the principal transitions, not a
full Cartesian product of visibility and history states. Returning from the
Overview restores the applicable waiting/live/history view.

## UML state machine: animated emote scheduler

The extension's animator is a resource scheduler, not a per-image timer. A
single GLib source advances shared decoded animations; gates pause work when
animation should not be visible or consumed.

```mermaid
stateDiagram-v2
    [*] --> Unavailable
    Unavailable --> Idle: animator module loaded
    Idle --> Running: animated actor registered and gates clear
    Running --> Idle: last animated actor removed
    Running --> Paused: backend gone / Overview / user hidden / history browsing
    Paused --> Running: all pause gates clear and actors remain
    Idle --> Disabled: animated-emotes set false
    Running --> Disabled: animated-emotes set false / stop and rewind
    Paused --> Disabled: animated-emotes set false / stop and rewind
    Disabled --> Idle: animated-emotes set true
    Disabled --> Unavailable: extension destroyed
    Idle --> Unavailable: extension destroyed
    Running --> Unavailable: extension destroyed / remove timer and caches
    Paused --> Unavailable: extension destroyed / remove timer and caches
```

If the animator cannot load or a specific asset is unsupported, the extension
still renders a static icon where possible. The `Unavailable` state does not
disable chat rendering.

