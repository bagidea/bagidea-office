const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const BASE_URL = 'http://127.0.0.1:8787';

// Mirror of the server's canZenity() probe — used to assert that the
// /platform endpoint's nativePick hint matches reality on the host.
function hasZenity() {
  if (process.platform !== 'linux') return true;
  try {
    execFileSync('sh', ['-c', 'command -v zenity'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        data: data ? JSON.parse(data) : null
      }));
    }).on('error', reject);
  });
}

test('API Health Check', async (t) => {
  try {
    const res = await get('/health');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.data.hasOwnProperty('clients'));
    assert.ok(res.data.hasOwnProperty('pendingPerms'));
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      t.skip('Daemon not running at 127.0.0.1:8787');
    } else {
      throw err;
    }
  }
});

test('Roster API Check', async (t) => {
  try {
    const res = await get('/registry');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.data.hasOwnProperty('agents'));
    assert.ok(res.data.agents.hasOwnProperty('main'));
    assert.ok(res.data.agents.hasOwnProperty('ceo'));
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      t.skip('Daemon not running at 127.0.0.1:8787');
    } else {
      throw err;
    }
  }
});

test('Version API Check', async (t) => {
  try {
    const res = await get('/version');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.data.hasOwnProperty('version'));
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      t.skip('Daemon not running at 127.0.0.1:8787');
    } else {
      throw err;
    }
  }
});

test('Platform endpoint returns OS + separator', async (t) => {
  // Cross-platform: /platform is the server-driven source of truth for the
  // overlay's path separator and native-picker availability.
  try {
    const res = await get('/platform');
    // A 404 here means the running daemon predates this endpoint — skip
    // rather than fail, so the suite stays green against an old build.
    if (res.statusCode === 404) return t.skip('/platform not on this daemon build');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(['win32', 'darwin', 'linux'].includes(res.data.platform),
      `platform must be win32|darwin|linux, got ${res.data.platform}`);
    assert.ok(typeof res.data.sep === 'string' && res.data.sep.length === 1,
      `sep must be a single char, got ${JSON.stringify(res.data.sep)}`);
    // sep must agree with the platform
    const expected = res.data.platform === 'win32' ? '\\' : '/';
    assert.strictEqual(res.data.sep, expected,
      `sep must match platform (${res.data.platform})`);
    // nativePick is platform-aware: always true on macOS/Windows; on Linux it
    // reflects whether zenity is on PATH. Either way it must be a boolean.
    assert.strictEqual(typeof res.data.nativePick, 'boolean',
      `nativePick must be boolean, got ${JSON.stringify(res.data.nativePick)}`);
    assert.strictEqual(res.data.nativePick, res.data.platform !== 'linux' || hasZenity(),
      `nativePick must agree with platform (zenity present on linux)`);
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      t.skip('Daemon not running at 127.0.0.1:8787');
    } else {
      throw err;
    }
  }
});

test('Native folder picker endpoint responds (or 404 on Linux w/o zenity)', async (t) => {
  // We don't exercise the dialog (it blocks on user input) — we only verify
  // the endpoint exists and returns a JSON-shaped response on the platforms
  // where we can reach it without blocking. On Linux without zenity the
  // daemon returns 404, which the client treats as "fall back to in-house".
  // Skip on darwin/win32 to avoid hanging the suite on a modal dialog.
  if (process.platform === 'darwin' || process.platform === 'win32') {
    // t.skip() only *marks* the test skipped — it does not stop the body, so
    // without this return the request fired anyway and the assertion below ran
    // on every Windows/macOS run.
    t.skip('Native picker blocks on user input — skip on darwin/win32');
    return;
  }
  try {
    const res = await new Promise((resolve, reject) => {
      // The endpoint is human-UI only: without this header the daemon answers
      // 403 by design (agents don't get to open modal dialogs), which is what
      // the overlay sends too.
      const req = http.request(`${BASE_URL}/fs/native-pick`,
        { method: 'POST', headers: { 'x-bagidea-ui': '1' } }, (r) => {
        let d = '';
        r.on('data', (c) => d += c);
        r.on('end', () => resolve({ statusCode: r.statusCode, data: d }));
      });
      req.on('error', reject);
      req.end();
    });
    // On Linux: either 404 (no zenity) or 200 with {path: ...} (zenity opened).
    // Both are acceptable; a 500 would indicate a real bug.
    assert.ok(res.statusCode === 200 || res.statusCode === 404,
      `expected 200 or 404, got ${res.statusCode}`);
    if (res.statusCode === 200) {
      const j = JSON.parse(res.data);
      assert.ok('path' in j, '200 response must have a path field');
    }
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      t.skip('Daemon not running at 127.0.0.1:8787');
    } else {
      throw err;
    }
  }
});
