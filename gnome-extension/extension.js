import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Variantes de prueba del fondo: 'baseline' | 'no-radius' | 'split'
const VARIANT = 'baseline';
const BG_ALPHA = 0.35;

const WIDTH = 340;
const MARGIN = 16;
const MAX_LINES = 10;
const WAITING_MARKUP = '<b>Esperando conexión a Twitch...</b>';
const DEFAULT_COLOR = '#8A2BE2';

const BUS_NAME = 'org.streamshell.Twitch';
const OBJECT_PATH = '/org/streamshell/Twitch/Chat';
const INTERFACE = 'org.streamshell.Twitch.Chat';

export default class ChatOverlayTest extends Extension {
    enable() {
        this._lines = [];

        this._label = new St.Label({
            style: 'color: white; font-size: 16px;',
        });
        this._label.get_clutter_text().set_markup(WAITING_MARKUP);

        if (VARIANT === 'split') {
            // Fondo como actor aparte: negro sólido con opacidad del actor, texto encima.
            this._box = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                reactive: false,
                can_focus: false,
                track_hover: false,
                width: WIDTH,
            });
            const bg = new St.Widget({
                style: 'background-color: black; border-radius: 12px;',
                x_expand: true,
                y_expand: true,
                opacity: Math.round(BG_ALPHA * 255),
            });
            const content = new St.BoxLayout({
                vertical: true,
                style: 'padding: 12px;',
                x_expand: true,
                y_expand: true,
            });
            content.add_child(this._label);
            this._box.add_child(bg);
            this._box.add_child(content);
        } else {
            const radius = VARIANT === 'baseline' ? ' border-radius: 12px;' : '';
            this._box = new St.BoxLayout({
                vertical: true,
                reactive: false,
                can_focus: false,
                track_hover: false,
                width: WIDTH,
                style: `background-color: rgba(0,0,0,${BG_ALPHA});${radius} padding: 12px;`,
            });
            this._box.add_child(this._label);
        }

        Main.uiGroup.add_child(this._box);

        this._reposition();
        this._startupId = Main.layoutManager.connect('startup-complete', () => this._reposition());
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._reposition());

        this._signalId = Gio.DBus.session.signal_subscribe(
            BUS_NAME,
            INTERFACE,
            'MessageReceived',
            OBJECT_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _iface, _signal, params) => {
                const [user, color, text] = params.deepUnpack();
                this._onMessageReceived(user, color, text);
            }
        );
        console.log(`[StreamShell] VARIANT=${VARIANT} loaded, subscribed id=${this._signalId}`);
    }

    _onMessageReceived(user, color, text) {
        const safeUser = GLib.markup_escape_text(user, -1);
        const safeText = GLib.markup_escape_text(text, -1);
        const safeColor = /^#[0-9A-Fa-f]{6}$/.test(color) ? color : DEFAULT_COLOR;

        const userMarkup = `<span color="${safeColor}"><b>${safeUser}</b></span>`;

        this._lines.push(`${userMarkup}: ${safeText}`);
        this._lines = this._lines.slice(-MAX_LINES);

        if (!this._label)
            return;
        this._label.get_clutter_text().set_markup(this._lines.join('\n'));
    }

    _reposition() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m || !this._box)
            return;
        const panelH = Math.max(Main.panel.height, 32);
        this._box.set_position(m.x + m.width - WIDTH - MARGIN, m.y + panelH + MARGIN);
    }

    disable() {
        if (this._signalId)
            Gio.DBus.session.signal_unsubscribe(this._signalId);
        this._signalId = null;

        if (this._startupId)
            Main.layoutManager.disconnect(this._startupId);
        if (this._monitorsId)
            Main.layoutManager.disconnect(this._monitorsId);
        this._startupId = this._monitorsId = null;

        this._box?.destroy();
        this._box = null;
        this._label = null;
    }
}
