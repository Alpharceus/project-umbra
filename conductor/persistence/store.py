
"""
Conductor — JSON File Store

Simple JSON-file persistence for configuration and presets.
See design doc §11.

Storage backend: a single local config directory on the Conductor machine.
Uses JSON files for P1 (human-readable, trivially editable, git-friendly,
matches the low write volume). Move to SQLite only if write frequency or
query needs grow.

What persists:
  - config.json  [P1] — port, bind address, default theme, default presets
  - presets.json  [P1] — the named mode presets
  - devices.json  [P2] — known device IDs, display names, per-device modifiers
  - layouts/<name>.json  [P2] — room layout presets

What is ephemeral (never persisted):
  - live state_version, current conductor_time, transient connection status
"""

import json
from pathlib import Path
from typing import Any, Optional

from conductor.config import DATA_DIR


class JsonStore:
    """
    Read/write JSON files in the data directory.
    All paths are relative to DATA_DIR.
    """

    def __init__(self, base_dir: Optional[Path] = None):
        self.base_dir = base_dir or DATA_DIR
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def read(self, filename: str) -> Optional[Any]:
        """Read and parse a JSON file. Returns None if missing or corrupt."""
        path = self.base_dir / filename
        if not path.exists():
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[store] Warning: failed to read {path}: {e}")
            return None

    def write(self, filename: str, data: Any) -> None:
        """Write data as formatted JSON."""
        path = self.base_dir / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

store = JsonStore()


# ---------------------------------------------------------------------------
# Convenience helpers for known data files (§11)
# ---------------------------------------------------------------------------

DEVICES_FILE = "devices.json"
PRESETS_FILE = "presets.json"


def save_devices(records: list) -> None:
    """Persist durable per-device settings (§7.4 calibration, §4.4 layout)."""
    store.write(DEVICES_FILE, records)


def load_devices() -> list:
    return store.read(DEVICES_FILE) or []


def save_presets(presets: list) -> None:
    store.write(PRESETS_FILE, presets)


def load_presets() -> Optional[list]:
    return store.read(PRESETS_FILE)
