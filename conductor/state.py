"""
Conductor — State Engine

Owns the canonical UmbraState. All state mutations flow through this module.
Players never independently decide the active theme, brightness, or sleep
status — they render what they receive.

State is versioned: every update carries a monotonically increasing
state_version. If a player misses an update, it requests a full snapshot.
"""

import time
import uuid
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class SleepState(str, Enum):
    AWAKE = "awake"
    BLACKOUT = "blackout"
    FROZEN_DARK = "frozen_dark"
    IDLE_BREATHING = "idle_breathing"
    DISCONNECT_SLEEP = "disconnect_sleep"


class TransitionType(str, Enum):
    NONE = "none"
    FADE_TO_BLACK_THEN_IN = "fade_to_black_then_in"
    CROSSFADE_FIELD = "crossfade_field"          # [P2]
    BRIGHTNESS_DIP = "brightness_dip"            # [P2]
    PARAMETER_MORPH = "parameter_morph"          # [P2]


# ---------------------------------------------------------------------------
# Transition State
# ---------------------------------------------------------------------------

class TransitionState(BaseModel):
    """Tracks an in-progress theme transition."""
    type: TransitionType = TransitionType.NONE
    start_time: float = 0.0
    duration: float = 6.0
    curve: str = "ease-in-out"
    from_theme_id: Optional[str] = None
    to_theme_id: Optional[str] = None
    progress: float = 0.0  # 0.0–1.0, computed


# ---------------------------------------------------------------------------
# UmbraState — The Canonical Room State [P1 core; tagged fields P2/DEFER]
# ---------------------------------------------------------------------------

class UmbraState(BaseModel):
    """
    The single source of truth for the entire Umbra system.
    The Conductor owns this; players receive it via STATE_SNAPSHOT / STATE_PATCH.
    """

    # Identity
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    state_version: int = Field(default=0)

    # Timing
    conductor_time: float = Field(default=0.0)

    # Theme
    active_theme_id: str = Field(default="cosmic-drift")
    previous_theme_id: Optional[str] = None
    theme_parameters: dict = Field(default_factory=dict)
    global_seed: int = Field(default=42)

    # Transition
    transition: TransitionState = Field(default_factory=TransitionState)

    # Global Controls
    brightness: float = Field(default=0.10)
    motion_scale: float = Field(default=0.50)
    contrast_scale: float = Field(default=0.70)
    density_scale: float = Field(default=0.80)
    sleep_state: SleepState = Field(default=SleepState.AWAKE)

    # [P2] Cross-screen continuity (§4.4). When true, world-space engines
    # sample using each device's room layout so the field is continuous
    # across screens. Screen-relative engines ignore it.
    global_coordinate_mode: bool = Field(default=False)

    # [P2] Room layout
    room_layout_id: Optional[str] = None

    # [DEFER] Media-aware hooks — reserved in state model now
    media_state: Optional[str] = None           # playing / paused / stopped
    primary_luminance: Optional[float] = None   # 0.0–1.0


# ---------------------------------------------------------------------------
# State Engine
# ---------------------------------------------------------------------------

class StateEngine:
    """
    Manages the canonical UmbraState. All mutations go through methods here
    so that state_version is bumped and patches can be tracked.
    """

    def __init__(self):
        self.state = UmbraState()
        self._start_time = time.monotonic()

    def initialize(self, settings) -> None:
        """Set initial state from configuration."""
        self.state = UmbraState(
            active_theme_id=settings.default_theme,
            brightness=settings.default_brightness,
            motion_scale=settings.default_motion_scale,
            contrast_scale=settings.default_contrast_scale,
            density_scale=settings.default_density_scale,
        )
        self._start_time = time.monotonic()

    # ----- Queries -----

    def get_snapshot(self) -> dict:
        """Return the full state as a dict for STATE_SNAPSHOT messages."""
        self.state.conductor_time = self._elapsed()
        return self.state.model_dump()

    def get_version(self) -> int:
        return self.state.state_version

    # ----- Mutations (each bumps state_version) -----

    def _bump(self) -> int:
        self.state.state_version += 1
        self.state.conductor_time = self._elapsed()
        return self.state.state_version

    def set_theme(self, theme_id: str, transition_duration: float = 6.0) -> dict:
        """Change the active theme with a transition."""
        self.state.previous_theme_id = self.state.active_theme_id
        self.state.active_theme_id = theme_id
        self.state.transition = TransitionState(
            type=TransitionType.FADE_TO_BLACK_THEN_IN,
            start_time=self._elapsed(),
            duration=transition_duration,
            from_theme_id=self.state.previous_theme_id,
            to_theme_id=theme_id,
        )
        version = self._bump()
        return self._patch("theme_change", version)

    def set_brightness(self, brightness: float) -> dict:
        """Set global brightness (0.0–1.0)."""
        self.state.brightness = max(0.0, min(1.0, brightness))
        version = self._bump()
        return self._patch("brightness", version)

    def set_motion_scale(self, scale: float) -> dict:
        """Set global motion scale (0.0–1.0)."""
        self.state.motion_scale = max(0.0, min(1.0, scale))
        version = self._bump()
        return self._patch("motion_scale", version)

    def set_sleep_state(self, sleep: SleepState) -> dict:
        """Set the global sleep state."""
        self.state.sleep_state = sleep
        version = self._bump()
        return self._patch("sleep_state", version)

    def set_global_coordinate_mode(self, enabled: bool) -> dict:
        """Toggle cross-screen continuity (§4.4)."""
        self.state.global_coordinate_mode = bool(enabled)
        version = self._bump()
        return self._patch("global_coordinate_mode", version)

    def set_contrast_scale(self, scale: float) -> dict:
        """Set global contrast scale (0.0–1.0)."""
        self.state.contrast_scale = max(0.0, min(1.0, scale))
        version = self._bump()
        return self._patch("contrast_scale", version)

    def set_density_scale(self, scale: float) -> dict:
        """Set global density scale (0.0–1.0)."""
        self.state.density_scale = max(0.0, min(1.0, scale))
        version = self._bump()
        return self._patch("density_scale", version)

    def apply_preset(self, preset: dict) -> dict:
        """Apply a named preset (e.g., Movie Mode, Ambient, Sleep Glow)."""
        for key, value in preset.items():
            if key == "active_theme":
                self.state.active_theme_id = value
            elif hasattr(self.state, key):
                setattr(self.state, key, value)
        version = self._bump()
        return self._patch("preset", version)

    # ----- Helpers -----

    def _elapsed(self) -> float:
        """Seconds since conductor start (monotonic)."""
        return time.monotonic() - self._start_time

    def _patch(self, change_type: str, version: int) -> dict:
        """Build a STATE_PATCH message payload."""
        return {
            "type": "STATE_PATCH",
            "change_type": change_type,
            "state_version": version,
            "conductor_time": self.state.conductor_time,
            "data": self.state.model_dump(),
        }


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

state_engine = StateEngine()
