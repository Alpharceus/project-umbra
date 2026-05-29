/**
 * Project Umbra — Engine E3: Falling Column
 *
 * Screen-relative columns of falling elements with per-column timing (§5.1).
 * Gravity is local down (§6.3). Themes:
 *   rain  — soft dark moisture streaks (Macro Rain)
 *   glyph — sparse columns of abstract falling glyphs (Digital Rainfall)
 */

(function () {
    const GLYPHS = '01╱╲|+=<>/\\:;.*¦†‡▒░§¤◊';

    class FallingColumnEngine extends EngineBase {
        constructor(options) {
            super(options);
            this.id = options.themeId || 'falling-column';
            this.variant = this.p('variant', 'rain');
        }

        _columnCount(viewport) {
            const base = this.p('columns', 28);
            const n = Math.round(base * (viewport.aspect / 1.78));
            return Math.max(6, Math.min(120, n));
        }

        render(ctx, viewport, brightness) {
            const w = viewport.width, h = viewport.height;
            UmbraRenderer.clear(ctx, w, h);
            if (this.variant === 'glyph') this._renderGlyphs(ctx, viewport);
            else this._renderRain(ctx, viewport);
            UmbraRenderer.applyBrightness(ctx, w, h, brightness);
        }

        _renderRain(ctx, viewport) {
            const w = viewport.width, h = viewport.height;
            const t = this.visualTime;
            const nCols = this._columnCount(viewport);
            const colW = w / nCols;
            const fall = this.p('fallSpeed', 0.04);
            const opacity = this.p('opacity', 0.1) * (this.state.contrast_scale ?? 1.0);
            const trail = this.p('trailLength', 0.35);
            const thickness = this.p('thickness', 2.4);

            for (let i = 0; i < nCols; i++) {
                const dropsPer = 1 + Math.floor(UmbraRenderer.hash(this.seed + 3, i) * 2); // 1–2
                for (let dgi = 0; dgi < dropsPer; dgi++) {
                    const speed = fall * (0.5 + UmbraRenderer.hash(this.seed, i, dgi) * 1.2);
                    const phase = UmbraRenderer.hash(this.seed + 1, i, dgi);
                    const xJit = (UmbraRenderer.hash(this.seed + 2, i, dgi) - 0.5) * colW * 0.5;
                    const x = (i + 0.5) * colW + xJit;

                    const cycle = (t * speed + phase) % 1;
                    const headY = cycle * (h * (1 + trail)) - trail * h;
                    const tailY = headY - trail * h;

                    const grad = ctx.createLinearGradient(0, tailY, 0, headY);
                    grad.addColorStop(0, 'rgba(150, 165, 195, 0)');
                    grad.addColorStop(1, `rgba(150, 165, 195, ${opacity})`);
                    ctx.fillStyle = grad;
                    ctx.fillRect(x - thickness / 2, tailY, thickness, headY - tailY);
                }
            }
        }

        _renderGlyphs(ctx, viewport) {
            const w = viewport.width, h = viewport.height;
            const t = this.visualTime;
            const nCols = this._columnCount(viewport);
            const colW = w / nCols;
            const fall = this.p('fallSpeed', 0.06);
            const opacity = this.p('opacity', 0.11) * (this.state.contrast_scale ?? 1.0);
            const trail = this.p('trailLength', 0.22);
            const size = this.p('glyphSize', 14) * (viewport.dpr || 1);

            ctx.font = `${size}px monospace`;
            ctx.textAlign = 'center';
            const step = size * 1.4;
            const trailGlyphs = Math.max(2, Math.round((trail * h) / step));

            for (let i = 0; i < nCols; i++) {
                if (UmbraRenderer.hash(this.seed + 5, i) > 0.8) continue; // sparse columns
                const speed = fall * (0.4 + UmbraRenderer.hash(this.seed, i) * 1.0);
                const phase = UmbraRenderer.hash(this.seed + 1, i);
                const x = (i + 0.5) * colW;
                const headY = ((t * speed + phase) % 1) * (h + trailGlyphs * step);

                for (let g = 0; g < trailGlyphs; g++) {
                    const y = headY - g * step;
                    if (y < -step || y > h + step) continue;
                    const fade = (1 - g / trailGlyphs);
                    const gi = Math.floor(UmbraRenderer.hash(this.seed + 6, i, g, Math.floor(t * speed)) * GLYPHS.length);
                    ctx.fillStyle = `rgba(140, 200, 150, ${opacity * fade})`;
                    ctx.fillText(GLYPHS[gi % GLYPHS.length], x, y);
                }
            }
        }
    }

    window.UMBRA_ENGINES.E3 = FallingColumnEngine;
})();
