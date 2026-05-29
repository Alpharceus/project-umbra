/**
 * Project Umbra — Engine E2: Advected Noise Field
 *
 * fBm noise sampled as a continuous field, advected over time, gradient-mapped
 * (§5.1, §6.2/§6.4/§6.6). The highest-value engine (three themes) and the
 * riskiest on weak GPUs, so it renders to a small offscreen buffer and upscales
 * smoothly (§4.9) rather than shading every device pixel.
 *
 * Variants:
 *   fluid  — domain-warped (curl-ish) swirl, very low contrast (Abyssal Fluid)
 *   smoke  — density advected along one airflow vector (Volumetric Smoke)
 *   nebula — slow layered fBm, cold palette (Glacial Nebula)
 *
 * Samples in world coordinates (§4.4) so the field is continuous across screens
 * in global mode.
 */

(function () {
    function clampByte(x) { return x < 0 ? 0 : x > 255 ? 255 : x | 0; }

    class NoiseFieldEngine extends EngineBase {
        constructor(options) {
            super(options);
            this.id = options.themeId || 'noise-field';
            this.variant = this.p('variant', 'nebula');
            this._noise = new UmbraNoise(this.seed);
            this._buf = document.createElement('canvas');
            this._bufCtx = this._buf.getContext('2d');
            this._bufW = 0;
            this._bufH = 0;
            this._img = null;
            this._col = [0, 0, 0]; // reused per pixel to avoid GC churn
        }

        _ensureBuffer(viewport) {
            // Long edge ~140px, scaled down further when the governor degrades us.
            const q = this.qualityLevel === 'minimal' ? 0.55
                : this.qualityLevel === 'reduced' ? 0.75 : 1.0;
            const longEdge = Math.max(48, Math.round(140 * q * (this.resolutionScale || 1)));
            let bw, bh;
            if (viewport.aspect >= 1) { bw = longEdge; bh = Math.max(24, Math.round(longEdge / viewport.aspect)); }
            else { bh = longEdge; bw = Math.max(24, Math.round(longEdge * viewport.aspect)); }
            if (bw !== this._bufW || bh !== this._bufH) {
                this._bufW = bw; this._bufH = bh;
                this._buf.width = bw; this._buf.height = bh;
                this._img = this._bufCtx.createImageData(bw, bh);
            }
        }

        _palette(d) {
            const pal = this.p('palette', [[6, 10, 22], [40, 30, 70]]);
            const c = this._col;  // reused, no per-pixel allocation
            if (pal.length === 1) { c[0] = pal[0][0]; c[1] = pal[0][1]; c[2] = pal[0][2]; return c; }
            const seg = d * (pal.length - 1);
            const i = Math.min(pal.length - 2, Math.floor(seg));
            const f = seg - i;
            const a = pal[i], b = pal[i + 1];
            c[0] = a[0] + (b[0] - a[0]) * f;
            c[1] = a[1] + (b[1] - a[1]) * f;
            c[2] = a[2] + (b[2] - a[2]) * f;
            return c;
        }

        render(ctx, viewport, brightness) {
            const w = viewport.width, h = viewport.height;
            UmbraRenderer.clear(ctx, w, h);
            this._ensureBuffer(viewport);

            const bw = this._bufW, bh = this._bufH;
            const data = this._img.data;
            const noise = this._noise;
            const t = this.visualTime;

            const scale = this.p('scale', 2.0);
            const timeScale = this.p('timeScale', 0.03);
            const octaves = this.p('octaves', 4);
            const contrastP = this.p('contrast', 0.45) * (this.state.contrast_scale ?? 1.0);
            const centralSupp = this.p('centralSuppression', 0.5);
            const edgeFade = this.p('edgeFade', false);
            const airflow = this.p('airflow', [1.0, 0.0]);
            const useCurl = this.p('curl', false);
            const rect = this.worldRect(viewport);

            const tShift = t * timeScale;

            for (let by = 0; by < bh; by++) {
                const v = (by + 0.5) / bh;
                for (let bx = 0; bx < bw; bx++) {
                    const u = (bx + 0.5) / bw;
                    const world = this.normalizedToWorld(u, v, rect);
                    let sx = world.x * scale;
                    let sy = world.y * scale;

                    if (this.variant === 'smoke') {
                        sx -= airflow[0] * tShift;
                        sy -= airflow[1] * tShift;
                    }

                    let d;
                    if (useCurl) {
                        // Domain warp for a swirling, fluid look.
                        const wx = noise.value(sx + 5.2 + tShift, sy + 1.3);
                        const wy = noise.value(sx + 1.7, sy + 9.2 - tShift);
                        d = noise.fbm(sx + (wx - 0.5) * 2.0, sy + (wy - 0.5) * 2.0, octaves, 2.0, 0.5);
                    } else {
                        d = noise.fbm(sx + tShift * 0.6, sy - tShift * 0.4, octaves, 2.0, 0.5);
                    }

                    // Contrast around mid-grey, kept low for ambience.
                    d = 0.5 + (d - 0.5) * (0.4 + contrastP);
                    d = d < 0 ? 0 : d > 1 ? 1 : d;

                    // Central suppression + optional edge fade.
                    const edgeDist = Math.min(u, 1 - u, v, 1 - v);
                    const centerVis = UmbraRenderer.smoothstep(0, 0.35, edgeDist);
                    let mul = (1 - centralSupp) + centralSupp * centerVis;
                    if (edgeFade) mul *= UmbraRenderer.smoothstep(0, 0.08, edgeDist);

                    const col = this._palette(d);
                    const o = (by * bw + bx) * 4;
                    data[o] = clampByte(col[0] * d * mul + col[0] * 0.15);
                    data[o + 1] = clampByte(col[1] * d * mul + col[1] * 0.15);
                    data[o + 2] = clampByte(col[2] * d * mul + col[2] * 0.15);
                    data[o + 3] = 255;
                }
            }

            this._bufCtx.putImageData(this._img, 0, 0);
            const smooth = ctx.imageSmoothingEnabled;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(this._buf, 0, 0, bw, bh, 0, 0, w, h);
            ctx.imageSmoothingEnabled = smooth;

            UmbraRenderer.applyBrightness(ctx, w, h, brightness);
        }
    }

    window.UMBRA_ENGINES.E2 = NoiseFieldEngine;
})();
