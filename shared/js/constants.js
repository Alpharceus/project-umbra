/**
 * Project Umbra — Shared Constants
 *
 * Constants used by both Player and Dashboard clients.
 * Loaded before any other JS module.
 */

const UMBRA_CONSTANTS = Object.freeze({
    // Default rendering
    DEFAULT_TARGET_FPS: 12,

    // Connection
    HEARTBEAT_INTERVAL_MS: 5000,
    RECONNECT_BASE_MS: 1000,
    RECONNECT_MAX_MS: 30000,
    DISCONNECT_SLEEP_TIMEOUT_S: 60,   // §3.9 — fade to black after conductor lost

    // Dimmer modes (§7.1)
    BRIGHTNESS_BLACKOUT: 0.00,
    BRIGHTNESS_SLEEP_GLOW: 0.02,
    BRIGHTNESS_MOVIE_ULTRA_DARK: 0.05,
    BRIGHTNESS_AMBIENT_DARK: 0.10,
    BRIGHTNESS_SETUP: 0.20,

    // Motion modes (§7.5)
    MOTION_FROZEN: 0.00,
    MOTION_ALMOST_STILL: 0.10,
    MOTION_MOVIE: 0.25,
    MOTION_AMBIENT: 0.50,
    MOTION_DEMO: 1.00,

    // Sleep states (§7.2)
    SLEEP_AWAKE: 'awake',
    SLEEP_BLACKOUT: 'blackout',
    SLEEP_FROZEN_DARK: 'frozen_dark',
    SLEEP_IDLE_BREATHING: 'idle_breathing',
    SLEEP_DISCONNECT: 'disconnect_sleep',

    // Themes (P1)
    THEME_COSMIC_DRIFT: 'cosmic-drift',
    THEME_SOLAR_CORONA: 'solar-corona',
});
