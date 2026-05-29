/**
 * Project Umbra — Dashboard UI Controls
 *
 * Binds DOM controls to the dashboard connection: sliders, sleep/theme/preset
 * grids, transition duration, cross-screen continuity, the advanced drawer,
 * per-device calibration/layout/identify, and the QR join panel (§8).
 */

const DashboardControls = (() => {
    'use strict';

    let dashboard = null;
    let transitionDuration = 6.0;

    // ------------------------------------------------------------------ //
    // Initialization
    // ------------------------------------------------------------------ //

    function init(dashRef) {
        dashboard = dashRef;

        document.getElementById('btn-blackout').addEventListener('click',
            () => dashboard.connection.setSleep('blackout'));
        document.getElementById('btn-wake').addEventListener('click',
            () => dashboard.connection.setSleep('awake'));

        bindSlider('slider-brightness', 'brightness-value', (v) => dashboard.connection.setBrightness(v / 100));
        bindChips('[data-brightness]', 'slider-brightness', 'brightness-value',
            (el) => parseInt(el.dataset.brightness, 10), (v) => dashboard.connection.setBrightness(v / 100));

        bindSlider('slider-motion', 'motion-value', (v) => dashboard.connection.setMotion(v / 100));
        bindChips('[data-motion]', 'slider-motion', 'motion-value',
            (el) => parseInt(el.dataset.motion, 10), (v) => dashboard.connection.setMotion(v / 100));

        document.querySelectorAll('[data-sleep]').forEach(btn =>
            btn.addEventListener('click', () => dashboard.connection.setSleep(btn.dataset.sleep)));

        // Transition duration
        document.querySelectorAll('[data-transition]').forEach(btn =>
            btn.addEventListener('click', () => {
                transitionDuration = parseFloat(btn.dataset.transition);
                document.querySelectorAll('[data-transition]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }));

        // Continuity toggle (§4.4)
        const cont = document.getElementById('toggle-continuity');
        if (cont) cont.addEventListener('change', () => dashboard.connection.setGlobalCoord(cont.checked));

        // Host monitor detection
        const refreshBtn = document.getElementById('btn-refresh-monitors');
        if (refreshBtn) refreshBtn.addEventListener('click', refreshHostMonitors);

        // Advanced drawer
        const toggle = document.getElementById('advanced-toggle');
        const content = document.getElementById('advanced-content');
        toggle.addEventListener('click', () => {
            const open = content.classList.toggle('hidden') === false;
            toggle.setAttribute('aria-expanded', String(open));
            toggle.querySelector('.chevron').textContent = open ? '▾' : '▸';
            if (open) dashboard.connection.requestDeviceList();
        });
    }

    function bindSlider(sliderId, valueId, onInput) {
        const slider = document.getElementById(sliderId);
        const value = document.getElementById(valueId);
        slider.addEventListener('input', () => {
            value.textContent = slider.value + '%';
            onInput(parseInt(slider.value, 10));
        });
    }

    function bindChips(selector, sliderId, valueId, getVal, onPick) {
        const slider = document.getElementById(sliderId);
        const value = document.getElementById(valueId);
        document.querySelectorAll(selector).forEach(chip =>
            chip.addEventListener('click', () => {
                const v = getVal(chip);
                slider.value = v;
                value.textContent = v + '%';
                onPick(v);
            }));
    }

    // ------------------------------------------------------------------ //
    // State Application
    // ------------------------------------------------------------------ //

    function applyState(state) {
        if (!state) return;

        document.getElementById('active-theme-name').textContent = formatThemeName(state.active_theme_id);

        setSlider('slider-brightness', 'brightness-value', Math.round(state.brightness * 100));
        setSlider('slider-motion', 'motion-value', Math.round(state.motion_scale * 100));

        const sleep = state.sleep_state || 'awake';
        document.querySelectorAll('[data-sleep]').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.sleep === sleep));

        const cont = document.getElementById('toggle-continuity');
        if (cont) cont.checked = !!state.global_coordinate_mode;
    }

    function setSlider(sliderId, valueId, pct) {
        document.getElementById(sliderId).value = pct;
        document.getElementById(valueId).textContent = pct + '%';
    }

    // ------------------------------------------------------------------ //
    // Theme Grid (all 10 themes are implemented in P2)
    // ------------------------------------------------------------------ //

    function renderThemeGrid(themes, state) {
        const grid = document.getElementById('theme-grid');
        if (!grid || !themes.length) return;
        grid.innerHTML = '';
        const activeId = state ? state.active_theme_id : null;

        themes.forEach(theme => {
            const card = document.createElement('div');
            card.className = 'theme-card';
            if (theme.id === activeId) card.classList.add('active');
            card.innerHTML = `
                <div class="theme-card-name">${theme.name}</div>
                <div class="theme-card-engine">${theme.engine} · ${theme.phase}</div>`;
            card.addEventListener('click', () =>
                dashboard.connection.setTheme(theme.id, transitionDuration));
            grid.appendChild(card);
        });
    }

    // ------------------------------------------------------------------ //
    // Preset Grid
    // ------------------------------------------------------------------ //

    function renderPresetGrid(presets) {
        const grid = document.getElementById('preset-grid');
        if (!grid || !presets.length) return;
        grid.innerHTML = '';
        presets.forEach(preset => {
            const card = document.createElement('div');
            card.className = 'preset-card';
            card.innerHTML = `<div class="preset-card-name">${preset.name}</div>`;
            card.addEventListener('click', () => dashboard.connection.applyPreset(preset));
            grid.appendChild(card);
        });
    }

    // ------------------------------------------------------------------ //
    // Device List + per-device calibration / layout / identify
    // ------------------------------------------------------------------ //

    function renderDeviceList(devices) {
        const list = document.getElementById('device-list');
        if (!list) return;

        const players = devices.filter(d => d.role === 'player' || d.role === 'excluded_primary');
        if (!players.length) {
            list.innerHTML = '<div class="empty-state">No screens connected</div>';
            return;
        }
        list.innerHTML = '';

        players.forEach(device => {
            const isExcluded = device.role === 'excluded_primary';
            const offline = device.connection_status !== 'connected';
            const vp = device.viewport || {};
            const dims = vp.width_px && vp.height_px ? `${vp.width_px}×${vp.height_px}` : '—';
            const layout = device.layout || {};
            const modPct = Math.round((device.brightness_modifier ?? 1) * 100);

            const item = document.createElement('div');
            item.className = 'device-item' + (isExcluded ? ' excluded' : '') + (offline ? ' offline' : '');

            // Row 1: name + actions
            const head = document.createElement('div');
            head.className = 'device-head';
            head.innerHTML = `
                <div class="device-info">
                    <div class="device-name">${device.display_name || device.device_id}</div>
                    <div class="device-meta">${device.role} · ${dims} · ${vp.orientation || '—'}</div>
                </div>`;
            const actions = document.createElement('div');
            actions.className = 'device-actions';

            const idBtn = document.createElement('button');
            idBtn.className = 'mini-btn';
            idBtn.textContent = 'Identify';
            idBtn.addEventListener('click', () => dashboard.connection.identifyDevice(device.device_id));

            const roleBtn = document.createElement('button');
            roleBtn.className = 'mini-btn' + (isExcluded ? ' active' : '');
            roleBtn.textContent = isExcluded ? 'Movie screen' : 'Mark movie';
            roleBtn.addEventListener('click', () =>
                dashboard.connection.setDeviceRole(device.device_id, isExcluded ? 'player' : 'excluded_primary'));

            actions.appendChild(idBtn);
            actions.appendChild(roleBtn);
            const dot = document.createElement('span');
            dot.className = 'device-status ' + (offline ? 'disconnected' : '');
            actions.appendChild(dot);
            head.appendChild(actions);
            item.appendChild(head);

            // Row 2: brightness calibration (§7.4)
            const cal = document.createElement('div');
            cal.className = 'device-cal';
            cal.innerHTML = `<span class="mini-label">Brightness ${modPct}%</span>`;
            const calSlider = document.createElement('input');
            calSlider.type = 'range'; calSlider.min = '0'; calSlider.max = '100'; calSlider.value = modPct;
            calSlider.className = 'cal-slider';
            calSlider.addEventListener('input', () => {
                cal.querySelector('.mini-label').textContent = `Brightness ${calSlider.value}%`;
            });
            calSlider.addEventListener('change', () =>
                dashboard.connection.setDeviceBrightness(device.device_id, parseInt(calSlider.value, 10) / 100));
            cal.appendChild(calSlider);
            item.appendChild(cal);

            // Row 3: room layout (§4.4)
            const lay = document.createElement('div');
            lay.className = 'device-layout';
            lay.appendChild(layoutField('X', 'origin_x', layout.origin_x ?? 0, device));
            lay.appendChild(layoutField('Y', 'origin_y', layout.origin_y ?? 0, device));
            lay.appendChild(layoutField('W', 'width_units', layout.width_units ?? 1, device));
            lay.appendChild(layoutField('H', 'height_units', layout.height_units ?? 1, device));
            lay.appendChild(rotationField(layout.rotation ?? 0, device));
            item.appendChild(lay);

            list.appendChild(item);
        });
    }

    function layoutField(label, key, value, device) {
        const wrap = document.createElement('label');
        wrap.className = 'layout-field';
        wrap.innerHTML = `<span>${label}</span>`;
        const input = document.createElement('input');
        input.type = 'number'; input.step = '0.05'; input.value = value;
        input.addEventListener('change', () => {
            const v = parseFloat(input.value);
            if (!isNaN(v)) dashboard.connection.setDeviceLayout(device.device_id, { [key]: v });
        });
        wrap.appendChild(input);
        return wrap;
    }

    function rotationField(value, device) {
        const wrap = document.createElement('label');
        wrap.className = 'layout-field';
        wrap.innerHTML = `<span>Rot</span>`;
        const sel = document.createElement('select');
        [0, 90, 180, 270].forEach(r => {
            const opt = document.createElement('option');
            opt.value = r; opt.textContent = r + '°';
            if (r === value) opt.selected = true;
            sel.appendChild(opt);
        });
        sel.addEventListener('change', () =>
            dashboard.connection.setDeviceLayout(device.device_id, { rotation: parseInt(sel.value, 10) }));
        wrap.appendChild(sel);
        return wrap;
    }

    // ------------------------------------------------------------------ //
    // Host Monitors — detected physical monitors with a launch button
    // ------------------------------------------------------------------ //

    function renderHostMonitors(monitors) {
        const wrap = document.getElementById('host-monitors');
        if (!wrap) return;
        if (!monitors || !monitors.length) {
            wrap.innerHTML = '<div class="empty-state">No monitors detected on the host</div>';
            return;
        }
        wrap.innerHTML = '';
        monitors.forEach((m) => {
            const row = document.createElement('div');
            row.className = 'host-monitor' + (m.active ? ' active' : '');
            const label = `${m.name}${m.is_primary ? ' (primary)' : ''}`;
            const info = document.createElement('div');
            info.className = 'host-monitor-info';
            info.innerHTML = `<div class="host-monitor-name">${label}</div>
                <div class="host-monitor-meta">${m.width}×${m.height} @ (${m.x},${m.y})</div>`;
            const btn = document.createElement('button');
            btn.className = 'mini-btn' + (m.active ? ' active' : '');
            btn.textContent = m.active ? 'Running' : 'Launch here';
            btn.addEventListener('click', async () => {
                btn.textContent = '…';
                try {
                    await fetch('/api/launch-display', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ index: m.index }),
                    });
                } catch (e) { /* ignore */ }
                setTimeout(refreshHostMonitors, 1500);
            });
            row.appendChild(info);
            row.appendChild(btn);
            wrap.appendChild(row);
        });
    }

    async function refreshHostMonitors() {
        try {
            const res = await fetch('/api/monitors');
            renderHostMonitors(await res.json());
        } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------ //
    // Display Map — Windows-display-settings-style monitor layout
    // ------------------------------------------------------------------ //

    function renderDisplayMap(devices) {
        const map = document.getElementById('display-map');
        if (!map) return;

        const players = devices.filter(d => d.role === 'player' || d.role === 'excluded_primary');
        if (!players.length) {
            map.style.height = '';
            map.innerHTML = '<div class="empty-state">No screens connected</div>';
            return;
        }

        // Build a rectangle per screen. Use the room layout when set; otherwise
        // auto-arrange left-to-right sized by the screen's aspect ratio.
        let cursor = 0;
        const items = players.map((d) => {
            const vp = d.viewport || {};
            const w = vp.width_px || 1600, h = vp.height_px || 900;
            const ar = (w && h) ? w / h : 1.6;
            const L = d.layout || {};
            let rect;
            if (L.width_units && L.height_units) {
                rect = { x: L.origin_x || 0, y: L.origin_y || 0, w: L.width_units, h: L.height_units, rot: L.rotation || 0 };
            } else {
                rect = { x: cursor, y: 0, w: ar, h: 1, rot: 0 };
                cursor += ar + 0.12;
            }
            return { d, rect, res: (w && h) ? `${w}×${h}` : '—' };
        });

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        items.forEach(({ rect }) => {
            minX = Math.min(minX, rect.x); minY = Math.min(minY, rect.y);
            maxX = Math.max(maxX, rect.x + rect.w); maxY = Math.max(maxY, rect.y + rect.h);
        });
        const bw = (maxX - minX) || 1, bh = (maxY - minY) || 1;

        const pad = 14;
        const innerW = (map.clientWidth || 320) - pad * 2;
        const maxBoxH = 190;
        const scale = Math.min(innerW / bw, maxBoxH / bh);
        map.style.height = (bh * scale + pad * 2) + 'px';
        map.innerHTML = '';

        items.forEach(({ d, rect, res }) => {
            const off = d.role === 'excluded_primary';
            const offline = d.connection_status !== 'connected';
            const el = document.createElement('div');
            el.className = 'monitor' + (off ? ' off' : '') + (offline ? ' offline' : '');
            el.style.left = (pad + (rect.x - minX) * scale) + 'px';
            el.style.top = (pad + (rect.y - minY) * scale) + 'px';
            el.style.width = Math.max(36, rect.w * scale) + 'px';
            el.style.height = Math.max(28, rect.h * scale) + 'px';
            const name = d.display_name || d.device_id;
            const rotBadge = rect.rot ? ` ${rect.rot}°` : '';
            el.innerHTML = `
                <div class="mon-name">${name}</div>
                <div class="mon-res">${res}${rotBadge}</div>
                <div class="mon-state">${off ? 'OFF' : 'ON'}</div>`;
            el.title = off ? 'Animations off — tap to enable' : 'Animating — tap to turn off';
            if (!offline) {
                el.addEventListener('click', () =>
                    dashboard.connection.setDeviceRole(d.device_id, off ? 'player' : 'excluded_primary'));
            }
            map.appendChild(el);
        });
    }

    // ------------------------------------------------------------------ //
    // QR Join Panel (§3.6)
    // ------------------------------------------------------------------ //

    function renderJoinInfo(info) {
        if (!info) return;
        const holder = document.getElementById('qr-holder');
        if (holder && info.qr_svg) holder.innerHTML = info.qr_svg;

        const wrap = document.querySelector('.join-urls');
        if (!wrap) return;
        const eps = info.endpoints || (info.player_url ? [{ player_url: info.player_url }] : []);
        if (!eps.length) { wrap.innerHTML = '<div class="join-hint">No network detected.</div>'; return; }
        const rows = eps.map(e => `<div class="join-url">${e.player_url}</div>`).join('');
        const hint = eps.length > 1
            ? 'Open the URL for the network the other device is on (e.g. the Ethernet IP for a direct cable).'
            : 'Open this URL on another screen on the same network.';
        wrap.innerHTML = rows + `<div class="join-hint">${hint}</div>`;
    }

    // ------------------------------------------------------------------ //
    // Helpers
    // ------------------------------------------------------------------ //

    function formatThemeName(id) {
        if (!id) return '—';
        return id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    return {
        init, applyState, renderThemeGrid, renderPresetGrid,
        renderDeviceList, renderDisplayMap, renderJoinInfo,
        renderHostMonitors, refreshHostMonitors,
    };
})();
