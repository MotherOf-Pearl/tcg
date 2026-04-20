// Phase 5 Priority 1 — parser coverage for ±power buff/debuff patterns
// beyond the original "X gains +N power during Y" shape. These three
// cards were in the [PARSE_ABILITY] coverage-gaps list before this turn.
// Pinning them down here means a future regex tweak surfaces as a diff
// rather than silently changing the emitted effect shape.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAbility } = require('../server');

test('NoroNoro Beam Sword — [Counter] DON!! -1: powerBuff + restTarget, [Trigger] addDon active', () => {
  const out = parseAbility(
    "[Counter] DON!! -1: Give up to 1 of your Leader or Character cards +2000 power for this battle. Then, rest up to 1 of your opponent's Characters. [Trigger] Add up to 1 DON!! card from your DON!! deck and set it as active."
  );
  assert.deepEqual(out.unparsedSegments, []);
  assert.equal(out.effects.length, 2);
  const [counter, trigger] = out.effects;
  assert.equal(counter.timing, 'counter');
  assert.deepEqual(counter.costs, [{ type: 'returnDon', count: 1 }]);
  assert.deepEqual(counter.effects, [
    { type: 'powerBuff', target: 'leaderOrCharacter', value: 2000, duration: 'thisBattle', max: 1 },
    { type: 'restTarget', max: 1, filter: { opponent: true } },
  ]);
  assert.equal(trigger.timing, 'trigger');
  assert.deepEqual(trigger.effects, [{ type: 'addDon', count: 1, state: 'active' }]);
});

test('Bad Manners Kick Course — [Counter] trash+powerBuff, [Trigger] powerDebuff (no "cards")', () => {
  // The raw card text quirks covered by this test:
  //   - Capital "Power" in the counter clause
  //   - Omitted "cards" word in both clauses
  //   - "this battle" (no "for") in the counter
  const out = parseAbility(
    "[Counter] You may trash 1 card from your hand: Give up to 1 of your leaders or characters +3000 Power this battle. [Trigger] Give up to one of your opponent's leaders or characters -3000 power for this turn."
  );
  assert.deepEqual(out.unparsedSegments, []);
  const [counter, trigger] = out.effects;
  assert.deepEqual(counter.costs, [{ type: 'trashFromHand', count: 1 }]);
  assert.deepEqual(counter.effects, [
    { type: 'powerBuff', target: 'leaderOrCharacter', value: 3000, duration: 'thisBattle', max: 1 },
  ]);
  assert.deepEqual(trigger.effects, [
    { type: 'powerDebuff', target: 'opponentLeaderOrCharacter', value: 3000, duration: 'thisTurn', max: 1 },
  ]);
});

test('Yasopp — [On Play] self powerBuff, [DON!! x1] [When Attacking] opponent powerDebuff', () => {
  const out = parseAbility(
    "[On Play] Up to one of your leaders gains +1000 power until the end of your opponent's next turn. [DON!! x1] [When Attacking] Up to one of your opponent's characters gets -1000 power for this turn."
  );
  assert.deepEqual(out.unparsedSegments, []);
  const onPlay = out.effects.find(e => e.timing === 'onPlay');
  const whenAtk = out.effects.find(e => e.timing === 'whenAttacking');
  // On-play buff matches the original passive "X gains +N power" regex
  // (handled before these Priority-1 additions). target 'leader' with
  // duration 'opponentNextTurn'.
  assert.deepEqual(onPlay.effects, [
    { type: 'powerBuff', target: 'leader', value: 1000, duration: 'opponentNextTurn' },
  ]);
  // When-Attacking debuff is the new "gets -N power" pattern.
  assert.deepEqual(whenAtk.conditions, [{ type: 'donAttached', value: 1 }]);
  assert.deepEqual(whenAtk.effects, [
    { type: 'powerDebuff', target: 'opponentCharacter', value: 1000, duration: 'thisTurn', max: 1 },
  ]);
});

test('powerBuff plurals — "leaders or characters" resolves to leaderOrCharacter target', () => {
  // Regression guard: earlier draft matched the plural as 'character'
  // because the substring test `/leader or character/` failed against
  // "leaders or characters" (the `s` breaks the space-separator).
  const out = parseAbility(
    "[Counter] Give up to 1 of your leaders or characters +3000 Power this battle."
  );
  assert.equal(out.effects[0].effects[0].target, 'leaderOrCharacter');
});
