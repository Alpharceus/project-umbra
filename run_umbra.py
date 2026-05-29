"""
Project Umbra — Frozen Entry Point

Starts the conductor. By default it opens the control dashboard in a browser so
you can detect your monitors and choose which ones to light up with the ambient
view (the dashboard's "Host Monitors" panel). Optionally it can auto-open a
fullscreen window on every monitor (settings.auto_launch_kiosk).

Disable browser auto-open with the env var UMBRA_NO_KIOSK=1 (used for headless
runs and testing). Passes the FastAPI `app` object directly to uvicorn so it
loads reliably inside a frozen bundle.
"""

import atexit
import os
import threading
import time
import webbrowser

import uvicorn

from conductor.config import settings
from conductor.main import app
from conductor import kiosk
from conductor.netutil import self_host


def _on_ready():
    # The server binds quickly; a short delay avoids racing the first request.
    time.sleep(2.0)
    host = self_host(settings.host)
    try:
        if settings.open_dashboard_on_start:
            webbrowser.open(f"http://{host}:{settings.port}/dashboard")
        if settings.auto_launch_kiosk:
            kiosk.launch_displays(settings.port, debug=settings.kiosk_debug, host=host)
    except Exception as e:
        print(f"[startup] browser launch error: {e}")


def main():
    if not os.environ.get("UMBRA_NO_KIOSK"):
        threading.Thread(target=_on_ready, daemon=True).start()
        atexit.register(kiosk.close_all)

    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")


if __name__ == "__main__":
    main()
