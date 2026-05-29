"""
Conductor — REST API Routes

Non-real-time operations: state queries, presets, device info.
Real-time state sync is handled over WebSocket, not REST (see §3.2).
"""

import io
import json

import segno
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from conductor.state import state_engine, SleepState
from conductor.devices import device_registry
from conductor.config import PRESETS_PATH, settings
from conductor.netutil import join_ips, self_host
from conductor import kiosk


router = APIRouter()


# ---------------------------------------------------------------------------
# Host monitors + on-demand kiosk launch (screensaver picker)
# ---------------------------------------------------------------------------

@router.get("/monitors")
async def get_monitors():
    """Detected physical monitors on the host machine (for the launch picker)."""
    return JSONResponse(content=kiosk.list_monitors())


@router.post("/launch-display")
async def launch_display(payload: dict):
    """Open a fullscreen ambient window on the host monitor at the given index."""
    index = int(payload.get("index", -1))
    ok = kiosk.launch_on(index, settings.port, debug=settings.kiosk_debug,
                         host=self_host(settings.host))
    return JSONResponse(content={"launched": ok, "index": index})


# ---------------------------------------------------------------------------
# Join Info + QR (§3.6 Layer 2)
# ---------------------------------------------------------------------------

@router.get("/join-info")
async def get_join_info():
    """Return join URLs for every network interface + a QR for the first one."""
    port = settings.port
    ips = join_ips(settings.host)
    endpoints = [{
        "ip": ip,
        "player_url": f"http://{ip}:{port}/join",
        "dashboard_url": f"http://{ip}:{port}/dashboard",
    } for ip in ips]

    primary = endpoints[0]["player_url"] if endpoints else f"http://localhost:{port}/join"
    qr = segno.make(primary, error="m")
    buff = io.BytesIO()
    # Drop the XML declaration so the SVG embeds cleanly via innerHTML.
    qr.save(buff, kind="svg", scale=5, border=2, dark="#c6c6ce", light=None,
            xmldecl=False)
    qr_svg = buff.getvalue().decode("utf-8")

    return JSONResponse(content={
        "port": port,
        "endpoints": endpoints,
        "player_url": primary,   # primary (default-route) for back-compat
        "qr_svg": qr_svg,
    })


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

@router.get("/state")
async def get_state():
    """Return the current full UmbraState (for debugging / initial load)."""
    return JSONResponse(content=state_engine.get_snapshot())


# ---------------------------------------------------------------------------
# Devices
# ---------------------------------------------------------------------------

@router.get("/devices")
async def get_devices():
    """Return the list of known devices."""
    return JSONResponse(content=device_registry.to_dict_list())


# ---------------------------------------------------------------------------
# Themes
# ---------------------------------------------------------------------------

@router.get("/themes")
async def get_themes():
    """Return the list of available themes with metadata."""
    themes = [
        {
            "id": "cosmic-drift",
            "name": "Cosmic Drift",
            "engine": "E1",
            "phase": "P1",
            "description": "Infinite-point starfield with slow parallax drift",
        },
        {
            "id": "solar-corona",
            "name": "Solar Corona",
            "engine": "E6",
            "phase": "P1",
            "description": "Dim warm peripheral glow — center stays dark",
        },
        # --- P2 Themes (placeholders) ---
        {
            "id": "abyssal-fluid",
            "name": "Abyssal Fluid",
            "engine": "E2",
            "phase": "P2",
            "description": "Low-contrast fluid field with slow pressure waves",
        },
        {
            "id": "macro-rain",
            "name": "Macro Rain",
            "engine": "E3",
            "phase": "P2",
            "description": "Slow moisture trails like night rain on a window",
        },
        {
            "id": "glacial-nebula",
            "name": "Glacial Nebula",
            "engine": "E2",
            "phase": "P2",
            "description": "Slow cold amorphous clouds in deep blue-violet",
        },
        {
            "id": "the-slow-matrix",
            "name": "The Slow Matrix",
            "engine": "E4",
            "phase": "P2",
            "description": "Dark data lattice with faint pulses along lines",
        },
        {
            "id": "volumetric-smoke",
            "name": "Volumetric Smoke",
            "engine": "E2",
            "phase": "P2",
            "description": "Dark vapor drifting in one direction, slowly dissipating",
        },
        {
            "id": "strata-shift",
            "name": "Strata Shift",
            "engine": "E5",
            "phase": "P2",
            "description": "Dark horizontal bands sliding like geological strata",
        },
        {
            "id": "digital-rainfall",
            "name": "Digital Rainfall",
            "engine": "E3",
            "phase": "P2",
            "description": "Sparse columns of falling abstract glyphs",
        },
        {
            "id": "dust-motes",
            "name": "Dust Motes",
            "engine": "E1",
            "phase": "P2",
            "description": "Tiny particles drifting with depth parallax",
        },
    ]
    return JSONResponse(content=themes)


# ---------------------------------------------------------------------------
# Presets
# ---------------------------------------------------------------------------

@router.get("/presets")
async def get_presets():
    """Return saved presets."""
    if PRESETS_PATH.exists():
        with open(PRESETS_PATH, "r", encoding="utf-8") as f:
            return JSONResponse(content=json.load(f))
    return JSONResponse(content=_default_presets())


def _default_presets() -> list[dict]:
    """Default presets per §13 of the design doc."""
    return [
        {
            "id": "movie-mode",
            "name": "Movie Mode",
            "brightness": 0.05,
            "motion_scale": 0.25,
            "contrast_scale": 0.40,
            "density_scale": 0.60,
        },
        {
            "id": "pre-movie-ambient",
            "name": "Pre-Movie Ambient",
            "brightness": 0.12,
            "motion_scale": 0.50,
            "contrast_scale": 0.70,
            "density_scale": 0.80,
        },
        {
            "id": "sleep-glow",
            "name": "Sleep Glow",
            "brightness": 0.02,
            "motion_scale": 0.05,
            "contrast_scale": 0.20,
            "density_scale": 0.30,
        },
        {
            "id": "blackout",
            "name": "Blackout",
            "brightness": 0.00,
            "motion_scale": 0.00,
            "sleep_state": "blackout",
        },
    ]
