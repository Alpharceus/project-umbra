"""
Conductor — Device Registry

Manages connected devices (players, dashboards, conductor displays).
Each device has identity, viewport info, capabilities, role, and
connection status.

First-time guests get an anonymous ID (guest-xxxx); returning devices
reuse an ID from browser local storage.
"""

import time
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class DeviceRole(str, Enum):
    PLAYER = "player"
    DASHBOARD = "dashboard"
    CONDUCTOR_DISPLAY = "conductor_display"
    EXCLUDED_PRIMARY = "excluded_primary"  # [P1] — movie screen exclusion


class ConnectionStatus(str, Enum):
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    RECONNECTING = "reconnecting"


# ---------------------------------------------------------------------------
# Device Model
# ---------------------------------------------------------------------------

class DeviceViewport(BaseModel):
    """Viewport dimensions reported by the client."""
    width_px: int = 0
    height_px: int = 0
    device_pixel_ratio: float = 1.0
    orientation: str = "landscape"  # landscape | portrait


class DeviceCapabilities(BaseModel):
    """Rendering capabilities reported by the client."""
    canvas2d: bool = True
    webgl: bool = False
    webgl2: bool = False
    fullscreen: bool = False
    max_texture_size: int = 0
    estimated_fps: float = 0.0
    battery: Optional[float] = None  # 0.0–1.0 if available


class DeviceLayout(BaseModel):
    """[P2] Global room coordinate placement."""
    origin_x: float = 0.0
    origin_y: float = 0.0
    width_units: float = 1.0
    height_units: float = 1.0
    rotation: int = 0  # degrees: 0, 90, 180, 270
    z_order: int = 0


class Device(BaseModel):
    """A registered device in the Umbra system."""
    device_id: str
    display_name: str = ""
    role: DeviceRole = DeviceRole.PLAYER
    connection_status: ConnectionStatus = ConnectionStatus.CONNECTED
    viewport: DeviceViewport = Field(default_factory=DeviceViewport)
    capabilities: DeviceCapabilities = Field(default_factory=DeviceCapabilities)
    layout: DeviceLayout = Field(default_factory=DeviceLayout)          # [P2]
    brightness_modifier: float = 1.0                                    # [P2]
    performance_level: str = "normal"  # normal | reduced | minimal
    last_seen: float = Field(default_factory=time.time)


# ---------------------------------------------------------------------------
# Device Registry
# ---------------------------------------------------------------------------

class DeviceRegistry:
    """
    Maintains the set of known devices. Thread-safe access is not needed
    because the conductor runs on a single async event loop.
    """

    def __init__(self):
        self._devices: dict[str, Device] = {}

    def register(
        self,
        device_id: str,
        display_name: str = "",
        role: DeviceRole = DeviceRole.PLAYER,
        viewport: Optional[dict] = None,
        capabilities: Optional[dict] = None,
        layout: Optional[dict] = None,
    ) -> Device:
        """Register a new device or update an existing one on reconnect."""
        if device_id in self._devices:
            device = self._devices[device_id]
            device.connection_status = ConnectionStatus.CONNECTED
            device.last_seen = time.time()
            if display_name:
                device.display_name = display_name
            if viewport:
                device.viewport = DeviceViewport(**viewport)
            if capabilities:
                device.capabilities = DeviceCapabilities(**capabilities)
            # Adopt a freshly reported layout (e.g. kiosk monitor geometry),
            # but don't clobber a layout the user tuned by hand on a reconnect
            # that carries no geometry.
            if layout:
                device.layout = DeviceLayout(**{**device.layout.model_dump(), **layout})
            return device

        device = Device(
            device_id=device_id,
            display_name=display_name or f"guest-{device_id[:4]}",
            role=role,
            viewport=DeviceViewport(**(viewport or {})),
            capabilities=DeviceCapabilities(**(capabilities or {})),
            layout=DeviceLayout(**(layout or {})),
        )
        self._devices[device_id] = device
        return device

    def unregister(self, device_id: str) -> None:
        """Mark a device as disconnected (keep in registry for reconnection)."""
        if device_id in self._devices:
            self._devices[device_id].connection_status = ConnectionStatus.DISCONNECTED

    def get(self, device_id: str) -> Optional[Device]:
        return self._devices.get(device_id)

    def get_all(self) -> list[Device]:
        return list(self._devices.values())

    def get_connected(self) -> list[Device]:
        return [d for d in self._devices.values()
                if d.connection_status == ConnectionStatus.CONNECTED]

    def get_players(self) -> list[Device]:
        """Get connected devices with player role (excludes excluded_primary)."""
        return [d for d in self.get_connected()
                if d.role == DeviceRole.PLAYER]

    def set_role(self, device_id: str, role) -> Optional[Device]:
        """Set a device's role. Accepts a DeviceRole or its string value."""
        device = self._devices.get(device_id)
        if device:
            device.role = role if isinstance(role, DeviceRole) else DeviceRole(role)
        return device

    def set_brightness_modifier(self, device_id: str, modifier: float) -> Optional[Device]:
        """Per-device brightness calibration (§7.4)."""
        device = self._devices.get(device_id)
        if device:
            device.brightness_modifier = max(0.0, min(1.0, float(modifier)))
        return device

    def set_layout(self, device_id: str, layout: dict) -> Optional[Device]:
        """Set a device's room-layout placement (§4.4)."""
        device = self._devices.get(device_id)
        if device and layout:
            device.layout = DeviceLayout(**{**device.layout.model_dump(), **layout})
        return device

    def update_telemetry(
        self, device_id: str, viewport: Optional[dict] = None,
        capabilities: Optional[dict] = None,
        performance_level: Optional[str] = None,
    ) -> None:
        """Update device telemetry from a TELEMETRY message."""
        device = self._devices.get(device_id)
        if not device:
            return
        device.last_seen = time.time()
        if viewport:
            device.viewport = DeviceViewport(**viewport)
        if capabilities:
            device.capabilities = DeviceCapabilities(**capabilities)
        if performance_level:
            device.performance_level = performance_level

    def to_dict_list(self) -> list[dict]:
        return [d.model_dump() for d in self._devices.values()]

    # ----- Persistence (§11) -----

    # Fields worth remembering across restarts (not transient connection state).
    _PERSISTED_FIELDS = (
        "device_id", "display_name", "role",
        "brightness_modifier", "layout",
    )

    def to_persistable(self) -> list[dict]:
        """Serialize durable per-device settings for data/devices.json."""
        out = []
        for d in self._devices.values():
            data = d.model_dump(mode="json")
            out.append({k: data[k] for k in self._PERSISTED_FIELDS})
        return out

    def load_persisted(self, records: list[dict]) -> None:
        """Re-create known devices (disconnected) from persisted records."""
        if not records:
            return
        for rec in records:
            device_id = rec.get("device_id")
            if not device_id:
                continue
            try:
                device = Device(
                    device_id=device_id,
                    display_name=rec.get("display_name", ""),
                    role=rec.get("role", DeviceRole.PLAYER),
                    connection_status=ConnectionStatus.DISCONNECTED,
                    layout=DeviceLayout(**(rec.get("layout") or {})),
                    brightness_modifier=rec.get("brightness_modifier", 1.0),
                )
                self._devices[device_id] = device
            except Exception as e:
                print(f"[devices] Skipping bad persisted record {device_id}: {e}")


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

device_registry = DeviceRegistry()
