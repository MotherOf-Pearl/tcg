// §6-5-6-1 — "Neither player can battle on their first turn."
// Regression suite for the live prod bug where the engine only blocked
// game-turn 1 (P1's first turn) and let P2 attack on game-turn 2 (P2's
// first turn). After the fix, both players are blocked on their own
// first turn, and the [Rush] keyword does NOT bypass the prohibition
// (§10-1-1-1 overrides §3-7-4 only, never §6-5-6-1).
//
// Tests use the existing twoPlayerGame helper, which pins firstPlayer
// and activePlayer to p1 so turn math is deterministic.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame, messagesOfType } = require('./helpers');

beforeEach(resetWorld);

// Helper: stand up a non-rested, non-played-this-turn attacker on the
// given player's field. Returns the card object.
function pushAttacker(game, pid, uid) {
  const c = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid, rested: false, playedThisTurn: false, attachedDon: 0 };
  game.players[pid].field.push(c);
  return c;
}

test('§6-5-6-1 — P1 cannot attack on their first turn (game-turn 1)', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p1;
  game.turn = 1;
  // hasTakenFirstTurn defaults to false — this is exactly the bug's
  // already-correct case (regression guard).
  pushAttacker(game, p1, 'p1-atk-t1');
  const p1ws = srv.clients.get(p1);
  p1ws._sent.length = 0;
  srv.handleAction(roomId, p1, {
    type: 'DECLARE_ATTACK', attackerUid: 'p1-atk-t1',
  });
  const errs = messagesOfType(p1ws, 'ERROR');
  assert.ok(errs.some(e => /6-5-6-1/.test(e.msg)),
    'ERROR carries §6-5-6-1 cite');
  assert.equal(game.battleState, null, 'no battleState created');
  assert.equal(game.phase, 'MAIN', 'phase unchanged');
});

test('§6-5-6-1 — P2 cannot attack on their first turn (game-turn 2)  [THE BUG]', () => {
  // The bug: under the old check (turn===1 && activePlayer===firstPlayer),
  // P2 on turn 2 was permitted to attack. With hasTakenFirstTurn the
  // engine now correctly blocks them.
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p2;
  game.turn = 2;
  // P1 has ended turn 1 (so their flag flips), but P2 has NOT yet ended
  // a turn — this is P2's first turn.
  game.players[p1].hasTakenFirstTurn = true;
  game.players[p2].hasTakenFirstTurn = false;
  pushAttacker(game, p2, 'p2-atk-t2');
  const p2ws = srv.clients.get(p2);
  p2ws._sent.length = 0;
  srv.handleAction(roomId, p2, {
    type: 'DECLARE_ATTACK', attackerUid: 'p2-atk-t2',
  });
  const errs = messagesOfType(p2ws, 'ERROR');
  assert.ok(errs.some(e => /6-5-6-1/.test(e.msg)),
    'ERROR carries §6-5-6-1 cite');
  assert.equal(game.battleState, null, 'no battleState created');
  assert.equal(game.phase, 'MAIN', 'phase unchanged');
});

test('§6-5-6-1 — P1 CAN attack on game-turn 3 (their second turn)', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p1;
  game.turn = 3;
  // Both players have already taken a first turn by turn 3.
  game.players[p1].hasTakenFirstTurn = true;
  game.players[p2].hasTakenFirstTurn = true;
  pushAttacker(game, p1, 'p1-atk-t3');
  srv.handleAction(roomId, p1, {
    type: 'DECLARE_ATTACK', attackerUid: 'p1-atk-t3',
  });
  assert.ok(game.battleState, 'attack proceeds — battleState armed');
  assert.equal(game.phase, 'ATTACKING', 'phase advanced to ATTACKING');
});

test('§6-5-6-1 — P2 CAN attack on game-turn 4 (their second turn)', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p2;
  game.turn = 4;
  game.players[p1].hasTakenFirstTurn = true;
  game.players[p2].hasTakenFirstTurn = true;
  pushAttacker(game, p2, 'p2-atk-t4');
  srv.handleAction(roomId, p2, {
    type: 'DECLARE_ATTACK', attackerUid: 'p2-atk-t4',
  });
  assert.ok(game.battleState, 'attack proceeds — battleState armed');
  assert.equal(game.phase, 'ATTACKING', 'phase advanced to ATTACKING');
});

test('§10-1-1-1 [Rush] does NOT bypass §6-5-6-1 (printed Rush — OP09-004 Shanks)', () => {
  // OP09-004 Shanks has printed [Rush]. On the controller's first turn
  // the §6-5-6-1 gate fires BEFORE the [Rush] check at server.js:1586,
  // so the attack is rejected.
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p1;
  game.turn = 1;
  const shanks = { ...srv.CARD_DB.find(c => c.id === 'OP09-004'),
    uid: 'shanks-rush', rested: false,
    playedThisTurn: true,  // just played — would normally need [Rush] to attack
    attachedDon: 0 };
  assert.equal(srv.hasRush(shanks), true, 'Shanks has printed [Rush]');
  game.players[p1].field.push(shanks);
  const p1ws = srv.clients.get(p1);
  p1ws._sent.length = 0;
  srv.handleAction(roomId, p1, {
    type: 'DECLARE_ATTACK', attackerUid: 'shanks-rush',
  });
  const errs = messagesOfType(p1ws, 'ERROR');
  assert.ok(errs.some(e => /6-5-6-1/.test(e.msg)),
    '[Rush] character still blocked by §6-5-6-1 on first turn');
  assert.equal(game.battleState, null, 'no battleState created');
});

test('§10-1-1-1 granted [Rush] also does NOT bypass §6-5-6-1 (ST04-003 Gee path)', () => {
  // Gee, Infernal Hound-Shlawg's [On Play] grants [Rush] for the turn
  // via tempKeywords. The grant route through hasRush() must also be
  // gated by §6-5-6-1.
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p2;
  game.turn = 2;
  // P2 is on their first turn (game-turn 2). P1 has ended their first.
  game.players[p1].hasTakenFirstTurn = true;
  game.players[p2].hasTakenFirstTurn = false;
  const gee = { ...srv.CARD_DB.find(c => c.id === 'ST04-003'),
    uid: 'gee-rush', rested: false,
    playedThisTurn: true,
    attachedDon: 0,
    tempKeywords: [{ keyword: 'rush', expiresAtTurn: game.turn }] };
  assert.equal(srv.hasRush(gee), true, 'Gee has granted [Rush] via tempKeywords');
  game.players[p2].field.push(gee);
  const p2ws = srv.clients.get(p2);
  p2ws._sent.length = 0;
  srv.handleAction(roomId, p2, {
    type: 'DECLARE_ATTACK', attackerUid: 'gee-rush',
  });
  const errs = messagesOfType(p2ws, 'ERROR');
  assert.ok(errs.some(e => /6-5-6-1/.test(e.msg)),
    'granted [Rush] character still blocked by §6-5-6-1 on first turn');
  assert.equal(game.battleState, null, 'no battleState created');
});

test('§6-5-6-1 state machine — hasTakenFirstTurn transitions via doEnd', () => {
  // Locks the per-player flag transition. createGame → both false.
  // After P1's first doEnd → only P1 true. After P2's first doEnd →
  // both true (and stay true on subsequent doEnd calls).
  const { p1, p2, game } = twoPlayerGame();
  assert.equal(game.players[p1].hasTakenFirstTurn, false,
    'P1 starts with hasTakenFirstTurn=false');
  assert.equal(game.players[p2].hasTakenFirstTurn, false,
    'P2 starts with hasTakenFirstTurn=false');

  // End P1's first turn.
  game.activePlayer = p1;
  game.phase = 'MAIN';
  game.turn = 1;
  srv.doEnd(game);
  assert.equal(game.players[p1].hasTakenFirstTurn, true,
    'P1 flag flips after first doEnd');
  assert.equal(game.players[p2].hasTakenFirstTurn, false,
    'P2 flag still false');

  // End P2's first turn.
  game.activePlayer = p2;
  game.phase = 'MAIN';
  srv.doEnd(game);
  assert.equal(game.players[p1].hasTakenFirstTurn, true);
  assert.equal(game.players[p2].hasTakenFirstTurn, true,
    'P2 flag flips after their first doEnd');

  // End P1's second turn — both still true (idempotent).
  game.activePlayer = p1;
  game.phase = 'MAIN';
  srv.doEnd(game);
  assert.equal(game.players[p1].hasTakenFirstTurn, true);
  assert.equal(game.players[p2].hasTakenFirstTurn, true);
});

test('§6-5-6-1 helper is exported and fail-closed on unknown playerId', () => {
  // Defensive check: bogus playerId returns true (treat as first turn),
  // so the engine rejects rather than silently allows.
  const { p1, game } = twoPlayerGame();
  assert.equal(typeof srv.isAttackerOnTheirFirstTurn, 'function',
    'helper exported');
  assert.equal(srv.isAttackerOnTheirFirstTurn(game, p1), true,
    'fresh player on first turn');
  game.players[p1].hasTakenFirstTurn = true;
  assert.equal(srv.isAttackerOnTheirFirstTurn(game, p1), false,
    'after first turn ends, helper returns false');
  assert.equal(srv.isAttackerOnTheirFirstTurn(game, 'bogus-id'), true,
    'unknown playerId fails closed (treated as first turn)');
});
