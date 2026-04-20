// Phase 8 Batch 2 — conditionalEffect wrapper + koLastTarget effect.
// Supports two "if <cond>, <effect>" shapes:
//   ownCharacterPowerMin (Mole Gun — own board condition)
//   lastTargetMaxCost + koLastTarget (Black Hole — last-picked target)
// Suppression window resolver now stores the picked uid on
// game._lastPickedTargetUid so koLastTarget can reference it.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── Parser ──────────────────────────────────────────────────────────────

test('parser: own-board conditional wrapping koTarget', () => {
  const out = srv.parseAbility(
    '[Main] if you have a character with 6000 power or more, K.O. up to one of your opponents characters with a power of 2000 or less.'
  );
  assert.deepEqual(out.effects[0].effects, [
    { type: 'conditionalEffect',
      condition: { type: 'ownCharacterPowerMin', value: 6000 },
      effect: { type: 'koTarget', max: 1, filter: { maxPower: 2000, opponent: true } } },
  ]);
});

test('parser: lastTarget conditional wrapping koLastTarget', () => {
  const out = srv.parseAbility(
    '[Main] if that Character has a cost of 4 or less, K.O. it.'
  );
  assert.deepEqual(out.effects[0].effects, [
    { type: 'conditionalEffect',
      condition: { type: 'lastTargetMaxCost', value: 4 },
      effect: { type: 'koLastTarget' } },
  ]);
});

// ─── Card flags ─────────────────────────────────────────────────────────

test('Mole Gun ST21-017 + Black Hole OP09-098 flag + fully parsed', () => {
  const mg = srv.CARD_DB.find(c => c.id === 'ST21-017');
  const bh = srv.CARD_DB.find(c => c.id === 'OP09-098');
  assert.equal(mg.useNewPipeline, true);
  assert.equal(bh.useNewPipeline, true);
  assert.deepEqual(srv.PARSED_EFFECTS.get('ST21-017').unparsedSegments, []);
  assert.deepEqual(srv.PARSED_EFFECTS.get('OP09-098').unparsedSegments, []);
});

// ─── Mole Gun: ownCharacterPowerMin condition ──────────────────────────

test('Mole Gun: follow-up KO fires only when own side has a ≥6000-power character', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  // Weak side — no 6000+ character.
  const weak = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'mg-weak', rested: false, attachedDon: 0, power: 3000 };
  game.players[p1].field.push(weak);
  // Opponent character at 2000 power — valid KO target if condition met.
  const opp = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'mg-opp', rested: false, attachedDon: 0, power: 2000 };
  game.players[p2].field.push(opp);

  const mg = { ...srv.CARD_DB.find(c => c.id === 'ST21-017'), uid: 'mg-1' };
  game.players[p1].trash.push(mg);
  srv.runPipeline('eventMain', game, p1, mg);
  // First effect is powerDebuff (opens window); skip it.
  assert.ok(game.powerBuffTargetWindow);
  srv.handleAction(roomId, p1, { type: 'POWER_BUFF_TARGET_SELECTED', skip: true });
  // Condition fails → no koTarget window opens.
  assert.ok(!game.koTargetWindow, 'condition unmet → no follow-up');

  // Now add a ≥6000 character and re-run.
  const strong = { ...srv.CARD_DB.find(c => c.id === 'OP06-007'),
    uid: 'mg-strong', rested: false, attachedDon: 0, power: 12000 };
  game.players[p1].field.push(strong);
  const mg2 = { ...srv.CARD_DB.find(c => c.id === 'ST21-017'), uid: 'mg-2' };
  game.players[p1].trash.push(mg2);
  srv.runPipeline('eventMain', game, p1, mg2);
  assert.ok(game.powerBuffTargetWindow);
  srv.handleAction(roomId, p1, { type: 'POWER_BUFF_TARGET_SELECTED', skip: true });
  assert.ok(game.koTargetWindow, 'condition met → follow-up opens');
  assert.deepEqual(game.koTargetWindow.candidateUids, ['mg-opp']);
});

// ─── Black Hole: suppress a character → koLastTarget if cost ≤4 ─────────

test('Black Hole: picked char cost ≤4 → suppressed AND K.O.d', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.players[p1].leader.affiliation = 'Blackbeard Pirates';
  const victim = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'bh-v', rested: false, attachedDon: 0, cost: 3 };
  game.players[p2].field.push(victim);

  const bh = { ...srv.CARD_DB.find(c => c.id === 'OP09-098'), uid: 'bh-1' };
  game.players[p1].trash.push(bh);
  srv.runPipeline('eventMain', game, p1, bh);
  assert.ok(game.suppressionTargetWindow, 'suppression window opened');
  srv.handleAction(roomId, p1, { type: 'SUPPRESSION_TARGET_SELECTED', targetUid: 'bh-v' });

  // Victim should be in opponent trash now (KO'd by follow-up).
  assert.equal(game.players[p2].field.find(c => c.uid === 'bh-v'), undefined,
    'victim removed from field');
  assert.ok(game.players[p2].trash.find(c => c.uid === 'bh-v'),
    'victim moved to trash');
});

test('Black Hole: picked char cost >4 → suppressed but NOT K.O.d', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.players[p1].leader.affiliation = 'Blackbeard Pirates';
  const bigVictim = { ...srv.CARD_DB.find(c => c.id === 'OP01-094'),
    uid: 'bh-big', rested: false, attachedDon: 0, cost: 10 };
  game.players[p2].field.push(bigVictim);

  const bh = { ...srv.CARD_DB.find(c => c.id === 'OP09-098'), uid: 'bh-2' };
  game.players[p1].trash.push(bh);
  srv.runPipeline('eventMain', game, p1, bh);
  srv.handleAction(roomId, p1, { type: 'SUPPRESSION_TARGET_SELECTED', targetUid: 'bh-big' });

  // Still on field (suppressed, not KO'd).
  const t = game.players[p2].field.find(c => c.uid === 'bh-big');
  assert.ok(t);
  assert.equal(t.suppressions[0].kind, 'effects');
});
