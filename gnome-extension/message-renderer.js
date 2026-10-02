import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {BADGE_SIZE, DEFAULT_COLOR, EMOTE_SIZE, FONT_SIZE, MAX_WORD_LEN, PADDING} from './constants.js';
import {T} from './i18n.js';

function parsePayload(payload) {
    try {
        const parsed = JSON.parse(payload);
        return {
            badges: Array.isArray(parsed.badges) ? parsed.badges : [],
            segments: Array.isArray(parsed.segments) ? parsed.segments : [],
            login: typeof parsed.login === 'string' ? parsed.login : '',
            reply: parsed.reply && typeof parsed.reply.user === 'string'
                ? {
                    user: parsed.reply.user,
                    message: typeof parsed.reply.message === 'string' ? parsed.reply.message : '',
                }
                : null,
        };
    } catch (_error) {
        return {badges: [], segments: [{t: 'text', v: String(payload)}], login: '', reply: null};
    }
}

function makeWord(word, style) {
    return new St.Label({
        text: word,
        style,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

function addReplyHeader(overlay, message, reply) {
    const replyRow = new St.BoxLayout({
        vertical: false,
        reactive: false,
        style: 'spacing: 4px;',
    });
    const iconFile = overlay.dir.get_child('reply.svg');
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
    const label = makeWord(
        `${T('replyTo')} @${reply.user}${quote ? `: ${quote}` : ''}`,
        'color: rgba(255,255,255,0.75); font-size: 13px;'
    );
    label.width = overlay._chatWidth - PADDING * 2 - 20;
    label.get_clutter_text().set_line_wrap(true);
    replyRow.add_child(label);
    message.add_child(replyRow);
}

function newRow(message) {
    const row = new St.BoxLayout({
        vertical: false,
        reactive: false,
        style: 'spacing: 4px;',
    });
    message.add_child(row);
    return row;
}

export function renderMessage(overlay, message, user, color, payload) {
    const {badges, segments, reply, login} = parsePayload(payload);
    const safeColor = /^#[0-9A-Fa-f]{6}$/.test(color) ? color : DEFAULT_COLOR;
    const textStyle = `color: white; font-size: ${FONT_SIZE}px;`;

    if (reply)
        addReplyHeader(overlay, message, reply);

    let row = newRow(message);
    const add = actor => {
        row.add_child(actor);
        if (row.get_n_children() > 1 &&
            row.get_preferred_width(-1)[1] > overlay._chatWidth - PADDING * 2) {
            row.remove_child(actor);
            row = newRow(message);
            row.add_child(actor);
        }
    };

    for (const badgePath of badges) {
        const icon = overlay._makeIcon(badgePath, BADGE_SIZE);
        if (icon)
            add(icon);
    }

    const username = new St.Button({
        label: `${user}:`,
        can_focus: overlay._disableClickThrough && overlay._clickableProfilesEnabled,
        reactive: overlay._disableClickThrough && overlay._clickableProfilesEnabled,
        y_align: Clutter.ActorAlign.CENTER,
        style: `padding: 0; border: 0; background-color: transparent; color: ${safeColor}; font-weight: bold; font-size: ${FONT_SIZE}px;`,
    });
    username.connect('clicked', () => overlay._showUserProfile(login || user.toLowerCase()));
    username.connect('destroy', () => {
        overlay._usernameButtons = overlay._usernameButtons.filter(button => button !== username);
    });
    add(username);
    overlay._usernameButtons.push(username);

    for (const segment of segments) {
        if (segment.t === 'emote') {
            const icon = overlay._makeIcon(segment.path, EMOTE_SIZE, segment.animated !== false, true);
            if (icon)
                add(icon);
            else if (segment.name)
                add(makeWord(String(segment.name), textStyle));
        } else if (segment.t === 'text' && typeof segment.v === 'string') {
            for (const word of segment.v.split(/\s+/)) {
                if (!word)
                    continue;
                for (let i = 0; i < word.length; i += MAX_WORD_LEN)
                    add(makeWord(word.slice(i, i + MAX_WORD_LEN), textStyle));
            }
        }
    }
}

export function renderFallbackMessage(overlay, user, payload) {
    const {segments, reply} = parsePayload(payload);
    const text = segments
        .map(segment => (segment.t === 'emote' ? (segment.name ?? '') : (segment.v ?? '')))
        .join('')
        .trim();
    const replyText = reply
        ? `${T('replyTo')} @${reply.user}${reply.message ? `: ${reply.message}` : ''}\n`
        : '';
    const label = new St.Label({
        text: `${replyText}${user}: ${text}`,
        style: `color: white; font-size: ${FONT_SIZE}px;`,
        width: overlay._chatWidth - PADDING * 2,
    });
    label.get_clutter_text().set_line_wrap(true);
    overlay._linesBox.add_child(label);
}
