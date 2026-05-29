"""
Conductor — Player Page Route

Serves the browser-based player app at /join.
See design doc §3.7: "Guest opens http://<conductor>:8000/join"
"""

from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import HTMLResponse


router = APIRouter()

PLAYER_DIR = Path(__file__).resolve().parent.parent.parent / "player"


@router.get("/join")
async def serve_player():
    """Serve the player HTML page. No install needed — browser is the runtime."""
    index_path = PLAYER_DIR / "index.html"
    if not index_path.exists():
        return HTMLResponse(
            content="<h1>Player not built yet</h1><p>player/index.html is missing.</p>",
            status_code=404,
        )
    return HTMLResponse(content=index_path.read_text(encoding="utf-8"))
