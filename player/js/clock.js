/**
 * Project Umbra — Client-Side Clock Sync
 *
 * Keeps the player's notion of conductor_time advancing between state
 * updates. See design doc §3.5.
 *
 *   visual_time = conductor_time * motion_scale   (§5.5)
 *
 * The conductor stamps every STATE_SNAPSHOT / STATE_PATCH with its current
 * conductor_time (seconds since the conductor started). That value is only
 * a momentary sample — if the player used it directly the animation would
 * freeze between updates. Instead we anchor it against the local clock at
 * the moment of receipt and extrapolate forward:
 *
 *   offset                 = conductor_time - local_now
 *   estimated conductor_time = local_now + offset
 *
 * Because both the conductor's monotonic clock and the browser's
 * performance.now() advance at real-time rate, the estimate stays aligned
 * across a long movie without further messages. Periodic CLOCK_SYNC
 * exchanges (NTP-style) measure round-trip time for diagnostics and could
 * refine the offset later; sub-50 ms alignment is enough.
 */

class UmbraClock {
    constructor() {
        this.offset = 0;       // conductor_time - local_seconds, smoothed
        this.anchored = false;
        this.alpha = 0.2;      // EMA smoothing for re-anchors
    }

    /** Local clock in seconds. */
    _now() {
        return performance.now() / 1000;
    }

    /**
     * Anchor conductor_time received in a snapshot/patch to the local clock.
     * Called on every STATE_SNAPSHOT and STATE_PATCH.
     */
    anchor(conductorTime) {
        if (typeof conductorTime !== 'number' || !isFinite(conductorTime)) return;
        const newOffset = conductorTime - this._now();
        if (!this.anchored) {
            this.offset = newOffset;
            this.anchored = true;
        } else {
            // Smooth small corrections; jump on large ones (e.g. conductor restart).
            if (Math.abs(newOffset - this.offset) > 2.0) {
                this.offset = newOffset;
            } else {
                this.offset = this.offset * (1 - this.alpha) + newOffset * this.alpha;
            }
        }
    }

    /**
     * Estimated current conductor_time (seconds), extrapolated locally.
     */
    getConductorTime() {
        return this._now() + this.offset;
    }

    /**
     * Handle a CLOCK_SYNC request from the conductor: reply immediately with
     * T1 (receive) and T2 (send) so the conductor can measure RTT/offset.
     */
    handleSyncRequest(msg, connection) {
        const t1 = performance.now(); // player receive time
        const t2 = performance.now(); // player send time
        connection.send({
            type: 'CLOCK_REPLY',
            t0: msg.t0,
            t1: t1,
            t2: t2,
        });
    }
}
