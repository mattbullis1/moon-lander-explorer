# Moon Lander Explorer

A self-contained HTML5 lunar exploration arcade game. Fly a thrust-only lander across a procedurally generated moon, collect mission objectives, avoid hazards, and unlock the next outpost checkpoint.

**Live demo:** <https://mattbullis1.github.io/moon-lander-explorer/>

**Local play:** <http://mother.local:8080/moon-lander-explorer/>

Both locations serve the same static game. There is no build step and no remote asset or font dependency.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Fire thrusters | Hold `Space`, `W`, `ArrowUp`, or hold the left mouse button on the game canvas | Press and hold anywhere on the game canvas |
| Pause / resume | `P` or `Escape`, or the pause button in the HUD | Pause button in the HUD |
| Menus | Mouse and keyboard | Tap |

The lander advances automatically. Thrust raises it; releasing thrust lets gravity and the auto-flight controller bring it down. There is no separate steering input. Landing on a pad uses the automatic approach, slow-down, and capture system when the lander enters a pad's approach envelope.

## Mission Loop

1. Launch from an outpost pad.
2. Complete the current sector objective: collect mineral samples, recover equipment, locate an anomaly, or rescue a survivor.
3. Avoid terrain, cave ceilings, drones, sentry fire, and falling cave debris.
4. Reach the next pad to bank the checkpoint score and open the service station.
5. Spend salvage on upgrades, then launch into the next sector.

Each sector is deterministic for a run seed. Terrain, caves, outposts, landmarks, pickups, hazards, and missions are rebuilt identically from that seed.

### Checkpoints and scoring

- Landing at a station advances the checkpoint and opens the service station.
- Live score and distance are reset to the last checkpoint on a crash.
- Salvage, upgrades, collected pickups, discoveries, and completed missions are retained after a crash.
- A completed mission cannot be rewarded twice. Reaching a station without its mission complete offers no mission bonus.
- The best score survives **New Game**.

### Upgrades

| Upgrade | Effect |
| --- | --- |
| Engine Tuning | Faster throttle response and thrust |
| Deflector Shield | More shield capacity and faster recharge |
| Hull Plating | More maximum hull integrity |
| Auxiliary Tanks | Cosmetic fuel pods and trim lights; fuel is unlimited |

## Persistence

Progress and settings use separate versioned `localStorage` keys:

- `moonLanderExplorer.progress.v1` - seed, checkpoint, score, best score, salvage, upgrades, collected IDs, completed missions, discoveries, and statistics.
- `moonLanderExplorer.settings.v1` - music/SFX volume and mute, screen shake, and render quality.

The checkpoint is written at stations and the current run is autosaved during flight and when the page is hidden. **New Game** clears route progress but keeps the best score and audio/display settings. Corrupt or unsupported stored data is sanitized or treated as no save instead of blocking startup.

Audio is generated with Web Audio and starts only after the first click, tap, or keypress, in line with browser autoplay policies.

## Technology

- Native HTML5 Canvas 2D rendering - no framework, engine download, or build step.
- Vanilla ES modules.
- Fixed `1/60 s` physics timestep.
- Procedural graphics and audio; no external images, fonts, audio files, or gameplay network requests.
- Seeded PRNG for deterministic world generation.
- Responsive layout for desktop, portrait mobile, and landscape mobile.
- High-DPI canvas backing store with device-pixel-ratio capping and adaptive quality.

### Source layout

| File | Responsibility |
| --- | --- |
| `index.html` | Canvas, HUD, overlays, menus, and station markup |
| `css/style.css` | Cockpit, menu, station, overlay, and responsive styling |
| `js/main.js` | Bootstrap, animation loop, resize/visibility handling, error banner |
| `js/game.js` | Game controller, fixed-step flight loop, missions, hazards, checkpoints, saves |
| `js/world.js` | Deterministic terrain, caves, outposts, pickups, missions, and hazards |
| `js/renderer.js` | Camera, layered scene rendering, mist, and screen effects |
| `js/player.js` | Flight model, health, shields, damage, and upgrades |
| `js/art.js` | Procedural spacecraft, stations, terrain props, and icons |
| `js/hud.js` | Vitals, score, mission card, radar, and proximity HUD |
| `js/ui.js` | Menu, station, settings, help, pause, confirmation, and crash screens |
| `js/audio.js` | Procedural Web Audio music and sound effects |
| `js/particles.js` | Exhaust, impacts, explosions, and ambient particles |
| `js/input.js` | Unified keyboard, mouse, and multi-touch input |
| `js/save.js` | Versioned persistence, schema sanitization, and settings |
| `js/utils.js` | Math, PRNG, hashing, and formatting helpers |

## Running Locally

The game is already deployed under XAMPP at:

```text
C:\xampp\htdocs\moon-lander-explorer
```

1. Start Apache in the XAMPP control panel.
2. Open <http://mother.local:8080/moon-lander-explorer/>.
3. No npm install or compile step is required.

Because the game uses ES modules, open it through the web server above rather than as a `file://` URL. Any static HTTP server that preserves the directory layout will also work.

## Verification Notes

Development checks were run in headless Chromium through Playwright against the live XAMPP URL. Covered flows include desktop and mobile menus, station upgrades, flight and landing, missions in consecutive sectors, checkpoint reloads, crash/respawn persistence, settings, help, pause, touch thrust, adaptive quality, sentry projectiles, falling debris, damaged-shield and invulnerability behavior, corrupt-storage recovery, and portrait/landscape layout checks. No console errors, page errors, or failed asset requests were recorded in those checks.
