"""
Conductor — Kiosk Launcher (screensaver mode)

Opens a fullscreen, chrome-less browser window on a chosen monitor of the host
machine, pointed at the player URL in auto-join mode. The dashboard drives this:
the host detects its monitors (list_monitors) and the user picks which ones to
light up (launch_on) — full multi-monitor support, no manual joining.

Each window:
  - launches with its own temp profile (separate windows, not tabs),
  - is positioned/sized to its monitor and started fullscreen,
  - carries its monitor's geometry so the Displays map mirrors the real layout.

Windows-first (Edge is always present); falls back to Chrome.
"""

import os
import shutil
import subprocess
import tempfile
from urllib.parse import urlencode

_procs: dict = {}     # monitor index -> Popen
_tmpdirs: list = []


def _find_browser() -> str | None:
    candidates = [
        r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
        r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
        r"%LocalAppData%\Microsoft\Edge\Application\msedge.exe",
        r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
        r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
        r"%LocalAppData%\Google\Chrome\Application\chrome.exe",
    ]
    for c in candidates:
        path = os.path.expandvars(c)
        if os.path.isfile(path):
            return path
    for name in ("msedge", "chrome", "chromium"):
        found = shutil.which(name)
        if found:
            return found
    return None


def _raw_monitors():
    try:
        from screeninfo import get_monitors
        return list(get_monitors())
    except Exception as e:
        print(f"[kiosk] monitor detection failed: {e}")
        return []


def _unit(monitors) -> float:
    primary = next((m for m in monitors if getattr(m, "is_primary", False)), monitors[0])
    return float(primary.height or 1)  # room unit = primary monitor height (§4.4)


def list_monitors() -> list[dict]:
    """Describe the host's monitors for the dashboard picker."""
    mons = _raw_monitors()
    out = []
    for i, m in enumerate(mons):
        out.append({
            "index": i,
            "width": m.width,
            "height": m.height,
            "x": m.x,
            "y": m.y,
            "is_primary": bool(getattr(m, "is_primary", False)),
            "name": getattr(m, "name", None) or f"Monitor {i + 1}",
            "active": i in _procs and _procs[i].poll() is None,
        })
    return out


def _launch_one(browser, m, index, port, unit, debug, host) -> bool:
    params = {
        "auto": "1",
        "name": f"Monitor {index + 1}",
        "ox": round(m.x / unit, 4),
        "oy": round(m.y / unit, 4),
        "wu": round(m.width / unit, 4),
        "hu": round(m.height / unit, 4),
    }
    if debug:
        params["debug"] = "1"
    url = f"http://{host}:{port}/join?{urlencode(params)}"
    profile = tempfile.mkdtemp(prefix=f"umbra_kiosk_{index}_")
    _tmpdirs.append(profile)
    args = [
        browser,
        f"--app={url}",
        f"--user-data-dir={profile}",
        f"--window-position={m.x},{m.y}",
        f"--window-size={m.width},{m.height}",
        "--start-fullscreen",
        "--no-first-run", "--no-default-browser-check",
        "--disable-translate", "--disable-infobars", "--noerrdialogs",
        "--disable-session-crashed-bubble", "--overscroll-history-navigation=0",
    ]
    try:
        _procs[index] = subprocess.Popen(args)
        print(f"[kiosk] Display {index + 1}: {m.width}x{m.height} @ ({m.x},{m.y})")
        return True
    except Exception as e:
        print(f"[kiosk] Failed to launch display {index + 1}: {e}")
        return False


def launch_on(index: int, port: int, debug: bool = True, host: str = "localhost") -> bool:
    """Open an ambient window on a single monitor (by index)."""
    browser = _find_browser()
    mons = _raw_monitors()
    if not browser or not mons or index < 0 or index >= len(mons):
        print(f"[kiosk] cannot launch index={index} (browser={bool(browser)}, monitors={len(mons)})")
        return False
    # If one is already open on that monitor, leave it.
    if index in _procs and _procs[index].poll() is None:
        return True
    return _launch_one(browser, mons[index], index, port, _unit(mons), debug, host)


def launch_displays(port: int, debug: bool = False, host: str = "localhost") -> int:
    """Open ambient windows on every monitor (auto screensaver mode)."""
    browser = _find_browser()
    mons = _raw_monitors()
    if not browser or not mons:
        print(f"[kiosk] not launching (browser={bool(browser)}, monitors={len(mons)})")
        return 0
    unit = _unit(mons)
    return sum(1 for i, m in enumerate(mons) if _launch_one(browser, m, i, port, unit, debug, host))


def close_all() -> None:
    for p in _procs.values():
        try:
            p.terminate()
        except Exception:
            pass
    _procs.clear()
    for d in _tmpdirs:
        shutil.rmtree(d, ignore_errors=True)
    _tmpdirs.clear()
