"""
Conductor — WebSocket Connection Manager

Manages persistent WebSocket connections for players and dashboard clients.
Handles message routing, state broadcast, and connection lifecycle.
"""

import json
import uuid
import asyncio
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect

from conductor.config import settings
from conductor.state import state_engine
from conductor.devices import device_registry, DeviceRole
from conductor.sync.messages import (
    PlayerMessage,
    DashboardMessage,
    build_snapshot,
    build_device_list,
    build_device_settings,
    build_identify,
)
from conductor.sync.clock import ClockSynchronizer


# ---------------------------------------------------------------------------
# Connection Manager
# ---------------------------------------------------------------------------

class WebSocketManager:
    """
    Manages all active WebSocket connections. Players and dashboards
    maintain persistent bidirectional connections through this manager.
    """

    def __init__(self):
        # device_id -> WebSocket
        self._player_connections: dict[str, WebSocket] = {}
        self._dashboard_connections: dict[str, WebSocket] = {}
        self._clock_sync = ClockSynchronizer()

    # ----- Player Connections -----

    async def handle_player_connection(self, websocket: WebSocket) -> None:
        """Handle a full player WebSocket lifecycle."""
        await websocket.accept()
        device_id: Optional[str] = None
        clock_task: Optional[asyncio.Task] = None

        try:
            # Wait for HELLO message
            hello_raw = await websocket.receive_text()
            hello = json.loads(hello_raw)

            if hello.get("type") != PlayerMessage.HELLO:
                await websocket.close(code=4001, reason="Expected HELLO")
                return

            # Register device (role is preserved across reconnects)
            device_id = hello.get("device_id") or str(uuid.uuid4())[:8]
            device = device_registry.register(
                device_id=device_id,
                display_name=hello.get("display_name", ""),
                role=DeviceRole.PLAYER,
                viewport=hello.get("viewport"),
                capabilities=hello.get("capabilities"),
                layout=hello.get("layout"),
            )
            self._player_connections[device_id] = websocket

            # Send STATE_SNAPSHOT (include the device's identity and per-device
            # settings so a returning screen restores its role/calibration/layout).
            snapshot = build_snapshot(state_engine.get_snapshot())
            snapshot["assigned_device_id"] = device_id
            snapshot["assigned_role"] = device.role.value
            snapshot["assigned_brightness_modifier"] = device.brightness_modifier
            snapshot["assigned_layout"] = device.layout.model_dump()
            await websocket.send_text(json.dumps(snapshot))

            # Notify dashboards of device list change
            await self._broadcast_device_list()

            # Begin periodic clock synchronization for this player
            clock_task = asyncio.create_task(self._clock_sync_loop(device_id, websocket))

            # Message loop
            while True:
                raw = await websocket.receive_text()
                msg = json.loads(raw)
                await self._handle_player_message(device_id, msg)

        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"[ws] Player {device_id} error: {e}")
        finally:
            if clock_task:
                clock_task.cancel()
            if device_id:
                self._player_connections.pop(device_id, None)
                device_registry.unregister(device_id)
                await self._broadcast_device_list()

    async def _clock_sync_loop(self, device_id: str, websocket: WebSocket) -> None:
        """Periodically send CLOCK_SYNC requests to a player (§3.5)."""
        try:
            while True:
                await asyncio.sleep(settings.clock_sync_interval_s)
                if device_id not in self._player_connections:
                    return
                request = self._clock_sync.create_sync_request(device_id)
                await websocket.send_text(json.dumps(request))
        except (asyncio.CancelledError, WebSocketDisconnect):
            return
        except Exception:
            return

    async def _handle_player_message(self, device_id: str, msg: dict) -> None:
        """Route an incoming player message."""
        msg_type = msg.get("type")

        if msg_type == PlayerMessage.HEARTBEAT:
            device_registry.update_telemetry(device_id)

        elif msg_type == PlayerMessage.TELEMETRY:
            device_registry.update_telemetry(
                device_id,
                viewport=msg.get("viewport"),
                capabilities=msg.get("capabilities"),
                performance_level=msg.get("performance_level"),
            )

        elif msg_type == PlayerMessage.CLOCK_REPLY:
            self._clock_sync.handle_reply(device_id, msg)

    # ----- Dashboard Connections -----

    async def handle_dashboard_connection(self, websocket: WebSocket) -> None:
        """Handle a full dashboard WebSocket lifecycle."""
        await websocket.accept()
        dash_id = f"dash-{str(uuid.uuid4())[:6]}"

        try:
            self._dashboard_connections[dash_id] = websocket

            # Send initial snapshot + device list
            snapshot = build_snapshot(state_engine.get_snapshot())
            await websocket.send_text(json.dumps(snapshot))

            devices = build_device_list(device_registry.to_dict_list())
            await websocket.send_text(json.dumps(devices))

            # Message loop
            while True:
                raw = await websocket.receive_text()
                msg = json.loads(raw)
                await self._handle_dashboard_message(msg)

        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"[ws] Dashboard {dash_id} error: {e}")
        finally:
            self._dashboard_connections.pop(dash_id, None)

    async def _handle_dashboard_message(self, msg: dict) -> None:
        """
        Handle a dashboard control message. P1 uses direct state mutations
        broadcast by the Conductor (see design doc §8.3 simplification).
        """
        msg_type = msg.get("type")

        if msg_type == DashboardMessage.SET_THEME:
            patch = state_engine.set_theme(
                msg["theme_id"],
                msg.get("transition_duration", 6.0),
            )
            await self._broadcast_to_players(patch)
            await self._broadcast_to_dashboards(patch)

        elif msg_type == DashboardMessage.SET_BRIGHTNESS:
            patch = state_engine.set_brightness(msg["value"])
            await self._broadcast_to_players(patch)
            await self._broadcast_to_dashboards(patch)

        elif msg_type == DashboardMessage.SET_MOTION:
            patch = state_engine.set_motion_scale(msg["value"])
            await self._broadcast_to_players(patch)
            await self._broadcast_to_dashboards(patch)

        elif msg_type == DashboardMessage.SET_CONTRAST:
            patch = state_engine.set_contrast_scale(msg["value"])
            await self._broadcast_to_players(patch)
            await self._broadcast_to_dashboards(patch)

        elif msg_type == DashboardMessage.SET_DENSITY:
            patch = state_engine.set_density_scale(msg["value"])
            await self._broadcast_to_players(patch)
            await self._broadcast_to_dashboards(patch)

        elif msg_type == DashboardMessage.SET_SLEEP:
            patch = state_engine.set_sleep_state(msg["sleep_state"])
            await self._broadcast_to_players(patch)
            await self._broadcast_to_dashboards(patch)

        elif msg_type == DashboardMessage.APPLY_PRESET:
            patch = state_engine.apply_preset(msg["preset"])
            await self._broadcast_to_players(patch)
            await self._broadcast_to_dashboards(patch)

        elif msg_type == DashboardMessage.SET_DEVICE_ROLE:
            device_registry.set_role(msg["device_id"], msg["role"])
            await self._after_device_change(msg["device_id"])

        elif msg_type == DashboardMessage.SET_DEVICE_BRIGHTNESS:
            device_registry.set_brightness_modifier(msg["device_id"], msg["value"])
            await self._after_device_change(msg["device_id"])

        elif msg_type == DashboardMessage.SET_DEVICE_LAYOUT:
            device_registry.set_layout(msg["device_id"], msg.get("layout", {}))
            await self._after_device_change(msg["device_id"])

        elif msg_type == DashboardMessage.SET_GLOBAL_COORD:
            patch = state_engine.set_global_coordinate_mode(msg["enabled"])
            await self._broadcast_to_players(patch)
            await self._broadcast_to_dashboards(patch)

        elif msg_type == DashboardMessage.IDENTIFY_DEVICE:
            device = device_registry.get(msg["device_id"])
            label = msg.get("label") or (device.display_name if device else msg["device_id"])
            await self._send_to_player(
                msg["device_id"],
                build_identify(msg["device_id"], label, msg.get("duration", 3.0)),
            )

        elif msg_type == DashboardMessage.SAVE_PRESET:
            self._save_preset(msg.get("preset"))

        elif msg_type == DashboardMessage.REQUEST_DEVICE_LIST:
            await self._broadcast_device_list()

    async def _after_device_change(self, device_id: str) -> None:
        """Push updated settings to the affected player, refresh dashboards, persist."""
        device = device_registry.get(device_id)
        if device:
            await self._send_to_player(device_id, build_device_settings(device.model_dump(mode="json")))
        await self._broadcast_device_list()
        self._persist_devices()

    def _persist_devices(self) -> None:
        from conductor.persistence import store as persistence
        try:
            persistence.save_devices(device_registry.to_persistable())
        except Exception as e:
            print(f"[ws] Failed to persist devices: {e}")

    def _save_preset(self, preset: Optional[dict]) -> None:
        if not preset or not preset.get("id"):
            return
        from conductor.persistence import store as persistence
        presets = persistence.load_presets() or []
        presets = [p for p in presets if p.get("id") != preset["id"]]
        presets.append(preset)
        persistence.save_presets(presets)

    # ----- Broadcasting -----

    async def _send_to_player(self, device_id: str, message: dict) -> None:
        """Send a message to a single player by device_id."""
        ws = self._player_connections.get(device_id)
        if not ws:
            return
        try:
            await ws.send_text(json.dumps(message))
        except Exception:
            self._player_connections.pop(device_id, None)
            device_registry.unregister(device_id)

    async def _broadcast_to_players(self, message: dict) -> None:
        """Send a message to all connected players."""
        text = json.dumps(message)
        disconnected = []
        for device_id, ws in self._player_connections.items():
            try:
                await ws.send_text(text)
            except Exception:
                disconnected.append(device_id)
        for did in disconnected:
            self._player_connections.pop(did, None)
            device_registry.unregister(did)

    async def _broadcast_to_dashboards(self, message: dict) -> None:
        """Send a message to all connected dashboards."""
        text = json.dumps(message)
        disconnected = []
        for dash_id, ws in self._dashboard_connections.items():
            try:
                await ws.send_text(text)
            except Exception:
                disconnected.append(dash_id)
        for did in disconnected:
            self._dashboard_connections.pop(did, None)

    async def _broadcast_device_list(self) -> None:
        """Push updated device list to all dashboards."""
        msg = build_device_list(device_registry.to_dict_list())
        await self._broadcast_to_dashboards(msg)

    async def disconnect_all(self) -> None:
        """Close all WebSocket connections (shutdown)."""
        for ws in list(self._player_connections.values()):
            try:
                await ws.close()
            except Exception:
                pass
        for ws in list(self._dashboard_connections.values()):
            try:
                await ws.close()
            except Exception:
                pass
        self._player_connections.clear()
        self._dashboard_connections.clear()


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

websocket_manager = WebSocketManager()
