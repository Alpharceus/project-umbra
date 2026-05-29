"""
Conductor — Sync Message Types

Defines all WebSocket message types exchanged between the Conductor,
Players, and Dashboard clients. See design doc §3.4.

Conductor → Player:
    STATE_SNAPSHOT, STATE_PATCH, CLOCK_SYNC, IDENTIFY, DEVICE_SETTINGS
    (sleep/wake and theme transitions are carried inside STATE_PATCH, not as
    separate message types.)

Player → Conductor:
    HELLO, TELEMETRY, HEARTBEAT, CLOCK_REPLY

Dashboard → Conductor:
    SET_THEME, SET_BRIGHTNESS, SET_MOTION/CONTRAST/DENSITY, SET_SLEEP,
    APPLY_PRESET, SET_DEVICE_ROLE/BRIGHTNESS/LAYOUT, SET_GLOBAL_COORD,
    IDENTIFY_DEVICE, SAVE_PRESET, REQUEST_DEVICE_LIST

Conductor → Dashboard:
    STATE_SNAPSHOT, STATE_PATCH, DEVICE_LIST
"""

from enum import Enum


# ---------------------------------------------------------------------------
# Message Type Enums
# ---------------------------------------------------------------------------

class ConductorMessage(str, Enum):
    """Messages sent from Conductor to clients."""
    STATE_SNAPSHOT = "STATE_SNAPSHOT"
    STATE_PATCH = "STATE_PATCH"
    CLOCK_SYNC = "CLOCK_SYNC"
    IDENTIFY = "IDENTIFY"
    DEVICE_LIST = "DEVICE_LIST"
    DEVICE_SETTINGS = "DEVICE_SETTINGS"  # push per-device role/modifier/layout (§9, §7.4, §4.4)


class PlayerMessage(str, Enum):
    """Messages sent from Player to Conductor."""
    HELLO = "HELLO"
    TELEMETRY = "TELEMETRY"
    HEARTBEAT = "HEARTBEAT"
    CLOCK_REPLY = "CLOCK_REPLY"
    USER_HINT = "USER_HINT"  # [P2]


class DashboardMessage(str, Enum):
    """Messages sent from Dashboard to Conductor."""
    SET_THEME = "SET_THEME"
    SET_BRIGHTNESS = "SET_BRIGHTNESS"
    SET_MOTION = "SET_MOTION"
    SET_CONTRAST = "SET_CONTRAST"
    SET_DENSITY = "SET_DENSITY"
    SET_SLEEP = "SET_SLEEP"
    APPLY_PRESET = "APPLY_PRESET"
    SET_DEVICE_ROLE = "SET_DEVICE_ROLE"
    REQUEST_DEVICE_LIST = "REQUEST_DEVICE_LIST"
    # P2 additions
    SET_GLOBAL_COORD = "SET_GLOBAL_COORD"        # toggle cross-screen continuity
    SET_DEVICE_BRIGHTNESS = "SET_DEVICE_BRIGHTNESS"  # per-device calibration (§7.4)
    SET_DEVICE_LAYOUT = "SET_DEVICE_LAYOUT"      # room-layout placement (§4.4)
    IDENTIFY_DEVICE = "IDENTIFY_DEVICE"          # briefly label a screen (§3.4)
    SAVE_PRESET = "SAVE_PRESET"                  # persist a named preset (§11)


# ---------------------------------------------------------------------------
# Message Builders
# ---------------------------------------------------------------------------

def build_snapshot(state_data: dict) -> dict:
    """Build a STATE_SNAPSHOT message."""
    return {
        "type": ConductorMessage.STATE_SNAPSHOT,
        "data": state_data,
    }


def build_identify(device_id: str, label: str, duration_s: float = 3.0) -> dict:
    """Ask a specific player to briefly show its identity label."""
    return {
        "type": ConductorMessage.IDENTIFY,
        "device_id": device_id,
        "label": label,
        "duration": duration_s,
    }


def build_device_list(devices: list[dict]) -> dict:
    return {
        "type": ConductorMessage.DEVICE_LIST,
        "devices": devices,
    }


def build_device_settings(device: dict) -> dict:
    """Push a player its own per-device settings: role, brightness modifier, layout."""
    return {
        "type": ConductorMessage.DEVICE_SETTINGS,
        "role": device.get("role"),
        "brightness_modifier": device.get("brightness_modifier", 1.0),
        "layout": device.get("layout"),
    }
