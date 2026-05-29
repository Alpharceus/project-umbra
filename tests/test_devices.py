"""
Tests — Device Registry

Validates device registration, telemetry updates, role management,
and query methods.
"""

import pytest
from conductor.devices import DeviceRegistry, DeviceRole, ConnectionStatus


class TestDeviceRegistry:
    def setup_method(self):
        self.registry = DeviceRegistry()

    def test_register_new_device(self):
        device = self.registry.register("dev-1", display_name="Main Monitor")
        assert device.device_id == "dev-1"
        assert device.display_name == "Main Monitor"
        assert device.role == DeviceRole.PLAYER
        assert device.connection_status == ConnectionStatus.CONNECTED

    def test_register_auto_name(self):
        """Unnamed devices get a guest-xxxx display name."""
        device = self.registry.register("abcd1234")
        assert device.display_name == "guest-abcd"

    def test_re_register_reconnects(self):
        """Re-registering an existing device should update status."""
        self.registry.register("dev-1")
        self.registry.unregister("dev-1")
        device = self.registry.get("dev-1")
        assert device.connection_status == ConnectionStatus.DISCONNECTED

        device = self.registry.register("dev-1")
        assert device.connection_status == ConnectionStatus.CONNECTED

    def test_get_connected(self):
        self.registry.register("a")
        self.registry.register("b")
        self.registry.register("c")
        self.registry.unregister("b")
        connected = self.registry.get_connected()
        assert len(connected) == 2
        ids = {d.device_id for d in connected}
        assert "a" in ids and "c" in ids

    def test_get_players_excludes_excluded_primary(self):
        """excluded_primary devices should not appear in get_players()."""
        self.registry.register("a")
        self.registry.register("b")
        self.registry.set_role("b", DeviceRole.EXCLUDED_PRIMARY)
        players = self.registry.get_players()
        assert len(players) == 1
        assert players[0].device_id == "a"

    def test_update_telemetry(self):
        self.registry.register("dev-1")
        self.registry.update_telemetry(
            "dev-1",
            viewport={"width_px": 1920, "height_px": 1080},
            performance_level="reduced",
        )
        device = self.registry.get("dev-1")
        assert device.viewport.width_px == 1920
        assert device.performance_level == "reduced"

    def test_set_role(self):
        self.registry.register("dev-1")
        self.registry.set_role("dev-1", DeviceRole.DASHBOARD)
        assert self.registry.get("dev-1").role == DeviceRole.DASHBOARD

    def test_to_dict_list(self):
        self.registry.register("a")
        self.registry.register("b")
        result = self.registry.to_dict_list()
        assert len(result) == 2
        assert all(isinstance(d, dict) for d in result)

    def test_set_brightness_modifier_clamps(self):
        self.registry.register("dev-1")
        self.registry.set_brightness_modifier("dev-1", 1.5)
        assert self.registry.get("dev-1").brightness_modifier == 1.0
        self.registry.set_brightness_modifier("dev-1", -0.2)
        assert self.registry.get("dev-1").brightness_modifier == 0.0

    def test_set_layout_merges(self):
        self.registry.register("dev-1")
        self.registry.set_layout("dev-1", {"origin_x": 2.5, "rotation": 90})
        layout = self.registry.get("dev-1").layout
        assert layout.origin_x == 2.5
        assert layout.rotation == 90
        assert layout.width_units == 1.0  # untouched default preserved

    def test_persistence_round_trip(self):
        self.registry.register("dev-1", display_name="Main")
        self.registry.set_role("dev-1", DeviceRole.EXCLUDED_PRIMARY)
        self.registry.set_brightness_modifier("dev-1", 0.7)
        self.registry.set_layout("dev-1", {"origin_x": 1.0, "width_units": 2.4})
        records = self.registry.to_persistable()

        fresh = DeviceRegistry()
        fresh.load_persisted(records)
        d = fresh.get("dev-1")
        assert d is not None
        assert d.display_name == "Main"
        assert d.role == DeviceRole.EXCLUDED_PRIMARY
        assert d.brightness_modifier == 0.7
        assert d.layout.origin_x == 1.0
        assert d.layout.width_units == 2.4
        # Persisted devices start disconnected until they reconnect.
        assert d.connection_status == ConnectionStatus.DISCONNECTED
