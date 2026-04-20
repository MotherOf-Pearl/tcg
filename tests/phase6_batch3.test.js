// Phase 6 Batch 3 — adds `restSelf` cost support (parser + agent) and
// migrates 5 cards. restSelf is the "You may rest this Character/Stage:"
// cost; for Activate: Main abilities the engine pre-rests the source
// as part of ACTIVATE_MAIN, so restSelf is paid trivially in those paths.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── Parser ──────────────────────────────────────────────────────────────

test('parser emits restSelf cost for "You may rest this character:"', () => {
  const out = srv.parseAbility('[Activate: Main] You may rest this character: Draw 1 card.');
  assert.deepEqual(out.effects[0].costs, [{ type: 'restSelf' }]);
});

test('parser emits restSelf cost for "You may rest this Stage:"', () => {
  const out = srv.parseAbility('[Activate: Main] You may rest this Stage: Add up to 1 DON!! card from your DON!! deck and rest it.');
  assert.deepEqual(out.effects[0].costs, [{ type: 'restSelf' }]);
});

// ─── ST18-001 Usohachi — donCountMin condition + restTarget ────────────

test('Usohachi ST18-001 flag + donCountMin≥8 gate', () => {
  const { p1, p2, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'ST18-001');
  assert.equal(c.useNewPipeline, true);
  const opp = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'uso-v', rested: false, attachedDon: 0 };
  game.players[p2].field.push(opp);
  const uso = { ...c, uid: 'uso-1' };
  game.players[p1].field.push(uso);

  // Not enough DON — block condition fails.
  game.players[p1].donActive = 3; game.players[p1].donRested = 2; game.players[p1].donDeck = 0;
  srv.runPipeline('onPlay', game, p1, uso);
  assert.ok(!game.restTargetWindow, 'condition fails → no window');

  // Enough DON — window opens.
  game.players[p1].donActive = 4; game.players[p1].donRested = 4; game.players[p1].donDeck = 0;
  srv.runPipeline('onPlay', game, p1, uso);
  assert.ok(game.restTargetWindow);
});

// ─── OP09-088 Shiryuu — DON!!x1 + trashFromHand cost + drawCards ───────

test('Shiryuu OP09-088 flag + DON!!x1 gate + trashFromHand(2)', () => {
  const { p1, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'OP09-088');
  assert.equal(c.useNewPipeline, true);
  game.players[p1].hand.push(
    { ...srv.CARD_DB.find(c => c.id === 'OP01-101'), uid: 'sh-h1' },
    { ...srv.CARD_DB.find(c => c.id === 'OP01-101'), uid: 'sh-h2' });
  // With 0 DON attached — condition fails.
  const sh0 = { ...c, uid: 'sh-0', attachedDon: 0, rested: false };
  game.players[p1].field.push(sh0);
  srv.runPipeline('whenAttacking', game, p1, sh0);
  assert.ok(!game.trashFromHandWindow, 'DON!!x1 condition fails');

  // With 1 DON attached — opens trashFromHand(2) cost window.
  const sh1 = { ...c, uid: 'sh-1', attachedDon: 1, rested: false };
  game.players[p1].field.push(sh1);
  srv.runPipeline('whenAttacking', game, p1, sh1);
  assert.ok(game.trashFromHandWindow);
  assert.equal(game.trashFromHandWindow.count, 2);
});

// ─── OP09-011 Hongo — activateMain restSelf cost → powerDebuff ─────────

test('Hongo OP09-011 flag + restSelf cost (auto-paid when rested) → powerDebuff', () => {
  const { p1, p2, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'OP09-011');
  assert.equal(c.useNewPipeline, true);
  // Leader must be Red Hair Pirates for condition.
  game.players[p1].leader.affiliation = 'Red Hair Pirates';
  const opp = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'ho-v', rested: false, attachedDon: 0 };
  game.players[p2].field.push(opp);
  // Simulate ACTIVATE_MAIN having pre-rested Hongo.
  const hongo = { ...c, uid: 'ho-1', rested: true };
  game.players[p1].field.push(hongo);
  srv.runPipeline('activateMain', game, p1, hongo);
  assert.ok(game.powerBuffTargetWindow);
  assert.equal(game.powerBuffTargetWindow.amount, -2000);
});

test('Hongo OP09-011 with non-matching leader — condition fails', () => {
  const { p1, p2, game } = twoPlayerGame();
  // Leave Anna of Brittany leader (non Red Hair Pirates).
  const opp = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'ho-v2', rested: false, attachedDon: 0 };
  game.players[p2].field.push(opp);
  const hongo = { ...srv.CARD_DB.find(c => c.id === 'OP09-011'),
    uid: 'ho-2', rested: true };
  game.players[p1].field.push(hongo);
  srv.runPipeline('activateMain', game, p1, hongo);
  assert.ok(!game.powerBuffTargetWindow);
});

// ─── OP09-021 Red Force — stage restSelf → powerDebuff ─────────────────

test('Red Force OP09-021 flag + restSelf stage cost → -1000 powerDebuff', () => {
  const { p1, p2, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'OP09-021');
  assert.equal(c.useNewPipeline, true);
  game.players[p1].leader.affiliation = 'Red Hair Pirates';
  const opp = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'rf-v', rested: false, attachedDon: 0 };
  game.players[p2].field.push(opp);
  const stage = { ...c, uid: 'rf-1', rested: true };  // engine pre-rested
  game.players[p1].stage = stage;
  srv.runPipeline('activateMain', game, p1, stage);
  assert.ok(game.powerBuffTargetWindow);
  assert.equal(game.powerBuffTargetWindow.amount, -1000);
});

// ─── ST04-017 GTA Server — stage restSelf → addDon ─────────────────────

test('GTA Server ST04-017 flag + restSelf → addDon from deck rested', () => {
  const { p1, game } = twoPlayerGame();
  const c = srv.CARD_DB.find(c => c.id === 'ST04-017');
  assert.equal(c.useNewPipeline, true);
  // Leader must be Holy Roman Empire.
  game.players[p1].leader.affiliation = 'Holy Roman Empire';
  const donDeckBefore = game.players[p1].donDeck;
  const restedBefore  = game.players[p1].donRested;
  const stage = { ...c, uid: 'gta-1', rested: true };
  game.players[p1].stage = stage;
  srv.runPipeline('activateMain', game, p1, stage);
  assert.equal(game.players[p1].donDeck, donDeckBefore - 1,
    '1 DON card consumed from deck');
  assert.equal(game.players[p1].donRested, restedBefore + 1,
    'DON added as rested');
});
