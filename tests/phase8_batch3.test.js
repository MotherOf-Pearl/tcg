// Phase 8 Batch 3 — trashSelf cost + mandatory trashFromHandEffect.
// Migrates OP10-082 Kuzan (Activate: Main with self-trash cost →
// drawCards + playFromTrash) and OP11-083 Caribou (On Play mandatory
// 2-card hand trash).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── Parser ──────────────────────────────────────────────────────────────

test('parser emits trashSelf cost for "You may trash this Character:"', () => {
  const out = srv.parseAbility('[Activate: Main] You may trash this Character: Draw 1 card.');
  assert.deepEqual(out.effects[0].costs, [{ type: 'trashSelf' }]);
});

test('parser emits trashFromHandEffect for "Trash N cards from your hand."', () => {
  const out = srv.parseAbility('[On Play] Trash 2 cards from your hand.');
  assert.deepEqual(out.unparsedSegments, []);
  assert.deepEqual(out.effects[0].effects, [{ type: 'trashFromHandEffect', count: 2 }]);
});

// ─── Kuzan OP10-082 ────────────────────────────────────────────────────

test('Kuzan OP10-082 flag + fully parsed (passive "cannot be removed" ignored)', () => {
  const c = srv.CARD_DB.find(c => c.id === 'OP10-082');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('OP10-082');
  assert.deepEqual(p.unparsedSegments, []);
  assert.deepEqual(p.effects[0].costs, [{ type: 'trashSelf' }]);
  assert.equal(p.effects[0].effects.length, 2);
  assert.equal(p.effects[0].effects[0].type, 'drawCards');
  assert.equal(p.effects[0].effects[1].type, 'playFromTrash');
  assert.equal(p.effects[0].effects[1].filter.excludeName, 'Kuzan');
});

test('Kuzan activateMain: trashSelf moves source to trash, then draws + opens playFromTrash', () => {
  const { p1, game } = twoPlayerGame();
  // Populate trash with an eligible revive target.
  const revivable = { ...srv.CARD_DB.find(c => c.id === 'OP09-009'),
    uid: 'kz-rev', affiliation: 'Blackbeard Pirates', cost: 3 };
  game.players[p1].trash.push(revivable);

  const kuzan = { ...srv.CARD_DB.find(c => c.id === 'OP10-082'),
    uid: 'kz-src', rested: true };  // ACTIVATE_MAIN rests first
  game.players[p1].field.push(kuzan);
  const handBefore = game.players[p1].hand.length;

  srv.runPipeline('activateMain', game, p1, kuzan);

  // Kuzan should now be in trash.
  assert.equal(game.players[p1].field.find(c => c.uid === 'kz-src'), undefined,
    'Kuzan removed from field');
  assert.ok(game.players[p1].trash.find(c => c.uid === 'kz-src'),
    'Kuzan in trash');
  // Drew 1 card.
  assert.equal(game.players[p1].hand.length, handBefore + 1);
  // playFromTrash window opens.
  assert.ok(game.playFromTrashWindow);
  assert.deepEqual(game.playFromTrashWindow.candidateUids, ['kz-rev'],
    'Kuzan excluded from candidates (excludeName)');
});

// ─── Caribou OP11-083 ──────────────────────────────────────────────────

test('Caribou OP11-083 flag + fully parsed', () => {
  const c = srv.CARD_DB.find(c => c.id === 'OP11-083');
  assert.equal(c.useNewPipeline, true);
});

test('Caribou onPlay opens mandatory trashFromHand(2) — non-optional', () => {
  const { p1, game } = twoPlayerGame();
  // Populate hand with enough cards.
  game.players[p1].hand.push(
    { ...srv.CARD_DB.find(c => c.id === 'OP01-101'), uid: 'cb-h1' },
    { ...srv.CARD_DB.find(c => c.id === 'OP01-101'), uid: 'cb-h2' },
    { ...srv.CARD_DB.find(c => c.id === 'OP01-101'), uid: 'cb-h3' });
  const cb = { ...srv.CARD_DB.find(c => c.id === 'OP11-083'), uid: 'cb-1' };
  game.players[p1].field.push(cb);
  srv.runPipeline('onPlay', game, p1, cb);
  assert.ok(game.trashFromHandWindow);
  assert.equal(game.trashFromHandWindow.count, 2);
  assert.equal(game.trashFromHandWindow.optional, false, 'mandatory — cannot skip');
});
