/**
 * Project Umbra — Performance Governor (§7.6)
 *
 * Each player measures its own frame timing and degrades locally within the
 * global aesthetic constraints. On a sustained drop it lowers, in order,
 * internal resolution then quality level (which engines use to cut particle
 * count / simulation detail). It recovers slowly when headroom returns. The
 * Conductor does not micromanage frames — it's only informed via telemetry.
 */

(function () {
    const LEVELS = ['normal', 'reduced', 'minimal'];
    const RES_FOR_LEVEL = { normal: 1.0, reduced: 0.75, minimal: 0.5 };

    class PerfGovernor {
        constructor(targetFps) {
            this.targetFps = targetFps || 12;
            this.emaDt = 1 / this.targetFps;
            this.alpha = 0.1;
            this.levelIndex = 0;
            this._badFrames = 0;
            this._goodFrames = 0;
        }

        setTargetFps(fps) {
            if (fps > 0) this.targetFps = fps;
        }

        /** Feed the real frame delta (seconds). */
        sample(dt) {
            if (dt > 0 && dt < 1) {
                this.emaDt = this.emaDt * (1 - this.alpha) + dt * this.alpha;
            }
            const fps = this.estimatedFps();
            const low = this.targetFps * 0.7;
            const good = this.targetFps * 0.92;

            if (fps < low) {
                this._badFrames++;
                this._goodFrames = 0;
                if (this._badFrames > this.targetFps * 2) { // ~2s sustained
                    this._degrade();
                    this._badFrames = 0;
                }
            } else if (fps > good) {
                this._goodFrames++;
                this._badFrames = 0;
                if (this._goodFrames > this.targetFps * 8) { // recover slowly (~8s)
                    this._recover();
                    this._goodFrames = 0;
                }
            } else {
                this._badFrames = Math.max(0, this._badFrames - 1);
            }
        }

        _degrade() { this.levelIndex = Math.min(LEVELS.length - 1, this.levelIndex + 1); }
        _recover() { this.levelIndex = Math.max(0, this.levelIndex - 1); }

        estimatedFps() { return this.emaDt > 0 ? 1 / this.emaDt : this.targetFps; }
        level() { return LEVELS[this.levelIndex]; }
        resolutionScale() { return RES_FOR_LEVEL[this.level()]; }
    }

    window.PerfGovernor = PerfGovernor;
})();
