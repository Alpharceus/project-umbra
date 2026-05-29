/**
 * Project Umbra — Engine E1: Point / Particle Field
 *
 * Deterministic or simulated particles with optional depth/parallax (§5.1).
 * Themes: Cosmic Drift (starfield) and Dust Motes (brownian).
 *
 * Stars are drawn as cached radial-glow sprites blended additively, in a few
 * colour temperatures, with twinkle, occasional bright "hero" stars, and a
 * faint drifting nebula backdrop for depth — richer than flat dots while
 * staying ambient. Cached sprites keep it cheap; world coordinates keep the
 * field continuous across screens (§4.4).
 */

(function () {
    // Star colour temperatures (RGB).
    const STAR_COLORS = [
        [220, 228, 250], // cool white
        [235, 240, 252], // white
        [150, 188, 255], // blue
        [255, 222, 172], // warm gold
        [180, 255, 240], // cyan
    ];
    const NEBULA_COLORS = [
        [40, 60, 130],   // deep blue
        [70, 45, 120],   // violet
        [30, 80, 110],   // teal
    ];
    const SPRITE_PX = 64;

    function makeGlowSprite(rgb) {
        const c = document.createElement('canvas');
        c.width = SPRITE_PX; c.height = SPRITE_PX;
        const g = c.getContext('2d');
        const r = SPRITE_PX / 2;
        const grad = g.createRadialGradient(r, r, 0, r, r, r);
        const [cr, cg, cb] = rgb;
        grad.addColorStop(0.0, `rgba(${cr}, ${cg}, ${cb}, 1)`);
        grad.addColorStop(0.25, `rgba(${cr}, ${cg}, ${cb}, 0.55)`);
        grad.addColorStop(1.0, `rgba(${cr}, ${cg}, ${cb}, 0)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
        return c;
    }

    class PointFieldEngine extends EngineBase {
        constructor(options) {
            super(options);
            this.id = options.themeId || 'point-field';
            this.mode = this.p('mode', 'starfield');
            this._noise = new UmbraNoise(this.seed);
            this._starSprites = STAR_COLORS.map(makeGlowSprite);
            this._nebulaSprites = NEBULA_COLORS.map(makeGlowSprite);
        }

        render(ctx, viewport, brightness) {
            const w = viewport.width, h = viewport.height;
            UmbraRenderer.clear(ctx, w, h);
            if (this.mode === 'brownian') {
                this._renderMotes(ctx, viewport);
            } else {
                this._renderStarfield(ctx, viewport);
            }
            UmbraRenderer.applyBrightness(ctx, w, h, brightness);
        }

        // ----- Cosmic Drift -----

        _renderStarfield(ctx, viewport) {
            const w = viewport.width, h = viewport.height;
            const t = this.visualTime;
            const layers = this.p('parallaxLayers', 4);
            const density = this.p('density', 0.5) * (this.state.density_scale ?? 1);
            const baseBrightness = this.p('baseBrightness', 1.0);
            const cellsDown = this.p('cellsDown', 14);
            const driftSpeed = this.p('driftSpeed', 0.08);
            const starScale = this.p('starScale', 1.8);
            const contrast = this.state.contrast_scale ?? 1.0;

            const bounds = this.worldBounds(viewport);

            this._drawNebula(ctx, viewport, bounds, t);

            ctx.globalCompositeOperation = 'lighter'; // glows add for depth/richness
            const rect = bounds.rect;

            for (let li = 0; li < layers; li++) {
                const depth = 1 - (li / layers) * 0.7;       // 1 far → 0.3 near
                const driftMult = 0.2 + (1 - depth) * 0.8;
                const brightScale = 0.4 + depth * 0.6;
                const sizeScale = 0.5 + (1 - depth) * 1.6;
                const cellSize = (1 / cellsDown) * (0.7 + depth * 0.6);

                const driftX = t * driftSpeed * driftMult;
                const driftY = t * driftSpeed * 0.4 * driftMult;

                const sCX = Math.floor((bounds.minX - driftX) / cellSize) - 1;
                const eCX = Math.ceil((bounds.maxX - driftX) / cellSize) + 1;
                const sCY = Math.floor((bounds.minY - driftY) / cellSize) - 1;
                const eCY = Math.ceil((bounds.maxY - driftY) / cellSize) + 1;

                for (let cx = sCX; cx <= eCX; cx++) {
                    for (let cy = sCY; cy <= eCY; cy++) {
                        if (UmbraRenderer.hash(this.seed, li, cx, cy) > density) continue;

                        const px = UmbraRenderer.hash(this.seed + 1, li, cx, cy);
                        const py = UmbraRenderer.hash(this.seed + 2, li, cx, cy);
                        const wx = (cx + px) * cellSize + driftX;
                        const wy = (cy + py) * cellSize + driftY;

                        const pix = this.worldToPixel(wx, wy, rect, viewport);
                        if (!pix.inside) continue;

                        const u = pix.x / w, v = pix.y / h;
                        const edgeDist = Math.min(u, 1 - u, v, 1 - v);
                        const edgeBias = 1 - 0.45 * UmbraRenderer.smoothstep(0, 0.3, edgeDist);

                        const bh = UmbraRenderer.hash(this.seed + 3, li, cx, cy);
                        const sh = UmbraRenderer.hash(this.seed + 4, li, cx, cy);
                        const tw = UmbraRenderer.hash(this.seed + 5, li, cx, cy);
                        const ch = UmbraRenderer.hash(this.seed + 6, li, cx, cy);

                        // A few stars are bright "hero" stars that twinkle more.
                        const isHero = bh > 0.93;
                        const twAmp = isHero ? 0.4 : 0.22;
                        const twinkle = (1 - twAmp) + twAmp * Math.sin(t * (isHero ? 1.1 : 0.7) + tw * 6.2832);

                        let a = baseBrightness * brightScale * twinkle
                            * (0.5 + bh * 0.5) * edgeBias * (0.7 + 0.3 * contrast);
                        if (isHero) a *= 1.5;
                        a = Math.min(a, 1.0);
                        if (a < 0.02) continue;

                        const size = Math.max(1.2, (0.6 + sh * 1.8) * sizeScale * starScale) * (isHero ? 1.6 : 1);
                        const glow = size * 3.2;
                        const sprite = this._starSprites[Math.floor(ch * STAR_COLORS.length) % STAR_COLORS.length];

                        ctx.globalAlpha = a;
                        ctx.drawImage(sprite, pix.x - glow, pix.y - glow, glow * 2, glow * 2);
                    }
                }
            }

            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
        }

        _drawNebula(ctx, viewport, bounds, t) {
            const w = viewport.width, h = viewport.height;
            const span = Math.max(0.001, bounds.maxX - bounds.minX);
            const baseR = Math.max(w, h) * 0.5;
            ctx.globalCompositeOperation = 'lighter';
            for (let i = 0; i < 3; i++) {
                const drift = t * 0.012 * (0.4 + i * 0.3);
                const bx = bounds.minX - 0.3 * span
                    + ((UmbraRenderer.hash(this.seed + 30, i) + drift) % 1.6) * span;
                const by = bounds.minY + UmbraRenderer.hash(this.seed + 31, i) * (bounds.maxY - bounds.minY);
                const pix = this.worldToPixel(bx, by, bounds.rect, viewport);
                const r = baseR * (0.8 + UmbraRenderer.hash(this.seed + 32, i) * 0.8);
                ctx.globalAlpha = 0.10;
                ctx.drawImage(this._nebulaSprites[i % this._nebulaSprites.length],
                    pix.x - r, pix.y - r, r * 2, r * 2);
            }
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
        }

        // ----- Dust Motes -----

        _renderMotes(ctx, viewport) {
            const w = viewport.width, h = viewport.height;
            const t = this.visualTime;
            const noise = this._noise;
            const density = this.p('density', 0.5) * (this.state.density_scale ?? 1);
            const cellsDown = this.p('cellsDown', 8);
            const baseBrightness = this.p('baseBrightness', 0.7);
            const moteSize = this.p('moteSize', 1.3);

            const { rect, minX, minY, maxX, maxY } = this.worldBounds(viewport);
            const cellSize = 1 / cellsDown;
            const wander = this.p('wander', 0.45) * cellSize;

            const sCX = Math.floor(minX / cellSize) - 1;
            const eCX = Math.ceil(maxX / cellSize) + 1;
            const sCY = Math.floor(minY / cellSize) - 1;
            const eCY = Math.ceil(maxY / cellSize) + 1;

            ctx.globalCompositeOperation = 'lighter';
            for (let cx = sCX; cx <= eCX; cx++) {
                for (let cy = sCY; cy <= eCY; cy++) {
                    if (UmbraRenderer.hash(this.seed, cx, cy) > density) continue;

                    const depth = 0.3 + UmbraRenderer.hash(this.seed + 7, cx, cy) * 0.7;
                    const bx = (cx + UmbraRenderer.hash(this.seed + 1, cx, cy)) * cellSize;
                    const by = (cy + UmbraRenderer.hash(this.seed + 2, cx, cy)) * cellSize;
                    const wx = bx + wander * (noise.value(cx * 1.3 + cy * 2.1, t * 0.05 / depth) - 0.5) * 2;
                    const wy = by + wander * (noise.value(cx * 2.7 + cy * 1.1 + 99, t * 0.045 / depth) - 0.5) * 2;

                    const pix = this.worldToPixel(wx, wy, rect, viewport);
                    if (!pix.inside) continue;

                    const u = pix.x / w, v = pix.y / h;
                    const edgeDist = Math.min(u, 1 - u, v, 1 - v);
                    const edgeBias = 0.5 + 0.5 * UmbraRenderer.smoothstep(0, 0.22, edgeDist);

                    const size = Math.max(1.0, moteSize / depth) * (this.resolutionScale || 1);
                    const glow = size * 3.0;
                    let a = baseBrightness * (0.4 + 0.6 * (1 - depth)) * edgeBias;
                    a = Math.min(a, 0.9);
                    if (a < 0.02) continue;

                    const ch = UmbraRenderer.hash(this.seed + 8, cx, cy);
                    const sprite = this._starSprites[Math.floor(ch * STAR_COLORS.length) % STAR_COLORS.length];
                    ctx.globalAlpha = a;
                    ctx.drawImage(sprite, pix.x - glow, pix.y - glow, glow * 2, glow * 2);
                }
            }
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
        }
    }

    window.UMBRA_ENGINES.E1 = PointFieldEngine;
})();
