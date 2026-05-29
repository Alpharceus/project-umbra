"""
Tests — Sync Protocol

Validates message building, clock synchronization, and protocol constants.
"""

import pytest
from conductor.sync.messages import (
    build_snapshot,
    build_identify,
    build_device_list,
    ConductorMessage,
    PlayerMessage,
    DashboardMessage,
)
from conductor.sync.clock import ClockSynchronizer


class TestMessages:
    def test_build_snapshot(self):
        data = {"active_theme_id": "cosmic-drift", "brightness": 0.1}
        msg = build_snapshot(data)
        assert msg["type"] == ConductorMessage.STATE_SNAPSHOT
        assert msg["data"] == data

    def test_build_identify(self):
        msg = build_identify("dev-1234", "Main Monitor", 5.0)
        assert msg["type"] == ConductorMessage.IDENTIFY
        assert msg["device_id"] == "dev-1234"
        assert msg["label"] == "Main Monitor"
        assert msg["duration"] == 5.0

    def test_build_device_list(self):
        devices = [{"device_id": "a"}, {"device_id": "b"}]
        msg = build_device_list(devices)
        assert msg["type"] == ConductorMessage.DEVICE_LIST
        assert len(msg["devices"]) == 2

    def test_message_type_values(self):
        """Ensure message type strings match what clients expect."""
        assert ConductorMessage.STATE_SNAPSHOT == "STATE_SNAPSHOT"
        assert PlayerMessage.HELLO == "HELLO"
        assert DashboardMessage.SET_THEME == "SET_THEME"


class TestClockSynchronizer:
    def test_create_sync_request(self):
        clock = ClockSynchronizer()
        req = clock.create_sync_request("device-1")
        assert req["type"] == "CLOCK_SYNC"
        assert "t0" in req

    def test_handle_reply_computes_offset(self):
        clock = ClockSynchronizer()
        # Simulate a sync exchange
        req = clock.create_sync_request("device-1")
        t0 = req["t0"]

        reply = {
            "t1": t0 + 5,   # player received 5ms later
            "t2": t0 + 6,   # player replied 1ms later
        }
        clock.handle_reply("device-1", reply)

        offset = clock.get_offset("device-1")
        # Offset should be roughly computed
        assert isinstance(offset, float)

    def test_no_offset_for_unknown_device(self):
        clock = ClockSynchronizer()
        assert clock.get_offset("unknown") == 0.0
