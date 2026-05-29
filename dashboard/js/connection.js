/**
 * Project Umbra — Dashboard WebSocket Connection
 *
 * Connects to the Conductor as a controller client.
 * Sends control intents (SET_THEME, SET_BRIGHTNESS, etc.)
 * and receives state updates and device lists.
 *
 * See design doc §8.3.
 */

class DashboardConnection {
    constructor(options) {
        this.onSnapshot = options.onSnapshot || (() => {});
        this.onPatch = options.onPatch || (() => {});
        this.onDeviceList = options.onDeviceList || (() => {});
        this.onStatusChange = options.onStatusChange || (() => {});

        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectDelay = 15000;
    }

    connect() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${location.host}/ws/dashboard`;

        this.onStatusChange('reconnecting');

        try {
            this.ws = new WebSocket(url);
        } catch (e) {
            console.error('[dashboard] WebSocket creation failed:', e);
            this._scheduleReconnect();
            return;
        }

        this.ws.onopen = () => {
            console.log('[dashboard] Connected to Conductor');
            this.reconnectAttempts = 0;
            this.onStatusChange('connected');
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this._routeMessage(msg);
            } catch (e) {
                console.warn('[dashboard] Failed to parse message:', e);
            }
        };

        this.ws.onclose = () => {
            this.onStatusChange('disconnected');
            this._scheduleReconnect();
        };

        this.ws.onerror = () => {
            // onclose will fire
        };
    }

    send(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    // ---- Control Messages (§8.3: direct state mutations) ----

    setTheme(themeId, transitionDuration) {
        this.send({
            type: 'SET_THEME',
            theme_id: themeId,
            transition_duration: transitionDuration || 6.0,
        });
    }

    setBrightness(value) {
        this.send({ type: 'SET_BRIGHTNESS', value });
    }

    setMotion(value) {
        this.send({ type: 'SET_MOTION', value });
    }

    setSleep(sleepState) {
        this.send({ type: 'SET_SLEEP', sleep_state: sleepState });
    }

    applyPreset(preset) {
        this.send({ type: 'APPLY_PRESET', preset });
    }

    setDeviceRole(deviceId, role) {
        this.send({ type: 'SET_DEVICE_ROLE', device_id: deviceId, role });
    }

    setDeviceBrightness(deviceId, value) {
        this.send({ type: 'SET_DEVICE_BRIGHTNESS', device_id: deviceId, value });
    }

    setDeviceLayout(deviceId, layout) {
        this.send({ type: 'SET_DEVICE_LAYOUT', device_id: deviceId, layout });
    }

    setGlobalCoord(enabled) {
        this.send({ type: 'SET_GLOBAL_COORD', enabled });
    }

    identifyDevice(deviceId) {
        this.send({ type: 'IDENTIFY_DEVICE', device_id: deviceId });
    }

    requestDeviceList() {
        this.send({ type: 'REQUEST_DEVICE_LIST' });
    }

    // ---- Private ----

    _routeMessage(msg) {
        switch (msg.type) {
            case 'STATE_SNAPSHOT':
                this.onSnapshot(msg);
                break;
            case 'STATE_PATCH':
                this.onPatch(msg);
                break;
            case 'DEVICE_LIST':
                this.onDeviceList(msg);
                break;
            default:
                console.log('[dashboard] Unknown message:', msg.type);
        }
    }

    _scheduleReconnect() {
        const delay = Math.min(
            1000 * Math.pow(2, this.reconnectAttempts),
            this.maxReconnectDelay
        );
        this.reconnectAttempts++;
        this.onStatusChange('reconnecting');
        setTimeout(() => this.connect(), delay);
    }
}
