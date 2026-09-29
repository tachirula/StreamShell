import St from 'gi://St';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const WIDTH = 340;
const MARGIN = 16;
const MAX_LINES = 8;

const TWITCH_COLORS = [
    '#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50',
    '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E',
    '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'
];

export default class ChatOverlayTest extends Extension {
    enable() {
        this._n = 0;
        this._lines = [];

        this._box = new St.BoxLayout({
            vertical: true,
            reactive: false,
            can_focus: false,
            track_hover: false,
            width: WIDTH,
            style: 'background-color: rgba(0,0,0,0.35); border-radius: 12px; padding: 12px;',
        });
        
        this._label = new St.Label({
            style: 'color: white; font-size: 16px;',
        });

        // Inicializamos con set_markup
        this._label.get_clutter_text().set_markup('<b>Chat de prueba</b>');
        
        this._box.add_child(this._label);
        Main.uiGroup.add_child(this._box);

        this._reposition();
        this._startupId = Main.layoutManager.connect('startup-complete', () => this._reposition());
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._reposition());

        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this._n++;
            
            const color = TWITCH_COLORS[this._n % TWITCH_COLORS.length];
            const userMarkup = `<span color="${color}"><b>usuario${this._n}</b></span>`;
            
            const rawMessage = "hola! <3"; 
            const safeMessage = GLib.markup_escape_text(rawMessage, -1);
            
            this._lines.push(`${userMarkup}: ${safeMessage}`);
            this._lines = this._lines.slice(-MAX_LINES);
            
            // Usamos set_markup en lugar de .text para que interprete los colores
            this._label.get_clutter_text().set_markup(this._lines.join('\n'));
            
            return GLib.SOURCE_CONTINUE;
        });
    }

    _reposition() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m || !this._box)
            return;
        const panelH = Math.max(Main.panel.height, 32);
        this._box.set_position(m.x + m.width - WIDTH - MARGIN, m.y + panelH + MARGIN);
    }

    disable() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = null;
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
