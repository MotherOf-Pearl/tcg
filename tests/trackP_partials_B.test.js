// Track P partials batch B — Rayleigh multi-pick split + Stronger
// costDebuff. Rayleigh's compound debuff is pre-processed into two
// sequential single-target powerDebuff effects; Stronger introduces
// a tempCostEffects array, effectiveCostOf helper, a compound
// trashFromHand + trashSelf cost, and a costDebuff effect that reuses
// powerBuffTarget window in mode='cost'.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── Rayleigh OP08-118 ─────────────────────────────────────────────────

test('Rayleigh OP08-118 flag + fully parsed as 3 sequential effects', () => {
  const c = srv.CARD_DB.find(c => c.id === 'OP08-118');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('OP08-118');
  assert.deepEqual(p.unparsedSegments, []);
  const effs = p.effects[0].effects;
  assert.equal(effs.length, 3);
  assert.equal(effs[0].type, 'powerDebuff');
  assert.equal(effs[0].value, 3000);
  assert.equal(effs[1].type, 'powerDebuff');
  assert.equal(effs[1].value, 2000);
  assert.equal(effs[2].type, 'koTarget');
  assert.equal(effs[2].filter.maxPower, 3000);
});

test('Rayleigh onPlay: opens first -3000 power-debuff picker', () => {
  const { p1, p2, game } = twoPlayerGame();
  const victim = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'ra-v', rested: false, attachedDon: 0 };
  game.players[p2].field.push(victim);
  const ray = { ...srv.CARD_DB.find(c => c.id === 'OP08-118'), uid: 'ra-1' };
  game.players[p1].field.push(ray);
  srv.runPipeline('onPlay', game, p1, ray);
  assert.ok(game.powerBuffTargetWindow);
  assert.equal(game.powerBuffTargetWindow.amount, -3000);
  assert.equal(game.powerBuffTargetWindow.side, 'opponent');
});

// ─── Stronger OP09-089 ─────────────────────────────────────────────────

test('Stronger OP09-089 flag + compound cost order (trashSelf before trashFromHand)', () => {
  const c = srv.CARD_DB.find(c => c.id === 'OP09-089');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('OP09-089');
  assert.deepEqual(p.unparsedSegments, []);
  assert.deepEqual(p.effects[0].costs, [
    { type: 'trashSelf' },
    { type: 'trashFromHand', count: 1 },
  ]);
  // Effects include costDebuff.
  const cd = p.effects[0].effects.find(e => e.type === 'costDebuff');
  assert.ok(cd);
  assert.equal(cd.amount, 2);
});

test('Stronger activateMain with matching leader: trashSelf first, then hand-trash window', () => {
  const { p1, game } = twoPlayerGame();
  game.players[p1].leader.affiliation = 'Blackbeard Pirates';
  game.players[p1].hand.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'str-handcost' });
  const str = { ...srv.CARD_DB.find(c => c.id === 'OP09-089'),
    uid: 'str-1', rested: true };
  game.players[p1].field.push(str);

  srv.runPipeline('activateMain', game, p1, str);
  // trashSelf (sync) already moved Stronger to trash; trashFromHand cost
  // window is now open.
  assert.equal(game.players[p1].field.find(c => c.uid === 'str-1'), undefined,
    'Stronger trashed as cost');
  assert.ok(game.players[p1].trash.find(c => c.uid === 'str-1'));
  assert.ok(game.trashFromHandWindow, 'hand-trash cost window open');
});

test('effectiveCostOf applies tempCostEffects', () => {
  const { p2, game } = twoPlayerGame();
  const victim = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'cd-v', cost: 5 };
  game.players[p2].field.push(victim);
  assert.equal(srv.effectiveCostOf(victim, game), 5);
  game.tempCostEffects.push({
    targetUid: 'cd-v', amount: -2, expiresAtTurn: game.turn,
  });
  assert.equal(srv.effectiveCostOf(victim, game), 3);
});

test('tempCostEffects pruned at doEnd when expiresAtTurn < turn', () => {
  const { p2, game } = twoPlayerGame();
  const victim = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'cd-v2', cost: 5 };
  game.players[p2].field.push(victim);
  game.tempCostEffects.push({
    targetUid: 'cd-v2', amount: -2, expiresAtTurn: game.turn,
  });
  game.activePlayer = Object.keys(game.players)[0];
  srv.doEnd(game);
  assert.equal(game.tempCostEffects.length, 0);
  assert.equal(srv.effectiveCostOf(victim, game), 5);
});
