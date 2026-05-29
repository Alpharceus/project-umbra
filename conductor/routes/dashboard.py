"""
Conductor — Dashboard Page Route

Serves the mobile-optimized control dashboard at /dashboard.
See design doc §8.1.
"""

from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import HTMLResponse


router = APIRouter()

DASHBOARD_DIR = Path(__file__).resolve().parent.parent.parent / "dashboard"


@router.get("/dashboard")
async def serve_dashboard():
    """Serve the dashboard HTML page (optimized for phone use)."""
    index_path = DASHBOARD_DIR / "index.html"
    if not index_path.exists():
        return HTMLResponse(
            content="<h1>Dashboard not built yet</h1><p>dashboard/index.html is missing.</p>",
            status_code=404,
        )
    return HTMLResponse(content=index_path.read_text(encoding="utf-8"))
