/**
 * Project Umbra — Theme Registry
 *
 * The 10 visual concepts (§6) are parameter presets over the six engines
 * (§5.1). This maps each theme id to its engine and default parameters.
 * `createUmbraTheme()` instantiates the right engine with merged params
 * (theme defaults overlaid by any state-supplied theme_parameters).
 */

(function () {
    const THEMES = {
        // --- E1: Point / Particle Field ---
        'cosmic-drift': {
            engine: 'E1',
            params: {
                mode: 'starfield', density: 0.5, baseBrightness: 1.0,
                driftSpeed: 0.08, parallaxLayers: 4, cellsDown: 14, starScale: 1.8,
            },
        },
        'dust-motes': {
            engine: 'E1',
            params: {
                mode: 'brownian', density: 0.5, baseBrightness: 0.6,
                cellsDown: 8, wander: 0.45, moteSize: 1.3, driftSpeed: 0.01,
            },
        },

        // --- E2: Advected Noise Field ---
        'abyssal-fluid': {
            engine: 'E2',
            params: {
                variant: 'fluid', scale: 2.2, timeScale: 0.03, octaves: 4,
                contrast: 0.5, palette: [[10, 16, 28], [70, 110, 160]],
                centralSuppression: 0.6, curl: true,
            },
        },
        'volumetric-smoke': {
            engine: 'E2',
            params: {
                variant: 'smoke', scale: 2.6, timeScale: 0.04, octaves: 5,
                contrast: 0.45, palette: [[8, 8, 12], [140, 140, 155]],
                airflow: [1.0, -0.25], centralSuppression: 0.35, edgeFade: true,
            },
        },
        'glacial-nebula': {
            engine: 'E2',
            params: {
                variant: 'nebula', scale: 1.6, timeScale: 0.015, octaves: 5,
                contrast: 0.4, palette: [[8, 14, 30], [70, 55, 130], [50, 130, 165]],
                centralSuppression: 0.7,
            },
        },

        // --- E3: Falling Column ---
        'macro-rain': {
            engine: 'E3',
            params: {
                variant: 'rain', columns: 26, fallSpeed: 0.04, opacity: 0.1,
                trailLength: 0.35, thickness: 2.4, blur: true,
            },
        },
        'digital-rainfall': {
            engine: 'E3',
            params: {
                variant: 'glyph', columns: 34, fallSpeed: 0.06, opacity: 0.11,
                trailLength: 0.22, glyphSize: 14,
            },
        },

        // --- E4: Procedural Grid ---
        'the-slow-matrix': {
            engine: 'E4',
            params: {
                spacing: 0.14, gridOpacity: 0.05, pulseOpacity: 0.11,
                pulseSpeed: 0.05, pulseDensity: 0.25,
            },
        },

        // --- E5: Banded Field ---
        'strata-shift': {
            engine: 'E5',
            params: {
                bands: 8, speedVariation: 0.5, contrast: 0.08,
                seamBlur: 0.4, baseSpeed: 0.01,
            },
        },

        // --- E6: Edge / Peripheral Mask ---
        'solar-corona': {
            engine: 'E6',
            params: {
                edgeWidthInner: 0.12, maxGlowBrightness: 0.6, warmth: 0.6,
                flickerSpeed: 0.15, flickerAmount: 0.2,
            },
        },
    };

    function createUmbraTheme(themeId, options) {
        const def = THEMES[themeId];
        if (!def) {
            console.warn('[umbra] Unknown theme:', themeId);
            return null;
        }
        const Engine = (window.UMBRA_ENGINES || {})[def.engine];
        if (!Engine) {
            console.warn('[umbra] Engine not loaded:', def.engine, 'for', themeId);
            return null;
        }
        const params = Object.assign({}, def.params, options.stateParams || {});
        return new Engine(Object.assign({}, options, { themeId, params }));
    }

    window.UMBRA_THEME_DEFS = THEMES;
    window.createUmbraTheme = createUmbraTheme;
})();
