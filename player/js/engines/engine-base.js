/**
 * Project Umbra — Engine Base
 *
 * "Build engines, not themes" (§5.1). Themes are parameter presets over a
 * small set of shared rendering engines. EngineBase provides:
 *   - parameter access (theme defaults + state overrides)
 *   - the shared global controls hookup (brightness/motion/contrast/density)
 *   - world-coordinate mapping for cross-screen continuity (§4.4–4.7)
 *   - quality degradation hooks for the performance governor (§7.6)
 *
 * World mapping. Each device is a viewport into a larger room. In LOCAL mode a
 * device's "room rect" is just its own aspect-correct space (origin 0, size
 * aspect×1), so screens render independently. In GLOBAL mode the device's room
 * rect comes from its layout (origin, size in room units, rotation), so a field
 * sampled in world coordinates is continuous across neighbouring screens.
 */

(function () {
    const ROT = { 0: 0, 90: 90, 180: 180, 270: 270 };

    class EngineBase extends ThemeBase {
        constructor(options) {
            super(options);
            this.params = Object.assign({}, options.params || {});
            // Device context for world mapping (§4.4)
            this.deviceLayout = options.deviceLayout || null;
            this.globalMode = !!options.globalMode;
            this.resolutionScale = 1.0; // set by the performance governor
        }

        p(name, fallback) {
            const v = this.params[name];
            return v === undefined ? fallback : v;
        }

        setDeviceContext(layout, globalMode) {
            this.deviceLayout = layout || null;
            this.globalMode = !!globalMode;
        }

        // ---- World-rect for this device (room units) ----

        /**
         * The rectangle in room space that this screen looks into.
         * Local mode: origin (0,0), size aspect×1, no rotation.
         * Global mode (layout present): the device's configured placement.
         */
        worldRect(viewport) {
            const L = this.deviceLayout;
            if (this.globalMode && L && L.width_units && L.height_units) {
                return {
                    ox: L.origin_x || 0,
                    oy: L.origin_y || 0,
                    w: L.width_units,
                    h: L.height_units,
                    rot: ROT[L.rotation] || 0,
                };
            }
            return { ox: 0, oy: 0, w: viewport.aspect, h: 1, rot: 0 };
        }

        /** Apply one of the 4 allowed rotations to normalized coords. */
        _rotNorm(u, v, rot) {
            switch (rot) {
                case 90:  return [v, 1 - u];
                case 180: return [1 - u, 1 - v];
                case 270: return [1 - v, u];
                default:  return [u, v];
            }
        }

        /** Inverse of _rotNorm. */
        _invRotNorm(ru, rv, rot) {
            switch (rot) {
                case 90:  return [1 - rv, ru];
                case 180: return [1 - ru, 1 - rv];
                case 270: return [rv, 1 - ru];
                default:  return [ru, rv];
            }
        }

        /** Device-normalized (u,v) → world point (room units). */
        normalizedToWorld(u, v, rect) {
            const [ru, rv] = this._rotNorm(u, v, rect.rot);
            return { x: rect.ox + ru * rect.w, y: rect.oy + rv * rect.h };
        }

        /** World point (room units) → device pixel. inside flags visibility. */
        worldToPixel(wx, wy, rect, viewport) {
            const ru = (wx - rect.ox) / rect.w;
            const rv = (wy - rect.oy) / rect.h;
            const [u, v] = this._invRotNorm(ru, rv, rect.rot);
            return {
                x: u * viewport.width,
                y: v * viewport.height,
                inside: u >= 0 && u <= 1 && v >= 0 && v <= 1,
            };
        }

        /** World bounding box covering this device's view (for cell iteration). */
        worldBounds(viewport) {
            const rect = this.worldRect(viewport);
            const corners = [
                this.normalizedToWorld(0, 0, rect),
                this.normalizedToWorld(1, 0, rect),
                this.normalizedToWorld(1, 1, rect),
                this.normalizedToWorld(0, 1, rect),
            ];
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const c of corners) {
                if (c.x < minX) minX = c.x;
                if (c.y < minY) minY = c.y;
                if (c.x > maxX) maxX = c.x;
                if (c.y > maxY) maxY = c.y;
            }
            return { rect, minX, minY, maxX, maxY };
        }

        degradeQuality(level) {
            this.qualityLevel = level;
        }
    }

    window.EngineBase = EngineBase;
    window.UMBRA_ENGINES = window.UMBRA_ENGINES || {};
})();
