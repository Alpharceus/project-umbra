/**
 * Project Umbra — Engine E4: Procedural Grid
 *
 * World-space periodic lines with faint pulses travelling along them (§5.1,
 * §6.5) — a dark data lattice, not green Matrix rain. World-space spacing keeps
 * the apparent scale consistent and continuous across screens (§4.4).
 */

(function () {
    class ProceduralGridEngine extends EngineBase {
        constructor(options) {
            super(options);
            this.id = options.themeId || 'procedural-grid';
        }

        render(ctx, viewport, brightness) {
            const w = viewport.width, h = viewport.height;
            UmbraRenderer.clear(ctx, w, h);

            const t = this.visualTime;
            const spacing = this.p('spacing', 0.14);
            const gridOpacity = this.p('gridOpacity', 0.05) * (this.state.contrast_scale ?? 1.0);
            const pulseOpacity = this.p('pulseOpacity', 0.11) * (this.state.contrast_scale ?? 1.0);
            const pulseSpeed = this.p('pulseSpeed', 0.05);
            const pulseDensity = this.p('pulseDensity', 0.25) * (this.state.density_scale ?? 1.0);

            const { rect, minX, minY, maxX, maxY } = this.worldBounds(viewport);
            const lineColor = `rgba(120, 150, 185, ${gridOpacity})`;
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = Math.max(1, (viewport.dpr || 1));

            const iX0 = Math.floor(minX / spacing) - 1, iX1 = Math.ceil(maxX / spacing) + 1;
            const iY0 = Math.floor(minY / spacing) - 1, iY1 = Math.ceil(maxY / spacing) + 1;

            // Vertical world lines
            for (let ix = iX0; ix <= iX1; ix++) {
                const wx = ix * spacing;
                const a = this.worldToPixel(wx, minY, rect, viewport);
                const b = this.worldToPixel(wx, maxY, rect, viewport);
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            }
            // Horizontal world lines
            for (let iy = iY0; iy <= iY1; iy++) {
                const wy = iy * spacing;
                const a = this.worldToPixel(minX, wy, rect, viewport);
                const b = this.worldToPixel(maxX, wy, rect, viewport);
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            }

            // Pulses travelling along vertical lines (edge-biased, sparse).
            for (let ix = iX0; ix <= iX1; ix++) {
                if (UmbraRenderer.hash(this.seed, ix) > pulseDensity) continue;
                const wx = ix * spacing;
                const phase = UmbraRenderer.hash(this.seed + 1, ix);
                const span = maxY - minY;
                const wy = minY + ((t * pulseSpeed + phase) % 1) * span;
                const pix = this.worldToPixel(wx, wy, rect, viewport);
                if (!pix.inside) continue;
                const r = Math.max(1.5, 2.5 * (viewport.dpr || 1));
                const grad = ctx.createRadialGradient(pix.x, pix.y, 0, pix.x, pix.y, r * 4);
                grad.addColorStop(0, `rgba(150, 190, 230, ${pulseOpacity})`);
                grad.addColorStop(1, 'rgba(150, 190, 230, 0)');
                ctx.fillStyle = grad;
                ctx.beginPath(); ctx.arc(pix.x, pix.y, r * 4, 0, 6.2832); ctx.fill();
            }

            UmbraRenderer.applyBrightness(ctx, w, h, brightness);
        }
    }

    window.UMBRA_ENGINES.E4 = ProceduralGridEngine;
})();
