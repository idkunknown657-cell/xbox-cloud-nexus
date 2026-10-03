#!/usr/bin/env node
/**
 * Windows packaging without administrator rights.
 *
 * electron-builder edits the executable's icon and version resources with rcedit
 * from its `winCodeSign` download. That archive also contains macOS symlinks, and
 * 7-Zip cannot create symlinks on Windows unless Developer Mode (or an elevated
 * shell) is enabled — so the download extraction fails and the whole build dies.
 *
 * This script builds the app directory without resource editing, stamps the icon
 * and version strings with the rcedit binary electron-builder already downloaded,
 * and only then builds the installer and portable executables from that prepared
 * directory. The result is identical to a normal build; it just does not need
 * privileges.
 *
 * Usage: node scripts/build-win.mjs [--portable-only]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const distDir = path.join(root, 'dist');
const unpacked = path.join(distDir, 'win-unpacked');
const appExe = path.join(unpacked, 'Xbox Cloud Nexus.exe');
const icon = path.join(root, 'build', 'icon.ico');
const portableOnly = process.argv.includes('--portable-only');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

/**
 * `shell: true` is needed for the electron-builder .cmd shim, but it must NOT be
 * used for rcedit: Node joins arguments verbatim on Windows shells, so a version
 * string containing spaces would be split into several arguments and fail.
 */
function run(cmd, args, { shell = process.platform === 'win32' } = {}) {
  console.log(`\n$ ${cmd} ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root, shell });
}

/** electron-builder's cached rcedit, wherever it unpacked it. */
function findRcedit() {
  const cacheRoot = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache');
  const candidates = [];
  const walk = (dir, depth = 0) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/^rcedit-x64\.exe$/i.test(e.name)) candidates.push(full);
    }
  };
  walk(cacheRoot);
  return candidates[0] || null;
}

const eb = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
const noEdit = ['--config.win.signAndEditExecutable=false'];

// 1) App directory (no resource editing, so no winCodeSign extraction).
run(eb, ['--win', 'dir', ...noEdit]);

// 2) Stamp icon + version metadata onto the app executable.
const rcedit = findRcedit();
if (!rcedit) {
  console.warn('\n! rcedit not found in the electron-builder cache — the app executable keeps the default Electron icon.');
} else if (!fs.existsSync(appExe)) {
  console.warn(`\n! ${appExe} missing — skipping resource stamping.`);
} else {  const stamp = [
    appExe,
    '--set-icon', icon,
    '--set-version-string', 'CompanyName', 'Xbox Cloud Nexus Contributors',
    '--set-version-string', 'ProductName', 'Xbox Cloud Nexus',
    // rcedit writes these as narrow strings: keep them ASCII.
    '--set-version-string', 'FileDescription', 'Xbox Cloud Nexus - play Xbox Cloud Gaming with keyboard and mouse',
    '--set-version-string', 'LegalCopyright', 'MIT licensed',
    '--set-file-version', version,
    '--set-product-version', version,
  ];
  // The freshly packed executable can still be held open for a moment by the
  // packager or by an indexer, so retry briefly before giving up.
  let stamped = false;
  for (let attempt = 1; attempt <= 5 && !stamped; attempt++) {
    try {
      run(rcedit, stamp, { shell: false });   // no shell: rcedit takes real argv
      stamped = true;
    } catch (err) {
      if (attempt === 5) console.warn('! resource stamping failed (icon/metadata only):', err.message);
      else await new Promise((r) => setTimeout(r, 700 * attempt));
    }
  }
}

// 3) Installer + portable from the prepared directory.
const targets = portableOnly ? ['portable'] : ['nsis', 'portable'];
run(eb, ['--win', ...targets, '--prepackaged', unpacked, ...noEdit]);

console.log('\nArtifacts:');
for (const f of fs.readdirSync(distDir)) {
  if (/\.exe$/i.test(f)) {
    const size = (fs.statSync(path.join(distDir, f)).size / 1048576).toFixed(1);
    console.log(`  dist/${f}  (${size} MB)`);
  }
}
