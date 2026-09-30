import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// --- i18n (minimal, extension-side) -----------------------------------------
// GNOME extensions traditionally use gettext with .po/.mo files under
// locale/<lang>/LC_MESSAGES/<uuid>.mo. That's the right long-term path once
// we package as .deb, but for now a tiny dictionary keeps things self-
// contained and avoids pulling in the gettext toolchain during dev.

const TRANSLATIONS = {
    en: {
        waiting: '<b>Waiting for Twitch connection...</b>',
    },
    es: {
        waiting: '<b>Esperando conexión a Twitch...</b>',
    },
};

function detectLocale() {
    // GLib returns e.g. ['es_AR.UTF-8', 'es_AR', 'es', 'en_US.UTF-8', 'C']
    const names = GLib.get_language_names();
    for (const name of names) {
        const short = name.split(/[._]/)[0].toLowerCase();
        if (TRANSLATIONS[short]) return short;
    }
    return 'en';
}

const LOCALE = detectLocale();
const T = (key) => TRANSLATIONS[LOCALE][key] ?? TRANSLATIONS.en[key] ?? key;

const WAITING_MARKUP = T('waiting');
// ----------------------------------------------------------------------------

const BG_ALPHA = 0.35;

const WIDTH = 340;
const PADDING = 12;
const ROW_WIDTH = WIDTH - PADDING * 2;
const MARGIN = 16;
const MAX_LINES = 10;
const DEFAULT_COLOR = '#8A2BE2';

const FONT_SIZE = 16;
const BADGE_SIZE = 18;
const EMOTE_SIZE = 24;
// A single "word" longer than this (URLs, spam) is split so it can't
// overflow the box.
const MAX_WORD_LEN = 28;

const BUS_NAME = 'org.streamshell.Twitch';
const OBJECT_PATH = '/org/streamshell/Twitch/Chat';
const INTERFACE = 'org.streamshell.Twitch.Chat';

export default class ChatOverlayTest extends Extension {
    enable() {
        this._box = null;
        this._label = null;      // "waiting" placeholder
        this._linesBox = null;   // vertical container of message rows
        this._signalId = null;
        this._clearSignalId = null;
        this._nameWatchId = null;

        // Reposicionamiento — siempre conectado, es barato.
        this._startupId = Main.layoutManager.connect('startup-complete', () => this._reposition());
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._reposition());

        // Ocultar durante Activities Overview (bug de alpha compositing).
        this._overviewShowingId = Main.overview.connect('showing', () => {
            if (this._box) this._box.hide();
        });
        this._overviewHidingId = Main.overview.connect('hiding', () => {
            if (this._box) this._box.show();
        });

        // Suscripción al signal D-Bus de mensajes.
        // El tercer argumento ahora es un JSON: {"badges":[...],"segments":[...]}
        this._signalId = Gio.DBus.session.signal_subscribe(
            BUS_NAME,
            INTERFACE,
            'MessageReceived',
            OBJECT_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _iface, _signal, params) => {
                const [user, color, payload] = params.deepUnpack();
                this._onMessageReceived(user, color, payload);
            }
        );

        // Suscripción al signal de reseteo. El backend lo emite cuando
        // el usuario conecta a un canal nuevo o pulsa "Cancelar conexión".
        this._clearSignalId = Gio.DBus.session.signal_subscribe(
            BUS_NAME,
            INTERFACE,
            'ChatCleared',
            OBJECT_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            () => this._onChatCleared()
        );

        // Observar la presencia del backend Electron en el bus de sesión.
        this._nameWatchId = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            BUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            () => this._onBackendAppeared(),
            () => this._onBackendVanished()
        );

        console.log(`[StreamShell] enabled, watching ${BUS_NAME}`);
    }

    _onBackendAppeared() {
        console.log('[StreamShell] backend detected, showing overlay');
        this._showBox();
    }

    _onBackendVanished() {
        console.log('[StreamShell] backend gone, hiding overlay');
        this._hideBox();
    }

    _onChatCleared() {
        console.log('[StreamShell] chat cleared');
        if (this._linesBox)
            this._linesBox.destroy_all_children();
        if (this._label)
            this._label.show();
    }

    _buildBox() {
        const label = new St.Label({
            style: `color: white; font-size: ${FONT_SIZE}px;`,
        });
        label.get_clutter_text().set_markup(WAITING_MARKUP);

        const linesBox = new St.BoxLayout({
            vertical: true,
            reactive: false,
            style: 'spacing: 4px;',
        });

        const box = new St.BoxLayout({
            vertical: true,
            reactive: false,
            can_focus: false,
            track_hover: false,
            width: WIDTH,
            style: `background-color: rgba(0,0,0,${BG_ALPHA}); border-radius: 12px; padding: ${PADDING}px;`,
        });
        box.add_child(label);
        box.add_child(linesBox);

        return {box, label, linesBox};
    }

    _showBox() {
        if (this._box) return;

        const {box, label, linesBox} = this._buildBox();
        this._box = box;
        this._label = label;
        this._linesBox = linesBox;

        Main.uiGroup.add_child(this._box);

        // Si el overview está abierto justo ahora, nace oculto.
        if (Main.overview.visible) {
            this._box.hide();
        }

        this._reposition();
    }

    _hideBox() {
        if (!this._box) return;
        this._box.destroy();
        this._box = null;
        this._label = null;
        this._linesBox = null;
    }

    // --- Rendering ----------------------------------------------------------

    _makeIcon(path, size) {
        // Only accept absolute PNG paths (they come from our own backend).
        if (typeof path !== 'string' || !path.startsWith('/') || !path.endsWith('.png'))
            return null;

        return new St.Icon({
            gicon: new Gio.FileIcon({file: Gio.File.new_for_path(path)}),
            icon_size: size,
            y_align: Clutter.ActorAlign.CENTER,
        });
    }

    _makeWord(word, style) {
        return new St.Label({
            text: word,
            style,
            y_align: Clutter.ActorAlign.CENTER,
        });
    }

    _parsePayload(payload) {
        try {
            const p = JSON.parse(payload);
            return {
                badges: Array.isArray(p.badges) ? p.badges : [],
                segments: Array.isArray(p.segments) ? p.segments : [],
            };
        } catch (_e) {
            // Backend antiguo: el tercer argumento era texto plano.
            return {badges: [], segments: [{t: 'text', v: String(payload)}]};
        }
    }

    _newRow(msg) {
        const row = new St.BoxLayout({
            vertical: false,
            reactive: false,
            style: 'spacing: 4px;',
        });
        msg.add_child(row);
        return row;
    }

    // Clutter.FlowLayout is a column-aligned grid, not inline text flow, so
    // wrapping is done by hand: add a child, measure the row, and if it no
    // longer fits, move that child to a new row. `msg` must already be
    // attached to the stage so widths are measured with the real theme.
    _fillMessage(msg, user, color, payload) {
        const {badges, segments} = this._parsePayload(payload);
        const safeColor = /^#[0-9A-Fa-f]{6}$/.test(color) ? color : DEFAULT_COLOR;
        const textStyle = `color: white; font-size: ${FONT_SIZE}px;`;

        let row = this._newRow(msg);
        const add = (actor) => {
            row.add_child(actor);
            if (row.get_n_children() > 1 && row.get_preferred_width(-1)[1] > ROW_WIDTH) {
                row.remove_child(actor);
                row = this._newRow(msg);
                row.add_child(actor);
            }
        };

        for (const badgePath of badges) {
            const icon = this._makeIcon(badgePath, BADGE_SIZE);
            if (icon) add(icon);
        }

        add(this._makeWord(
            `${user}:`,
            `color: ${safeColor}; font-weight: bold; font-size: ${FONT_SIZE}px;`
        ));

        for (const seg of segments) {
            if (seg.t === 'emote') {
                const icon = this._makeIcon(seg.path, EMOTE_SIZE);
                // If the icon can't be built, fall back to the emote's name.
                if (icon) add(icon);
                else if (seg.name) add(this._makeWord(String(seg.name), textStyle));
            } else if (seg.t === 'text' && typeof seg.v === 'string') {
                for (const word of seg.v.split(/\s+/)) {
                    if (!word) continue;
                    for (let i = 0; i < word.length; i += MAX_WORD_LEN)
                        add(this._makeWord(word.slice(i, i + MAX_WORD_LEN), textStyle));
                }
            }
        }
    }

    _onMessageReceived(user, color, payload) {
        if (!this._linesBox) return;

        if (this._label) this._label.hide();

        const msg = new St.BoxLayout({
            vertical: true,
            reactive: false,
            width: ROW_WIDTH,
            style: 'spacing: 2px;',
        });
        this._linesBox.add_child(msg);

        try {
            this._fillMessage(msg, user, color, payload);
        } catch (e) {
            console.error(`[StreamShell] failed to render message: ${e}`);
            msg.destroy();
            return;
        }

        // Keep only the last MAX_LINES messages.
        const rows = this._linesBox.get_children();
        for (let i = 0; i < rows.length - MAX_LINES; i++)
            rows[i].destroy();
    }

    _reposition() {
        if (!this._box) return;
        const m = Main.layoutManager.primaryMonitor;
        if (!m) return;
        const panelH = Math.max(Main.panel.height, 32);
        this._box.set_position(m.x + m.width - WIDTH - MARGIN, m.y + panelH + MARGIN);
    }

    disable() {
        if (this._overviewShowingId) Main.overview.disconnect(this._overviewShowingId);
        if (this._overviewHidingId) Main.overview.disconnect(this._overviewHidingId);
        this._overviewShowingId = this._overviewHidingId = null;

        if (this._signalId)
            Gio.DBus.session.signal_unsubscribe(this._signalId);
        this._signalId = null;

        if (this._clearSignalId)
            Gio.DBus.session.signal_unsubscribe(this._clearSignalId);
        this._clearSignalId = null;

        if (this._nameWatchId) {
            Gio.bus_unwatch_name(this._nameWatchId);
            this._nameWatchId = null;
        }

        if (this._startupId)
            Main.layoutManager.disconnect(this._startupId);
        if (this._monitorsId)
            Main.layoutManager.disconnect(this._monitorsId);
        this._startupId = this._monitorsId = null;

        this._hideBox();
    }
}