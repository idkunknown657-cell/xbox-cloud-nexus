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

## Sign-in and account

- Sign-in always happens on Microsoft's own page. The app never renders a login form and
  never reads, stores or forwards a password, token or cookie value.
- **A sign-in completed in your web browser does not connect Nexus.** Cookies belong to
  the browser that made them, so the app needs its own one-time sign-in in the window it
  opens — that session partition is the one the game windows use. The app says this
  explicitly instead of leaving you wondering why the launcher stayed signed out.
- Signing out clears only the `persist:stream` partition the app created for Xbox; cookies,
  saved games and any browser session are untouched.
- The subscription tier is read from the signed-in Microsoft page when it can be read. That
  page is Microsoft's own rendering of your account, but it is not a stable API: if it
  changes, the plan falls back to "unknown" and every Game Pass title is offered rather than
  wrongly blocked. You can also set the tier by hand in Settings → Account.
- Microsoft occasionally loads an embedded sign-in in a popup. Popups are pinned to the same
  session partition so the resulting session is the one the games use; a popup Microsoft
  opens outside its own domains is handed to your browser instead.

## Entitlements and availability

- Access badges come from Microsoft's public, unauthenticated display catalogue, queried for
  your market. They are a *label*, never a grant: the official play page still decides
  every launch.
- Titles offered through ad-supported streaming are taken from Xbox's own Play-with-Ads list
  for your market. Whether a given account, region and title combination is actually served
  with ads is decided by Xbox at stream time.
- A title that is both in Game Pass and free to start is shown as playable for an account
  with no subscription; the catalogue does not always expose a price for cloud titles, so
  the app never claims a purchase is required on incomplete data — it shows what Microsoft
  published and lets the official page arbitrate.
- Regional availability is whatever the catalogue reports for the market in Settings →
  Cloud Gaming. A title offered in one region may be absent in another.

## Launching a game

- Pressing Play opens the official Xbox Cloud Gaming page and then routes it to the
  title's own launch route (`/play/launch/<slug>/<productId>`), which is what starts the
  stream. The slug is derived from the product title, so an unusual title can be rejected
  by Xbox's router; the app retries with the slug Xbox itself uses, and falls back to the
  title's own Play button if the router sends it to a store page.
- Launching a title is **not** something the app can guarantee. If the account is signed
  out, the region does not serve the title, or the title is not cloud playable, the
  official page decides and the app says so rather than leaving a window open on a page
  that is never a game. The specific reason is shown as a notification.
- Streaming quality, server assignment and ad pre-rolls are entirely Xbox's. The app sets
  video preferences through Better xCloud and does not touch the transport.

## Build and packaging

- `npm run dist` uses `scripts/build-win.mjs`, which builds the unpacked app with
  `--win dir`, stamps the version resources with the cached `rcedit`, and only then produces
  the NSIS installer and the portable executable. This avoids the Windows symlink privilege
  that a plain `electron-builder` run needs for its code-signing cache.
- The EXEs are **not code-signed**, so SmartScreen will warn on first run. Sign them with
  your own certificate for distribution.

## What this app will never do

- Bypass DRM, authentication, regional restrictions or any access control.
- Present a fake Microsoft sign-in page.
- Store or log credentials, tokens or session cookies.
- Claim a game is free or ad-supported when the service does not say so.
- Grant access the account does not have, or hide a game the account can play.