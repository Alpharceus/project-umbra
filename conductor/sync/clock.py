"""
Conductor — Clock Synchronization

Lightweight NTP-style clock sync for perceptual alignment.
See design doc §3.5.

    round_trip_delay ≈ (T3 - T0) - (T2 - T1)
    offset           ≈ ((T1 - T0) + (T2 - T3)) / 2

Sub-50 ms alignment is enough; themes are slow, so 100 ms of drift
is usually invisible.
"""

import time
from dataclasses import dataclass, field


@dataclass
class ClockEstimate:
    """Estimated clock offset for a single device."""
    offset_ms: float = 0.0
    rtt_ms: float = 0.0
    samples: int = 0
    last_sync: float = 0.0


class ClockSynchronizer:
    """
    Manages clock-sync exchanges with all connected players.
    Each exchange follows the NTP-style four-timestamp pattern.
    """

    def __init__(self):
        # device_id -> ClockEstimate
        self._estimates: dict[str, ClockEstimate] = {}
        # device_id -> T0 (conductor send time)
        self._pending: dict[str, float] = {}

    def create_sync_request(self, device_id: str) -> dict:
        """
        Build a CLOCK_SYNC message. Records T0 (conductor send time).
        The player will record T1 (receive) and T2 (reply send),
        and return them in CLOCK_REPLY.
        """
        t0 = time.monotonic() * 1000  # ms
        self._pending[device_id] = t0
        return {
            "type": "CLOCK_SYNC",
            "t0": t0,
        }

    def handle_reply(self, device_id: str, msg: dict) -> None:
        """
        Process a CLOCK_REPLY from a player containing T1 and T2.
        Compute offset and RTT.
        """
        t0 = self._pending.pop(device_id, None)
        if t0 is None:
            return

        t1 = msg.get("t1", 0)
        t2 = msg.get("t2", 0)
        t3 = time.monotonic() * 1000  # ms — conductor receive time

        rtt = (t3 - t0) - (t2 - t1)
        offset = ((t1 - t0) + (t2 - t3)) / 2

        # Running average
        est = self._estimates.get(device_id, ClockEstimate())
        if est.samples == 0:
            est.offset_ms = offset
            est.rtt_ms = rtt
        else:
            # Exponential moving average
            alpha = 0.3
            est.offset_ms = est.offset_ms * (1 - alpha) + offset * alpha
            est.rtt_ms = est.rtt_ms * (1 - alpha) + rtt * alpha

        est.samples += 1
        est.last_sync = time.time()
        self._estimates[device_id] = est

    def get_offset(self, device_id: str) -> float:
        """Get estimated clock offset in ms for a device."""
        est = self._estimates.get(device_id)
        return est.offset_ms if est else 0.0

    def get_all_estimates(self) -> dict[str, ClockEstimate]:
        return dict(self._estimates)
