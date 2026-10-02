# Limitations and honest boundaries

Xbox Cloud Nexus is an independent launcher. It does not change what Xbox Cloud Gaming
offers — it makes that offering comfortable on a PC. These are the real limits.

## Sign-in and account

- Authentication happens on **Microsoft's own sign-in page**, inside a stream window.
  The app never sees, stores or logs your password, tokens or cookies.
- Session state lives in Chromium's cookie store for the stream partition. Signing out is
  done from Microsoft's account page; the app does not synthesise login requests.
- If the account has no active Game Pass subscription, the catalogue still lists what
  the public endpoints expose, but launching will fail with Microsoft's own error. The app
  surfaces that error instead of hiding it.

## Region and service support

- Only regions where Xbox Cloud Gaming is officially supported will stream. The app does
  **not** bypass regional restrictions, and the "Preferred region" setting only chooses
  which locale the official play page is opened with.
- Game availability, ad-supported titles and controller requirements are whatever the
  service reports. Nothing is faked: a game is labelled "Play with Ads" only when the
  catalogue says so.

## Video quality

- The **target resolution** setting (Auto / 720p / 1080p / 1080p HQ) is the ceiling the app
  asks the service for. The stream always adapts to your bandwidth and the service's own
  limits — asking for 1080p HQ on a slow connection gives you a lower resolution.
- There is **no 4K option**, because the service does not offer one. The app does not
  claim otherwise.
- WebGPU rendering exists in Better xCloud but is experimental; this app exposes the
  stable default renderer and WebGL2.

## Keyboard + mouse

- Emulation works by presenting a virtual gamepad to the game. Some games read absolute
  pointer input directly (a few strategy and card games) and will not benefit from mouse
  aiming; the mapping still applies to every button.
- Mouse buttons are mapped as button presses, so a game that treats the right trigger as an
  analogue axis will read the emulated trigger as pressed. This is inherent to controller
  translation.
- Modifiers (Shift/Ctrl/Alt + key) are offered in the remapper, but Better xCloud's preset
  format maps one key per button; combined chords are stored and displayed, and are sent
  as the base key when the stream is active.

## Profiles

- Per-game profiles key off the store product id. If Microsoft changes the id a title is
  published under, an existing per-game binding can point at a stale id and the game falls
  back to the active profile until you reassign it.
- Controller polling above 60 Hz is not offered; the transport tops out there.

## Better xCloud dependency

- The vendored copy is a snapshot. If Better xCloud changes its IndexedDB schema for
  virtual-controller presets, the preset writer in `src/preload/stream-preload.cjs` needs a
  matching update — until then custom mappings would silently stop applying.
- Better xCloud is MIT licensed and credits `redphx`; see
  [`LICENSE-BETTER-XCLOUD`](LICENSE-BETTER-XCLOUD).

## What this app will never do

- Bypass DRM, authentication, regional restrictions or any access control.
- Present a fake Microsoft sign-in page.
- Store or log credentials, tokens or session cookies.
- Claim a game is free or ad-supported when the service does not say so.