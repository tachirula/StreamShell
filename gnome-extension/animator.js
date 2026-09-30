import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import St from 'gi://St';

// Animated emote engine for the overlay.
//
// GNOME Shell runs all its JavaScript in the compositor's main thread, so a
// careless animation can freeze the whole desktop. The design follows five
// rules to keep the cost low:
//
//  1. ONE timer for everything (not one per emote), removed whenever there is
//     nothing to animate.
//  2. ONE Cairo surface per distinct emote, shared by every actor that shows
//     it. 14 messages with the same emote cost one frame upload per tick.
//  3. The timer stops while paused (overview open, overlay hidden). Frame
//     selection is time-based, so animations resume in sync.
//  4. A cap on distinct animated emotes at once. Beyond it, new emotes are
//     shown as a still (first frame) so they never cost CPU.
//  5. It can be switched off (setEnabled(false)); the extension wires that to
//     a GSettings key.

const TICK_MS = 40;      // ~25 fps upper bound; most GIFs use 50-100 ms delays
const MAX_STILLS = 64;   // cached first-frame images before the cache resets
const MAX_FRAME_SIZE = 24;

export class EmoteAnimator {
    constructor({maxAnimated = 16} = {}) {
        this._maxAnimated = maxAnimated;
        this._entries = new Map();     // path -> animated entry (shared)
        this._stills = new Map();      // path -> {surface, w, h, sourceWidth, sourceHeight}
        this._staticPaths = new Set(); // GIF files with a single frame / unreadable
        this._sourceId = 0;
        this._paused = false;
        this._enabled = true;
        this._destroyed = false;
        this._warned = false;
    }

    // --- Public API ---------------------------------------------------------

    /**
     * Builds an actor of height `size` showing the emote at `path` (a .gif or .webp).
     * Animated when possible, otherwise a still frame. Returns null on failure
     * (the caller should fall back to a plain icon).
     */
    makeActor(path, size) {
        if (this._destroyed) return null;

        try {
            let entry = this._entries.get(path);
            if (!entry && this._enabled) {
                if (this._entries.size >= this._maxAnimated)
                    this._evictOldestEntry();
                entry = this._createEntry(path);
            }

            if (entry)
                return this._animatedActor(entry, size);

            const still = this._getStill(path);
            return still ? this._actorFrom(still, size) : null;
        } catch (e) {
            // Never let an animation problem take a whole message down.
            this._warnOnce(`makeActor failed for ${path}: ${e}\n${e.stack}`);
            return null;
        }
    }

    setEnabled(enabled) {
        if (this._enabled === enabled) return;
        this._enabled = enabled;

        if (!enabled) {
            for (const entry of this._entries.values()) {
                try {
                    entry.iter = entry.anim.get_iter(null);
                    this._upload(entry, entry.iter.get_pixbuf());
                } catch (e) {
                    this._warnOnce(`could not reset ${entry.path} to its first frame: ${e}`);
                }
            }
        }

        this._updateTimer();
    }

    setPaused(paused) {
        if (this._paused === paused) return;
        this._paused = paused;

        if (!paused && this._enabled) {
            for (const entry of this._entries.values()) {
                try {
                    entry.iter = entry.anim.get_iter(null);
                    this._upload(entry, entry.iter.get_pixbuf());
                } catch (e) {
                    this._warnOnce(`could not resume ${entry.path}: ${e}`);
                }
            }
        }

        this._updateTimer();
    }

    destroy() {
        this._destroyed = true;
        this._stopTimer();
        this._entries.clear();
        this._stills.clear();
        this._staticPaths.clear();
    }

    // --- Timer (rules 1 and 3) ----------------------------------------------

    _updateTimer() {
        const shouldRun = !this._destroyed && this._enabled && !this._paused &&
            this._entries.size > 0;

        if (shouldRun && !this._sourceId) {
            this._sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => this._tick());
        } else if (!shouldRun) {
            this._stopTimer();
        }
    }

    _stopTimer() {
        if (this._sourceId) {
            GLib.Source.remove(this._sourceId);
            this._sourceId = 0;
        }
    }

    _tick() {
        for (const entry of this._entries.values()) {
            try {
                // null = "now": the iterator picks the frame from wall-clock time.
                if (entry.iter.advance(null))
                    this._upload(entry, entry.iter.get_pixbuf());
            } catch (e) {
                this._warnOnce(`iter.advance failed: ${e}`);
            }
        }

        if (this._entries.size === 0) {
            this._sourceId = 0;          // the source is removed by returning REMOVE
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    }

    // --- Entries (rule 2) ---------------------------------------------------

    _createEntry(path) {
        if (this._staticPaths.has(path)) return null;

        let anim;
        try {
            anim = GdkPixbuf.PixbufAnimation.new_from_file(path);
        } catch (e) {
            this._warnOnce(`cannot load ${path}: ${e}`);
            this._staticPaths.add(path);
            return null;
        }

        if (anim.is_static_image()) {
            this._staticPaths.add(path);
            return null;
        }

        const iter = anim.get_iter(null);
        const frame = this._createSurface(iter.get_pixbuf());

        const entry = {
            path,
            anim, // keep a reference: the iterator depends on it
            iter,
            ...frame,
            actors: new Set(),
        };
        this._entries.set(path, entry);
        return entry;
    }

    _animatedActor(entry, size) {
        const actor = this._actorFrom(entry, size);
        entry.actors.add(actor);
        actor.connect('destroy', () => this._release(entry, actor));
        this._updateTimer();
        return actor;
    }

    _evictOldestEntry() {
        const oldest = this._entries.values().next().value;
        if (!oldest) return;

        try {
            oldest.iter = oldest.anim.get_iter(null);
            this._upload(oldest, oldest.iter.get_pixbuf());
        } catch (e) {
            this._warnOnce(`could not freeze ${oldest.path} before eviction: ${e}`);
        }

        this._entries.delete(oldest.path);
        this._updateTimer();
    }

    _release(entry, actor) {
        if (this._destroyed) return;

        entry.actors.delete(actor);
        // No actor shows this emote anymore: free the decoded frames and,
        // if it was the last one, the timer stops.
        if (entry.actors.size === 0 && this._entries.get(entry.path) === entry)
            this._entries.delete(entry.path);
        this._updateTimer();
    }

    // --- Stills (rule 4 fallback) -------------------------------------------

    _getStill(path) {
        let still = this._stills.get(path);
        if (still) return still;

        try {
            // For a GIF this loads only the first frame.
            const pixbuf = GdkPixbuf.Pixbuf.new_from_file(path);
            still = this._createSurface(pixbuf);
        } catch (e) {
            this._warnOnce(`cannot load still ${path}: ${e}`);
            return null;
        }

        if (this._stills.size >= MAX_STILLS)
            this._stills.clear(); // actors keep their own reference to the content
        this._stills.set(path, still);
        return still;
    }

    // --- Helpers ------------------------------------------------------------

    _actorFrom(frame, size) {
        const actor = new St.DrawingArea({
            width: Math.max(1, Math.round(size * frame.w / frame.h)),
            height: size,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: false,
        });
        actor.connect('repaint', () => {
            const [surfaceWidth, surfaceHeight] = actor.get_surface_size();
            if (surfaceWidth <= 0 || surfaceHeight <= 0) return;

            const cr = actor.get_context();
            cr.scale(surfaceWidth / frame.w, surfaceHeight / frame.h);
            cr.setSourceSurface(frame.surface, 0, 0);
            cr.paint();
            cr.$dispose();
        });
        actor.queue_repaint();
        return actor;
    }

    _createSurface(pixbuf) {
        const sourceWidth = pixbuf.get_width();
        const sourceHeight = pixbuf.get_height();
        const scale = Math.min(1, MAX_FRAME_SIZE / Math.max(sourceWidth, sourceHeight));
        const w = Math.max(1, Math.round(sourceWidth * scale));
        const h = Math.max(1, Math.round(sourceHeight * scale));
        const frame = scale < 1
            ? pixbuf.scale_simple(w, h, GdkPixbuf.InterpType.BILINEAR)
            : pixbuf;
        if (!frame) throw new Error('Could not scale emote frame');

        const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, w, h);
        this._drawPixbuf(surface, frame);
        return {surface, w, h, sourceWidth, sourceHeight};
    }

    _upload(entry, pixbuf) {
        try {
            if (pixbuf.get_width() !== entry.sourceWidth ||
                pixbuf.get_height() !== entry.sourceHeight) {
                this._warnOnce(`animation frame dimensions changed for ${entry.path}`);
                return;
            }

            const scale = Math.min(1, MAX_FRAME_SIZE / Math.max(entry.sourceWidth, entry.sourceHeight));
            const frame = scale < 1
                ? pixbuf.scale_simple(entry.w, entry.h, GdkPixbuf.InterpType.BILINEAR)
                : pixbuf;
            if (!frame) throw new Error('Could not scale animation frame');
            this._drawPixbuf(entry.surface, frame);
            for (const actor of entry.actors)
                actor.queue_repaint();
        } catch (e) {
            this._warnOnce(`frame upload failed for ${entry.path}: ${e}`);
        }
    }

    _drawPixbuf(surface, pixbuf) {
        const source = pixbuf.get_pixels();
        const sourceStride = pixbuf.get_rowstride();
        const channels = pixbuf.get_n_channels();
        const hasAlpha = pixbuf.get_has_alpha();
        const width = pixbuf.get_width();
        const height = pixbuf.get_height();
        const cr = new Cairo.Context(surface);
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);
        for (let y = 0; y < height; y++) {
            let x = 0;
            while (x < width) {
                const offset = y * sourceStride + x * channels;
                const red = source[offset];
                const green = source[offset + 1];
                const blue = source[offset + 2];
                const alpha = hasAlpha ? source[offset + 3] : 255;
                let end = x + 1;
                while (end < width) {
                    const next = y * sourceStride + end * channels;
                    if (source[next] !== red || source[next + 1] !== green ||
                        source[next + 2] !== blue ||
                        (hasAlpha && source[next + 3] !== alpha))
                        break;
                    end++;
                }
                cr.setSourceRGBA(red / 255, green / 255, blue / 255, alpha / 255);
                cr.rectangle(x, y, end - x, 1);
                cr.fill();
                x = end;
            }
        }
        cr.$dispose();
    }

    _warnOnce(message) {
        if (this._warned) return;
        this._warned = true;
        console.warn(`[StreamShell] animator: ${message}`);
    }
}