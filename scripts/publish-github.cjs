/**
 * Create the GitHub repository and push, using the credentials the OS credential
 * manager already holds for github.com.
 *
 * The token is read from `git credential fill` and never written to disk, never
 * logged and never echoed: every call below sends it in an Authorization header
 * and prints only status codes and usernames.
 *
 * Usage: node scripts/publish-github.cjs [--dry-run]
 */
'use strict';
const { execFileSync } = require('node:child_process');

const OWNER = 'idkunknown657-cell';
const REPO = 'xbox-cloud-nexus';
const DRY = process.argv.includes('--dry-run');

/** Ask the credential manager for a github.com credential. Throws if absent. */
function credential() {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const fields = {};
  for (const line of out.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) fields[line.slice(0, i)] = line.slice(i + 1);
  }
  if (!fields.password) throw new Error('no github credential available');
  return { user: fields.username || '', token: fields.password };
}

async function api(token, method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'xbox-cloud-nexus-publisher',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
  return { status: res.status, json };
}

(async () => {
  const { user, token } = credential();
  console.log(`credential found for ${user}`);

  // Confirm the credential really is a working GitHub credential before doing
  // anything else. An expired or wrong-scope token fails here, not halfway
  // through a push.
  const who = await api(token, 'GET', '/user');
  if (who.status !== 200) {
    console.error(`GitHub rejected the credential (HTTP ${who.status}).`);
    console.error('Re-authenticate with Git Credential Manager, then re-run.');
    process.exit(1);
  }
  console.log(`authenticated as ${who.json.login}`);

  const existing = await api(token, 'GET', `/repos/${OWNER}/${REPO}`);
  if (existing.status === 200) {
    console.log(`repository ${OWNER}/${REPO} already exists (${existing.status}) — will push to it.`);
  } else if (existing.status === 404) {
    if (DRY) {
      console.log(`[dry-run] would create ${OWNER}/${REPO}`);
      process.exit(0);
    }
    const created = await api(token, 'POST', '/user/repos', {
      name: REPO,
      description: 'A Windows desktop client for Xbox Cloud Gaming with official Microsoft sign-in, honest account entitlements, and full keyboard & mouse to controller remapping via Better xCloud.',
      private: false,
      has_issues: true,
      has_wiki: false,
      auto_init: false,
    });
    if (created.status !== 201) {
      console.error(`could not create the repository (HTTP ${created.status}):`,
        created.json?.message || '');
      process.exit(1);
    }
    console.log(`created ${created.json.full_name} (${created.json.html_url})`);
  } else {
    console.error(`unexpected response checking the repository (HTTP ${existing.status}).`);
    process.exit(1);
  }

  const remote = `https://github.com/${OWNER}/${REPO}.git`;
  console.log(`remote: ${remote}`);
  if (DRY) process.exit(0);

  const run = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  try { run(['remote', 'remove', 'origin']); } catch { /* no remote yet */ }
  run(['remote', 'add', 'origin', remote]);
  run(['push', '-u', 'origin', 'HEAD']);

  // The token must never end up in the repo config or on disk.
  const embedded = run(['remote', '-v']).includes(token);
  if (embedded) {
    run(['remote', 'set-url', 'origin', remote]);
    console.log('remote URL sanitised (token was not stored).');
  }

  const final = await api(token, 'GET', `/repos/${OWNER}/${REPO}`);
  console.log(`repository is live: ${final.json?.html_url} (HTTP ${final.status})`);
  console.log(`default branch: ${final.json?.default_branch}`);
})().catch((err) => {
  console.error('publish failed:', err.message);
  process.exit(1);
});