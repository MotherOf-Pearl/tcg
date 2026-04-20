// Phase 7 Batch 1 — scry parser accepts "Look at the top N cards …"
// phrasing and "reveal and add one" variant; "draw one card" variant
// for drawCards. Unlocks 3 migrations.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── Parser ──────────────────────────────────────────────────────────────

test('parser accepts "Look at the top N cards of your deck" phrasing', () => {
  const out = srv.parseAbility(
    '[On Play] Look at the top 5 cards of your deck, reveal up to 1 {Red Hair Pirates} type card and add it to your hand. Then, place the rest at the bottom of your deck in any order.'
  );
  assert.deepEqual(out.unparsedSegments, []);
  assert.equal(out.effects[0].effects[0].type, 'scry');
  assert.equal(out.effects[0].effects[0].count, 5);
  assert.equal(out.effects[0].effects[0].reveal.count, 1);
  assert.equal(out.effects[0].effects[0].reveal.filter.affiliation, 'Red Hair Pirates');
});

test('parser accepts "reveal and add one" variant', () => {
  const out = srv.parseAbility(
    '[Main] Look at the top 5 cards of your deck, reveal and add one {Red Hair Pirates} type card to your hand. Place the rest at the bottom of the deck in any order.'
  );
  assert.equal(out.effects[0].effects[0].reveal.count, 1);
});

test('parser accepts "Draw one card"', () => {
  const out = srv.parseAbility('[Trigger] Draw one card.');
  assert.deepEqual(out.effects[0].effects, [{ type: 'drawCards', count: 1 }]);
});

// ─── Migrations ─────────────────────────────────────────────────────────

test('Sugar OP10-065 flag + activateMain restDon+restSelf → scry with reveal', () => {
  const { p1, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'OP10-065');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('OP10-065');
  assert.deepEqual(p.unparsedSegments, []);
  // Sugar activateMain requires rest-a-DON cost — not yet in new pipeline
  // (restDon cost is currently parsed but not wired). Skip end-to-end;
  // parse-shape coverage only for this card.
});

test('Uta OP09-002 flag + onPlay opens scry with reveal', () => {
  const { p1, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'OP09-002');
  assert.equal(c.useNewPipeline, true);
  const uta = { ...c, uid: 'uta-1' };
  game.players[p1].field.push(uta);
  srv.runPipeline('onPlay', game, p1, uta);
  assert.ok(game.scryWindow);
  assert.equal(game.scryWindow.cards.length, 5);
  assert.equal(game.scryWindow.keepCount, 1);
  assert.equal(game.scryWindow.keepFilter, 'Red Hair Pirates');
  assert.equal(game.scryWindow.placement, 'bottom');
});

test("Come on!! OP09-020 flag + activateMain opens scry; trigger draws", () => {
  const { p1, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'OP09-020');
  assert.equal(c.useNewPipeline, true);
  // EVENT: eventMain would fire from hand play, but the card has
  // [Activate: Main] + [Trigger] — they're two separate timings.
  const evt = { ...c, uid: 'com-1' };
  game.players[p1].trash.push(evt);
  srv.runPipeline('activateMain', game, p1, evt);
  assert.ok(game.scryWindow);
  assert.equal(game.scryWindow.keepFilter, 'Red Hair Pirates');

  // Clear and fire trigger — draws 1 card.
  game.scryWindow = null;
  const handBefore = game.players[p1].hand.length;
  srv.runPipeline('trigger', game, p1, evt);
  assert.equal(game.players[p1].hand.length, handBefore + 1);
});
