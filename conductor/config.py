"""
Conductor — Configuration

Loads configuration from data/config.json with sensible defaults.
All settings are validated via Pydantic.
"""

import json
import sys
from pathlib import Path
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Default Paths
#
# Paths resolve differently when frozen with PyInstaller. Frontend assets are
# bundled read-only (served from the bundle / _MEIPASS), while runtime data
# (config, presets, devices) must stay writable next to the executable.
# ---------------------------------------------------------------------------

def _resource_root() -> Path:
    """Base dir for bundled read-only resources (frontend assets)."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent


def _runtime_root() -> Path:
    """Base dir for writable runtime data — next to the exe (repo root in dev)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent.parent


PROJECT_ROOT = _resource_root()
DATA_DIR = _runtime_root() / "data"
CONFIG_PATH = DATA_DIR / "config.json"
CONFIG_LOCAL_PATH = DATA_DIR / "config.local.json"  # gitignored machine overrides
PRESETS_PATH = DATA_DIR / "presets.json"


# ---------------------------------------------------------------------------
# Settings Model
# ---------------------------------------------------------------------------

class Settings(BaseModel):
    """Conductor server configuration."""

    # Network
    host: str = Field(default="0.0.0.0", description="Bind address")
    port: int = Field(default=8000, description="HTTP/WS port")

    # Defaults
    default_theme: str = Field(
        default="cosmic-drift",
        description="Theme to activate on startup",
    )
    default_brightness: float = Field(
        default=0.60,
        description="Initial brightness level (0.0–1.0). Bright enough to be clearly "
                    "visible as a screensaver on a normal monitor; dim with the "
                    "Movie/Ambient presets for the dark movie-viewing aesthetic.",
    )
    default_motion_scale: float = Field(
        default=0.60,
        description="Initial motion scale (0.0–1.0)",
    )
    default_contrast_scale: float = Field(
        default=0.70,
        description="Initial contrast scale (0.0–1.0)",
    )
    default_density_scale: float = Field(
        default=0.80,
        description="Initial density scale (0.0–1.0)",
    )

    # Timing
    clock_sync_interval_s: float = Field(
        default=30.0,
        description="Seconds between clock-sync exchanges",
    )
    heartbeat_interval_s: float = Field(
        default=5.0,
        description="Seconds between heartbeat pings",
    )
    disconnect_timeout_s: float = Field(
        default=15.0,
        description="Seconds before a silent player is considered disconnected",
    )
    disconnect_sleep_timeout_s: float = Field(
        default=60.0,
        description="Seconds of conductor absence before players self-dim to black",
    )

    # Rendering
    target_fps: int = Field(
        default=12,
        description="Target frame rate for ambient rendering (10–15 recommended)",
    )

    # Screensaver / kiosk
    open_dashboard_on_start: bool = Field(
        default=True,
        description="On startup (exe), open the control dashboard in a browser so "
                    "the user can detect monitors and choose where to run the ambient view.",
    )
    auto_launch_kiosk: bool = Field(
        default=False,
        description="On startup (exe), auto-open a fullscreen player window on EVERY "
                    "monitor. Off by default; the dashboard's monitor picker is preferred.",
    )
    kiosk_debug: bool = Field(
        default=False,
        description="Launch kiosk windows with the on-screen debug overlay. Off by "
                    "default; enable here or append ?debug=1 to a player URL to see "
                    "engine/theme/fps stats on a screen.",
    )


# ---------------------------------------------------------------------------
# Load / Save
# ---------------------------------------------------------------------------

def _read_json(path) -> dict:
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[config] Warning: failed to load {path}: {e}")
    return {}


def load_settings() -> Settings:
    """Load config.json, then overlay machine-specific config.local.json.

    config.local.json is gitignored, so things like the exact bind IP for this
    machine stay out of the repo. Its keys override config.json.
    """
    data = _read_json(CONFIG_PATH)
    data.update(_read_json(CONFIG_LOCAL_PATH))  # local overrides win
    try:
        return Settings(**data)
    except Exception as e:
        print(f"[config] Warning: invalid config ({e}); using defaults.")
        return Settings()


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

settings = load_settings()
