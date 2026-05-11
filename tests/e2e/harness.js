// E2E harness — spawns a real `node server.js` on a random free port and
// connects two WebSocket clients. Tests script scenarios via the actual
// over-the-wire protocol; teardown is guaranteed in a `finally` in each
// spec.
//
// NOT a unit-test helper. Specs run via `node tests/e2e/<name>.e2e.js`,
// not through the node --test harness.
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const WebSocket = require('ws');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_JS = path.join(REPO_ROOT, 'server.js');

// Find a free TCP port by binding 0, reading the assigned port, closing.
function pickPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

// Spawn server.js with PORT=<port>. Resolves once the "running on port" log
// arrives on stdout. Rejects on early exit / timeout.
async function startServer({ silent = true, timeoutMs = 10000 } = {}) {
  const port = await pickPort();
  const proc = spawn(process.execPath, [SERVER_JS], {
    env: { ...process.env, PORT: String(port) },
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdoutBuf = '';
  let stderrBuf = '';
  let ready = false;
  const onStdout = (chunk) => {
    const s = chunk.toString();
    stdoutBuf += s;
    if (!silent) process.stdout.write('[srv-out] ' + s);
  };
  const onStderr = (chunk) => {
    const s = chunk.toString();
    stderrBuf += s;
    if (!silent) process.stderr.write('[srv-err] ' + s);
  };
  proc.stdout.on('data', onStdout);
  proc.stderr.on('data', onStderr);

  return await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      if (!ready) {
        try { proc.kill('SIGKILL'); } catch (_) {}
        reject(new Error(`server startup timeout — stdout=${stdoutBuf.slice(0,500)} stderr=${stderrBuf.slice(0,500)}`));
      }
    }, timeoutMs).unref();
    const onData = (chunk) => {
      const s = chunk.toString();
      if (!ready && /running on port/i.test(stdoutBuf + s)) {
        ready = true;
        clearTimeout(deadline);
        proc.stdout.removeListener('data', onData);
        resolve({
          proc,
          port,
          stop: () => stopServer(proc),
          // Diagnostic accessors for failure messages.
          getStdout: () => stdoutBuf,
          getStderr: () => stderrBuf,
        });
      }
    };
    proc.stdout.on('data', onData);
    // Also detect early exits.
    proc.once('exit', (code, sig) => {
      if (!ready) {
        clearTimeout(deadline);
        reject(new Error(`server exited before listening (code=${code} sig=${sig}) stdout=${stdoutBuf.slice(0,500)} stderr=${stderrBuf.slice(0,500)}`));
      }
    });
  });
}

function stopServer(proc) {
  if (!proc || proc.exitCode != null) return Promise.resolve();
  return new Promise((resolve) => {
    proc.once('exit', () => resolve());
    try { proc.kill('SIGKILL'); } catch (_) { resolve(); }
    setTimeout(() => resolve(), 1000).unref();
  });
}

// Lightweight client wrapper. Maintains:
//   .inbox — every message received (in order)
//   .lastState — most recent GAME_STATE.game
//   .clientId, .playerId, .roomId — populated as the lobby progresses.
class Client {
  constructor(port, label) {
    this.port = port;
    this.label = label || 'client';
    this.inbox = [];
    this.lastState = null;
    this.clientId = null;
    this.playerId = null;
    this.roomId = null;
    this.ws = null;
    this._waiters = [];  // pending waitFor predicates
  }
  async connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
      this.ws = ws;
      ws.on('open', () => resolve());
      ws.on('error', (e) => reject(e));
      ws.on('message', (raw) => {
        let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
        this.inbox.push(msg);
        if (msg.type === 'CONNECTED') { this.clientId = msg.clientId; }
        if (msg.type === 'ROOM_CREATED') { this.roomId = msg.roomId; this.playerId = msg.playerId; }
        if (msg.type === 'ROOM_JOINED')  { this.roomId = msg.roomId; this.playerId = msg.playerId; }
        if (msg.type === 'GAME_STATE')   { this.lastState = msg.game; }
        // Fire any waiters that match.
        for (let i = this._waiters.length - 1; i >= 0; i--) {
          const w = this._waiters[i];
          try {
            if (w.predicate(msg, this)) {
              this._waiters.splice(i, 1);
              clearTimeout(w.timer);
              w.resolve(msg);
            }
          } catch (e) {
            this._waiters.splice(i, 1);
            clearTimeout(w.timer);
            w.reject(e);
          }
        }
      });
      ws.on('close', () => { /* no-op */ });
    });
  }
  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }
  // Wire-level: send an ACTION envelope.
  action(action) {
    this.send({ type: 'ACTION', action });
  }
  // Resolve as soon as a message matching `predicate(msg, client)` arrives.
  // Looks at history first, then queues. Timeout in ms (default 4000).
  waitFor(predicate, { timeoutMs = 4000, label = '' } = {}) {
    // Scan history first.
    for (const m of this.inbox) { try { if (predicate(m, this)) return Promise.resolve(m); } catch (_) {} }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waiters.indexOf(entry);
        if (idx !== -1) this._waiters.splice(idx, 1);
        reject(new Error(`waitFor timeout on ${this.label}: ${label} — last 10 msgs: ${JSON.stringify(this.inbox.slice(-10).map(m => m.type))}`));
      }, timeoutMs).unref();
      const entry = { predicate, resolve, reject, timer };
      this._waiters.push(entry);
    });
  }
  // Wait for the next GAME_STATE that satisfies `pred(game, client)`.
  waitForState(pred, opts) {
    return this.waitFor((m, c) => m.type === 'GAME_STATE' && pred(m.game, c), opts);
  }
  // Like waitForState, but ignores history — only considers messages
  // received *after* the call. Use this when a previous matching state
  // (e.g. pre-action) would otherwise satisfy the predicate immediately
  // before the action-induced state arrives.
  waitForNewState(pred, { timeoutMs = 4000, label = '' } = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waiters.indexOf(entry);
        if (idx !== -1) this._waiters.splice(idx, 1);
        reject(new Error(`waitForNewState timeout on ${this.label}: ${label} — last 10 msgs: ${JSON.stringify(this.inbox.slice(-10).map(m => m.type))}`));
      }, timeoutMs).unref();
      const predicate = (m, c) => m.type === 'GAME_STATE' && pred(m.game, c);
      const entry = { predicate, resolve, reject, timer };
      this._waiters.push(entry);
    });
  }
  close() {
    try { this.ws && this.ws.close(); } catch (_) {}
  }
}

// Standard lobby flow: connect two clients, create + join room, deal with
// mulligan (both keep). Returns { p1, p2, roomId } once both clients have
// received their first MAIN-phase GAME_STATE with activePlayer set.
//
// `decks` is { p1: {leaderId, cards}, p2: {leaderId, cards} } — passed
// directly to server.js's JOIN_ROOM/CREATE_ROOM. Default = Anna+Anna so the
// canonical scenarios can rely on Anna's leader.
async function lobby(port, decks = {}) {
  const p1deck = decks.p1 || { leaderId: 'ST03-001', cards: [] };  // empty cards = server fallback
  const p2deck = decks.p2 || { leaderId: 'ST03-001', cards: [] };
  const p1 = new Client(port, 'P1');
  const p2 = new Client(port, 'P2');
  await p1.connect();
  await p2.connect();
  await p1.waitFor(m => m.type === 'CONNECTED', { label: 'P1 CONNECTED' });
  await p2.waitFor(m => m.type === 'CONNECTED', { label: 'P2 CONNECTED' });
  p1.send({ type: 'CREATE_ROOM', deck: p1deck });
  await p1.waitFor(m => m.type === 'ROOM_CREATED', { label: 'ROOM_CREATED' });
  p2.send({ type: 'JOIN_ROOM', roomId: p1.roomId, deck: p2deck });
  await p2.waitFor(m => m.type === 'ROOM_JOINED', { label: 'ROOM_JOINED' });
  // Both should now have received GAME_STARTED + initial GAME_STATE.
  await p1.waitForState(g => g.phase === 'MULLIGAN', { label: 'P1 MULLIGAN' });
  await p2.waitForState(g => g.phase === 'MULLIGAN', { label: 'P2 MULLIGAN' });
  // Both keep their hands. The active player will move through MULLIGAN→DON
  // automatically once both submit.
  p1.action({ type: 'MULLIGAN', doMulligan: false });
  p2.action({ type: 'MULLIGAN', doMulligan: false });
  // Wait for active player to reach DON or MAIN — server lands at DON post
  // mulligan; the active player must explicitly DRAW_DON to enter MAIN.
  await p1.waitForState(g => g.phase === 'DON' || g.phase === 'MAIN', { label: 'reach DON/MAIN' });
  await p2.waitForState(g => g.phase === 'DON' || g.phase === 'MAIN', { label: 'reach DON/MAIN' });
  return { p1, p2, roomId: p1.roomId };
}

// Helper — given a lobby result, drive the active player through DON →
// MAIN. After this returns both clients are at game.phase === 'MAIN' and it
// is the active player's turn.
async function advanceToMain({ p1, p2 }) {
  // Identify active player by lastState.activePlayer / playerId.
  const state = p1.lastState || p2.lastState;
  if (!state) throw new Error('advanceToMain: no state yet');
  if (state.phase === 'MAIN') return;
  const activeClient = state.activePlayer === p1.playerId ? p1 : p2;
  activeClient.action({ type: 'DRAW_DON' });
  await p1.waitForState(g => g.phase === 'MAIN', { label: 'P1 MAIN' });
  await p2.waitForState(g => g.phase === 'MAIN', { label: 'P2 MAIN' });
}

// Identify which client is the active player (based on latest GAME_STATE).
function activeClient({ p1, p2 }) {
  const state = p1.lastState || p2.lastState;
  if (!state) throw new Error('activeClient: no state');
  return state.activePlayer === p1.playerId ? p1 : p2;
}
function inactiveClient({ p1, p2 }) {
  const state = p1.lastState || p2.lastState;
  if (!state) throw new Error('inactiveClient: no state');
  return state.activePlayer === p1.playerId ? p2 : p1;
}

// Test-runner glue — accumulates pass/fail counts. Each spec calls run()
// with a list of {name, fn} cases. Exits non-zero if any fail.
async function runSuite(specName, cases) {
  console.log(`\n=== ${specName} ===`);
  let passed = 0, failed = 0;
  const failures = [];
  for (const { name, fn } of cases) {
    process.stdout.write(`  - ${name} ... `);
    try {
      await fn();
      console.log('PASS');
      passed++;
    } catch (e) {
      console.log('FAIL');
      console.log('      ' + (e.stack || e.message || e));
      failed++;
      failures.push({ name, error: e });
    }
  }
  console.log(`\n  ${passed} passed, ${failed} failed`);
  return { passed, failed, failures };
}

module.exports = {
  startServer, stopServer, pickPort,
  Client, lobby, advanceToMain,
  activeClient, inactiveClient, runSuite,
};
