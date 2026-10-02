# Xbox Cloud Nexus

A premium Windows desktop client for **Xbox Cloud Gaming** — browse, search, launch and,
most importantly, **play every cloud game with keyboard and mouse**, including games that
only accept a controller.

Built on Electron. It uses Microsoft's official sign-in and the official Cloud Gaming
play page, and layers a **full visual controller remapper** and Better xCloud's
open-source mouse/keyboard emulation on top of it.

---

## Why this exists

Cloud Gaming titles assume a gamepad. Shooters, racing games and platformers all expect
thumbsticks and triggers. If you only have a keyboard and a mouse, most of the catalogue
is unplayable.

Xbox Cloud Nexus translates **your** keyboard and mouse into the controller inputs the
game expects — the same approach as the open-source [Better xCloud](https://github.com/redphx/better-xcloud)
project, vendored and wired in automatically. No browser extension to install, no
compatibility list to check: if a game runs with a controller, it runs here with your
mappings.

---

## Features

### Play with keyboard + mouse, on every game
- Your mapping is compiled into a **virtual controller preset** that Better xCloud loads
  before the game starts — the game sees a normal gamepad, never your keyboard.
- Mouse movement drives the **right stick** (right-stick aiming) with per-profile
  sensitivity X/Y, invert Y, deadzone, response curve, smoothing and acceleration.
- Switch between controller and keyboard + mouse at any time: a **pre-launch panel**
  before the game opens, and **F8** toggles emulation inside a running game.
- Works alongside a real controller — both are live at the same time.

### Visual controller remapping
- An Xbox-style controller diagram where **every one of the 25 remappable inputs** is a
  real hotspot: A/B/X/Y, LB/RB, LT/RT, View/Menu/Xbox, both stick clicks, all four
  D-pad directions and all four directions of **both analogue sticks**.
- Click a control, press a key or mouse button, and the diagram updates instantly — the
  panel is patched in place, never rebuilt.
- An on-screen keyboard highlights every key that is currently bound and lets you build a
  layout from scratch: click an unbound key, pick what it should control, done.
- Full keyboard (letters, numbers, F-keys, arrows, modifiers) and all mouse buttons.
  Windows-reserved and app-navigation combos are refused with an explanation.
- **Conflict detection** whenever a key is already in use: replace, keep both, or cancel.

### Control profiles
- Create, rename, duplicate, delete and reset profiles (Default, FPS, Racing, RPG, Custom).
- **Per-game profiles**: bind a profile to a game and it is loaded automatically at launch.
- Import / export profiles as JSON.
- Mouse and stick tuning is per profile, not global — an FPS profile can have 200 %
  sensitivity while a racing profile keeps it subtle.

### Input test mode
- Press anything — key, mouse button or controller button — and see what it *is* and what
  it *maps to*, with the matching control lighting up on the pad.

### Streaming quality and latency
- Target resolution (Auto / 720p / 1080p / 1080p HQ), lock-resolution option, frame-rate
  cap (30/40/50/60), WebGL2 renderer with a clarity boost, GPU power preference and
  **controller polling rate** (4–60 Hz) for the lowest practical input latency.
- Native fullscreen, **F11** to toggle fullscreen in game, F12 to reload.
- Low-end mode drops the heavy renderer, lowers artwork quality and keeps frame pacing
  smooth.

### Browse the catalogue
- Home with a rotating hero, recently played, and dedicated **Play With Ads** rail.
- Cloud Gaming, Library (search, sort, favourites, hide, genres), Play With Ads and
  Recent views.
- Game details with facts, availability, KBM support and a per-game profile picker.
- Catalogue loads progressively: the app paints in about a second and fills in as
  product data arrives, instead of staring at a spinner for a minute.

---

## Install

Download from the releases page and run the installer:

- `XboxCloudNexus-<version>-x64-nsis.exe` — normal installer with Start Menu and desktop
  shortcuts.
- `XboxCloudNexus-<version>-portable.exe` — single file, no installation.

Windows 10/11 x64. Sign-in happens inside Microsoft's own page; the app never asks for or
stores your password.

---

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Ctrl` + `K` | Command palette |
| `F8` | Toggle keyboard + mouse emulation **inside a game** |
| `F11` | Toggle fullscreen in a game |
| `F12` | Reload the stream |
| `Esc` | Close overlay / cancel remapping |

---

## How it works

```
Renderer (nexus://app)  ──IPC──>  Main (Electron)
   views, remapper UI                nexus:// protocol, settings store,
   profile editor                    catalog cache, window manager
        │                                    │
        │                            builds the Better xCloud bundle
        ▼                                    ▼
  settings.json  <──  profile → preset  ──►  stream window
                                             https://www.xbox.com/<locale>/play
                                             + Better xCloud injected at document-start
```

1. The renderer stores control profiles in `settings.json`.
2. On launch the main process picks the per-game profile (falling back to the active one)
   and converts it into a Better xCloud **virtual controller preset** plus preference set.
3. The stream window loads the official play page and injects Better xCloud at
   document-start, writing the preset and preferences before the game boots.

Nothing about the sign-in flow, the catalogue or DRM is bypassed: games stream from
Microsoft exactly as they do in a browser.

---

## Development

```bash
npm install
npm start          # run the app
npm run smoke      # main-process checks (settings, catalogue, BX, profile → preset)
npm run uitest     # boots the real UI and asserts 127 behaviours
npm run verify:bridge  # offline proof that a profile becomes a valid BX preset
npm run typecheck  # node --check on the main process
npm run dist       # build the installer and the portable exe into dist/
```

### Verification

| Suite | What it proves |
| --- | --- |
| `npm run verify:bridge` | 57 assertions: every binding reaches the right Better xCloud button index, mouse→right-stick maths, clamping, junk input, and that **every preference key we send exists in Better xCloud** |
| `npm run smoke` | 12 checks in the main process, including per-game profile resolution into the preset |
| `npm run uitest` | 127 assertions in a real Electron window: wizard, catalogue, remapping, conflicts, profiles, geometry, launch panel, settings, palette |

---

## Credits and licences

This project embeds **Better xCloud** by **redphx** (`redphx/better-xcloud`), vendored at
`vendor/better-xcloud/better-xcloud.user.js`, which is used under the **MIT licence**.
Its copyright notice is preserved in [`LICENSE-BETTER-XCLOUD`](LICENSE-BETTER-XCLOUD).

Better xCloud is a separate project. Xbox Cloud Nexus is an independent launcher; no
affiliation with or endorsement by Microsoft or the Better xCloud authors is implied.

See [LIMITATIONS.md](LIMITATIONS.md) for what this app cannot and will not do.