/**
 * Project Umbra — Value Noise / fBm
 *
 * Lightweight seeded value noise for the E2 advected-noise engine (§5.1, §6.2).
 * Canvas-2D friendly: cheap enough to sample a small offscreen buffer each
 * frame and upscale. Deterministic from a seed so every player renders the
 * same field (§5.4).
 */

(function () {
    function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function lerp(a, b, t) { return a + (b - a) * t; }

    class UmbraNoise {
        constructor(seed) {
            this.seed = seed >>> 0;
        }

        // Deterministic hash for an integer lattice point -> [0,1)
        _hash(ix, iy) {
            let h = (ix * 374761393 + iy * 668265263 + this.seed * 2654435761) >>> 0;
            h = (h ^ (h >>> 13)) >>> 0;
            h = (h * 1274126177) >>> 0;
            return (h >>> 0) / 4294967296;
        }

        /** 2D value noise in [0,1]. */
        value(x, y) {
            const x0 = Math.floor(x), y0 = Math.floor(y);
            const fx = fade(x - x0), fy = fade(y - y0);
            const v00 = this._hash(x0, y0);
            const v10 = this._hash(x0 + 1, y0);
            const v01 = this._hash(x0, y0 + 1);
            const v11 = this._hash(x0 + 1, y0 + 1);
            return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
        }

        /** Fractal Brownian motion (sum of octaves) in [0,1]. */
        fbm(x, y, octaves, lacunarity, gain) {
            octaves = octaves || 4;
            lacunarity = lacunarity || 2.0;
            gain = gain || 0.5;
            let amp = 0.5, freq = 1.0, sum = 0, norm = 0;
            for (let i = 0; i < octaves; i++) {
                sum += amp * this.value(x * freq, y * freq);
                norm += amp;
                amp *= gain;
                freq *= lacunarity;
            }
            return sum / norm;
        }
    }

    window.UmbraNoise = UmbraNoise;
})();
