# Component Architecture

This diagram illustrates the macro-level structure of StreamShell. It shows how the Node.js/Electron backend handles the heavy lifting (network, API, IRC) and communicates with the lightweight GNOME Shell extension via native Linux IPC (D-Bus and GSettings).

```mermaid
graph TD
    subgraph Twitch [Twitch Cloud]
        API[Helix API]
        IRC[Chat WebSocket]
    end

    subgraph ElectronApp [StreamShell Backend]
        UI[React/TSX UI]
        TwitchClient[Twitch Motor]
        DBusOut[D-Bus Emitter]
        ConfigOut[GSettings Manager]
    end

    subgraph LinuxOS [Linux OS]
        DBus[(D-Bus Session)]
        GSettings[(GSettings Registry)]
    end

    subgraph GnomeShell [StreamShell Frontend]
        DBusIn[D-Bus Listener]
        ConfigIn[GSettings Observer]
        Renderer[Clutter/St Renderer]
    end

    IRC --> TwitchClient
    API --> TwitchClient
    TwitchClient --> DBusOut
    UI --> ConfigOut

    DBusOut -- "Signal: NewMessage" --> DBus
    ConfigOut -- "Exec: gsettings set" --> GSettings

    DBus --> DBusIn
    GSettings --> ConfigIn

    DBusIn --> Renderer
    ConfigIn --> Renderer
```
