"""
Conductor — Application Entry Point

Starts the FastAPI application with:
- HTTP server: serves player app, dashboard app, join/config endpoints
- WebSocket server: persistent connections, state sync, heartbeats
- Discovery service: local URL display [P1], QR [P2]
- State engine: theme, brightness, sleep, global clock, seeds
"""

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles

from conductor.config import settings, PROJECT_ROOT
from conductor.netutil import join_ips
from conductor.state import state_engine
from conductor.devices import device_registry
from conductor.persistence import store as persistence
from conductor.sync.websocket import websocket_manager
from conductor.routes import api, player, dashboard


# ---------------------------------------------------------------------------
# Lifecycle (startup / shutdown)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize state engine, print join URL, and clean up on shutdown."""
    state_engine.initialize(settings)
    device_registry.load_persisted(persistence.load_devices())
    port = settings.port
    ips = join_ips(settings.host)
    print()
    print("=" * 64)
    print("  PROJECT UMBRA - Conductor Online")
    print("=" * 64)
    print()
    print("  Open one of these on another screen ON THE SAME NETWORK:")
    print()
    for ip in ips:
        print(f"    Player:    http://{ip}:{port}/join")
        print(f"    Dashboard: http://{ip}:{port}/dashboard")
        print()
    if settings.host in ("0.0.0.0", "::", ""):
        print(f"  On this PC you can also use: http://localhost:{port}")
        if len(ips) > 1:
            print("  (Multiple networks detected - use the IP on the same network")
            print("   as the other device, e.g. the Ethernet IP for a direct cable.)")
    else:
        print(f"  Bound only to {settings.host} (this interface only).")
    print("=" * 64)
    print()

    yield

    # Shutdown
    await websocket_manager.disconnect_all()
    persistence.save_devices(device_registry.to_persistable())


# ---------------------------------------------------------------------------
# FastAPI Application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Project Umbra — Conductor",
    description="Distributed ambient display synchronization server",
    version="0.1.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# No-store caching for app assets
#
# This is a single-room LAN app whose JS/HTML changes between builds. Telling
# browsers never to cache these avoids the classic "I rebuilt but the screen
# still shows the old, broken code" problem.
# ---------------------------------------------------------------------------

@app.middleware("http")
async def no_cache_assets(request, call_next):
    response = await call_next(request)
    path = request.url.path
    if (path.startswith(("/player", "/dashboard", "/shared"))
            or path in ("/join",)):
        response.headers["Cache-Control"] = "no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response


# ---------------------------------------------------------------------------
# Mount Routes
# ---------------------------------------------------------------------------

app.include_router(api.router, prefix="/api", tags=["api"])
app.include_router(player.router, tags=["player"])
app.include_router(dashboard.router, tags=["dashboard"])

# Static file mounts for player and dashboard assets.
# Absolute paths so the server works regardless of the launch directory.
app.mount("/player/static", StaticFiles(directory=PROJECT_ROOT / "player"), name="player-static")
app.mount("/dashboard/static", StaticFiles(directory=PROJECT_ROOT / "dashboard"), name="dashboard-static")
app.mount("/shared/static", StaticFiles(directory=PROJECT_ROOT / "shared"), name="shared-static")


# ---------------------------------------------------------------------------
# WebSocket Endpoints
# ---------------------------------------------------------------------------

@app.websocket("/ws/player")
async def ws_player_endpoint(websocket: WebSocket):
    """Player WebSocket connection — receives state, sends telemetry."""
    await websocket_manager.handle_player_connection(websocket)


@app.websocket("/ws/dashboard")
async def ws_dashboard_endpoint(websocket: WebSocket):
    """Dashboard WebSocket connection — sends control intents, receives state."""
    await websocket_manager.handle_dashboard_connection(websocket)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def start():
    """Entry point for the `umbra` console script."""
    uvicorn.run(
        "conductor.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    start()
