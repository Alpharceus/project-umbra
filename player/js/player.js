/**
 * Project Umbra — Player Orchestrator
 *
 * Top-level coordinator for the player app:
 *   - Entry gate (fullscreen on user interaction)
 *   - WebSocket lifecycle + conductor-session binding (§3.9)
 *   - Engine/theme loading via the registry, with transitions (§5.6)
 *   - Throttled, time-decoupled render loop (§7.7)
 *   - Dimmer + per-device calibration (§7.1, §7.4), motion governor (§7.5),
 *     sleep states (§7.2), cross-screen continuity (§4.4)
 *   - Performance governor + telemetry (§7.6, §3.8)
 */

(function () {
    'use strict';

    // ------------------------------------------------------------------ //
    // URL options
    //   ?auto=1            skip the entry gate and connect immediately
    //                      (used by the kiosk launcher — browser is already
    //                       fullscreen, so no Fullscreen API gesture is needed)
    //   ?name=...          display name for this screen
    //   ?ox,oy,wu,hu       initial room-layout placement (room units, §4.4)
    //   ?debug             show an on-screen diagnostic overlay
    // ------------------------------------------------------------------ //
    const params = new URLSearchParams(location.search);
    const AUTO = params.has('auto');
    const DEBUG = params.has('debug');

    function safeGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function safeSet(key, val) {
        try { localStorage.setItem(key, val); } catch (e) { /* storage blocked */ }
    }

    function initialLayoutFromParams() {
        if (!params.has('wu') || !params.has('hu')) return null;
        return {
            origin_x: parseFloat(params.get('ox')) || 0,
            origin_y: parseFloat(params.get('oy')) || 0,
            width_units: parseFloat(params.get('wu')) || 1,
            height_units: parseFloat(params.get('hu')) || 1,
            rotation: 0,
        };
    }

    const player = {
        deviceId: safeGet('umbra_device_id') || null,
        displayName: params.get('name') || '',
        role: 'player',
        brightnessModifier: 1.0,        // per-device calibration (§7.4)
        layout: initialLayoutFromParams(), // room placement (§4.4)
        sessionId: null,                // bound conductor session (§3.9)

        state: null,
        activeTheme: null,
        transition: null,               // { type, start_time, duration }
        fadeCanvas: null,               // captured outgoing frame for crossfade
        fadeActive: false,
        connection: null,
        viewport: null,
        clock: null,
        perf: null,
        canvas: null,
        ctx: null,

        running: false,
        lastFrameTime: 0,
        targetFps: UMBRA_CONSTANTS.DEFAULT_TARGET_FPS,
        frameInterval: 1000 / UMBRA_CONSTANTS.DEFAULT_TARGET_FPS,

        veil: 0,
        lastVisualTime: 0,

        connected: false,
        disconnectedSince: null,
        disconnectSleepTimeoutMs: (UMBRA_CONSTANTS.DISCONNECT_SLEEP_TIMEOUT_S || 60) * 1000,

        battery: null,
        telemetryTimer: null,

        // Diagnostics (?debug)
        frameCount: 0,
        lastError: '',
    };

    // ------------------------------------------------------------------ //
    // Initialization
    // ------------------------------------------------------------------ //

    function init() {
        player.canvas = document.getElementById('umbra-canvas');
        player.ctx = player.canvas.getContext('2d');
        player.viewport = new UmbraViewport(player.canvas);
        player.clock = new UmbraClock();
        player.perf = new PerfGovernor(player.targetFps);

        if (navigator.getBattery) {
            navigator.getBattery().then((b) => { player.battery = b; }).catch(() => {});
        }

        if (DEBUG) createDebugHUD();
        window.addEventListener('error', (e) => {
            player.lastError = (e && e.message) ? e.message : String(e);
        });

        const gate = document.getElementById('umbra-gate');
        const btnEnter = document.getElementById('btn-enter');
        const enter = (withFullscreen) => {
            gate.classList.add('hidden');
            // Start the connection FIRST so a fullscreen failure can never block it.
            startConnection();
            startTelemetry();
            if (withFullscreen) {
                try { requestFullscreen(); } catch (e) { /* best-effort only (§15) */ }
            }
        };
        btnEnter.addEventListener('click', () => enter(true));
        gate.addEventListener('click', (e) => { if (e.target === gate) enter(true); });

        window.addEventListener('resize', () => player.viewport.update());

        // Kiosk / screensaver mode: no gate, connect immediately. The launcher
        // already opened the window fullscreen, so we skip the Fullscreen API.
        if (AUTO) enter(false);
    }

    function requestFullscreen() {
        const el = document.documentElement;
        const rfs = el.requestFullscreen || el.webkitRequestFullscreen
            || el.mozRequestFullScreen || el.msRequestFullscreen;
        if (rfs) rfs.call(el).catch(() => {});
    }

    // ------------------------------------------------------------------ //
    // Connection
    // ------------------------------------------------------------------ //

    function startConnection() {
        player.connection = new UmbraConnection({
            deviceId: player.deviceId,
            displayName: player.displayName,
            layout: player.layout,
            viewport: player.viewport.getInfo(),
            onSnapshot: handleSnapshot,
            onPatch: handlePatch,
            onClockSync: (msg) => player.clock.handleSyncRequest(msg, player.connection),
            onIdentify: handleIdentify,
            onDeviceSettings: handleDeviceSettings,
            onStatusChange: handleStatusChange,
        });
        player.connection.connect();
    }

    function handleStatusChange(status) {
        player.connected = (status === 'connected');
        if (player.connected) {
            player.disconnectedSince = null;
        } else {
            if (player.disconnectedSince === null) player.disconnectedSince = performance.now();
            // Re-bind session on reconnect (handles conductor restart, §3.9).
            player.sessionId = null;
        }
        updateStatusUI(status);
    }

    function handleSnapshot(msg) {
        const data = msg.data || {};

        // Conductor-session binding (§3.9): refuse a *different* live authority.
        if (data.session_id) {
            if (player.sessionId && player.sessionId !== data.session_id) {
                console.warn('[umbra] Ignoring snapshot from a different conductor session');
                return;
            }
            player.sessionId = data.session_id;
        }

        if (msg.assigned_device_id) {
            player.deviceId = msg.assigned_device_id;
            safeSet('umbra_device_id', player.deviceId);
        }
        if (msg.assigned_role) player.role = msg.assigned_role;
        if (typeof msg.assigned_brightness_modifier === 'number') {
            player.brightnessModifier = msg.assigned_brightness_modifier;
        }
        // Prefer the conductor's stored layout, but keep our launcher-provided
        // one if the conductor hasn't got a meaningful placement yet.
        if (msg.assigned_layout && msg.assigned_layout.width_units) {
            player.layout = msg.assigned_layout;
        }

        player.state = data;

        // Start the render loop FIRST so nothing below can silently prevent it.
        if (!player.running) {
            player.running = true;
            player.lastFrameTime = performance.now();
            requestAnimationFrame(renderLoop);
        }

        try { player.clock.anchor(data.conductor_time); } catch (e) { /* non-fatal */ }
        try { applyState(data, true); } catch (e) { player.lastError = 'applyState: ' + e.message; }
    }

    function handlePatch(msg) {
        if (!msg.data) return;
        // Ignore patches from a conflicting session.
        if (msg.data.session_id && player.sessionId && msg.data.session_id !== player.sessionId) return;
        player.state = msg.data;
        player.clock.anchor(msg.data.conductor_time);
        applyState(msg.data, false);
    }

    function handleIdentify(msg) {
        const overlay = document.getElementById('umbra-identify');
        const label = document.getElementById('identify-label');
        label.textContent = msg.label || player.deviceId;
        overlay.classList.remove('hidden');
        setTimeout(() => overlay.classList.add('hidden'), (msg.duration || 3) * 1000);
    }

    function handleDeviceSettings(msg) {
        if (msg.role) player.role = msg.role;
        if (typeof msg.brightness_modifier === 'number') player.brightnessModifier = msg.brightness_modifier;
        if (msg.layout) player.layout = msg.layout;
        applyDeviceContextToThemes();
    }

    // ------------------------------------------------------------------ //
    // State Application
    // ------------------------------------------------------------------ //

    function applyState(state, isSnapshot) {
        if (!state) return;

        const themeId = state.active_theme_id;
        if (!player.activeTheme || player.activeTheme.id !== themeId) {
            switchTheme(themeId, state, isSnapshot);
        }

        // Transition bookkeeping (§5.6)
        const tr = state.transition;
        if (tr && tr.type && tr.type !== 'none' && tr.duration > 0) {
            player.transition = {
                type: tr.type,
                start_time: tr.start_time || 0,
                duration: tr.duration || 6.0,
            };
        }

        applyDeviceContextToThemes();

        if (state.target_fps) {
            player.targetFps = state.target_fps;
            player.frameInterval = 1000 / state.target_fps;
            player.perf.setTargetFps(state.target_fps);
        }
    }

    function switchTheme(themeId, state, isSnapshot) {
        const next = createUmbraTheme(themeId, {
            seed: state.global_seed || 42,
            viewport: player.viewport,
            state: state,
            stateParams: state.theme_parameters,
            deviceLayout: player.layout,
            globalMode: !!state.global_coordinate_mode,
        });
        if (!next) return;

        // Capture the outgoing theme's last frame so we can crossfade to the new
        // one with no black gap (a fresh join has nothing to fade from).
        if (player.activeTheme && !isSnapshot) {
            captureFadeFrame();
        }
        if (player.activeTheme && player.activeTheme.destroy) {
            player.activeTheme.destroy();
        }
        player.activeTheme = next;
    }

    function applyDeviceContextToThemes() {
        const globalMode = !!(player.state && player.state.global_coordinate_mode);
        if (player.activeTheme && player.activeTheme.setDeviceContext) {
            player.activeTheme.setDeviceContext(player.layout, globalMode);
        }
    }

    // ------------------------------------------------------------------ //
    // Render Loop — Throttled (§7.7)
    // ------------------------------------------------------------------ //

    function renderLoop(timestamp) {
        if (!player.running) return;
        requestAnimationFrame(renderLoop);

        const elapsed = timestamp - player.lastFrameTime;
        if (elapsed < player.frameInterval) return;
        player.lastFrameTime = timestamp - (elapsed % player.frameInterval);

        const dt = elapsed / 1000;
        const state = player.state;
        if (!state) return;

        player.frameCount++;

        // Performance governor (§7.6)
        player.perf.sample(dt);
        const resScale = player.perf.resolutionScale();
        const qLevel = player.perf.level();

        if (player.role === 'excluded_primary') {
            clearToBlack();
            player.veil = 1;
        } else {
            applyEngineQuality(resScale, qLevel);
            try {
                renderForSleepState(effectiveSleepState(state), state, dt);
            } catch (e) {
                player.lastError = 'render: ' + e.message;
            }
        }

        if (DEBUG) updateDebugHUD();
    }

    function applyEngineQuality(resScale, qLevel) {
        const th = player.activeTheme;
        if (!th) return;
        th.resolutionScale = resScale;
        if (th.degradeQuality) th.degradeQuality(qLevel);
    }

    function effectiveSleepState(state) {
        if (!player.connected && player.disconnectedSince !== null) {
            if (performance.now() - player.disconnectedSince > player.disconnectSleepTimeoutMs) {
                return 'disconnect_sleep';
            }
        }
        return state.sleep_state || 'awake';
    }

    function renderForSleepState(sleep, state, dt) {
        const motionScale = state.motion_scale ?? 1.0;
        const brightness = (state.brightness ?? 0.10) * player.brightnessModifier;
        const conductorNow = player.clock.getConductorTime();
        const visualTime = conductorNow * motionScale;

        switch (sleep) {
            case 'blackout':
            case 'disconnect_sleep':
                stepVeil(1.0, dt, 2.0);
                if (player.veil >= 0.999) clearToBlack();
                else { renderActive(visualTime, dt, state, brightness, conductorNow); applyVeil(); }
                player.lastVisualTime = visualTime;
                return;

            case 'frozen_dark':
                stepVeil(0.0, dt, 1.5);
                drawTheme(player.activeTheme, player.lastVisualTime, 0, state, brightness * 0.25);
                return;

            case 'idle_breathing':
                stepVeil(0.0, dt, 1.5);
                drawIdleBreathing(visualTime);
                player.lastVisualTime = visualTime;
                return;

            case 'awake':
            default:
                stepVeil(0.0, dt, 2.0);
                renderActive(visualTime, dt, state, brightness, conductorNow);
                if (player.veil > 0.001) applyVeil();
                player.lastVisualTime = visualTime;
                return;
        }
    }

    /**
     * Render the active theme, crossfading from the previous one if a theme
     * change is in progress (§5.6). The new theme renders live; the captured
     * outgoing frame fades out on top of it — a seamless transition with no
     * black gap.
     */
    function renderActive(visualTime, dt, state, brightness, conductorNow) {
        drawTheme(player.activeTheme, visualTime, dt, state, brightness);

        const tr = player.transition;
        if (!tr) return;
        const p = (conductorNow - tr.start_time) / tr.duration;
        if (p >= 1 || p < 0) {
            endTransition();
            return;
        }
        if (player.fadeActive && player.fadeCanvas) {
            const ctx = player.ctx;
            ctx.globalAlpha = 1 - p;
            ctx.drawImage(player.fadeCanvas, 0, 0, player.viewport.width, player.viewport.height);
            ctx.globalAlpha = 1;
        }
    }

    function captureFadeFrame() {
        const w = player.viewport.width, h = player.viewport.height;
        if (!w || !h) return;
        if (!player.fadeCanvas) player.fadeCanvas = document.createElement('canvas');
        if (player.fadeCanvas.width !== w) player.fadeCanvas.width = w;
        if (player.fadeCanvas.height !== h) player.fadeCanvas.height = h;
        const fctx = player.fadeCanvas.getContext('2d');
        fctx.clearRect(0, 0, w, h);
        fctx.drawImage(player.canvas, 0, 0);
        player.fadeActive = true;
    }

    function endTransition() {
        player.transition = null;
        player.fadeActive = false;
        // Release the offscreen buffer's memory once the crossfade is done.
        if (player.fadeCanvas) {
            player.fadeCanvas.width = 0;
            player.fadeCanvas.height = 0;
        }
    }

    function drawTheme(theme, visualTime, dt, state, brightness) {
        if (theme) {
            theme.update(visualTime, dt, state);
            theme.render(player.ctx, player.viewport, brightness);
        } else {
            clearToBlack();
        }
    }

    function drawIdleBreathing(visualTime) {
        const ctx = player.ctx, w = player.viewport.width, h = player.viewport.height;
        clearToBlack();
        const breath = 0.5 + 0.5 * Math.sin(visualTime * 0.15);
        const alpha = 0.015 + 0.025 * breath;
        const edge = Math.min(w, h) * 0.18;
        const edges = [
            [ctx.createLinearGradient(0, 0, 0, edge), 0, 0, w, edge],
            [ctx.createLinearGradient(0, h, 0, h - edge), 0, h - edge, w, edge],
            [ctx.createLinearGradient(0, 0, edge, 0), 0, 0, edge, h],
            [ctx.createLinearGradient(w, 0, w - edge, 0), w - edge, 0, edge, h],
        ];
        for (const [grad, x, y, gw, gh] of edges) {
            grad.addColorStop(0, `rgba(150, 110, 70, ${alpha})`);
            grad.addColorStop(1, 'rgba(150, 110, 70, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(x, y, gw, gh);
        }
    }

    function stepVeil(target, dt, seconds) {
        const rate = seconds > 0 ? Math.min(1, dt / seconds) : 1;
        player.veil += (target - player.veil) * rate;
        if (player.veil < 0.001) player.veil = 0;
        if (player.veil > 0.999) player.veil = 1;
    }

    function overlayBlack(alpha) {
        if (alpha <= 0) return;
        const ctx = player.ctx;
        ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, alpha)})`;
        ctx.fillRect(0, 0, player.viewport.width, player.viewport.height);
    }

    function applyVeil() { overlayBlack(player.veil); }

    function clearToBlack() {
        player.ctx.fillStyle = '#000';
        player.ctx.fillRect(0, 0, player.viewport.width, player.viewport.height);
    }

    // ------------------------------------------------------------------ //
    // Telemetry (§3.8, §7.6)
    // ------------------------------------------------------------------ //

    function startTelemetry() {
        if (player.telemetryTimer) clearInterval(player.telemetryTimer);
        player.telemetryTimer = setInterval(sendTelemetry, UMBRA_CONSTANTS.HEARTBEAT_INTERVAL_MS);
    }

    function sendTelemetry() {
        if (!player.connection) return;
        // NOTE: do NOT call viewport.update() here — reassigning canvas.width/height
        // wipes the canvas, which caused a periodic black flash. Resizing only
        // happens on the real window 'resize' event.
        const caps = {
            canvas2d: true,
            battery: player.battery ? player.battery.level : null,
            estimated_fps: Math.round(player.perf.estimatedFps()),
        };
        player.connection.send({
            type: 'TELEMETRY',
            viewport: player.viewport.getInfo(),
            capabilities: caps,
            performance_level: player.perf.level(),
        });
    }

    // ------------------------------------------------------------------ //
    // Status UI
    // ------------------------------------------------------------------ //

    function updateStatusUI(status) {
        const dot = document.getElementById('status-dot');
        const text = document.getElementById('status-text');
        dot.className = 'dot ' + status;
        const labels = { connected: 'Connected', disconnected: 'Disconnected', reconnecting: 'Reconnecting…' };
        text.textContent = labels[status] || status;
    }

    // ------------------------------------------------------------------ //
    // Debug HUD (?debug) — surfaces why a screen might be black
    // ------------------------------------------------------------------ //

    let debugEl = null;
    function createDebugHUD() {
        debugEl = document.createElement('div');
        debugEl.style.cssText =
            'position:fixed;top:8px;left:8px;z-index:200;font:12px/1.55 monospace;' +
            'color:#7f7;background:rgba(0,0,0,0.8);padding:8px 10px;border:1px solid #2a2a2a;' +
            'border-radius:6px;pointer-events:none;white-space:pre;max-width:90vw;';
        document.body.appendChild(debugEl);
        // Update on a timer too, so the HUD still reports even if the render
        // loop never starts (which is exactly the case we're diagnosing).
        setInterval(updateDebugHUD, 400);
        updateDebugHUD();
    }

    function updateDebugHUD() {
        if (!debugEl) return;
        const engines = Object.keys(window.UMBRA_ENGINES || {}).join(',') || 'NONE';
        const s = player.state || {};
        debugEl.textContent = [
            'UMBRA debug',
            'connected:  ' + player.connected,
            'engines:    ' + engines,
            'theme:      ' + (player.activeTheme ? player.activeTheme.id : 'NULL') + '  (state: ' + (s.active_theme_id || '-') + ')',
            'sleep:      ' + (s.sleep_state || '-') + '   role: ' + player.role,
            'brightness: ' + (s.brightness ?? '-') + ' x mod ' + player.brightnessModifier,
            'motion:     ' + (s.motion_scale ?? '-') + '   globalCoord: ' + !!s.global_coordinate_mode,
            'frames:     ' + player.frameCount + '   fps~' + Math.round(player.perf.estimatedFps()),
            'lastError:  ' + (player.lastError || 'none'),
        ].join('\n');
    }

    // ------------------------------------------------------------------ //
    // Boot
    // ------------------------------------------------------------------ //

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
