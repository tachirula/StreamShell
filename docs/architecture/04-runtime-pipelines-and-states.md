# Runtime pipelines and state machines

This document covers two critical areas not visible in the component view:
the asynchronous message/asset path and the state conditions controlling the
overlay and animated emotes.

## UML activity: ordered message delivery

After JOIN, broadcaster lookup starts badge preload and optional third-party
catalog loading concurrently. The BTTV, FFZ, and 7TV requests also run
concurrently, each with a 15-second request timeout. Messages wait for the
third-party catalog-loading task to settle before segment construction.

```plantuml
@startuml
start

partition "Electron main" {
  :Receive IRC message and tags;
  :Append to messageChain;
  :Wait for thirdPartyEmotesReady;
  fork
    :Resolve badge IDs to cached/local image paths;
  fork again
    :Parse Twitch emote code-point ranges;
    :Match third-party codes as whole words;
    :Resolve images via FIFO workers\n(configured concurrency);
    if (Image asset available?) then (yes)
      :Use local image path;
    else (no)
      :Keep emote code as text;
    endif
  end fork
  :Build JSON payload with badges,\nsegments, and optional reply metadata;
  :Emit MessageReceived(user, color, JSON);
}

partition "GNOME extension" {
  :Receive D-Bus signal;
  :Validate payload and local paths;
  :Build reply line, badge row,\ntext, and emote actors;
  if (Rich layout succeeds?) then (yes)
    :Render wrapped message row;
  else (no)
    :Render readable text fallback;
  endif
}

stop
@enduml
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
