// Phase 7 Batch 3 — grantKeyword effect (parser pre-processing +
// agent) and `card.tempKeywords` storage. hasRush() now reads both the
// card's static ability text and its temporary grants. Migrates ST04-003
// Gee, Infernal Hound-Shlawg.
//
// Deferred from this batch: Catarina Devon (OP09-084) uses an
// and/or keyword choice — needs chooseOne over keywords, Phase 8+.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── Parser ──────────────────────────────────────────────────────────────

test('parser emits grantKeyword for "This Character gains [Rush] during this turn"', () => {
  const out = srv.parseAbility('[On Play] This Character gains [Rush] during this turn.');
  assert.deepEqual(out.unparsedSegments, []);
  assert.deepEqual(out.effects[0].effects, [
    { type: 'grantKeyword', keyword: 'rush', duration: 'thisTurn' },
  ]);
});

test('parser emits grantKeyword with opponentNextTurn duration', () => {
  const out = srv.parseAbility(
    "[Activate: Main] This Character gains [Double Attack] until the end of your opponent's next turn."
  );
  assert.deepEqual(out.unparsedSegments, []);
  assert.deepEqual(out.effects[0].effects, [
    { type: 'grantKeyword', keyword: 'double attack', duration: 'opponentNextTurn' },
  ]);
});

// ─── Card flag + migration ──────────────────────────────────────────────

test('Gee Hound-Shlawg ST04-003 flag + fully parsed', () => {
  const c = srv.CARD_DB.find(c => c.id === 'ST04-003');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('ST04-003');
  assert.deepEqual(p.unparsedSegments, []);
});

// ─── End-to-end: rush grant makes a newly-played character attack ──────

test('Gee Hound-Shlawg: onPlay Rush grant makes the new character attack this turn', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.players[p1].leader.affiliation = 'Holy Roman Empire';
  game.players[p1].donActive = 6;
  // Put an opponent character that can be K.O.'d (but we'll skip KO).
  const gee = { ...srv.CARD_DB.find(c => c.id === 'ST04-003'),
    uid: 'gee-1', rested: false, attachedDon: 0, playedThisTurn: true };
  game.players[p1].field.push(gee);

  srv.runPipeline('onPlay', game, p1, gee);
  assert.ok(game.donReturnWindow);
  srv.handleAction(roomId, p1, {
    type: 'RETURN_DON',
    selections: { fromActive: 5, fromRested: 0, fromCards: [] },
  });
  // koTarget fires — with no opponent characters, it's a silent no-op
  // and the chain continues to grantKeyword.
  assert.ok(Array.isArray(gee.tempKeywords));
  assert.equal(gee.tempKeywords[0].keyword, 'rush');
  assert.equal(srv.hasRush(gee), true, 'hasRush picks up the temp grant');

  // Simulate DECLARE_ATTACK — playedThisTurn would normally reject, but
  // Rush lets it through.
  game.activePlayer = p1;
  game.phase = 'MAIN';
  game.turn = 2;
  game.players[p1].hasTakenFirstTurn = true; // §6-5-6-1 bypass for test fixture
  srv.handleAction(roomId, p1, {
    type: 'DECLARE_ATTACK', attackerUid: 'gee-1', targetUid: game.players[p2].leader.uid,
  });
  assert.ok(game.battleState, 'attack opened — Rush grant valid');
});

// ─── Pruning at end-of-turn ─────────────────────────────────────────────

test('tempKeywords with expiresAtTurn=turn pruned at doEnd of that turn', () => {
  const { p1, game } = twoPlayerGame();
  const victim = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'tk-1', rested: false, attachedDon: 0,
    tempKeywords: [{ keyword: 'rush', expiresAtTurn: game.turn }] };
  game.players[p1].field.push(victim);
  // Before doEnd: rush present.
  assert.equal(srv.hasRush(victim), true);
  // Advance turn to trigger the expiry threshold.
  game.turn += 1;
  srv.doEnd(game);
  assert.equal((victim.tempKeywords || []).length, 0, 'tempKeywords pruned');
  assert.equal(srv.hasRush(victim), false);
});
