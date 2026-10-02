/**
 * Navigation bridge.
 *
 * `app.js` owns routing, but overlays and panels live outside the view tree and
 * still need to move the user somewhere. Registering the navigator here keeps
 * that one-way: modules call `go('controls')` instead of importing app.js.
 */
let navigator = null;

export function setNavigator(fn) {
  navigator = typeof fn === 'function' ? fn : null;
}

/** Navigate to a route id (see ROUTES in app.js). No-op before boot. */
export function go(id, arg) {
  if (!navigator) return false;
  navigator(id, arg);
  return true;
}