// Track P Phase 1 — passive/continuous effect parser + PASSIVE_EFFECTS
// cache. No behavior is wired yet; these tests only verify the AST
// shape. Behavior wiring follows in P-2 (power), P-3 (keywords),
// P-4 (hand cost), P-5 (removal protection), P-6 (self-save).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld } = require('./helpers');

beforeEach(resetWorld);

test('parsePassive: scaledPowerBuff with donAttached + leaderType (Jesse the Jester)', () => {
  const passives = srv.parsePassive(
    '[DON!! x1] [Your Turn] If your Leader has the {Duchess of Brittany} type, this Character gains +1000 power for every 2 Events in your trash.'
  );
  assert.equal(passives.length, 1);
  assert.deepEqual(passives[0], {
    type: 'scaledPowerBuff',
    scope: 'yourTurn',
    conditions: [
      { type: 'donAttached', value: 1 },
      { type: 'leaderType', value: 'Duchess of Brittany' },
    ],
    per: 2,
    amount: 1000,
    source: 'eventsInTrash',
  });
});

test('parsePassive: scaledPowerBuff + removalProtection on Burgess', () => {
  const passives = srv.parsePassive(
    "This character cannot be K.O'd by your opponents effects. If your leader has the {Blackbeard Pirates} type, this character gets +1000 power for every 4 cards in your trash."
  );
  assert.equal(passives.length, 2);
  // Order: scaledPowerBuff first (matches earlier in scan), then protection.
  // We assert presence regardless of order.
  const kinds = passives.map(p => p.type).sort();
  assert.deepEqual(kinds, ['removalProtection', 'scaledPowerBuff']);
  const scaled = passives.find(p => p.type === 'scaledPowerBuff');
  assert.equal(scaled.source, 'trashCards');
  assert.equal(scaled.per, 4);
  assert.deepEqual(scaled.conditions, [{ type: 'leaderType', value: 'Blackbeard Pirates' }]);
});

test('parsePassive: scopedPowerBuff (Chopper)', () => {
  const passives = srv.parsePassive("[Blocker] [Opponent's Turn] This character has +2000 power.");
  assert.equal(passives.length, 1);
  assert.deepEqual(passives[0], {
    type: 'scopedPowerBuff',
    scope: 'opponentsTurn',
    amount: 2000,
  });
});

test('parsePassive: globalPowerModifier (OP09-004 Shanks)', () => {
  const passives = srv.parsePassive('All of your opponents characters have -1000 power. [Rush]');
  assert.equal(passives.length, 1);
  assert.deepEqual(passives[0], {
    type: 'globalPowerModifier',
    side: 'opponent',
    target: 'characters',
    amount: -1000,
  });
});

test('parsePassive: conditionalKeyword [Blocker] gated by ownTrashCountMin (Vivi)', () => {
  const passives = srv.parsePassive('If your trash has 10 cards or more, this character gains [Blocker].');
  assert.equal(passives.length, 1);
  assert.deepEqual(passives[0], {
    type: 'conditionalKeyword',
    conditions: [{ type: 'ownTrashCountMin', value: 10 }],
    keyword: 'blocker',
  });
});

test('parsePassive: conditionalKeyword gated by leaderType (Shiryu PRB02-015)', () => {
  const passives = srv.parsePassive(
    'If your Leader has the {Blackbeard Pirates} type, this Character gains [Blocker]. [On K.O.] …'
  );
  const kw = passives.find(p => p.type === 'conditionalKeyword');
  assert.ok(kw);
  assert.deepEqual(kw.conditions, [{ type: 'leaderType', value: 'Blackbeard Pirates' }]);
  assert.equal(kw.keyword, 'blocker');
});

test('parsePassive: handCostDiscount with ownCharacterPowerMin (Uta ST23-001)', () => {
  const passives = srv.parsePassive(
    'If you have a Character with 10000 power or more, give this card in your hand -4 cost. [Blocker]'
  );
  const disc = passives.find(p => p.type === 'handCostDiscount');
  assert.ok(disc);
  assert.equal(disc.discount, 4);
  assert.deepEqual(disc.conditions, [{ type: 'ownCharacterPowerMin', value: 10000 }]);
});

test('parsePassive: handCostDiscount with oppCharacterPowerMin base-power (Shanks ST23-002)', () => {
  const passives = srv.parsePassive(
    'If your opponent has a Character with 8000 base power or more, give this card in your hand -3 cost.'
  );
  const disc = passives.find(p => p.type === 'handCostDiscount');
  assert.ok(disc);
  assert.equal(disc.discount, 3);
  assert.deepEqual(disc.conditions, [{ type: 'oppCharacterPowerMin', value: 8000 }]);
});

test('parsePassive: handCostDiscountAura for Constable Anna OP01-067', () => {
  const passives = srv.parsePassive('[Banish] [DON!! x1] Give blue Events in your hand -1 cost.');
  const aura = passives.find(p => p.type === 'handCostDiscountAura');
  assert.ok(aura, 'expected handCostDiscountAura entry');
  assert.equal(aura.discount, 1);
  assert.deepEqual(aura.filter, { type: 'EVENT', color: 'blue' });
  assert.deepEqual(aura.conditions, [{ type: 'donAttached', value: 1 }]);
});

test('handPlayCostFor: Anna aura discounts blue Events in hand when ≥1 DON!! attached; stacks per Anna', () => {
  const srvMod = require('../server.js');
  const anna = srvMod.CARD_DB.find(c => c.id === 'OP01-067');
  const cig = srvMod.CARD_DB.find(c => c.id === 'ST03-015'); // blue EVENT, cost 4
  assert.ok(anna && cig, 'expected OP01-067 Constable Anna and ST03-015 Cig Break in CARD_DB');

  // No Anna on field — base cost.
  const player0 = { leader: null, field: [], hand: [] };
  const game0 = { players: { p1: player0 } };
  assert.equal(srvMod.handPlayCostFor(player0, cig, game0), cig.cost);

  // One Anna with 0 DON!! attached — condition fails, no discount.
  const annaNoDon = { ...anna, uid: 'anna-a', attachedDon: 0 };
  const player1 = { leader: null, field: [annaNoDon], hand: [] };
  const game1 = { players: { p1: player1 } };
  assert.equal(srvMod.handPlayCostFor(player1, cig, game1), cig.cost);

  // One Anna with 1 DON!! attached — -1 cost.
  const annaOne = { ...anna, uid: 'anna-b', attachedDon: 1 };
  const player2 = { leader: null, field: [annaOne], hand: [] };
  const game2 = { players: { p1: player2 } };
  assert.equal(srvMod.handPlayCostFor(player2, cig, game2), cig.cost - 1);

  // Two Annas, each with 1 DON!! — stacks to -2.
  const annaTwoA = { ...anna, uid: 'anna-c', attachedDon: 1 };
  const annaTwoB = { ...anna, uid: 'anna-d', attachedDon: 2 };
  const player3 = { leader: null, field: [annaTwoA, annaTwoB], hand: [] };
  const game3 = { players: { p1: player3 } };
  assert.equal(srvMod.handPlayCostFor(player3, cig, game3), cig.cost - 2);

  // Does not discount non-EVENT cards.
  const annaChar = srvMod.CARD_DB.find(c => c.id === 'OP01-077'); // blue CHARACTER
  assert.ok(annaChar);
  assert.equal(srvMod.handPlayCostFor(player2, annaChar, game2), annaChar.cost);
});

test('parsePassive: removalProtection (Kuzan OP10-082 anyRemoval vs Burgess koOnly)', () => {
  const kuzan = srv.parsePassive(
    "This Character cannot be removed from the field by your opponent's effects. [Activate: Main] …"
  );
  assert.deepEqual(kuzan.find(p => p.type === 'removalProtection'),
    { type: 'removalProtection', source: 'opponent', scope: 'anyRemoval' });
  const burgess = srv.parsePassive("This character cannot be K.O'd by your opponents effects.");
  assert.deepEqual(burgess.find(p => p.type === 'removalProtection'),
    { type: 'removalProtection', source: 'opponent', scope: 'koOnly' });
});

test('parsePassive: selfSaveReplacement powerDebuffSelf (Ace/Law)', () => {
  const ace = srv.parsePassive(
    "[Once Per Turn] If this character would be removed from play by one of your opponent's effects, instead you may give this character -2000 power for this turn."
  );
  const save = ace.find(p => p.type === 'selfSaveReplacement');
  assert.ok(save);
  assert.equal(save.replaceWith, 'powerDebuffSelf');
  assert.equal(save.amount, 2000);
  assert.deepEqual(save.conditions, [{ type: 'oncePerTurn' }]);
});

test('parsePassive: selfSaveReplacement returnDon (Vergo)', () => {
  const vergo = srv.parsePassive(
    "[Once Per Turn] If your {Donquixote Pirates} type Character would be removed from the field by your opponent's effect, you may return 1 DON!! card from your field to your DON!! deck instead."
  );
  const save = vergo.find(p => p.type === 'selfSaveReplacement');
  assert.ok(save);
  assert.equal(save.replaceWith, 'returnDon');
  assert.equal(save.affiliation, 'Donquixote Pirates');
});

// ─── PASSIVE_EFFECTS cache ──────────────────────────────────────────────

test('PASSIVE_EFFECTS cache populated at startup', () => {
  // Should include at least the 12 cards we know carry passives:
  const expected = [
    'OP01-083', 'OP10-011', 'OP09-004', 'OP05-086', 'OP09-086',
    'PRB02-015', 'ST23-001', 'ST23-002', 'OP10-082',
    'ST15-005', 'PRB02-002', 'OP14-061',
  ];
  for (const id of expected) {
    assert.ok(srv.PASSIVE_EFFECTS.has(id), `PASSIVE_EFFECTS missing ${id}`);
    assert.ok(srv.PASSIVE_EFFECTS.get(id).length > 0, `no entries for ${id}`);
  }
});
