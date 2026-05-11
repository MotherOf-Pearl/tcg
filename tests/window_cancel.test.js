// window-lifecycle v2 — CANCEL_WINDOW on a cancellable picker.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame, messagesOfType } = require('./helpers');

beforeEach(resetWorld);

test('CANCEL_WINDOW is REJECTED on a post-cost bounceTargetWindow (§8-4-1-5)', () => {
  // Per §8-4-1, once the cost has been paid (§8-4-1-3) and the effect
  // activated (§8-4-1-4), the player must resolve (§8-4-1-5). User-
  // initiated cancel is only legal pre-cost. The engine rejects with
  // an ERROR and leaves the window open.
  const { roomId, p1, p2, game } = twoPlayerGame();
  const ball = { ...srv.CARD_DB.find(c => c.id === 'ST03-014'),
    uid: 'ball-cancel', rested: false, attachedDon: 0 };
  game.players[p1].field.push(ball);
  const opp = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'opp-can', cost: 2, rested: false, attachedDon: 0 };
  game.players[p2].field.push(opp);
  srv.runPipeline('onPlay', game, p1, ball);
  assert.ok(game.bounceTargetWindow, 'window open');
  assert.ok(game.activeWindow, 'activeWindow tracked');

  const p1Client = srv.clients.get(p1);
  p1Client._sent.length = 0;
  srv.handleAction(roomId, p1, { type: 'CANCEL_WINDOW' });

  const errs = messagesOfType(p1Client, 'ERROR');
  assert.ok(errs.some(e => /already activated/.test(e.msg)),
    'ERROR fired with "already activated" message');
  assert.ok(game.bounceTargetWindow, 'window still open after rejected cancel');
  assert.ok(game.activeWindow, 'activeWindow still tracked');
});

test('CANCEL_WINDOW rejects when no window is open', () => {
  const { roomId, p1 } = twoPlayerGame();
  const p1Client = srv.clients.get(p1);
  p1Client._sent.length = 0;
  srv.handleAction(roomId, p1, { type: 'CANCEL_WINDOW' });
  const errs = messagesOfType(p1Client, 'ERROR');
  assert.ok(errs.some(e => /No window/.test(e.msg)), 'ERROR fired');
});

test('CANCEL_WINDOW rejects a foreign cancel attempt', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const ball = { ...srv.CARD_DB.find(c => c.id === 'ST03-014'),
    uid: 'ball-foreign', rested: false, attachedDon: 0 };
  game.players[p1].field.push(ball);
  const opp = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'opp-foreign', cost: 2, rested: false, attachedDon: 0 };
  game.players[p2].field.push(opp);
  srv.runPipeline('onPlay', game, p1, ball);
  const p2Client = srv.clients.get(p2);
  p2Client._sent.length = 0;
  // p2 (not the window's owner) tries to cancel — must error.
  srv.handleAction(roomId, p2, { type: 'CANCEL_WINDOW' });
  const errs = messagesOfType(p2Client, 'ERROR');
  assert.ok(errs.some(e => /not yours/.test(e.msg)), 'ERROR fired for foreign cancel');
  assert.ok(game.bounceTargetWindow, 'window still open');
});

test('attack cancel via CANCEL_WINDOW unrests attacker and restores MAIN', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p1;
  game.turn = 2; // bypass turn-1-no-attack rule
  game.players[p1].hasTakenFirstTurn = true; // §6-5-6-1 bypass for test fixture
  // Give p1 a non-rested character that can attack.
  const attacker = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'att-1', rested: false, playedThisTurn: false, attachedDon: 0 };
  game.players[p1].field.push(attacker);
  srv.handleAction(roomId, p1, { type: 'DECLARE_ATTACK', attackerUid: 'att-1' });
  assert.equal(game.phase, 'ATTACKING', 'phase ATTACKING after declare');
  assert.equal(attacker.rested, true, 'attacker rested');
  assert.ok(game.attackDeclarationWindow, 'attackDeclarationWindow open');

  srv.handleAction(roomId, p1, { type: 'CANCEL_WINDOW' });
  assert.equal(attacker.rested, false, 'attacker unrested after cancel');
  assert.equal(game.battleState, null, 'battleState cleared');
  assert.equal(game.phase, 'MAIN', 'phase back to MAIN');
  assert.equal(game.attackDeclarationWindow, null, 'window cleared');
});
