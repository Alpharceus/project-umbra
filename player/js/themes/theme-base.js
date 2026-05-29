/**
 * Project Umbra — Theme Base Class
 *
 * All themes extend this base. Themes never own global state; they receive it.
 * See design doc §5.2 for the theme interface contract.
 *
 * Theme Interface:
 *   - initialize(seed, device_context, room_context)
 *   - update(global_time, delta_time, state)
 *   - render(canvas_or_webgl_context)
 *   - transition_in(progress) / transition_out(progress)
 *   - degrade_quality(performance_level)
 */

class ThemeBase {
    /**
     * @param {object} options
     * @param {string} options.id - Theme identifier
     * @param {number} options.seed - Global seed for deterministic generation
     * @param {UmbraViewport} options.viewport - Viewport manager
     * @param {object} options.state - Current UmbraState
     */
    constructor(options) {
        this.id = options.id || 'unknown';
        this.seed = options.seed || 42;
        this.viewport = options.viewport;
        this.state = options.state || {};
        this.visualTime = 0;
        this.qualityLevel = 'normal'; // normal | reduced | minimal
    }

    /**
     * Advance the theme simulation by delta_time seconds.
     * @param {number} visualTime - Synchronized visual time (§5.5)
     * @param {number} deltaTime - Seconds since last frame
     * @param {object} state - Current UmbraState
     */
    update(visualTime, deltaTime, state) {
        this.visualTime = visualTime;
        this.state = state;
    }

    /**
     * Render the current frame to the canvas context.
     * @param {CanvasRenderingContext2D} ctx
     * @param {UmbraViewport} viewport
     * @param {number} brightness - Global brightness (0.0–1.0)
     */
    render(ctx, viewport, brightness) {
        // Subclasses override this
        UmbraRenderer.clear(ctx, viewport.width, viewport.height);
    }

    /**
     * Reduce quality for performance.
     * @param {string} level - 'normal' | 'reduced' | 'minimal'
     */
    degradeQuality(level) {
        this.qualityLevel = level;
    }

    /**
     * Clean up resources when switching away from this theme.
     */
    destroy() {
        // Override if needed
    }
}
