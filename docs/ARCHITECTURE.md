# Project Umbra — Architecture & Implementation Handoff

> **For a future implementer (likely another Claude session).** This documents
> the *standalone* Umbra codebase so you can reimplement it — stripped down, with
> features added — as the **"movie mode" / ambient-display feature of the larger
> "Jarvis" assistant project**. The agent architecture and the exact integration
> surface are TBD; this doc gives you the design, the contracts, and the
> hard-won lessons so you don't rediscover them. Read this instead of the whole
> tree; jump to specific files only when you need the detail.

---

## 0. TL;DR

- **One Python server (Conductor) is the authority.** Every "screen" is just a
  **browser** that opens a URL and renders **procedurally** (math from
  `seed + time + params`), synced over WebSocket. No video is streamed; almost
  no bandwidth. Nothing is installed on client screens.
- **The visuals are deterministic**, so all screens draw the same field
  independently from shared state — sync the *state*, not the pixels.
- For Jarvis, the **mobile dashboard (human UI) is the part you replace**: an
  agent drives the same state mutations programmatically (or in-process). The
  **renderer + engines + state engine + kiosk launcher** are the reusable core.
- "Movie mode" maps directly to existing controls: **Blackout** sleep state /
  **Movie preset** (low brightness, slow motion) when a film plays; ambient
  field when idle.

---

## 1. Components & data flow

```
            Dashboard (browser /dashboard)         <- REPLACE with agent control
                    |  WebSocket (control intents)
                    v
        +-----------------------------+
        |  Conductor (FastAPI server) |  authoritative UmbraState
        |  HTTP + WebSocket, port 8000|
        +-----------------------------+
                    |  WebSocket (STATE_SNAPSHOT / STATE_PATCH / CLOCK_SYNC)
        +-----------+-----------+
        v           v           v
    Player       Player       Player          browsers, render Canvas2D locally
   (/join)      (/join)      (/join)
```

- **HTTP** serves the static apps + REST (themes/presets/devices/monitors/QR).
- **WebSocket** carries realtime state. Two endpoints: `/ws/player`,
  `/ws/dashboard`.
- **Players are opt-in**: a screen is only used if a browser opens `/join`
  (or the kiosk launcher opens one). This is how the movie screen is excluded —
  it simply isn't joined, or is marked `excluded_primary`.

---

## 2. Canonical state — the contract (`conductor/state.py`)

`UmbraState` is the single source of truth. Every mutation bumps
`state_version` and broadcasts a `STATE_PATCH` (full state in `data`).

```
UmbraState
  session_id            # uuid; players bind to the first they see (conductor-conflict guard)
  state_version         # monotonic; bump on every change
  conductor_time        # seconds since conductor start (monotonic). See §6 clock note.
  active_theme_id        previous_theme_id     theme_parameters {}   global_seed
  transition            # {type,start_time,duration,curve,from,to,progress}
  brightness            # 0..1  global dimmer
  motion_scale          # 0..1  motion governor
  contrast_scale density_scale
  sleep_state           # awake|blackout|frozen_dark|idle_breathing|disconnect_sleep
  global_coordinate_mode# bool: cross-screen continuity on/off
  room_layout_id
  media_state           # DEFER hook: playing|paused|stopped   <- Jarvis integration seam
  primary_luminance     # DEFER hook: 0..1 avg movie brightness <- Jarvis integration seam
```

`StateEngine` (module singleton `state_engine`) has `set_theme`,
`set_brightness`, `set_motion_scale`, `set_contrast_scale`, `set_density_scale`,
`set_sleep_state`, `set_global_coordinate_mode`, `apply_preset`. Each returns a
patch dict and bumps the version. **An agent can call these directly in-process**
instead of going through WebSocket.

---

## 3. Message protocol (`conductor/sync/messages.py`, `shared/js/protocol.js`)

| Direction | Types |
|---|---|
| Conductor → Player | `STATE_SNAPSHOT` (full, on connect/resync), `STATE_PATCH` (full state on each change), `CLOCK_SYNC` (t0 ping), `IDENTIFY` (flash a label), `DEVICE_SETTINGS` (this device's role/brightness_modifier/layout) |
| Conductor → Dashboard | `STATE_SNAPSHOT`, `STATE_PATCH`, `DEVICE_LIST` |
| Player → Conductor | `HELLO` (device_id, display_name, viewport, capabilities, layout), `TELEMETRY`, `HEARTBEAT`, `CLOCK_REPLY` |
| Dashboard → Conductor | `SET_THEME`, `SET_BRIGHTNESS`, `SET_MOTION`, `SET_CONTRAST`, `SET_DENSITY`, `SET_SLEEP`, `APPLY_PRESET`, `SET_DEVICE_ROLE`, `SET_DEVICE_BRIGHTNESS`, `SET_DEVICE_LAYOUT`, `SET_GLOBAL_COORD`, `IDENTIFY_DEVICE`, `SAVE_PRESET`, `REQUEST_DEVICE_LIST` |

Notes:
- **There is no separate SLEEP/WAKE/THEME_TRANSITION message** — sleep state and
  transitions live inside `STATE_PATCH`. (Earlier versions had them; removed.)
- The dashboard uses **direct state mutation** (single-user home system; no
  intent/validation layer). The conductor broadcasts the resulting patch to all.
- Connection lifecycle in `conductor/sync/websocket.py` (`WebSocketManager`):
  player `HELLO` → register device → send snapshot (with `assigned_device_id`,
  `assigned_role`, `assigned_brightness_modifier`, `assigned_layout`) → broadcast
  device list → per-player clock-sync loop.

---

## 4. Rendering engines (`player/js/engines/`)

**Engines, not themes.** 10 themes are parameter presets over 6 engines
(`player/js/themes/registry.js` maps `theme_id -> {engine, params}`).
`createUmbraTheme(themeId, opts)` instantiates the engine.

| Engine | File | Themes | Space |
|---|---|---|---|
| E1 Point/Particle Field | `e1-point-field.js` | cosmic-drift (glowing starfield), dust-motes (brownian) | world |
| E2 Advected Noise Field | `e2-noise-field.js` | abyssal-fluid, volumetric-smoke, glacial-nebula | world; renders to a small offscreen buffer, upscaled |
| E3 Falling Column | `e3-falling-column.js` | macro-rain, digital-rainfall | screen-relative |
| E4 Procedural Grid | `e4-procedural-grid.js` | the-slow-matrix | world |
| E5 Banded Field | `e5-banded-field.js` | strata-shift | world; offscreen buffer |
| E6 Edge/Peripheral Mask | `e6-edge-mask.js` | solar-corona | screen-relative |

- `EngineBase` (`engine-base.js`) provides param access (`this.p(name, default)`),
  quality scaling, and **world↔pixel mapping with rotation** (`worldRect`,
  `normalizedToWorld`, `worldToPixel`, `worldBounds`). In **local mode** a device's
  "room rect" is its own aspect-correct space; in **global mode** it's the device's
  layout (origin/size/rotation in room units) → fields flow across screens.
- `noise.js` = seeded value-noise + fBm for E2/E5.
- All themes extend `ThemeBase` (`themes/theme-base.js`): `update(visualTime, dt,
  state)` then `render(ctx, viewport, brightness)`.
- **Brightness model:** themes render at full intrinsic output; the global dimmer
  is a black overlay at `alpha = 1 - brightness` (so `final = scene * brightness`).
  `UmbraRenderer.applyBrightness` in `renderer.js`.
- **Transitions are a crossfade** (`player.js`): capture the outgoing frame to one
  offscreen canvas, render the new theme live, fade the captured frame out on top.
  No black gap. Freed after the transition.

---

## 5. Player runtime (`player/js/player.js`)

- Boot: parse URL opts → connect → on `STATE_SNAPSHOT` start the throttled render
  loop (`requestAnimationFrame` gated to ~`target_fps` 12).
- **Visual time:** `visualTime = clock.getConductorTime() * motion_scale`. The
  clock (`clock.js`) **anchors** `conductor_time` to the local clock on each
  snapshot/patch and **extrapolates** locally — do NOT use the raw snapshot time
  directly or the animation freezes between updates.
- Sleep states handled per-frame: blackout/disconnect_sleep fade to black;
  frozen_dark holds the last frame dimmed; idle_breathing draws a faint breathing
  edge glow; `excluded_primary` role renders nothing.
- Per-device: `brightness_modifier` (calibration), `layout`, `role` arrive via
  `DEVICE_SETTINGS` and the snapshot.
- **Performance governor** (`perf.js`): EMA of frame dt; on sustained <70% target
  for ~2s, drop quality (resolution/particle detail); recover after ~8s.
- **URL options:** `?auto=1` (skip the entry gate, connect immediately — used by
  the kiosk launcher), `?name=`, `?ox/oy/wu/hu` (initial room layout), `?debug=1`
  (on-screen HUD: engines, theme, fps, frames, lastError).

---

## 6. Control surfaces = the "movie mode" knobs

These are what an agent toggles:
- **sleep_state = `blackout`** → screens fade to black (movie starts).
- **Movie preset** → brightness 0.05, motion 0.25, low contrast/density.
- **brightness / motion / contrast / density** sliders (0..1).
- **Per-screen exclusion**: set a device's role to `excluded_primary` so the
  screen showing the film stays black while others render.
- Presets in `data/presets.json` (Movie / Pre-Movie Ambient / Sleep Glow /
  Blackout).

---

## 7. Module map

```
conductor/
  main.py            FastAPI app, lifespan (banner+device load/save), middleware (no-store),
                     static mounts, /ws/player /ws/dashboard, start()
  config.py          Settings (pydantic). Loads config.json + gitignored config.local.json.
                     Frozen-aware paths (_resource_root via sys._MEIPASS, _runtime_root via sys.executable)
  netutil.py         get_local_ip, list_local_ipv4, join_ips(host), self_host(host)
  kiosk.py           screeninfo monitor detection; launch fullscreen browser per monitor (Edge/Chrome --app)
  state.py           UmbraState, TransitionState, SleepState, StateEngine (singleton state_engine)
  devices.py         Device model, DeviceRegistry (roles, calibration, layout, JSON persistence)
  sync/websocket.py  WebSocketManager: connections, routing, broadcast, per-player clock loop
  sync/messages.py   message enums + builders
  sync/clock.py      ClockSynchronizer (conductor-side NTP-ish; diagnostic)
  routes/api.py      REST: /state /devices /themes /presets /join-info(QR) /monitors /launch-display
  routes/player.py   serves player/index.html at /join
  routes/dashboard.py serves dashboard/index.html at /dashboard
  persistence/store.py JSON file IO + save/load devices & presets

player/  index.html + css + js/{viewport,clock,perf,connection,renderer,player} + js/engines/* + js/themes/{theme-base,registry}
dashboard/ index.html + css + js/{connection,controls,dashboard}
shared/js/ constants.js, protocol.js
data/ config.json, presets.json, config.local.example.json   (gitignored: config.local.json, devices.json)
run_umbra.py  frozen entry: opens dashboard on launch, optional auto-kiosk; passes app to uvicorn
```

---

## 8. Runtime, networking, packaging

- **Entry points:** `python -m conductor.main` (plain server) · `python run_umbra.py`
  / the exe (opens dashboard, monitor picker; `auto_launch_kiosk` opens all).
- **Kiosk/screensaver:** `kiosk.launch_on(index, port, debug, host)` opens a
  fullscreen chrome-less `--app` window per monitor at `/join?auto=1&geometry`.
  Geometry → device layout → the dashboard's Displays map mirrors the physical
  arrangement. Each window auto-joins.
- **Networking:** binds `settings.host` (default `0.0.0.0` = all interfaces).
  Set `config.local.json` `{"host":"192.168.10.1"}` (gitignored) to bind **one
  interface only** — then it isn't exposed on other networks at all. Banner +
  `/api/join-info` list a join URL per interface. Use the host **IP** on other
  devices, never `localhost`. Lock down further with a scoped firewall rule
  (allow only the peer IP).
- **Packaging:** PyInstaller via `run_umbra.py`; `--collect-all uvicorn websockets
  h11 segno screeninfo --hidden-import httptools`, `--add-data player/dashboard/
  shared`. Ship `dist/umbra/` (exe + `_internal/` + `data/`). The exe is a build
  artifact, **not** committed.
- **Deps:** fastapi, uvicorn[standard], websockets, pydantic, segno (QR),
  screeninfo (monitors). Frontend is vanilla JS + Canvas2D, **no build step**.
- **Tests:** pytest (`tests/`), incl. an `httpx`/TestClient integration test. JS is
  validated headlessly with `py_mini_racer` (V8) since Edge == Chromium == V8.

---

## 9. Hard-won lessons (don't rediscover these)

1. **Browsers can't dim the monitor backlight.** Dim-themed visuals drown against
   a lit "black." Keep default brightness high enough to see (we ship 0.6); dim
   only for movie mode.
2. **Reassigning `canvas.width`/`height` wipes the canvas.** A telemetry timer that
   called `viewport.update()` every 5s caused a periodic black flash. Resize only
   on real window-resize.
3. **Anchor + extrapolate the clock.** Using the raw `conductor_time` from the last
   snapshot freezes motion between updates.
4. **FastAPI WebSocket handlers need a typed param** (`websocket: WebSocket`) or the
   handshake 403s.
5. **PyInstaller frozen paths:** resolve bundled assets via `sys._MEIPASS`, writable
   data via `sys.executable` parent. `uvicorn.run(app_object)` (not import string).
   Lazy imports (screeninfo) need `--collect-all`.
6. **A stale exe holding port 8000** silently serves old code → "my fix didn't
   work." Added `Cache-Control: no-store` for assets; ensure only one instance.
7. **Avoid per-frame allocations** (E2 palette allocated an array per pixel → GC
   stutter). Reuse buffers.
8. **str-enum message types** serialize fine via `json.dumps` (they're `str`
   subclasses), but coerce role strings back to the `DeviceRole` enum before
   storing in a pydantic model.

---

## 10. Adapting for Jarvis (movie mode)

The user's note: *"great for humans, not so much for an agent."* So:

**Replace the human dashboard with agent control.** Three viable surfaces:
- **In-process** (simplest if Jarvis is Python): import `state_engine` and call
  `set_sleep_state`, `apply_preset`, etc.; the WebSocket manager broadcasts to the
  browser screens. Drop `/ws/dashboard` and the `dashboard/` app entirely.
- **Thin REST/WS control endpoint** the agent hits (keep the protocol, drop the UI).
- Keep the conductor as a subprocess/service Jarvis manages.

**Use the reserved media hooks** (`media_state`, `primary_luminance` in
`UmbraState`) as the integration seam:
- `media_state = playing` → agent sets Blackout (or Movie preset) on ambient
  screens; `paused` → raise toward ambient; `stopped` → return to the idle field.
- `primary_luminance` (if Jarvis can sample the film) → inversely modulate ambient
  brightness (darker scene → dimmer room).

**Probably strip** (not needed for a single-machine agent feature): the mobile
dashboard UI, QR/multi-guest onboarding, per-device brightness calibration,
room-layout editor + cross-screen continuity (unless multi-monitor continuity is
wanted), device persistence. **Keep:** the procedural renderer + 6 engines, the
state/dimmer/sleep model, the kiosk launcher (screensaver on the host's monitors),
and the throttled time-decoupled render loop.

**Likely additions for Jarvis:** voice/intent triggers ("movie mode on" →
Blackout the TV, ambient on the rest), media-player integration (detect
play/pause), and scheduling (ambient when idle, off at night). The control plane
is the new work; the rendering substrate is done and reusable.

**Minimal viable "movie mode" for the agent:** run the Conductor headless, kiosk
the ambient field onto chosen monitors, and on a "movie starts" signal set
`sleep_state=blackout` (or Movie preset) — exclude the screen playing the film.
That's the whole feature in terms of Umbra's existing API.
