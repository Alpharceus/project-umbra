/**
 * Project Umbra — Engine E6: Edge / Peripheral Mask
 *
 * Screen-relative edge-distance glow with slow modulation (§5.1, §6.8).
 * Theme: Solar Corona. Always local/normalized — no cross-screen continuity
 * (the glow hugs every screen's own edges).
 */

(function () {
    class EdgeMaskEngine extends EngineBase {
        constructor(options) {
            super(options);
            this.id = options.themeId || 'edge-mask';
            this.noiseOffsets = [];
            for (let i = 0; i < 8; i++) {
                this.noiseOffsets.push(UmbraRenderer.hash(this.seed, i, 999) * 100);
            }
        }

        render(ctx, viewport, brightness) {
            const w = viewport.width, h = viewport.height;
            UmbraRenderer.clear(ctx, w, h);

            const t = this.visualTime;
            const warmth = this.p('warmth', 0.6);
            const edgeInner = this.p('edgeWidthInner', 0.12);
            const maxGlow = this.p('maxGlowBrightness', 0.6) * (this.state.contrast_scale ?? 1.0);
            const flickerSpeed = this.p('flickerSpeed', 0.15);
            const flickerAmount = this.p('flickerAmount', 0.2);

            const r = Math.round(180 + warmth * 60);
            const g = Math.round(120 + warmth * 30);
            const b = Math.round(60 - warmth * 20);

            const flick = (a, b2) =>
                1.0 + flickerAmount *
                Math.sin(t * flickerSpeed + this.noiseOffsets[a]) *
                Math.sin(t * flickerSpeed * b2 + this.noiseOffsets[a + 1]);

            const edgePxH = h * edgeInner;
            const edgePxW = w * edgeInner;

            this._edge(ctx, 'top', w, h, edgePxH, r, g, b, maxGlow, flick(0, 0.7));
            this._edge(ctx, 'bottom', w, h, edgePxH, r, g, b, maxGlow, flick(2, 0.6));
            this._edge(ctx, 'left', w, h, edgePxW, r, g, b, maxGlow, flick(4, 0.8));
            this._edge(ctx, 'right', w, h, edgePxW, r, g, b, maxGlow, flick(6, 0.5));

            UmbraRenderer.applyBrightness(ctx, w, h, brightness);
        }

        _edge(ctx, edge, w, h, edgePx, r, g, b, maxGlow, flicker) {
            const alpha = maxGlow * Math.max(0, flicker);
            const c0 = `rgba(${r}, ${g}, ${b}, ${alpha})`;
            const c1 = `rgba(${r}, ${g}, ${b}, 0)`;
            let grad, x, y, gw, gh;
            switch (edge) {
                case 'top': grad = ctx.createLinearGradient(0, 0, 0, edgePx); x = 0; y = 0; gw = w; gh = edgePx; break;
                case 'bottom': grad = ctx.createLinearGradient(0, h, 0, h - edgePx); x = 0; y = h - edgePx; gw = w; gh = edgePx; break;
                case 'left': grad = ctx.createLinearGradient(0, 0, edgePx, 0); x = 0; y = 0; gw = edgePx; gh = h; break;
                default: grad = ctx.createLinearGradient(w, 0, w - edgePx, 0); x = w - edgePx; y = 0; gw = edgePx; gh = h; break;
            }
            grad.addColorStop(0, c0);
            grad.addColorStop(1, c1);
            ctx.fillStyle = grad;
            ctx.fillRect(x, y, gw, gh);
        }
    }

    window.UMBRA_ENGINES.E6 = EdgeMaskEngine;
})();
