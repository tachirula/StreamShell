import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {T, WAITING_MARKUP} from './i18n.js';
import {renderFallbackMessage, renderMessage} from './message-renderer.js';
import {
    BUS_NAME,
    DEFAULT_CHAT_WIDTH,
    DEFAULT_MAX_VISIBLE_MESSAGES,
    EMOTE_SIZE,
    FONT_SIZE,
    INTERFACE,
    MARGIN,
    MAX_ANIMATED,
    OBJECT_PATH,
    PADDING,
    SETTING_ANIMATED,
    SETTING_TOGGLE_CHAT,
} from './constants.js';

export default class ChatOverlayTest extends Extension {
    enable() {
        this._box = null;
        this._label = null;      // "waiting" placeholder
        this._linesBox = null;   // vertical container of message rows
        this._scrollView = null;
        this._newMessagesButton = null;
        this._messageInput = null;
        this._messageStatus = null;
        this._profilePanel = null;
        this._profileScroll = null;
        this._profileCloseButton = null;
        this._profileAvatar = null;
        this._profileName = null;
        this._profileDescription = null;
        this._profileMessages = null;
        this._requestedProfileLogin = '';
        this._profileLiveMessages = [];
        this._profileBaseMessages = [];
        this._profileHistorySequence = null;
        this._messageRequestSequence = 0;
        this._signalId = null;
        this._historySignalId = null;
        this._clearSignalId = null;
        this._settingsSignalId = null;
        this._nameWatchId = null;
        this._scrollValueId = 0;
        this._scrollEventId = 0;
        this._scrollPositionSourceId = 0;
        this._scrollPositionRevision = 0;
        this._scrollSyncSourceId = 0;
        this._scrollRestoreSourceId = 0;
        this._alive = true;
        this._backendAvailable = false;
        this._followingLatest = true;
        this._overviewOpen = Main.overview.visible;
        this._animator = null;
        this._settings = null;
        this._settingsId = 0;
        this._chatWidth = DEFAULT_CHAT_WIDTH;
        this._backgroundOpacity = 35;
        this._maxVisibleMessages = DEFAULT_MAX_VISIBLE_MESSAGES;
        this._historyEnabled = false;
        this._historyLimit = 20;
        this._disableClickThrough = false;
        this._interactiveChatEnabled = false;
        this._clickableProfilesEnabled = false;
        this._usernameButtons = [];
        this._messagePayloads = new WeakMap();
        this._profileMessageLimit = 100;
        this._userHidden = false;
        this._toggleChatShortcut = '';
        this._keybindingRegistered = false;

        // Keep repositioning signals connected; they are inexpensive.
        this._startupId = Main.layoutManager.connect('startup-complete', () => this._reposition());
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._reposition());

        // Hide during Activities Overview (alpha compositing bug).
        this._overviewShowingId = Main.overview.connect('showing', () => {
            this._overviewOpen = true;
            this._syncOverlayVisibility();
            this._syncAnimatorPause();
        });
        this._overviewHidingId = Main.overview.connect('hiding', () => {
            this._overviewOpen = false;
            this._syncOverlayVisibility();
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
            let scaleFactor = 1;
            try {
                scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
            } catch (e) {
                console.warn(`[StreamShell] could not read the scale factor: ${e}`);
            }
            this._animator = new EmoteAnimator({
                maxAnimated: MAX_ANIMATED,
                frameHeight: EMOTE_SIZE * scaleFactor,
            });
            this._syncAnimatorPause();
            this._applyAnimationSetting();
            this._rerenderMessages();
        }).catch(e => {
            console.warn(`[StreamShell] animated emotes unavailable: ${e}`);
        });
    }

    _scheduleScrollRestore(value) {
        if (this._scrollRestoreSourceId)
            GLib.Source.remove(this._scrollRestoreSourceId);
        this._scrollRestoreSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._scrollRestoreSourceId = 0;
            if (!this._scrollView || this._followingLatest) return GLib.SOURCE_REMOVE;
            const adjustment = this._scrollView.vadjustment;
            const [, lower, upper, , , pageSize] = adjustment.get_values();
            adjustment.set_value(Math.max(lower, Math.min(value, upper - pageSize)));
            return GLib.SOURCE_REMOVE;
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
        if (!this._settings ||
            !this._settings.settings_schema.has_key(SETTING_ANIMATED))
            return;
        this._setAnimationEnabled(this._settings.get_boolean(SETTING_ANIMATED));
    }

    _setAnimationEnabled(enabled) {
        if (this._settings?.settings_schema.has_key(SETTING_ANIMATED) &&
            this._settings.get_boolean(SETTING_ANIMATED) !== enabled)
            this._settings.set_boolean(SETTING_ANIMATED, enabled);
        if (!this._animator) return;
        this._animator.setEnabled(enabled);
        if (enabled)
            this._rerenderMessages();
    }

    _rerenderMessages() {
        if (!this._linesBox) return;
        for (const message of this._linesBox.get_children()) {
            const data = this._messagePayloads.get(message);
            if (!data)
                continue;
            message.destroy_all_children();
            try {
                renderMessage(this, message, data.user, data.color, data.payload);
            } catch (error) {
                console.error(`[StreamShell] failed to rerender message: ${error}\n${error.stack}`);
                message.destroy();
                renderFallbackMessage(this, data.user, data.payload);
                this._messagePayloads.delete(message);
            }
        }
        this._updateScrollView();
        this._scheduleScrollToLatest();
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
        this._syncOverlayVisibility();
        this._syncAnimatorPause();
    }

    _syncOverlayVisibility() {
        const overlayVisible = this._backendAvailable && !this._userHidden && !this._overviewOpen;
        if (this._box) {
            if (overlayVisible)
                this._box.show();
            else
                this._box.hide();
        }
        if (this._profilePanel) {
            const profileVisible = overlayVisible &&
                this._clickableProfilesEnabled && Boolean(this._requestedProfileLogin);
            if (profileVisible)
                this._profilePanel.show();
            else
                this._profilePanel.hide();
        }
    }

    _onBackendAppeared() {
        console.log('[StreamShell] backend detected, showing overlay');
        this._backendAvailable = true;
        this._syncAnimatorPause();
        this._requestOverlaySettings();
        try {
            this._showBox();
        } catch (e) {
            console.error(`[StreamShell] failed to show chat overlay: ${e}\n${e.stack}`);
        }
    }

    _requestOverlaySettings() {
        Gio.DBus.session.call(
            BUS_NAME,
            OBJECT_PATH,
            INTERFACE,
            'GetOverlaySettings',
            null,
            new GLib.VariantType('(s)'),
            Gio.DBusCallFlags.NONE,
            5000,
            null,
            (connection, result) => {
                try {
                    const [payload] = connection.call_finish(result).deepUnpack();
                    if (this._alive && this._backendAvailable)
                        this._applyOverlaySettings(payload);
                } catch (error) {
                    if (this._alive && this._backendAvailable)
                        console.warn(`[StreamShell] could not load backend overlay settings: ${error}`);
                }
            }
        );
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
        this._scrollPositionRevision++;
        if (this._scrollPositionSourceId) {
            GLib.Source.remove(this._scrollPositionSourceId);
            this._scrollPositionSourceId = 0;
        }
        if (this._scrollSyncSourceId) {
            GLib.Source.remove(this._scrollSyncSourceId);
            this._scrollSyncSourceId = 0;
        }
        if (this._scrollRestoreSourceId) {
            GLib.Source.remove(this._scrollRestoreSourceId);
            this._scrollRestoreSourceId = 0;
        }
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
        if (this._profilePanel)
            this._profilePanel.hide();
        this._requestedProfileLogin = '';
        this._profileLiveMessages = [];
        this._profileBaseMessages = [];
        this._profileHistorySequence = null;
        if (this._messageStatus)
            this._messageStatus.hide();
        this._syncAnimatorPause();
    }

    _applyOverlaySettings(payload) {
        try {
            const settings = JSON.parse(payload);
            if (Number.isInteger(settings.chatWidth) && settings.chatWidth >= 280 && settings.chatWidth <= 600)
                this._chatWidth = settings.chatWidth;
            if (Number.isInteger(settings.backgroundOpacity) &&
                settings.backgroundOpacity >= 0 && settings.backgroundOpacity <= 100)
                this._backgroundOpacity = settings.backgroundOpacity;
            if (Number.isInteger(settings.maxVisibleMessages) &&
                settings.maxVisibleMessages >= 3 && settings.maxVisibleMessages <= 20)
                this._maxVisibleMessages = settings.maxVisibleMessages;
            if (typeof settings.historyEnabled === 'boolean')
                this._historyEnabled = settings.historyEnabled;
            if (Number.isInteger(settings.historyLimit) &&
                settings.historyLimit >= 5 && settings.historyLimit <= 100)
                this._historyLimit = settings.historyLimit;
            if (typeof settings.disableClickThrough === 'boolean')
                this._disableClickThrough = settings.disableClickThrough;
            if (typeof settings.interactiveChatEnabled === 'boolean')
                this._interactiveChatEnabled = settings.interactiveChatEnabled;
            if (typeof settings.clickableProfilesEnabled === 'boolean')
                this._clickableProfilesEnabled = settings.clickableProfilesEnabled;
            if (typeof settings.animatedEmotesEnabled === 'boolean')
                this._setAnimationEnabled(settings.animatedEmotesEnabled);
            if (Number.isInteger(settings.profileMessageLimit) &&
                settings.profileMessageLimit >= 1 && settings.profileMessageLimit <= 500)
                this._profileMessageLimit = settings.profileMessageLimit;
            if (typeof settings.toggleChatShortcut === 'string') {
                this._toggleChatShortcut = settings.toggleChatShortcut;
                this._applyChatShortcutSetting();
            }
            if (this._box) {
                this._box.width = this._chatWidth;
                this._box.set_style(this._boxStyle());
            }
            if (this._profilePanel)
                this._profilePanel.width = this._chatWidth - PADDING * 2;
            this._applyClickThrough();
            if (!this._clickableProfilesEnabled) {
                this._requestedProfileLogin = '';
                if (this._profilePanel)
                    this._profilePanel.hide();
            }
            if (!this._historyEnabled)
                this._setFollowingLatest(true);
            this._trimMessages();
            this._updateScrollView();
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
            height: 1,
            reactive: false,
            x_expand: true,
        });
        scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        scrollView.set_child(linesBox);
        scrollView.hide();

        const newMessagesButton = new St.Button({
            label: T('latest'),
            can_focus: false,
            reactive: false,
            style: 'margin-top: 4px; padding: 4px 8px; border-radius: 6px; background-color: rgba(145,70,255,0.9); color: white; font-size: 12px;',
        });
        newMessagesButton.hide();
        newMessagesButton.connect('clicked', () => this._followLatest());

        const messageInput = new St.Entry({
            hint_text: T('messagePlaceholder'),
            can_focus: false,
            reactive: false,
            track_hover: true,
            style: `margin-top: 6px; padding: 6px 8px; border-radius: 6px; background-color: rgba(20,20,23,0.95); color: white; font-size: ${FONT_SIZE}px;`,
        });
        messageInput.visible = this._interactiveChatEnabled;
        messageInput.clutter_text.connect('activate', () => this._sendOverlayMessage());

        const profilePanel = new St.BoxLayout({
            vertical: true,
            reactive: false,
            width: this._chatWidth - PADDING * 2,
            style: 'margin-top: 6px; padding: 8px; spacing: 6px; background-color: rgba(20,20,23,0.98); border-radius: 8px;',
        });
        const profileHeader = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 8px;',
            x_expand: true,
        });
        const profileAvatar = new St.Icon({
            icon_name: 'avatar-default-symbolic',
            icon_size: 48,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const profileName = new St.Label({
            text: '',
            style: 'color: white; font-weight: bold; font-size: 15px;',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        const profileCloseButton = new St.Button({
            label: '×',
            can_focus: false,
            reactive: false,
            style: 'padding: 2px 8px; border-radius: 4px; background-color: rgba(145,70,255,0.8); color: white;',
        });
        profileCloseButton.accessible_name = T('closeProfile');
        profileCloseButton.connect('clicked', () => {
            this._requestedProfileLogin = '';
            this._syncOverlayVisibility();
        });
        profileHeader.add_child(profileAvatar);
        profileHeader.add_child(profileName);
        profileHeader.add_child(profileCloseButton);
        const profileDescription = new St.Label({
            text: '',
            style: 'color: rgba(255,255,255,0.8); font-size: 13px;',
            x_expand: true,
        });
        profileDescription.get_clutter_text().set_line_wrap(true);
        const profileMessages = new St.Label({
            text: '',
            style: 'color: rgba(255,255,255,0.8); font-size: 13px;',
            x_expand: true,
        });
        profileMessages.get_clutter_text().set_line_wrap(true);
        const profileScroll = new St.ScrollView({
            height: 150,
            reactive: false,
            x_expand: true,
        });
        const profileMessagesContainer = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });
        profileMessagesContainer.add_child(profileMessages);
        profileScroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        profileScroll.set_child(profileMessagesContainer);
        profilePanel.add_child(profileHeader);
        profilePanel.add_child(new St.Label({
            text: T('profileAbout'),
            style: 'color: #bf94ff; font-weight: bold; font-size: 13px;',
        }));
        profilePanel.add_child(profileDescription);
        profilePanel.add_child(new St.Label({
            text: T('profileMessages'),
            style: 'color: #bf94ff; font-weight: bold; font-size: 13px;',
        }));
        profilePanel.add_child(profileScroll);
        profilePanel.hide();

        const box = new St.BoxLayout({
            vertical: true,
            reactive: false,
            can_focus: false,
            track_hover: false,
            width: this._chatWidth,
            style: this._boxStyle(),
        });
        box.add_child(label);
        box.add_child(scrollView);
        box.add_child(newMessagesButton);
        box.add_child(messageInput);
        const messageStatus = new St.Label({
            text: '',
            style: 'margin-top: 4px; color: rgba(255,255,255,0.85); font-size: 12px;',
        });
        messageStatus.get_clutter_text().set_line_wrap(true);
        messageStatus.hide();
        box.add_child(messageStatus);

        return {
            box,
            label,
            linesBox,
            scrollView,
            newMessagesButton,
            messageInput,
            messageStatus,
            profilePanel,
            profileScroll,
            profileCloseButton,
            profileAvatar,
            profileName,
            profileDescription,
            profileMessages,
        };
    }

    _boxStyle() {
        return `background-color: rgba(0,0,0,${this._backgroundOpacity / 100}); border-radius: 12px; padding: ${PADDING}px;`;
    }

    _sendOverlayMessage() {
        if (!this._messageInput || !this._interactiveChatEnabled) {
            console.warn('[StreamShell] Chat send skipped: input is unavailable or interactive chat is disabled.');
            return;
        }
        const text = this._messageInput.get_text().trim();
        if (!text) {
            console.warn('[StreamShell] Chat send skipped: message is empty.');
            return;
        }

        const requestId =
            `${Date.now().toString(36)}-${(++this._messageRequestSequence).toString(36)}`;
        console.log(
            `[StreamShell] [chat:${requestId}] submitting message to D-Bus (length=${text.length}).`
        );
        this._messageInput.clutter_text.editable = false;
        if (this._messageStatus) {
            this._messageStatus.set_text(T('sendingMessage'));
            this._messageStatus.show();
        }
        try {
            Gio.DBus.session.call(
                BUS_NAME,
                OBJECT_PATH,
                INTERFACE,
                'SendChatMessage',
                new GLib.Variant('(ss)', [requestId, text]),
                new GLib.VariantType('(s)'),
                Gio.DBusCallFlags.NONE,
                5000,
                null,
                (connection, result) => {
                    try {
                        if (!this._messageInput) return;
                        const response = connection.call_finish(result);
                        const [status] = response.deepUnpack();
                        if (status === 'sent') {
                            console.log(`[StreamShell] [chat:${requestId}] backend confirmed IRC client acceptance.`);
                            if (this._messageInput?.get_text().trim() === text)
                                this._messageInput.set_text('');
                            if (this._messageStatus) {
                                this._messageStatus.set_text(T('messageSent'));
                                this._messageStatus.show();
                            }
                        } else {
                            console.warn(
                                `[StreamShell] [chat:${requestId}] backend returned unexpected status: ${String(status)}.`
                            );
                        }
                    } catch (error) {
                        console.error(
                            `[StreamShell] [chat:${requestId}] D-Bus send call failed or timed out: ${error}`
                        );
                        if (this._messageStatus) {
                            this._messageStatus.set_text(T('messageSendFailed'));
                            this._messageStatus.show();
                        }
                    } finally {
                        if (this._messageInput)
                            this._messageInput.clutter_text.editable =
                                this._interactiveChatEnabled && this._disableClickThrough;
                    }
                }
            );
        } catch (error) {
            console.error(`[StreamShell] [chat:${requestId}] could not start D-Bus send call: ${error}`);
            this._messageInput.clutter_text.editable =
                this._interactiveChatEnabled && this._disableClickThrough;
            if (this._messageStatus) {
                this._messageStatus.set_text(T('messageSendFailed'));
                this._messageStatus.show();
            }
        }
    }

    _showUserProfile(login) {
        if (!this._clickableProfilesEnabled || !this._profilePanel) return;
        if (!/^[a-z0-9_]{1,25}$/i.test(login)) return;
        if (this._profilePanel.visible && this._requestedProfileLogin === login.toLowerCase()) {
            this._requestedProfileLogin = '';
            this._syncOverlayVisibility();
            return;
        }

        this._profileName.set_text(login);
        this._requestedProfileLogin = login.toLowerCase();
        this._profileAvatar.set_icon_name('avatar-default-symbolic');
        this._profileDescription.set_text(T('profileLoading'));
        this._profileMessages.set_text('');
        this._profileLiveMessages = [];
        this._profileBaseMessages = [];
        this._profileHistorySequence = null;
        this._syncOverlayVisibility();

        Gio.DBus.session.call(
            BUS_NAME,
            OBJECT_PATH,
            INTERFACE,
            'GetUserProfile',
            new GLib.Variant('(s)', [login]),
            new GLib.VariantType('(s)'),
            Gio.DBusCallFlags.NONE,
            15000,
            null,
            (connection, result) => {
                try {
                    if (!this._profilePanel || !this._profileName ||
                        !this._profileAvatar || !this._profileDescription || !this._profileMessages)
                        return;
                    const response = connection.call_finish(result);
                    const [payload] = response.deepUnpack();
                    const profile = JSON.parse(payload);
                    if (this._requestedProfileLogin !== login.toLowerCase() ||
                        profile.login !== login.toLowerCase())
                        return;
                    this._profileName.set_text(profile.displayName || profile.login);
                    this._profileDescription.set_text(
                        typeof profile.description === 'string' && profile.description
                            ? profile.description.slice(0, 1000)
                            : T('profileUnavailable')
                    );
                    if (typeof profile.avatarPath === 'string' && profile.avatarPath.startsWith('/')) {
                        this._profileAvatar.set_gicon(
                            new Gio.FileIcon({file: Gio.File.new_for_path(profile.avatarPath)})
                        );
                    }
                    const messages = Array.isArray(profile.messages)
                        ? profile.messages.flatMap(message => {
                            if (typeof message === 'string')
                                return [{sequence: null, text: message}];
                            if (message && Number.isInteger(message.sequence) &&
                                typeof message.text === 'string')
                                return [{sequence: message.sequence, text: message.text}];
                            return [];
                        })
                        : [];
                    this._profileHistorySequence = Number.isInteger(profile.lastSequence)
                        ? profile.lastSequence
                        : -1;
                    this._profileBaseMessages = messages;
                    const liveMessages = this._profileLiveMessages.filter(message =>
                        message.sequence > this._profileHistorySequence
                    );
                    this._setProfileMessages([...this._profileBaseMessages, ...liveMessages]);
                } catch (error) {
                    if (this._requestedProfileLogin !== login.toLowerCase()) return;
                    console.error(`[StreamShell] could not load Twitch profile: ${error}`);
                    this._profileBaseMessages = [];
                    this._profileDescription.set_text(T('profileUnavailable'));
                    this._profileMessages.set_text(T('profileNoMessages'));
                }
            }
        );
    }

    _showBox() {
        if (this._box) return;

        const {
            box, label, linesBox, scrollView, newMessagesButton, messageInput, messageStatus,
            profilePanel, profileScroll, profileCloseButton, profileAvatar, profileName,
            profileDescription, profileMessages,
        } = this._buildBox();
        this._box = box;
        this._label = label;
        this._linesBox = linesBox;
        this._scrollView = scrollView;
        this._newMessagesButton = newMessagesButton;
        this._messageInput = messageInput;
        this._messageStatus = messageStatus;
        this._profilePanel = profilePanel;
        this._profileScroll = profileScroll;
        this._profileCloseButton = profileCloseButton;
        this._profileAvatar = profileAvatar;
        this._profileName = profileName;
        this._profileDescription = profileDescription;
        this._profileMessages = profileMessages;
        this._usernameButtons = [];
        this._applyClickThrough();
        Main.uiGroup.add_child(this._box);
        Main.uiGroup.add_child(this._profilePanel);
        this._syncOverlayVisibility();

        try {
            this._scrollEventId = scrollView.connect('scroll-event', () => {
                const revision = ++this._scrollPositionRevision;
                if (this._scrollPositionSourceId)
                    GLib.Source.remove(this._scrollPositionSourceId);
                this._scrollPositionSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._scrollPositionSourceId = 0;
                    if (revision === this._scrollPositionRevision)
                        this._syncFollowFromPosition();
                    return GLib.SOURCE_REMOVE;
                });
                return Clutter.EVENT_PROPAGATE;
            });
        } catch (e) {
            console.warn(`[StreamShell] scroll controls unavailable; chat remains active: ${e}`);
        }

        this._updateScrollView();
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
        this._scrollPositionRevision++;
        if (this._scrollPositionSourceId) {
            GLib.Source.remove(this._scrollPositionSourceId);
            this._scrollPositionSourceId = 0;
        }
        if (this._scrollSyncSourceId) {
            GLib.Source.remove(this._scrollSyncSourceId);
            this._scrollSyncSourceId = 0;
        }
        if (this._scrollRestoreSourceId) {
            GLib.Source.remove(this._scrollRestoreSourceId);
            this._scrollRestoreSourceId = 0;
        }
        this._box.destroy();
        if (this._profilePanel)
            this._profilePanel.destroy();
        this._box = null;
        this._label = null;
        this._linesBox = null;
        this._scrollView = null;
        this._newMessagesButton = null;
        this._messageInput = null;
        this._messageStatus = null;
        this._profilePanel = null;
        this._profileScroll = null;
        this._profileCloseButton = null;
        this._profileAvatar = null;
        this._profileName = null;
        this._profileDescription = null;
        this._profileMessages = null;
        this._usernameButtons = [];
        this._requestedProfileLogin = '';
        this._profileLiveMessages = [];
        this._profileBaseMessages = [];
        this._profileHistorySequence = null;
    }

    _updateScrollView() {
        if (!this._scrollView) return;
        this._scrollView.width = this._chatWidth - PADDING * 2;
        const rows = this._linesBox?.get_children() ?? [];
        const contentHeight = rows.reduce(
            (height, row) => height + row.get_preferred_height(this._chatWidth - PADDING * 2)[1],
            Math.max(0, rows.length - 1) * 4
        );
        const monitor = Main.layoutManager.primaryMonitor;
        const availableHeight = monitor
            ? Math.max(120, monitor.height - Math.max(Main.panel.height, 32) - MARGIN * 2)
            : this._maxVisibleMessages * (EMOTE_SIZE + 4);
        const fixedHeight = Math.max(
            1,
            Math.min(this._maxVisibleMessages * (EMOTE_SIZE + 4), availableHeight)
        );
        this._scrollView.height = fixedHeight;
        this._scrollView.set_policy(
            St.PolicyType.NEVER,
            this._historyEnabled || contentHeight > fixedHeight
                ? St.PolicyType.AUTOMATIC
                : St.PolicyType.NEVER
        );
        this._applyClickThrough();
    }

    _applyClickThrough() {
        const canInteract = this._disableClickThrough;
        if (this._box)
            this._box.reactive = canInteract;
        if (this._profilePanel)
            this._profilePanel.reactive = canInteract && this._clickableProfilesEnabled;
        if (this._scrollView)
            this._scrollView.reactive =
                canInteract && (this._historyEnabled || this._clickableProfilesEnabled);
        if (this._newMessagesButton) {
            this._newMessagesButton.reactive = canInteract && this._historyEnabled;
            this._newMessagesButton.can_focus = canInteract && this._historyEnabled;
        }
        if (this._messageInput) {
            this._messageInput.visible = this._interactiveChatEnabled;
            this._messageInput.reactive = canInteract && this._interactiveChatEnabled;
            this._messageInput.can_focus = canInteract && this._interactiveChatEnabled;
        }
        if (this._profileScroll)
            this._profileScroll.reactive = canInteract && this._clickableProfilesEnabled;
        if (this._profileCloseButton) {
            this._profileCloseButton.reactive = canInteract && this._clickableProfilesEnabled;
            this._profileCloseButton.can_focus = canInteract && this._clickableProfilesEnabled;
        }
        const usernamesInteractive = canInteract && this._clickableProfilesEnabled;
        for (const button of this._usernameButtons) {
            button.reactive = usernamesInteractive;
            button.can_focus = usernamesInteractive;
        }
    }

    _trimMessages() {
        if (!this._linesBox) return 0;
        const limit = this._historyEnabled
            ? this._historyLimit
            : this._maxVisibleMessages;
        const rows = this._linesBox.get_children();
        const removeCount = Math.max(0, rows.length - limit);
        let removedHeight = 0;
        for (let i = 0; i < removeCount; i++) {
            removedHeight += rows[i].get_preferred_height(this._chatWidth - PADDING * 2)[1];
            rows[i].destroy();
        }
        const removedGaps = rows.length - removeCount > 0
            ? removeCount
            : Math.max(0, removeCount - 1);
        return removedHeight + removedGaps * 4;
    }

    _scrollToLatest() {
        if (!this._scrollView) return;
        const adjustment = this._scrollView.vadjustment;
        const [, lower, upper, , , pageSize] = adjustment.get_values();
        adjustment.set_value(Math.max(lower, upper - pageSize));
    }

    _scheduleScrollToLatest() {
        if (this._scrollRestoreSourceId) {
            GLib.Source.remove(this._scrollRestoreSourceId);
            this._scrollRestoreSourceId = 0;
        }
        if (this._scrollSyncSourceId) return;
        this._scrollSyncSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._scrollSyncSourceId = 0;
            if (this._followingLatest)
                this._scrollToLatest();
            return GLib.SOURCE_REMOVE;
        });
    }

    _setFollowingLatest(following) {
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
        if (upper - (value + pageSize) <= 4)
            this._setFollowingLatest(true);
        else
            this._setFollowingLatest(false);
    }

    _followLatest() {
        this._scrollPositionRevision++;
        if (this._scrollPositionSourceId) {
            GLib.Source.remove(this._scrollPositionSourceId);
            this._scrollPositionSourceId = 0;
        }
        if (this._scrollRestoreSourceId) {
            GLib.Source.remove(this._scrollRestoreSourceId);
            this._scrollRestoreSourceId = 0;
        }
        this._setFollowingLatest(true);
        this._scrollToLatest();
        this._scheduleScrollToLatest();
    }

    // --- Rendering ----------------------------------------------------------

    _makeIcon(path, size, animate = true, isEmote = false) {
        try {
            return this._makeIconUnsafe(path, size, animate, isEmote);
        } catch (e) {
            console.warn(`[StreamShell] icon failed for ${path}: ${e}\n${e.stack}`);
            return null;
        }
    }

    _makeIconUnsafe(path, size, animate, isEmote) {
        // Only accept absolute image paths (they come from our own backend).
        if (typeof path !== 'string' || !path.startsWith('/') || !/\.(png|gif|webp)$/.test(path))
            return null;

        if (isEmote && this._animator) {
            const canAnimate = animate && /\.(gif|webp)$/.test(path);
            const actor = this._animator.makeActor(path, size, canAnimate);
            if (actor) return actor;
        } else if (animate && /\.(gif|webp)$/.test(path) && this._animator) {
            const animated = this._animator.makeActor(path, size);
            if (animated) return animated;
        }

        return new St.Icon({
            gicon: new Gio.FileIcon({file: Gio.File.new_for_path(path)}),
            icon_size: size,
            y_align: Clutter.ActorAlign.CENTER,
        });
    }

    _onMessageReceived(user, color, payload, fromHistory = false) {
        if (!this._linesBox || !this._scrollView) return;
        if (!fromHistory)
            this._appendLiveProfileMessage(payload);
        const wasFollowingLatest = this._followingLatest;
        const previousScrollValue = this._scrollView.vadjustment.value;

        if (this._label) this._label.hide();
        this._scrollView.show();

        const msg = new St.BoxLayout({
            vertical: true,
            reactive: false,
            width: this._chatWidth - PADDING * 2,
            style: 'spacing: 2px;',
        });
        this._linesBox.add_child(msg);
        this._messagePayloads.set(msg, {user, color, payload});

        try {
            renderMessage(this, msg, user, color, payload);
        } catch (e) {
            // Show the message as plain text rather than dropping it.
            console.error(`[StreamShell] failed to render message: ${e}\n${e.stack}`);
            msg.destroy();
            renderFallbackMessage(this, user, payload);
        }

        const removedHeight = this._trimMessages();
        this._updateScrollView();
        if (fromHistory) {
            this._setFollowingLatest(true);
            this._scheduleScrollToLatest();
        } else if (wasFollowingLatest) {
            this._scheduleScrollToLatest();
        } else {
            this._scheduleScrollRestore(Math.max(0, previousScrollValue - removedHeight));
        }
    }

    _appendLiveProfileMessage(payload) {
        if (!this._requestedProfileLogin) return;
        try {
            const message = JSON.parse(payload);
            if (typeof message.login !== 'string' ||
                message.login.toLowerCase() !== this._requestedProfileLogin ||
                !Number.isInteger(message.sequence) ||
                typeof message.text !== 'string')
                return;
            const entry = {sequence: message.sequence, text: message.text};
            this._profileLiveMessages.push(entry);
            this._profileLiveMessages = this._profileLiveMessages.slice(-this._profileMessageLimit);
            if (this._profileHistorySequence !== null &&
                entry.sequence > this._profileHistorySequence)
                this._setProfileMessages([
                    ...this._profileBaseMessages,
                    ...this._profileLiveMessages.filter(item =>
                        item.sequence > this._profileHistorySequence
                    ),
                ]);
        } catch (error) {
            console.warn(`[StreamShell] could not update live profile history: ${error}`);
        }
    }

    _setProfileMessages(messages) {
        if (!this._profileMessages) return;
        const texts = messages
            .map(message => typeof message === 'string' ? message : message.text)
            .filter(message => typeof message === 'string' && message.length > 0)
            .slice(-this._profileMessageLimit);
        this._profileMessages.set_text(texts.length ? texts.join('\n') : T('profileNoMessages'));
    }

    _reposition() {
        if (!this._box) return;
        const m = Main.layoutManager.primaryMonitor;
        if (!m) return;
        const panelH = Math.max(Main.panel.height, 32);
        const chatX = m.x + m.width - this._chatWidth - MARGIN;
        this._box.set_position(chatX, m.y + panelH + MARGIN);
        if (this._profilePanel) {
            const availableWidth = Math.max(220, chatX - (m.x + MARGIN) - MARGIN);
            const profileWidth = Math.min(420, availableWidth);
            this._profilePanel.width = profileWidth;
            const profileX = Math.max(m.x + MARGIN, chatX - profileWidth - MARGIN);
            this._profilePanel.set_position(profileX, m.y + panelH + MARGIN);
        }
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