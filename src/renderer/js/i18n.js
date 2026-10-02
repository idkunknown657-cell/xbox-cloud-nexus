/**
 * Localization — i18n with graceful fallbacks.
 * Add a language by dropping a JSON in /locales and registering it here.
 */
const EN = {
  appName: 'Xbox Cloud Nexus',
  // nav
  nav_home: 'Home', nav_cloud: 'Cloud Gaming', nav_library: 'Library',
  nav_playAds: 'Play with Ads', nav_recent: 'Recently Played', nav_favorites: 'Favorites',
  nav_settings: 'Settings', nav_search: 'Search',
  // hero / sections
  play_now: 'Play Now', game_details: 'Game Details', view_all: 'View all',
  quick_play: 'Quick play', configure_controls: 'Configure controls',
  featured: 'Featured', popular_on_cloud: 'Popular on Cloud', recently_added: 'Recently added',
  recently_played: 'Recently Played', free_with_ads: 'Play with Ads',
  freeWithAds_sub: 'Stream these titles free — just watch a few ads',
  cloud_gaming: 'Cloud Gaming', game_pass: 'Game Pass',
  kbm_supported: 'Keyboard & Mouse', controller: 'Controller',
  // library
  all_games: 'All Games', search_games: 'Search games…', sort_by: 'Sort',
  sort_recent: 'Recently played', sort_name: 'Name A–Z', sort_popular: 'Most popular',
  filter_all: 'All', filter_favorites: 'Favorites', genre: 'Genre',
  no_results: 'Nothing found', no_results_sub: 'Try a different search or filter.',
  empty_library: 'Your library is empty', empty_library_sub: 'Games you play will appear here.',
  empty_favorites: 'No favorites yet', empty_favorites_sub: 'Tap the heart on any game to add it here.',
  // details
  developer: 'Developer', publisher: 'Publisher', genres: 'Genres', rating: 'Rating',
  add_favorite: 'Add to favorites', remove_favorite: 'Remove from favorites',
  back: 'Back', hide_game: 'Hide game', show_game: 'Unhide game',
  available_cloud: 'Available on Cloud Gaming', play_with_ads_badge: 'Play with Ads',
  // settings sections
  set_account: 'Account', set_controls: 'Controls & Input', set_cloud: 'Cloud Gaming',
  set_appearance: 'Appearance', set_animations: 'Animations', set_performance: 'Performance',
  set_language: 'Language', set_accessibility: 'Accessibility', set_audio: 'Audio',
  set_window: 'Window / Display', set_about: 'About',
  // controls
  controls_title: 'Controls & Input',
  remap_prompt: 'Press a keyboard key or mouse button…', esc_to_cancel: 'Esc to cancel',
  conflict_title: 'Key already assigned', conflict_msg: '{key} is already assigned to {btn}.',
  replace: 'Replace', keep_both: 'Keep both', cancel: 'Cancel',
  unassigned: 'Unassigned', reset_profile: 'Reset profile', reset_all_controls: 'Reset all controls',
  profile_default: 'Default', new_profile: 'New profile', duplicate: 'Duplicate', rename: 'Rename', delete: 'Delete',
  import_profile: 'Import', export_profile: 'Export',
  test_mode: 'Input test', test_hint: 'Press any keyboard key, mouse button, or controller button.',
  detected: 'Detected', maps_to: 'Maps to', press_key: 'Press any key…',
  per_game: 'Per-game profiles', per_game_desc: 'Assign a control profile to a specific game. It loads automatically when you launch it.',
  no_profile: 'Use default profile',
  controller_connected: 'Controller connected', controller_disconnected: 'Controller disconnected',
  kbm_enabled_toast: 'Keyboard & Mouse mode enabled', kbm_disabled_toast: 'Keyboard & Mouse mode disabled',
  // wizard
  wizard_welcome: 'Welcome', wizard_welcome_msg: 'Let’s get you set up for the best cloud gaming experience. This takes less than a minute.',
  wizard_signin: 'Sign in', wizard_signin_msg: 'Games launch in the official Xbox window where you can sign in securely with your Microsoft account. Your credentials are never seen by this app.',
  wizard_controller: 'Controller', wizard_controller_msg: 'Connect an Xbox controller now, or configure it later in Settings.',
  controller_found: 'Controller detected', no_controller: 'No controller detected',
  wizard_kbm: 'Keyboard & Mouse', wizard_kbm_msg: 'Enable keyboard & mouse emulation (powered by Better xCloud). You can remap every button later.',
  wizard_look: 'Appearance', wizard_look_msg: 'Pick a look. You can customize everything in Settings.',
  wizard_perf: 'Performance', wizard_perf_msg: 'Choose a preset. Low-End Mode keeps the app smooth on older PCs.',
  perf_low: 'Low', perf_balanced: 'Balanced', perf_quality: 'Quality',
  wizard_done: 'You’re all set!', wizard_done_msg: 'Your setup is ready. Have fun!',
  get_started: 'Get started', skip: 'Skip for now', finish: 'Finish',
  next: 'Next', back_wiz: 'Back',
  // misc
  settings: 'Settings', search_settings: 'Search settings…', version: 'Version',
  reset_settings: 'Reset settings', reset_settings_msg: 'This restores every setting to default. Your profiles are erased. Continue?',
  reset_confirm: 'Reset', saved: 'Saved', error: 'Something went wrong', retry: 'Retry',
  signout_note: 'Sign-out happens in the official Xbox window (Menu → Sign out).',
  open_xbox: 'Open Xbox sign-in',
  check_updates: 'Check for updates', updates_note: 'Updates are delivered with new installers. This build ships Better xCloud {bx} (MIT).',
  credits: 'Credits & licenses',
  language_note: 'Interface language. More languages can be added.',
  notif_test: 'Test notification', notif_test_msg: 'Notifications are working.',
  ui_sounds: 'UI sounds', ui_sounds_desc: 'Subtle sounds for actions and notifications.',
  volume: 'Volume',
  launch: 'Launch', launching: 'Launching…', launched: 'Game launched',
  stream_crashed: 'Stream error', stream_crashed_msg: 'The game window closed unexpectedly. Try launching again.',
  network_err: 'Network error', network_err_msg: 'Couldn’t reach the Xbox catalog. Showing cached data.',
  fullscreen_play: 'Fullscreen when playing', fullscreen_play_desc: 'Open game windows in fullscreen.',
  theme: 'Theme', theme_dark: 'Dark', theme_light: 'Light', theme_system: 'System',
  accent: 'Accent color', background: 'Background', solid: 'Solid', gradient: 'Gradient',
  gradient_from: 'From', gradient_to: 'To', gradient_angle: 'Angle', gradient_intensity: 'Intensity',
  custom_color: 'Custom',
  animations_full: 'Full', animations_reduced: 'Reduced', animations_minimal: 'Minimal', animations_off: 'Off',
  speed: 'Speed',
  text_size: 'Text size', high_contrast: 'High contrast', reduced_motion_os: 'Respect system reduced motion',
  hw_accel: 'Hardware acceleration', hw_accel_desc: 'Turn off only if you see rendering glitches.',
  ui_quality: 'UI quality', blur_fx: 'Background blur', shadows_fx: 'Shadows', bg_fx: 'Ambient effects',
  low_end: 'Low-End Mode', low_end_desc: 'Disables expensive effects for smooth performance on weak PCs.',
  preset: 'Preset',
  window_mode: 'Window mode', win_normal: 'Windowed', win_max: 'Maximized', win_full: 'Fullscreen',
  start_max: 'Start maximized', remember_bounds: 'Remember window size & position',
  apply: 'Apply',
  kbm_section: 'Keyboard & Mouse mode', kbm_section_desc: 'Emulate a controller with KBM in supported games. Toggle in-game with {key}.',
  toggle_key: 'Toggle hotkey', sens: 'Sensitivity',
  stick_as_mouse: 'Right stick moves mouse', show_stats: 'Show stream statistics',
  region_note: 'Streaming uses your account region automatically.',
  favorite_added: 'Added to favorites', favorite_removed: 'Removed from favorites',
  profile_saved: 'Profile saved', profile_deleted: 'Profile deleted', profile_imported: 'Profile imported', profile_exported: 'Profile exported',
  settings_searched_none: 'No matching settings',
  game_hidden: 'Game hidden', game_shown: 'Game unhidden',
  window_title_details: 'Game details',
  about_bx: 'This app integrates Better xCloud by redphx (MIT) to enable keyboard/mouse emulation and stream enhancements inside the official Xbox Cloud Gaming web app. Better xCloud is developed independently and is not affiliated with Microsoft.',
  disclaimer: 'Xbox Cloud Nexus is an independent desktop client. Not affiliated with or endorsed by Microsoft. Xbox and Game Pass are trademarks of Microsoft Corporation. Streaming requires an eligible Microsoft/Xbox account; gameplay availability depends on your region and subscription.',
  debug_mode: 'Debug mode', debug_desc: 'Verbose logging for troubleshooting.',
  view_logs: 'View logs', copy_logs: 'Copy logs', logs_title: 'Debug log',
  offline_cached: 'Offline — cached library',
  search_placeholder: 'Search games, settings, or anything…',
  quick_search: 'Quick search', type_to_search: 'Type to search games and settings',
  games: 'Games', sections: 'Sections', settings_results: 'Settings',
  profiles_results: 'Profiles',
};

const HI = {
  appName: 'Xbox Cloud Nexus',
  nav_home: 'होम', nav_cloud: 'क्लाउड गेमिंग', nav_library: 'लाइब्रेरी',
  nav_playAds: 'विज्ञापन के साथ खेलें', nav_recent: 'हाल में खेले गए', nav_favorites: 'पसंदीदा',
  nav_settings: 'सेटिंग्स', nav_search: 'खोज',
  play_now: 'अभी खेलें', game_details: 'गेम विवरण', view_all: 'सभी देखें',
  quick_play: 'तुरंत खेलें', configure_controls: 'कंट्रोल कॉन्फ़िगर करें',
  featured: 'विशेष रुप से प्रदर्शित', popular_on_cloud: 'क्लाउड पर लोकप्रिय', recently_added: 'हाल ही में जोड़े गए',
  recently_played: 'हाल में खेले गए', free_with_ads: 'विज्ञापन के साथ मुफ़्त',
  freeWithAds_sub: 'इन गेम्स को मुफ़्त स्ट्रीम करें — बस कुछ विज्ञापन देखें',
  cloud_gaming: 'क्लाउड गेमिंग', game_pass: 'गेम पास',
  kbm_supported: 'कीबोर्ड और माउस', controller: 'कंट्रोलर',
  all_games: 'सभी गेम', search_games: 'गेम खोजें…', sort_by: 'क्रम',
  sort_recent: 'हाल में खेले', sort_name: 'नाम A–Z', sort_popular: 'सबसे लोकप्रिय',
  filter_all: 'सभी', filter_favorites: 'पसंदीदा', genre: 'शैली',
  no_results: 'कुछ नहीं मिला', no_results_sub: 'कोई और खोज या फ़िल्टर आज़माएँ।',
  empty_library: 'आपकी लाइब्रेरी खाली है', empty_library_sub: 'आपके द्वारा खेले गए गेम यहाँ दिखाई देंगे।',
  empty_favorites: 'अभी कोई पसंदीदा नहीं', empty_favorites_sub: 'किसी भी गेम पर हृदय पर टैप करें।',
  developer: 'डेवलपर', publisher: 'प्रकाशक', genres: 'शैलियाँ', rating: 'रेटिंग',
  add_favorite: 'पसंदीदा में जोड़ें', remove_favorite: 'पसंदीदा से हटाएं',
  back: 'वापस', hide_game: 'गेम छिपाएँ', show_game: 'गेम दिखाएँ',
  available_cloud: 'क्लाउड गेमिंग पर उपलब्ध', play_with_ads_badge: 'विज्ञापन के साथ खेलें',
  set_account: 'खाता', set_controls: 'नियंत्रण और इनपुट', set_cloud: 'क्लाउड गेमिंग',
  set_appearance: 'रूप-रंग', set_animations: 'एनिमेशन', set_performance: 'प्रदर्शन',
  set_language: 'भाषा', set_accessibility: 'सुगम्यता', set_audio: 'ऑडियो',
  set_window: 'विंडो / डिस्प्ले', set_about: 'बारे में',
  controls_title: 'नियंत्रण और इनपुट',
  remap_prompt: 'कोई कीबोर्ड की या माउस बटन दबाएँ…', esc_to_cancel: 'रद्द करने के लिए Esc',
  conflict_title: 'की पहले से असाइन है', conflict_msg: '{key} पहले से {btn} को असाइन है।',
  replace: 'बदलें', keep_both: 'दोनों रखें', cancel: 'रद्द करें',
  unassigned: 'असाइन नहीं', reset_profile: 'प्रोफ़ाइल रीसेट करें', reset_all_controls: 'सभी नियंत्रण रीसेट करें',
  profile_default: 'डिफ़ॉल्ट', new_profile: 'नई प्रोफ़ाइल', duplicate: 'डुप्लिकेट', rename: 'नाम बदलें', delete: 'मिटाएँ',
  import_profile: 'इंपोर्ट', export_profile: 'एक्सपोर्ट',
  test_mode: 'इनपुट टेस्ट', test_hint: 'कोई भी कीबोर्ड की, माउस बटन या कंट्रोलर बटन दबाएँ।',
  detected: 'पहचाना गया', maps_to: 'मैप्स टू', press_key: 'कोई की दबाएँ…',
  per_game: 'प्रति-गेम प्रोफ़ाइल', per_game_desc: 'किसी गेम के लिए प्रोफ़ाइल असाइन करें। लॉन्च पर यह अपने आप लोड होगी।',
  no_profile: 'डिफ़ॉल्ट प्रोफ़ाइल',
  controller_connected: 'कंट्रोलर कनेक्ट हुआ', controller_disconnected: 'कंट्रोलर डिस्कनेक्ट हुआ',
  wizard_welcome: 'स्वागत है', wizard_welcome_msg: 'सबसे अच्छे क्लाउड गेमिंग अनुभव के लिए सेटअप करें। इसमें एक मिनट से भी कम समय लगेगा।',
  wizard_signin: 'साइन इन', wizard_signin_msg: 'गेम आधिकारिक Xbox विंडो में लॉन्च होते हैं जहाँ आप अपने Microsoft खाते से सुरक्षित रूप से साइन इन करते हैं। आपका पासवर्ड इस ऐप को कभी नहीं दिखता।',
  wizard_controller: 'कंट्रोलर', wizard_controller_msg: 'अब Xbox कंट्रोलर कनेक्ट करें, या बाद में सेटिंग्स में करें।',
  controller_found: 'कंट्रोलर मिला', no_controller: 'कोई कंट्रोलर नहीं मिला',
  wizard_kbm: 'कीबोर्ड और माउस', wizard_kbm_msg: 'कीबोर्ड और माउस एमुलेशन चालू करें (Better xCloud द्वारा)। सभी बटन बाद में रीमैप करें।',
  wizard_look: 'रूप-रंग', wizard_look_msg: 'एक रंग चुनें। सब कुछ सेटिंग्स में बदल सकते हैं।',
  wizard_perf: 'प्रदर्शन', wizard_perf_msg: 'एक प्रीसेट चुनें। कमज़ोर PC पर लो-एंड मोड सब कुछ स्मूद रखता है।',
  perf_low: 'कम', perf_balanced: 'संतुलित', perf_quality: 'गुणवत्ता',
  wizard_done: 'सब तैयार!', wizard_done_msg: 'आपका सेटअप पूरा हुआ। मज़े करें!',
  get_started: 'शुरू करें', skip: 'अभी नहीं', finish: 'पूरा करें',
  next: 'आगे', back_wiz: 'वापस',
  settings: 'सेटिंग्स', search_settings: 'सेटिंग्स खोजें…', version: 'संस्करण',
  reset_settings: 'सेटिंग्स रीसेट', reset_settings_msg: 'सभी सेटिंग्स डिफ़ॉल्ट पर लौटेंगी। प्रोफ़ाइल मिट जाएँगी। जारी रखें?',
  reset_confirm: 'रीसेट', saved: 'सेव हुआ', error: 'कुछ गड़बड़ हुई', retry: 'फिर कोशिश करें',
  open_xbox: 'Xbox साइन-इन खोलें',
  theme: 'थीम', theme_dark: 'डार्क', theme_light: 'लाइट', theme_system: 'सिस्टम',
  launch: 'लॉन्च', launching: 'लॉन्च हो रहा है…', launched: 'गेम लॉन्च हुआ',
  games: 'गेम्स', sections: 'सेक्शन', settings_results: 'सेटिंग्स',
  search_placeholder: 'गेम, सेटिंग्स, या कुछ भी खोजें…',
};

const LANGS = {
  en: { name: 'English', dict: EN },
  hi: { name: 'हिन्दी (Hindi)', dict: HI },
};

let current = 'en';

export function setLang(code) {
  if (LANGS[code]) current = code;
  else current = 'en';
  document.documentElement.lang = current;
}

export function getLang() { return current; }

export function availableLangs() {
  return Object.entries(LANGS).map(([code, l]) => ({ code, name: l.name }));
}

/** Translate with {placeholder} interpolation. */
export function t(key, vars) {
  let s = LANGS[current]?.dict?.[key] ?? LANGS.en.dict[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, v);
    }
  }
  return s;
}
