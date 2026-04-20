// Phase 8 Batch 6 — playSelf trigger effect ("Play this card" when a
// life card with [Trigger] is revealed). Migrates Monk Matt ST04-010.
//
// Deferred: OP09-081 Marshall D. Teach — passive "Your [On Play]
// abilities don't activate" requires a game-wide on-play suppression
// flag with per-side scope + expiry, plus a passive-effects track.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

test('parser emits playSelf for "Play this card"', () => {
  const out = srv.parseAbility('[Trigger] Play this card.');
  assert.deepEqual(out.unparsedSegments, []);
  assert.deepEqual(out.effects[0].effects, [{ type: 'playSelf' }]);
});

test('Monk Matt ST04-010 flag + fully parsed', () => {
  const c = srv.CARD_DB.find(c => c.id === 'ST04-010');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('ST04-010');
  assert.deepEqual(p.unparsedSegments, []);
  assert.equal(p.effects[1].effects[0].type, 'playSelf');
});

test('Monk Matt trigger: card moves from hand to field as free play', () => {
  const { p1, game } = twoPlayerGame();
  const matt = { ...srv.CARD_DB.find(c => c.id === 'ST04-010'),
    uid: 'mm-1', rested: true, attachedDon: 0 };
  // Simulate the life-reveal path: card sits in hand.
  game.players[p1].hand.push(matt);
  const fieldBefore = game.players[p1].field.length;
  const handBefore = game.players[p1].hand.length;

  srv.runPipeline('trigger', game, p1, matt);

  assert.equal(game.players[p1].hand.length, handBefore - 1, 'removed from hand');
  assert.equal(game.players[p1].field.length, fieldBefore + 1, 'added to field');
  const onField = game.players[p1].field.find(c => c.uid === 'mm-1');
  assert.ok(onField);
  assert.equal(onField.rested, false, 'played active');
  assert.equal(onField.playedThisTurn, true);
});

test('Monk Matt playSelf is a no-op if card is not in hand', () => {
  const { p1, game } = twoPlayerGame();
  const matt = { ...srv.CARD_DB.find(c => c.id === 'ST04-010'),
    uid: 'mm-orphan' };
  // Card is neither in hand nor anywhere — playSelf should gracefully no-op.
  const fieldBefore = game.players[p1].field.length;
  srv.runPipeline('trigger', game, p1, matt);
  assert.equal(game.players[p1].field.length, fieldBefore);
});
