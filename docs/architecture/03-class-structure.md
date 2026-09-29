# Class Structure

This diagram shows the internal object structure. It highlights how the main GNOME extension class inherits from the native module and instantiates proxy objects to listen to the Electron manager.

```mermaid
classDiagram
    class Extension {
        +enable()
        +disable()
    }

    class ChatOverlayTest {
        -_box : St.BoxLayout
        -_label : St.Label
        -_dbusProxy : Gio.DBusProxy
        -_settings : Gio.Settings
        +enable()
        +disable()
        -_reposition()
        -_onMessageReceived()
        -_onSettingsChanged()
    }

    class ElectronManager {
        -twitchClient
        -dbusService
        +connectToTwitch()
        +handleTwitchMessage()
        +emitDBusSignal()
        +updateGSettings()
    }

    Extension <|-- ChatOverlayTest
    ChatOverlayTest *-- Gio_Settings
    ChatOverlayTest *-- Gio_DBusProxy
    ElectronManager ..> Gio_DBusProxy : Emits signals to
    ElectronManager ..> Gio_Settings : Writes values to
```
