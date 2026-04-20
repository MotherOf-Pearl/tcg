// Phase-4 Batch 2/3 — Ball the Berserk (ST03-014) migrated.
//   [On Play] Return 1 of your opponent's Characters with a cost of 3
//   or less to the owner's hand.
//
// Text updated in Batch 3 to drop "up to" → bounce is MANDATORY
// (optional=false). Skip action is rejected by the server.
// Verifies: opponent-only scope (own field is NOT a candidate), filter
// enforcement by cost, mandatory behavior.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

function placeBall(game, ownerId) {
  const ball = { ...srv.CARD_DB.find(c => c.id === 'ST03-014'),
    uid: 'ball-1', rested: false, attachedDon: 0 };
  game.players[ownerId].field.push(ball);
  return ball;
}

test('Ball the Berserk CARD_DB carries useNewPipeline:true', () => {
  const b = srv.CARD_DB.find(c => c.id === 'ST03-014');
  assert.equal(b.useNewPipeline, true);
});

test('onPlay opens bounceTargetWindow with opponent-only candidates', () => {
  const { p1, p2, game } = twoPlayerGame();
  const ball = placeBall(game, p1);
  // Put a cost-2 on OPPONENT's field (valid) and a cost-2 on OWN field
  // (should NOT be a candidate because scope is 'opponent').
  const oppChar  = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'opp-lo', cost: 2, rested: false, attachedDon: 0 };
  const ownChar  = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'own-lo', cost: 2, rested: false, attachedDon: 0 };
  game.players[p2].field.push(oppChar);
  game.players[p1].field.push(ownChar);

  srv.runPipeline('onPlay', game, p1, ball);
  assert.ok(game.bounceTargetWindow, 'window opened');
  assert.equal(game.bounceTargetWindow.playerId, p1);
  assert.deepEqual(game.bounceTargetWindow.candidateUids, ['opp-lo'],
    'only opponent character qualifies — own field excluded');
});

test('cost filter enforced — opponent char with cost > 3 is not a candidate', () => {
  const { p1, p2, game } = twoPlayerGame();
  const ball = placeBall(game, p1);
  // High-cost opponent character — should be filtered out.
  game.players[p2].field.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'opp-big', cost: 9, rested: false, attachedDon: 0 });
  srv.runPipeline('onPlay', game, p1, ball);
  assert.ok(!game.bounceTargetWindow, 'no candidates → no window');
});

test('selecting a target returns it to opponent hand', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const ball = placeBall(game, p1);
  const victim = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'opp-vic', cost: 2, rested: false, attachedDon: 3 };
  game.players[p2].field.push(victim);
  const handLenBefore = game.players[p2].hand.length;

  srv.runPipeline('onPlay', game, p1, ball);
  assert.ok(game.bounceTargetWindow);
  srv.handleAction(roomId, p1, { type: 'BOUNCE_TARGET_SELECTED', targetUid: 'opp-vic' });

  assert.equal(game.bounceTargetWindow, null);
  assert.ok(game.players[p2].hand.some(c => c.uid === 'opp-vic'), 'bounced to opponent hand');
  assert.equal(game.players[p2].field.some(c => c.uid === 'opp-vic'), false, 'off field');
  const returned = game.players[p2].hand.find(c => c.uid === 'opp-vic');
  assert.equal(returned.attachedDon, 0, 'attached DON stripped on bounce');
  assert.equal(game.players[p2].hand.length, handLenBefore + 1);
});

test('mandatory: bounce window is non-optional (optional=false on the window)', () => {
  const { p1, p2, game } = twoPlayerGame();
  const ball = placeBall(game, p1);
  game.players[p2].field.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'opp-mandatory', cost: 2, rested: false, attachedDon: 0 });
  srv.runPipeline('onPlay', game, p1, ball);
  assert.ok(game.bounceTargetWindow);
  assert.equal(game.bounceTargetWindow.optional, false,
    'post-text-change Ball: no "up to" → optional:false (mandatory)');
});

test('skip action on a mandatory window is rejected — window stays, no bounce', () => {
  const { roomId, p1, p2, p1ws, game } = twoPlayerGame();
  const ball = placeBall(game, p1);
  game.players[p2].field.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'opp-keep', cost: 2, rested: false, attachedDon: 0 });
  srv.runPipeline('onPlay', game, p1, ball);
  assert.ok(game.bounceTargetWindow);
  srv.handleAction(roomId, p1, { type: 'BOUNCE_TARGET_SELECTED', skip: true });
  assert.ok(game.bounceTargetWindow, 'mandatory window survives a skip attempt');
  assert.ok(game.players[p2].field.some(c => c.uid === 'opp-keep'), 'target stays on field');
  // Server sends an ERROR explaining why skip failed.
  const errs = p1ws._sent.filter(m => m.type === 'ERROR');
  assert.ok(errs.length > 0);
  assert.match(errs[errs.length - 1].msg, /Must select a target/i);
});
