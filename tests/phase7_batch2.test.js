// Phase 7 Batch 2 — parser extension: "Add up to N Active DON!!" (the
// adjective-prefix variant where "Active" is before DON!! rather than
// a trailing "set it as active"). Migrates God Thread (OP10-079).
//
// Deferred from this batch: setOwnDonActive + setCharacterActive effects
// + [End of Your Turn] pipeline hook (needed for Rosinante + Katakuri).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

test('parser: "Add up to 1 Active DON!! from your DON!! deck" → addDon active', () => {
  const out = srv.parseAbility('[Trigger] Add up to 1 Active DON!! from your DON!! deck.');
  assert.deepEqual(out.unparsedSegments, []);
  assert.deepEqual(out.effects[0].effects, [{ type: 'addDon', count: 1, state: 'active' }]);
});

test('God Thread OP10-079 flag + fully parsed', () => {
  const c = srv.CARD_DB.find(c => c.id === 'OP10-079');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('OP10-079');
  assert.deepEqual(p.unparsedSegments, []);
  // Main: koTarget ≤5 + active DON.
  assert.deepEqual(p.effects[0].effects, [
    { type: 'koTarget', max: 1, filter: { maxCost: 5, opponent: true } },
    { type: 'addDon', count: 1, state: 'active' },
  ]);
  // Trigger: active DON.
  assert.deepEqual(p.effects[1].effects, [
    { type: 'addDon', count: 1, state: 'active' },
  ]);
});

test('God Thread eventMain opens koTargetWindow with ≤5 cost filter', () => {
  const { p1, p2, game } = twoPlayerGame();
  const small = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'gt-s', rested: false, attachedDon: 0 };  // cost 3
  const big = { ...srv.CARD_DB.find(c => c.id === 'OP01-094'),
    uid: 'gt-b', rested: false, attachedDon: 0 };  // cost 10
  game.players[p2].field.push(small, big);

  const gt = { ...srv.CARD_DB.find(c => c.id === 'OP10-079'), uid: 'gt-1' };
  game.players[p1].trash.push(gt);
  srv.runPipeline('eventMain', game, p1, gt);
  assert.ok(game.koTargetWindow);
  assert.deepEqual(game.koTargetWindow.candidateUids, ['gt-s']);
});

test('God Thread trigger adds 1 Active DON', () => {
  const { p1, game } = twoPlayerGame();
  const donDeckBefore = game.players[p1].donDeck;
  const activeBefore  = game.players[p1].donActive;
  const gt = { ...srv.CARD_DB.find(c => c.id === 'OP10-079'), uid: 'gt-t' };
  game.players[p1].trash.push(gt);
  srv.runPipeline('trigger', game, p1, gt);
  assert.equal(game.players[p1].donDeck, donDeckBefore - 1);
  assert.equal(game.players[p1].donActive, activeBefore + 1);
});
