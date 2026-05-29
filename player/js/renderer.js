/**
 * Project Umbra — Renderer Base
 *
 * Provides common rendering utilities used by all themes:
 * canvas clearing, brightness application, resolution scaling,
 * and performance measurement.
 *
 * See design doc §4.9 (resolution scaling) and §7.1 (dimmer logic).
 */

class UmbraRenderer {
    /**
     * Clear the canvas to black.
     */
    static clear(ctx, width, height) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
    }

    /**
     * Apply global brightness as a dimming overlay.
     * final_color = theme_color * global_brightness * display_brightness_modifier
     *
     * This draws a semi-transparent black rectangle over the canvas.
     * brightness 1.0 = no dimming, 0.0 = full black.
     */
    static applyBrightness(ctx, width, height, brightness) {
        if (brightness >= 1.0) return;
        const dimAlpha = 1.0 - Math.max(0, Math.min(1, brightness));
        ctx.fillStyle = `rgba(0, 0, 0, ${dimAlpha})`;
        ctx.fillRect(0, 0, width, height);
    }

    /**
     * Deterministic pseudo-random hash from seed + ids.
     * Used for procedural generation (§5.4):
     * value = hash(seed, object_id, world_cell)
     */
    static hash(seed, ...ids) {
        let h = seed;
        for (const id of ids) {
            h = ((h << 5) - h + id) | 0;
            h = (h * 2654435761) >>> 0;
        }
        return (h >>> 0) / 4294967296; // normalize to [0, 1]
    }

    /**
     * Smooth step function for transitions and edge effects.
     */
    static smoothstep(edge0, edge1, x) {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    }
}
