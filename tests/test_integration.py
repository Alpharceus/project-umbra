"""
Tests — End-to-End Integration (HTTP + WebSocket)

Exercises the real ASGI app through Starlette's TestClient, including the
WebSocket handshake and state propagation between a dashboard and a player.
These cover the conductor-player pipeline that the unit tests cannot reach.

Requires httpx (TestClient dependency); skipped if unavailable.
"""

import pytest

pytest.importorskip("httpx")

from fastapi.testclient import TestClient

from conductor.main import app
from conductor.config import settings


@pytest.fixture
def client():
    # Avoid the 30s clock-sync timer interfering with short tests.
    settings.clock_sync_interval_s = 3600
    with TestClient(app) as c:
        yield c


def test_http_pages_served(client):
    assert client.get("/join").status_code == 200
    assert client.get("/dashboard").status_code == 200
    assert client.get("/api/state").status_code == 200
    assert client.get("/api/themes").status_code == 200
    assert client.get("/api/presets").status_code == 200


def test_static_assets_served(client):
    assert client.get("/player/static/js/player.js").status_code == 200
    assert client.get("/shared/static/js/protocol.js").status_code == 200
    assert client.get("/dashboard/static/css/dashboard.css").status_code == 200


def test_player_handshake_returns_snapshot(client):
    """Player HELLO -> STATE_SNAPSHOT with an assigned id and role (§3.7)."""
    with client.websocket_connect("/ws/player") as ws:
        ws.send_json({
            "type": "HELLO", "device_id": None, "display_name": "test",
            "viewport": {"width_px": 1920, "height_px": 1080},
            "capabilities": {"canvas2d": True},
        })
        snap = ws.receive_json()
        assert snap["type"] == "STATE_SNAPSHOT"
        assert snap["assigned_device_id"]
        assert snap["assigned_role"] == "player"
        assert snap["data"]["active_theme_id"] == "cosmic-drift"


def test_dashboard_receives_snapshot_and_device_list(client):
    with client.websocket_connect("/ws/dashboard") as dws:
        first = dws.receive_json()
        second = dws.receive_json()
        types = {first["type"], second["type"]}
        assert "STATE_SNAPSHOT" in types
        assert "DEVICE_LIST" in types


def test_dashboard_control_propagates_to_player(client):
    """A dashboard brightness change is broadcast to a connected player."""
    with client.websocket_connect("/ws/player") as pws:
        pws.send_json({"type": "HELLO", "device_id": "p-1",
                       "viewport": {}, "capabilities": {}})
        pws.receive_json()  # snapshot

        with client.websocket_connect("/ws/dashboard") as dws:
            dws.receive_json()  # snapshot
            dws.receive_json()  # device list

            dws.send_json({"type": "SET_BRIGHTNESS", "value": 0.33})
            patch = pws.receive_json()
            assert patch["type"] == "STATE_PATCH"
            assert patch["change_type"] == "brightness"
            assert patch["data"]["brightness"] == pytest.approx(0.33)


def test_excluded_primary_notifies_player(client):
    """Marking a player excluded_primary pushes it DEVICE_SETTINGS (§9)."""
    with client.websocket_connect("/ws/player") as pws:
        pws.send_json({"type": "HELLO", "device_id": "movie-screen",
                       "viewport": {}, "capabilities": {}})
        pws.receive_json()  # snapshot

        with client.websocket_connect("/ws/dashboard") as dws:
            dws.receive_json()  # snapshot
            dws.receive_json()  # device list

            dws.send_json({"type": "SET_DEVICE_ROLE",
                           "device_id": "movie-screen", "role": "excluded_primary"})
            msg = pws.receive_json()
            assert msg["type"] == "DEVICE_SETTINGS"
            assert msg["role"] == "excluded_primary"


def test_device_calibration_and_layout(client):
    """Per-device brightness (§7.4) and layout (§4.4) push DEVICE_SETTINGS."""
    with client.websocket_connect("/ws/player") as pws:
        pws.send_json({"type": "HELLO", "device_id": "screen-A",
                       "viewport": {}, "capabilities": {}})
        snap = pws.receive_json()
        assert "assigned_brightness_modifier" in snap
        assert "assigned_layout" in snap

        with client.websocket_connect("/ws/dashboard") as dws:
            dws.receive_json(); dws.receive_json()

            dws.send_json({"type": "SET_DEVICE_BRIGHTNESS",
                           "device_id": "screen-A", "value": 0.5})
            m1 = pws.receive_json()
            assert m1["type"] == "DEVICE_SETTINGS"
            assert m1["brightness_modifier"] == pytest.approx(0.5)

            dws.send_json({"type": "SET_DEVICE_LAYOUT", "device_id": "screen-A",
                           "layout": {"origin_x": 1.5, "width_units": 2.0}})
            m2 = pws.receive_json()
            assert m2["type"] == "DEVICE_SETTINGS"
            assert m2["layout"]["origin_x"] == pytest.approx(1.5)


def test_global_coordinate_toggle(client):
    """Continuity toggle (§4.4) broadcasts a STATE_PATCH to players."""
    with client.websocket_connect("/ws/player") as pws:
        pws.send_json({"type": "HELLO", "device_id": "g-1",
                       "viewport": {}, "capabilities": {}})
        pws.receive_json()
        with client.websocket_connect("/ws/dashboard") as dws:
            dws.receive_json(); dws.receive_json()
            dws.send_json({"type": "SET_GLOBAL_COORD", "enabled": True})
            patch = pws.receive_json()
            assert patch["type"] == "STATE_PATCH"
            assert patch["data"]["global_coordinate_mode"] is True


def test_join_info_qr(client):
    """/api/join-info returns join URLs and an inline SVG QR (§3.6)."""
    j = client.get("/api/join-info").json()
    assert j["player_url"].endswith("/join")
    assert "<svg" in j["qr_svg"]
    assert "<?xml" not in j["qr_svg"]
