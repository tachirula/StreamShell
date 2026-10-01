import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
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
        latest: '↓ Jump to latest',
        replyTo: 'Reply to',
    },
    es: {
        waiting: '<b>Esperando conexión a Twitch...</b>',
        latest: '↓ Ir a los nuevos',
        replyTo: 'Respuesta a',
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

const DEFAULT_CHAT_WIDTH = 340;
const PADDING = 12;
const MARGIN = 16;
const DEFAULT_MAX_VISIBLE_MESSAGES = 10;
const MESSAGE_HEIGHT = 30;
const DEFAULT_COLOR = '#8A2BE2';

const FONT_SIZE = 16;
const BADGE_SIZE = 18;
const EMOTE_SIZE = 24;
// A single "word" longer than this (URLs, spam) is split so it can't
// overflow the box.
const MAX_WORD_LEN = 28;

// Animated emotes: max distinct animated emotes at once, and the GSettings
// key that switches animation on/off.
const MAX_ANIMATED = 16;
const SETTING_ANIMATED = 'animated-emotes';
const SETTING_TOGGLE_CHAT = 'toggle-chat-shortcut';

const BUS_NAME = 'org.streamshell.Twitch';
const OBJECT_PATH = '/org/streamshell/Twitch/Chat';
const INTERFACE = 'org.streamshell.Twitch.Chat';

export default class ChatOverlayTest extends Extension {
    enable() {
        this._box = null;
        this._label = null;      // "waiting" placeholder
        this._linesBox = null;   // vertical container of message rows
        this._scrollView = null;
        this._newMessagesButton = null;
        this._signalId = null;
        this._historySignalId = null;
        this._clearSignalId = null;
        this._settingsSignalId = null;
        this._nameWatchId = null;
        this._scrollValueId = 0;
        this._scrollEventId = 0;
        this._scrollSyncSourceId = 0;
        this._alive = true;
        this._backendAvailable = false;
        this._followingLatest = true;
        this._overviewOpen = Main.overview.visible;
        this._animator = null;
        this._settings = null;
        this._settingsId = 0;
        this._chatWidth = DEFAULT_CHAT_WIDTH;
        this._maxVisibleMessages = DEFAULT_MAX_VISIBLE_MESSAGES;
        this._historyEnabled = false;
        this._historyLimit = 20;
        this._userHidden = false;
        this._toggleChatShortcut = '';
        this._keybindingRegistered = false;

        // Keep repositioning signals connected; they are inexpensive.
        this._startupId = Main.layoutManager.connect('startup-complete', () => this._reposition());
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._reposition());

        // Hide during Activities Overview (alpha compositing bug).
        this._overviewShowingId = Main.overview.connect('showing', () => {
            this._overviewOpen = true;
            if (this._box) this._box.hide();
            this._syncAnimatorPause();
        });
        this._overviewHidingId = Main.overview.connect('hiding', () => {
            this._overviewOpen = false;
            if (this._box && !this._userHidden) this._box.show();
            this._syncAnimatorPause();
        });

        // Subscribe to the D-Bus message signal.
        // The third argument is now JSON: {"badges":[...],"segments":[...]}
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

        this._historySignalId = Gio.DBus.session.signal_subscribe(
            BUS_NAME,
            INTERFACE,
            'HistoryMessageReceived',
            OBJECT_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _iface, _signal, params) => {
                const [user, color, payload] = params.deepUnpack();
                this._onMessageReceived(user, color, payload, true);
            }
        );

        this._settingsSignalId = Gio.DBus.session.signal_subscribe(
            BUS_NAME,
            INTERFACE,
            'OverlaySettingsChanged',
            OBJECT_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _iface, _signal, params) => {
                this._applyOverlaySettings(params.deepUnpack()[0]);
            }
        );

        // Subscribe to the reset signal. The backend emits it when the user
        // connects to a new channel or clicks "Cancel connection".
        this._clearSignalId = Gio.DBus.session.signal_subscribe(
            BUS_NAME,
            INTERFACE,
            'ChatCleared',
            OBJECT_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            () => this._onChatCleared()
        );

        // Watch for the Electron backend on the session bus.
        this._nameWatchId = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            BUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            () => this._onBackendAppeared(),
            () => this._onBackendVanished()
        );

        this._setupAnimator();
        this._connectSettings();

        console.log(`[StreamShell] enabled, watching ${BUS_NAME}`);
    }

    // --- Animated emotes ----------------------------------------------------

    _setupAnimator() {
        // Loaded dynamically: if something is missing in the Shell (e.g.
        // GdkPixbuf can't be imported) emotes degrade to static images
        // instead of breaking the whole extension.
        import('./animator.js').then(({EmoteAnimator}) => {
            if (!this._alive) return;
            this._animator = new EmoteAnimator({maxAnimated: MAX_ANIMATED});
            this._syncAnimatorPause();
            this._applyAnimationSetting();
        }).catch(e => {
            console.warn(`[StreamShell] animated emotes unavailable: ${e}`);
        });
    }

    _syncAnimatorPause() {
        if (this._animator)
            this._animator.setPaused(
                !this._backendAvailable ||
                this._overviewOpen ||
                this._userHidden ||
                (this._historyEnabled && !this._followingLatest)
            );
    }

    _connectSettings() {
        try {
            this._settings = this.getSettings();
        } catch (e) {
            console.warn(`[StreamShell] settings unavailable: ${e}`);
            return;
        }

        if (this._settings.settings_schema.has_key(SETTING_TOGGLE_CHAT))
            this._toggleChatShortcut = this._settings.get_strv(SETTING_TOGGLE_CHAT)[0] ?? '';

        if (this._settings.settings_schema.has_key(SETTING_ANIMATED)) {
            this._settingsId = this._settings.connect(
                `changed::${SETTING_ANIMATED}`, () => this._applyAnimationSetting());
            this._applyAnimationSetting();
        } else {
            console.warn(`[StreamShell] schema has no '${SETTING_ANIMATED}' key, animations stay on`);
        }

        if (this._settings.settings_schema.has_key(SETTING_TOGGLE_CHAT)) {
            Main.wm.addKeybinding(
                SETTING_TOGGLE_CHAT,
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => this._toggleOverlay()
            );
            this._keybindingRegistered = true;
            this._applyChatShortcutSetting();
        } else {
            console.warn(
                `[StreamShell] schema has no '${SETTING_TOGGLE_CHAT}' key; compile the schema and reload GNOME Shell`
            );
        }
    }

    _applyAnimationSetting() {
        if (!this._animator || !this._settings) return;
        this._animator.setEnabled(this._settings.get_boolean(SETTING_ANIMATED));
    }

    _applyChatShortcutSetting() {
        if (!this._settings ||
            !this._settings.settings_schema.has_key(SETTING_TOGGLE_CHAT))
            return;

        const accelerators = this._toggleChatShortcut ? [this._toggleChatShortcut] : [];
        if (this._settings.get_strv(SETTING_TOGGLE_CHAT).join('\0') !== accelerators.join('\0'))
            this._settings.set_strv(SETTING_TOGGLE_CHAT, accelerators);
    }

    _toggleOverlay() {
        if (!this._backendAvailable || !this._box) return;
        this._userHidden = !this._userHidden;
        if (this._userHidden || this._overviewOpen)
            this._box.hide();
        else
            this._box.show();
        this._syncAnimatorPause();
    }

    _onBackendAppeared() {
        console.log('[StreamShell] backend detected, showing overlay');
        this._backendAvailable = true;
        this._syncAnimatorPause();
        try {
            this._showBox();
        } catch (e) {
            console.error(`[StreamShell] failed to show chat overlay: ${e}\n${e.stack}`);
        }
    }

    _onBackendVanished() {
        console.log('[StreamShell] backend gone, hiding overlay');
        this._backendAvailable = false;
        this._userHidden = false;
        this._syncAnimatorPause();
        this._hideBox();
    }

    _onChatCleared() {
        console.log('[StreamShell] chat cleared');
        if (this._linesBox)
            this._linesBox.destroy_all_children();
        if (this._label)
            this._label.show();
        if (this._scrollView) {
            this._scrollView.hide();
            this._scrollView.vadjustment.set_value(this._scrollView.vadjustment.lower);
        }
        this._followingLatest = true;
        if (this._newMessagesButton)
            this._newMessagesButton.hide();
        this._syncAnimatorPause();
    }

    _applyOverlaySettings(payload) {
        try {
            const settings = JSON.parse(payload);
            if (Number.isInteger(settings.chatWidth) && settings.chatWidth >= 280 && settings.chatWidth <= 600)
                this._chatWidth = settings.chatWidth;
            if (Number.isInteger(settings.maxVisibleMessages) &&
                settings.maxVisibleMessages >= 3 && settings.maxVisibleMessages <= 20)
                this._maxVisibleMessages = settings.maxVisibleMessages;
            if (typeof settings.historyEnabled === 'boolean')
                this._historyEnabled = settings.historyEnabled;
            if (Number.isInteger(settings.historyLimit) &&
                settings.historyLimit >= 5 && settings.historyLimit <= 100)
                this._historyLimit = settings.historyLimit;
            if (typeof settings.toggleChatShortcut === 'string') {
                this._toggleChatShortcut = settings.toggleChatShortcut;
                this._applyChatShortcutSetting();
            }
            if (this._box) this._box.width = this._chatWidth;
            this._updateScrollView();
            if (!this._historyEnabled)
                this._setFollowingLatest(true);
            this._trimMessages();
            this._syncAnimatorPause();
            this._reposition();
        } catch (e) {
            console.warn(`[StreamShell] invalid overlay settings: ${e}`);
        }
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

        const scrollView = new St.ScrollView({
            width: this._chatWidth - PADDING * 2,
            height: this._maxVisibleMessages * MESSAGE_HEIGHT,
            reactive: true,
            x_expand: true,
        });
        scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        scrollView.set_child(linesBox);
        scrollView.hide();

        const newMessagesButton = new St.Button({
            label: T('latest'),
            can_focus: true,
            reactive: true,
            style: 'margin-top: 4px; padding: 4px 8px; border-radius: 6px; background-color: rgba(145,70,255,0.9); color: white; font-size: 12px;',
        });
        newMessagesButton.hide();
        newMessagesButton.connect('clicked', () => this._followLatest());

        const box = new St.BoxLayout({
            vertical: true,
            reactive: false,
            can_focus: false,
            track_hover: false,
            width: this._chatWidth,
            style: `background-color: rgba(0,0,0,${BG_ALPHA}); border-radius: 12px; padding: ${PADDING}px;`,
        });
        box.add_child(label);
        box.add_child(scrollView);
        box.add_child(newMessagesButton);

        return {box, label, linesBox, scrollView, newMessagesButton};
    }

    _showBox() {
        if (this._box) return;

        const {box, label, linesBox, scrollView, newMessagesButton} = this._buildBox();
        this._box = box;
        this._label = label;
        this._linesBox = linesBox;
        this._scrollView = scrollView;
        this._newMessagesButton = newMessagesButton;
        Main.uiGroup.add_child(this._box);

        try {
            this._scrollValueId = scrollView.vadjustment.connect('notify', () => {
                if (this._followingLatest)
                    this._scheduleScrollToLatest();
            });
            this._scrollEventId = scrollView.connect('scroll-event', () => {
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._syncFollowFromPosition();
                    return GLib.SOURCE_REMOVE;
                });
                return Clutter.EVENT_PROPAGATE;
            });
        } catch (e) {
            console.warn(`[StreamShell] scroll controls unavailable; chat remains active: ${e}`);
        }

        // If the Overview is currently open, start hidden.
        if (this._overviewOpen || this._userHidden) {
            this._box.hide();
        }

        this._reposition();
    }

    _hideBox() {
        if (!this._box) return;
        if (this._scrollValueId && this._scrollView)
            this._scrollView.vadjustment.disconnect(this._scrollValueId);
        if (this._scrollEventId && this._scrollView)
            this._scrollView.disconnect(this._scrollEventId);
        this._scrollValueId = 0;
        this._scrollEventId = 0;
        if (this._scrollSyncSourceId) {
            GLib.Source.remove(this._scrollSyncSourceId);
            this._scrollSyncSourceId = 0;
        }
        this._box.destroy();
        this._box = null;
        this._label = null;
        this._linesBox = null;
        this._scrollView = null;
        this._newMessagesButton = null;
    }

    _updateScrollView() {
        if (!this._scrollView) return;
        this._scrollView.width = this._chatWidth - PADDING * 2;
        this._scrollView.height = this._maxVisibleMessages * MESSAGE_HEIGHT;
        this._scrollView.set_policy(
            St.PolicyType.NEVER,
            this._historyEnabled ? St.PolicyType.AUTOMATIC : St.PolicyType.NEVER
        );
    }

    _trimMessages() {
        if (!this._linesBox) return;
        const limit = this._historyEnabled
            ? this._historyLimit
            : this._maxVisibleMessages;
        const rows = this._linesBox.get_children();
        for (let i = 0; i < rows.length - limit; i++)
            rows[i].destroy();
    }

    _scrollToLatest() {
        if (!this._scrollView) return;
        const adjustment = this._scrollView.vadjustment;
        const [, lower, upper, , , pageSize] = adjustment.get_values();
        adjustment.set_value(Math.max(lower, upper - pageSize));
    }

    _scheduleScrollToLatest() {
        if (this._scrollSyncSourceId) return;
        this._scrollSyncSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._scrollSyncSourceId = 0;
            if (this._followingLatest)
                this._scrollToLatest();
            return GLib.SOURCE_REMOVE;
        });
    }

    _setFollowingLatest(following) {
        if (!this._historyEnabled)
            following = true;
        if (this._followingLatest === following) return;
        this._followingLatest = following;
        if (this._newMessagesButton) {
            if (following)
                this._newMessagesButton.hide();
            else
                this._newMessagesButton.show();
        }
        this._syncAnimatorPause();
    }

    _syncFollowFromPosition() {
        if (!this._scrollView) return;
        const [value, , upper, , , pageSize] = this._scrollView.vadjustment.get_values();
        this._setFollowingLatest(upper - (value + pageSize) <= 4);
    }

    _followLatest() {
        this._setFollowingLatest(true);
        this._scrollToLatest();
        this._scheduleScrollToLatest();
    }

    // --- Rendering ----------------------------------------------------------

    _makeIcon(path, size, animate = true) {
        try {
            return this._makeIconUnsafe(path, size, animate);
        } catch (e) {
            console.warn(`[StreamShell] icon failed for ${path}: ${e}\n${e.stack}`);
            return null;
        }
    }

    _makeIconUnsafe(path, size, animate) {
        // Only accept absolute image paths (they come from our own backend).
        if (typeof path !== 'string' || !path.startsWith('/') || !/\.(png|gif|webp)$/.test(path))
            return null;

        if (animate && /\.(gif|webp)$/.test(path) && this._animator) {
            const animated = this._animator.makeActor(path, size);
            if (animated) return animated;
        }

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
                reply: p.reply && typeof p.reply.user === 'string'
                    ? {
                        user: p.reply.user,
                        message: typeof p.reply.message === 'string' ? p.reply.message : '',
                    }
                    : null,
            };
        } catch (_e) {
            // Older backend: the third argument was plain text.
            return {badges: [], segments: [{t: 'text', v: String(payload)}], reply: null};
        }
    }

    _addReplyHeader(msg, reply) {
        const replyRow = new St.BoxLayout({
            vertical: false,
            reactive: false,
            style: 'spacing: 4px;',
        });
        const iconFile = this.dir.get_child('reply.svg');
        replyRow.add_child(new St.Icon({
            gicon: new Gio.FileIcon({file: iconFile}),
            icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'color: rgba(255,255,255,0.75);',
        }));

        const quotedMessage = reply.message.replace(/\s+/g, ' ').trim();
        const quote = quotedMessage.length > 96
            ? `${quotedMessage.slice(0, 95)}…`
            : quotedMessage;
        const text = `${T('replyTo')} @${reply.user}${quote ? `: ${quote}` : ''}`;
        const label = this._makeWord(
            text,
            `color: rgba(255,255,255,0.75); font-size: 13px;`
        );
        label.width = this._chatWidth - PADDING * 2 - 20;
        label.get_clutter_text().set_line_wrap(true);
        replyRow.add_child(label);
        msg.add_child(replyRow);
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
        const {badges, segments, reply} = this._parsePayload(payload);
        const safeColor = /^#[0-9A-Fa-f]{6}$/.test(color) ? color : DEFAULT_COLOR;
        const textStyle = `color: white; font-size: ${FONT_SIZE}px;`;

        if (reply)
            this._addReplyHeader(msg, reply);

        let row = this._newRow(msg);
        const add = (actor) => {
            row.add_child(actor);
            if (row.get_n_children() > 1 &&
                row.get_preferred_width(-1)[1] > this._chatWidth - PADDING * 2) {
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
                const icon = this._makeIcon(seg.path, EMOTE_SIZE, seg.animated !== false);
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

    _addFallbackLine(user, payload) {
        const {segments, reply} = this._parsePayload(payload);
        const text = segments
            .map(s => (s.t === 'emote' ? (s.name ?? '') : (s.v ?? '')))
            .join('')
            .trim();
        const replyText = reply
            ? `${T('replyTo')} @${reply.user}${reply.message ? `: ${reply.message}` : ''}\n`
            : '';
        const label = new St.Label({
            text: `${replyText}${user}: ${text}`,
            style: `color: white; font-size: ${FONT_SIZE}px;`,
            width: this._chatWidth - PADDING * 2,
        });
        label.get_clutter_text().set_line_wrap(true);
        this._linesBox.add_child(label);
    }

    _onMessageReceived(user, color, payload, fromHistory = false) {
        if (!this._linesBox || !this._scrollView) return;

        if (this._label) this._label.hide();
        this._scrollView.show();

        const msg = new St.BoxLayout({
            vertical: true,
            reactive: false,
            width: this._chatWidth - PADDING * 2,
            style: 'spacing: 2px;',
        });
        this._linesBox.add_child(msg);

        try {
            this._fillMessage(msg, user, color, payload);
        } catch (e) {
            // Show the message as plain text rather than dropping it.
            console.error(`[StreamShell] failed to render message: ${e}\n${e.stack}`);
            msg.destroy();
            this._addFallbackLine(user, payload);
        }

        this._trimMessages();
        if (fromHistory)
            this._setFollowingLatest(true);
        if (this._followingLatest)
            this._scheduleScrollToLatest();
    }

    _reposition() {
        if (!this._box) return;
        const m = Main.layoutManager.primaryMonitor;
        if (!m) return;
        const panelH = Math.max(Main.panel.height, 32);
        this._box.set_position(m.x + m.width - this._chatWidth - MARGIN, m.y + panelH + MARGIN);
    }

    disable() {
        if (this._overviewShowingId) Main.overview.disconnect(this._overviewShowingId);
        if (this._overviewHidingId) Main.overview.disconnect(this._overviewHidingId);
        this._overviewShowingId = this._overviewHidingId = null;

        if (this._signalId)
            Gio.DBus.session.signal_unsubscribe(this._signalId);
        this._signalId = null;

        if (this._historySignalId)
            Gio.DBus.session.signal_unsubscribe(this._historySignalId);
        this._historySignalId = null;

        if (this._clearSignalId)
            Gio.DBus.session.signal_unsubscribe(this._clearSignalId);
        this._clearSignalId = null;

        if (this._settingsSignalId)
            Gio.DBus.session.signal_unsubscribe(this._settingsSignalId);
        this._settingsSignalId = null;
        if (this._nameWatchId) {
            Gio.bus_unwatch_name(this._nameWatchId);
            this._nameWatchId = null;
        }

        if (this._startupId)
            Main.layoutManager.disconnect(this._startupId);
        if (this._monitorsId)
            Main.layoutManager.disconnect(this._monitorsId);
        this._startupId = this._monitorsId = null;

        this._alive = false;
        if (this._keybindingRegistered) {
            Main.wm.removeKeybinding(SETTING_TOGGLE_CHAT);
            this._keybindingRegistered = false;
        }
        if (this._settings && this._settingsId)
            this._settings.disconnect(this._settingsId);
        this._settings = null;
        this._settingsId = 0;

        if (this._animator) {
            this._animator.destroy();
            this._animator = null;
        }
        this._backendAvailable = false;
        this._hideBox();
    }
}