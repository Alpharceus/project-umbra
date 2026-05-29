/**
 * Project Umbra — Player WebSocket Connection
 *
 * Manages the persistent WebSocket connection to the Conductor.
 * Handles HELLO registration, reconnection with exponential backoff,
 * heartbeats, and message routing.
 *
 * See design doc §3.7 (join flow) and §3.9 (failure handling).
 */

class UmbraConnection {
    constructor(options) {
        this.deviceId = options.deviceId || null;
        this.displayName = options.displayName || '';
        this.layout = options.layout || null;
        this.viewport = options.viewport || {};
        this.onSnapshot = options.onSnapshot || (() => {});
        this.onPatch = options.onPatch || (() => {});
        this.onClockSync = options.onClockSync || (() => {});
        this.onIdentify = options.onIdentify || (() => {});
        this.onDeviceSettings = options.onDeviceSettings || (() => {});
        this.onStatusChange = options.onStatusChange || (() => {});

        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectDelay = 30000; // 30s max
        this.heartbeatInterval = null;
    }

    connect() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${location.host}/ws/player`;

        this.onStatusChange('reconnecting');

        try {
            this.ws = new WebSocket(url);
        } catch (e) {
            console.error('[umbra] WebSocket creation failed:', e);
            this._scheduleReconnect();
            return;
        }

        this.ws.onopen = () => {
            console.log('[umbra] Connected to Conductor');
            this.reconnectAttempts = 0;
            this.onStatusChange('connected');
            this._sendHello();
            this._startHeartbeat();
        };

        this.ws.onmessage = (event) => {
            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch (e) {
                console.warn('[umbra] Failed to parse message:', e);
                return;
            }
            // Route outside the parse try so handler bugs surface as real
            // errors instead of being mislabeled as parse failures.
            try {
                this._routeMessage(msg);
            } catch (e) {
                console.error('[umbra] Error handling message', msg && msg.type, e);
            }
        };

        this.ws.onclose = () => {
            console.log('[umbra] Disconnected from Conductor');
            this.onStatusChange('disconnected');
            this._stopHeartbeat();
            this._scheduleReconnect();
        };

        this.ws.onerror = (err) => {
            console.error('[umbra] WebSocket error:', err);
            // onclose will fire after onerror
        };
    }

    send(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    // ---- Private ----

    _sendHello() {
        this.send({
            type: 'HELLO',
            device_id: this.deviceId,
            display_name: this.displayName,
            viewport: this.viewport,
            capabilities: this._detectCapabilities(),
            layout: this.layout,
        });
    }

    _detectCapabilities() {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        return {
            canvas2d: true,
            webgl: !!canvas.getContext('webgl'),
            webgl2: !!canvas.getContext('webgl2'),
            fullscreen: !!(document.fullscreenEnabled || document.webkitFullscreenEnabled),
            max_texture_size: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0,
            estimated_fps: 0,
            battery: null,
        };
    }

    _routeMessage(msg) {
        switch (msg.type) {
            case 'STATE_SNAPSHOT':
                this.onSnapshot(msg);
                break;
            case 'STATE_PATCH':
                this.onPatch(msg);
                break;
            case 'CLOCK_SYNC':
                this.onClockSync(msg);
                break;
            case 'IDENTIFY':
                this.onIdentify(msg);
                break;
            case 'DEVICE_SETTINGS':
                this.onDeviceSettings(msg);
                break;
            default:
                console.log('[umbra] Unknown message type:', msg.type);
        }
    }

    _startHeartbeat() {
        this._stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            this.send({ type: 'HEARTBEAT' });
        }, UMBRA_CONSTANTS.HEARTBEAT_INTERVAL_MS);
    }

    _stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    _scheduleReconnect() {
        // Exponential backoff: 1s, 2s, 4s, 8s, … capped at 30s
        const delay = Math.min(
            1000 * Math.pow(2, this.reconnectAttempts),
            this.maxReconnectDelay
        );
        this.reconnectAttempts++;
        this.onStatusChange('reconnecting');
        console.log(`[umbra] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        setTimeout(() => this.connect(), delay);
    }
}
