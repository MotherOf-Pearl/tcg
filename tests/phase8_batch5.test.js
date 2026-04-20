// Phase 8 Batch 5 — powerBuff/powerDebuff phrasing extensions (accept
// "gets +N"/"gets -N" without the "power" word) and giveDon effect.
// Migrates Kamakura Jussoushi (OP10-018) and Edward Newgate (ST15-002).
//
// Deferred from this batch:
//   - Rayleigh OP08-118 (multi-pick split debuff: pick 2 targets, apply
//     different amounts to each — needs custom window).
//   - Marco OP03-013 (onKO self-revive with colon-less optional cost).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── Parser ──────────────────────────────────────────────────────────────

test('parser: "gains +N during this battle" (no "power" word) → powerBuff', () => {
  const out = srv.parseAbility(
    '[Counter] Choose up to 1 of your leader or character, it gains +3000 during this battle.'
  );
  assert.deepEqual(out.unparsedSegments, []);
  assert.deepEqual(out.effects[0].effects, [
    { type: 'powerBuff', target: 'leaderOrCharacter', value: 3000, duration: 'thisBattle' },
  ]);
});

test("parser: \"one of your opponent's leader or character gets -N during this turn\" → powerDebuff", () => {
  const out = srv.parseAbility(
    "[Main] Afterwards, one of your opponent's leader or character gets -2000 during this turn."
  );
  assert.deepEqual(out.effects[0].effects, [
    { type: 'powerDebuff', target: 'opponentLeaderOrCharacter', value: 2000 },
  ]);
});

test('parser: giveDon for "Give your leader or one of your characters up to one rested DON!!"', () => {
  const out = srv.parseAbility('[On Play] Give your leader or one of your characters up to one rested DON!!.');
  assert.deepEqual(out.effects[0].effects, [{ type: 'giveDon', count: 1, state: 'rested' }]);
});

// ─── Kamakura Jussoushi OP10-018 ───────────────────────────────────────

test('Kamakura OP10-018 flag + fully parsed (counter + trigger)', () => {
  const c = srv.CARD_DB.find(c => c.id === 'OP10-018');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('OP10-018');
  assert.deepEqual(p.unparsedSegments, []);
  // Counter: powerBuff +3000 battle, then powerDebuff -2000.
  assert.equal(p.effects[0].effects.length, 2);
  assert.equal(p.effects[0].effects[0].type, 'powerBuff');
  assert.equal(p.effects[0].effects[1].type, 'powerDebuff');
  // Trigger: powerBuff +1000 thisTurn.
  assert.equal(p.effects[1].effects[0].type, 'powerBuff');
  assert.equal(p.effects[1].effects[0].value, 1000);
});

test('Kamakura counter opens powerBuffTargetWindow for self side first', () => {
  const { p1, game } = twoPlayerGame();
  const evt = { ...srv.CARD_DB.find(c => c.id === 'OP10-018'), uid: 'km-1' };
  game.players[p1].trash.push(evt);
  srv.runPipeline('counter', game, p1, evt);
  assert.ok(game.powerBuffTargetWindow);
  assert.equal(game.powerBuffTargetWindow.amount, 3000);
  assert.equal(game.powerBuffTargetWindow.side, 'self');
});

// ─── Newgate ST15-002 ──────────────────────────────────────────────────

test('Newgate ST15-002 flag + fully parsed (onPlay giveDon + activateMain koTarget)', () => {
  const c = srv.CARD_DB.find(c => c.id === 'ST15-002');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('ST15-002');
  assert.deepEqual(p.unparsedSegments, []);
});

test('Newgate onPlay: giveDon attaches 1 DON from deck to Newgate itself', () => {
  const { p1, game } = twoPlayerGame();
  const newgate = { ...srv.CARD_DB.find(c => c.id === 'ST15-002'),
    uid: 'ng-1', attachedDon: 0 };
  game.players[p1].field.push(newgate);
  const donDeckBefore = game.players[p1].donDeck;
  srv.runPipeline('onPlay', game, p1, newgate);
  assert.equal(newgate.attachedDon, 1, 'DON attached to Newgate');
  assert.equal(game.players[p1].donDeck, donDeckBefore - 1);
});
