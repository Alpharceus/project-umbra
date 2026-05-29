/**
 * Project Umbra — Dashboard Orchestrator
 *
 * Coordinates the dashboard app: connects to the Conductor,
 * populates the UI, and routes user interactions to the control layer.
 */

(function () {
    'use strict';

    const dashboard = {
        connection: null,
        state: null,
        themes: [],
        presets: [],
        devices: [],
    };

    // ------------------------------------------------------------------ //
    // Initialization
    // ------------------------------------------------------------------ //

    function init() {
        // Load themes, presets, join info, and host monitors via REST
        fetchThemes();
        fetchPresets();
        fetchJoinInfo();
        DashboardControls.refreshHostMonitors();

        // Connect WebSocket
        dashboard.connection = new DashboardConnection({
            onSnapshot: handleSnapshot,
            onPatch: handlePatch,
            onDeviceList: handleDeviceList,
            onStatusChange: updateConnectionUI,
        });
        dashboard.connection.connect();

        // Bind controls
        DashboardControls.init(dashboard);
    }

    // ------------------------------------------------------------------ //
    // REST Fetches
    // ------------------------------------------------------------------ //

    async function fetchThemes() {
        try {
            const res = await fetch('/api/themes');
            dashboard.themes = await res.json();
            DashboardControls.renderThemeGrid(dashboard.themes, dashboard.state);
        } catch (e) {
            console.warn('[dashboard] Failed to fetch themes:', e);
        }
    }

    async function fetchPresets() {
        try {
            const res = await fetch('/api/presets');
            dashboard.presets = await res.json();
            DashboardControls.renderPresetGrid(dashboard.presets);
        } catch (e) {
            console.warn('[dashboard] Failed to fetch presets:', e);
        }
    }

    async function fetchJoinInfo() {
        try {
            const res = await fetch('/api/join-info');
            DashboardControls.renderJoinInfo(await res.json());
        } catch (e) {
            console.warn('[dashboard] Failed to fetch join info:', e);
        }
    }

    // ------------------------------------------------------------------ //
    // WebSocket Handlers
    // ------------------------------------------------------------------ //

    function handleSnapshot(msg) {
        dashboard.state = msg.data;
        DashboardControls.applyState(dashboard.state);
        DashboardControls.renderThemeGrid(dashboard.themes, dashboard.state);
    }

    function handlePatch(msg) {
        if (msg.data) {
            dashboard.state = msg.data;
            DashboardControls.applyState(dashboard.state);
            DashboardControls.renderThemeGrid(dashboard.themes, dashboard.state);
        }
    }

    function handleDeviceList(msg) {
        dashboard.devices = msg.devices || [];
        DashboardControls.renderDisplayMap(dashboard.devices);
        DashboardControls.renderDeviceList(dashboard.devices);
    }

    // ------------------------------------------------------------------ //
    // Connection UI
    // ------------------------------------------------------------------ //

    function updateConnectionUI(status) {
        const badge = document.getElementById('dash-connection');
        const text = document.getElementById('conn-text');

        badge.className = 'connection-badge ' + status;
        const labels = {
            connected: 'Connected',
            disconnected: 'Disconnected',
            reconnecting: 'Reconnecting…',
        };
        text.textContent = labels[status] || status;
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
