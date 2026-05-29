/**
 * Project Umbra — Engine E5: Banded Field
 *
 * Horizontal bands of noise with per-band offset/speed, sliding against each
 * other like geological strata (§5.1, §6.7). World-space band height keeps
 * layers consistent across vertically-adjacent screens; horizontal motion is
 * continuous across horizontally-adjacent screens (§4.4).
 *
 * Rendered to a small offscreen buffer and upscaled (§4.9).
 */

(function () {
    function clampByte(x) { return x < 0 ? 0 : x > 255 ? 255 : x | 0; }

    class BandedFieldEngine extends EngineBase {
        constructor(options) {
            super(options);
            this.id = options.themeId || 'banded-field';
            this._noise = new UmbraNoise(this.seed);
            this._buf = document.createElement('canvas');
            this._bufCtx = this._buf.getContext('2d');
            this._bufW = 0; this._bufH = 0; this._img = null;
        }

        _ensureBuffer(viewport) {
            const q = this.qualityLevel === 'minimal' ? 0.6
                : this.qualityLevel === 'reduced' ? 0.8 : 1.0;
            const longEdge = Math.max(48, Math.round(160 * q * (this.resolutionScale || 1)));
            let bw, bh;
            if (viewport.aspect >= 1) { bw = longEdge; bh = Math.max(24, Math.round(longEdge / viewport.aspect)); }
            else { bh = longEdge; bw = Math.max(24, Math.round(longEdge * viewport.aspect)); }
            if (bw !== this._bufW || bh !== this._bufH) {
                this._bufW = bw; this._bufH = bh;
                this._buf.width = bw; this._buf.height = bh;
                this._img = this._bufCtx.createImageData(bw, bh);
            }
        }

        render(ctx, viewport, brightness) {
            const w = viewport.width, h = viewport.height;
            UmbraRenderer.clear(ctx, w, h);
            this._ensureBuffer(viewport);

            const bw = this._bufW, bh = this._bufH;
            const data = this._img.data;
            const noise = this._noise;
            const t = this.visualTime;

            const bands = this.p('bands', 8);
            const speedVar = this.p('speedVariation', 0.5);
            const baseSpeed = this.p('baseSpeed', 0.01);
            const contrastP = this.p('contrast', 0.08) * (this.state.contrast_scale ?? 1.0);
            const seamBlur = this.p('seamBlur', 0.4);
            const rect = this.worldRect(viewport);
            const bandH = 1.0 / bands; // world units per band (height of room = 1)

            for (let by = 0; by < bh; by++) {
                const v = (by + 0.5) / bh;
                for (let bx = 0; bx < bw; bx++) {
                    const u = (bx + 0.5) / bw;
                    const world = this.normalizedToWorld(u, v, rect);

                    const bandF = world.y / bandH;
                    const idx = Math.floor(bandF);
                    const frac = bandF - idx;

                    const speed = baseSpeed * (1 + (UmbraRenderer.hash(this.seed, idx) - 0.5) * 2 * speedVar);
                    const bright = 0.35 + UmbraRenderer.hash(this.seed + 1, idx) * 0.5;
                    const offset = speed * t;

                    let n = noise.value(world.x * 3.0 + offset, idx * 7.31);
                    // Soft seams: blend toward neighbour band near edges of the band.
                    const seam = Math.min(frac, 1 - frac);
                    if (seam < seamBlur) {
                        const nIdx = frac < 0.5 ? idx - 1 : idx + 1;
                        const nSpeed = baseSpeed * (1 + (UmbraRenderer.hash(this.seed, nIdx) - 0.5) * 2 * speedVar);
                        const nNoise = noise.value(world.x * 3.0 + nSpeed * t, nIdx * 7.31);
                        const blend = (1 - seam / seamBlur) * 0.5;
                        n = n * (1 - blend) + nNoise * blend;
                    }

                    let lum = bright * (0.5 + (n - 0.5) * (0.3 + contrastP * 6));
                    lum = lum < 0 ? 0 : lum > 1 ? 1 : lum;

                    const o = (by * bw + bx) * 4;
                    // Cool dark strata tint.
                    data[o] = clampByte(lum * 70 + 6);
                    data[o + 1] = clampByte(lum * 78 + 8);
                    data[o + 2] = clampByte(lum * 95 + 12);
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

    window.UMBRA_ENGINES.E5 = BandedFieldEngine;
})();
