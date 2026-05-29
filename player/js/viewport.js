/**
 * Project Umbra — Viewport Manager
 *
 * Manages canvas sizing, aspect ratio, and coordinate space transforms.
 * See design doc §4.3 and §4.8.
 *
 * Coordinate Spaces:
 *   - Pixel Space [P1]: device-local physical pixels
 *   - Normalized Viewport Space [P1]: u,v ∈ [0,1]
 *   - Aspect-Correct Local Space [P1]: preserves circles on any aspect ratio
 *   - Global Room Space [P2]: shared 2D plane across all displays
 */

class UmbraViewport {
    constructor(canvas) {
        this.canvas = canvas;
        this.update();
    }

    /**
     * Recalculate dimensions. Called on resize and init.
     * Match canvas to device pixels: canvas.width = CSS_width * devicePixelRatio
     */
    update() {
        const dpr = window.devicePixelRatio || 1;
        const cssWidth = window.innerWidth;
        const cssHeight = window.innerHeight;

        this.canvas.style.width = cssWidth + 'px';
        this.canvas.style.height = cssHeight + 'px';
        this.canvas.width = Math.round(cssWidth * dpr);
        this.canvas.height = Math.round(cssHeight * dpr);

        this.width = this.canvas.width;
        this.height = this.canvas.height;
        this.cssWidth = cssWidth;
        this.cssHeight = cssHeight;
        this.dpr = dpr;
        this.aspect = this.width / this.height;
    }

    /**
     * Get viewport info for HELLO / TELEMETRY messages.
     */
    getInfo() {
        return {
            width_px: this.width,
            height_px: this.height,
            device_pixel_ratio: this.dpr,
            orientation: this.width >= this.height ? 'landscape' : 'portrait',
        };
    }
}
