"""
Tests — State Engine

Validates UmbraState management: versioning, mutations, snapshots, presets.
"""

import pytest
from conductor.state import StateEngine, SleepState


class TestStateEngine:
    def setup_method(self):
        self.engine = StateEngine()

    def test_initial_state(self):
        """State should have version 0 and default values."""
        assert self.engine.get_version() == 0
        snap = self.engine.get_snapshot()
        assert snap["active_theme_id"] == "cosmic-drift"
        assert snap["brightness"] == 0.10
        assert snap["sleep_state"] == "awake"

    def test_version_bumps_on_mutation(self):
        """Every mutation should increment state_version."""
        v0 = self.engine.get_version()
        self.engine.set_brightness(0.5)
        assert self.engine.get_version() == v0 + 1
        self.engine.set_motion_scale(0.3)
        assert self.engine.get_version() == v0 + 2

    def test_set_brightness_clamps(self):
        """Brightness should be clamped to [0.0, 1.0]."""
        self.engine.set_brightness(1.5)
        assert self.engine.state.brightness == 1.0
        self.engine.set_brightness(-0.5)
        assert self.engine.state.brightness == 0.0

    def test_set_theme_creates_transition(self):
        """Setting a theme should populate the transition state."""
        patch = self.engine.set_theme("solar-corona", transition_duration=4.0)
        assert self.engine.state.active_theme_id == "solar-corona"
        assert self.engine.state.previous_theme_id == "cosmic-drift"
        assert self.engine.state.transition.duration == 4.0
        assert patch["change_type"] == "theme_change"

    def test_set_sleep_state(self):
        """Should accept valid sleep states."""
        self.engine.set_sleep_state(SleepState.BLACKOUT)
        assert self.engine.state.sleep_state == SleepState.BLACKOUT
        self.engine.set_sleep_state(SleepState.AWAKE)
        assert self.engine.state.sleep_state == SleepState.AWAKE

    def test_apply_preset(self):
        """Applying a preset should update multiple fields."""
        preset = {
            "brightness": 0.05,
            "motion_scale": 0.25,
            "contrast_scale": 0.40,
        }
        self.engine.apply_preset(preset)
        assert self.engine.state.brightness == 0.05
        assert self.engine.state.motion_scale == 0.25
        assert self.engine.state.contrast_scale == 0.40

    def test_snapshot_includes_conductor_time(self):
        """Snapshots should include a non-zero conductor_time."""
        import time
        time.sleep(0.01)
        snap = self.engine.get_snapshot()
        assert snap["conductor_time"] > 0

    def test_patch_format(self):
        """Patches should have type, change_type, state_version, data."""
        patch = self.engine.set_brightness(0.5)
        assert patch["type"] == "STATE_PATCH"
        assert "change_type" in patch
        assert "state_version" in patch
        assert "data" in patch
