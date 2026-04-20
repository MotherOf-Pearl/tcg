// BUG 4 — counter-step DON cost. Event counters pay their printed cost
// from defender.donActive; character counters (discarded for their
// printed Counter value) cost zero DON.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame, messagesOfType } = require('./helpers');

beforeEach(resetWorld);

// Put a battleState in place so USE_COUNTER is accepted. No real attack is
// being resolved here — we only care about the side effects of USE_COUNTER.
function armCounterStep(game, p1, p2) {
  game.phase = 'COUNTER_STEP';
  game.battleState = {
    attackerUid: game.players[p1].leader.uid,
    attackerId: p1,
    attackerName: 'X',
    attackerPower: 4000,
    targetUid: game.players[p2].leader.uid,
    targetName: 'Y',
    targetPower: 5000,
    targetIsLeader: true,
    counterBonus: 0,
    blockerUsed: false,
  };
}

test('Character counter: no DON deducted, card goes to trash, counterBonus applied', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  armCounterStep(game, p1, p2);
  // Put a character counter (FiFi Cat, counter 1000) in defender's hand.
  const fifi = {
    ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'fifi-counter', rested: false,
  };
  game.players[p2].hand = [fifi];
  game.players[p2].donActive = 3;  // unchanged expected
  srv.handleAction(roomId, p2, { type: 'USE_COUNTER', cardUid: fifi.uid });
  assert.equal(game.players[p2].donActive, 3, 'character counter costs 0 DON');
  assert.ok(game.players[p2].trash.some(c => c.uid === fifi.uid), 'card moved to trash');
  assert.equal(game.players[p2].hand.length, 0, 'card removed from hand');
  assert.equal(game.battleState.counterBonus, 1000, 'counter bonus applied');
  assert.equal(game.battleState.counterUsed, true, 'counterUsed flag set');
});

test('Event counter: deducts printed cost from defender.donActive', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  armCounterStep(game, p1, p2);
  // Snow Merchant (OP01-087) — cost 2, Event, has [Counter] ability.
  const snow = {
    ...srv.CARD_DB.find(c => c.id === 'OP01-087'),
    uid: 'snow-counter',
  };
  game.players[p2].hand = [snow];
  game.players[p2].donActive = 5;
  srv.handleAction(roomId, p2, { type: 'USE_COUNTER', cardUid: snow.uid });
  assert.equal(game.players[p2].donActive, 3, 'event counter deducted 2 DON');
  assert.equal(game.players[p2].donRested, 2, 'spent DON goes to rested');
  assert.ok(game.players[p2].trash.some(c => c.uid === snow.uid));
});

test('Event counter rejected when insufficient DON — card stays in hand', () => {
  const { roomId, p1, p2, p2ws, game } = twoPlayerGame();
  armCounterStep(game, p1, p2);
  const snow = {
    ...srv.CARD_DB.find(c => c.id === 'OP01-087'),
    uid: 'snow-nofund',
  };
  game.players[p2].hand = [snow];
  game.players[p2].donActive = 1;  // need 2
  srv.handleAction(roomId, p2, { type: 'USE_COUNTER', cardUid: snow.uid });
  assert.equal(game.players[p2].donActive, 1, 'DON untouched on rejection');
  assert.equal(game.players[p2].hand.length, 1, 'card still in hand');
  const errs = messagesOfType(p2ws, 'ERROR');
  assert.equal(errs.length, 1);
  assert.match(errs[0].msg, /Not enough active DON/);
});
