/**
 * Project Umbra — Shared Protocol Definitions
 *
 * Message type constants used by both Player and Dashboard clients.
 * Mirror of conductor/sync/messages.py.
 * See design doc §3.4.
 */

const UMBRA_PROTOCOL = Object.freeze({
    // Conductor → Client
    STATE_SNAPSHOT: 'STATE_SNAPSHOT',
    STATE_PATCH: 'STATE_PATCH',
    CLOCK_SYNC: 'CLOCK_SYNC',
    IDENTIFY: 'IDENTIFY',
    DEVICE_LIST: 'DEVICE_LIST',
    DEVICE_SETTINGS: 'DEVICE_SETTINGS',

    // Player → Conductor
    HELLO: 'HELLO',
    TELEMETRY: 'TELEMETRY',
    HEARTBEAT: 'HEARTBEAT',
    CLOCK_REPLY: 'CLOCK_REPLY',
    USER_HINT: 'USER_HINT', // [P2]

    // Dashboard → Conductor
    SET_THEME: 'SET_THEME',
    SET_BRIGHTNESS: 'SET_BRIGHTNESS',
    SET_MOTION: 'SET_MOTION',
    SET_CONTRAST: 'SET_CONTRAST',
    SET_DENSITY: 'SET_DENSITY',
    SET_SLEEP: 'SET_SLEEP',
    APPLY_PRESET: 'APPLY_PRESET',
    SET_DEVICE_ROLE: 'SET_DEVICE_ROLE',
    REQUEST_DEVICE_LIST: 'REQUEST_DEVICE_LIST',
    SET_GLOBAL_COORD: 'SET_GLOBAL_COORD',
    SET_DEVICE_BRIGHTNESS: 'SET_DEVICE_BRIGHTNESS',
    SET_DEVICE_LAYOUT: 'SET_DEVICE_LAYOUT',
    IDENTIFY_DEVICE: 'IDENTIFY_DEVICE',
    SAVE_PRESET: 'SAVE_PRESET',
});
