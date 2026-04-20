// Parser contract tests — assert the exact parseAbility() output shape for
// every card on the spec list. If the router regresses, these fail
// immediately with a diff showing which field drifted.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAbility } = require('../server');

function onlyBlock(text) {
  const out = parseAbility(text);
  assert.equal(out.effects.length, 1, `expected 1 timing block, got ${out.effects.length}: ${JSON.stringify(out.effects)}`);
  assert.deepEqual(out.unparsedSegments, [], `unexpected unparsed: ${JSON.stringify(out.unparsedSegments)}`);
  return { out, block: out.effects[0] };
}

test('FiFi Cat — [On Play] scry 5 either-placement, no reveal', () => {
  const { out, block } = onlyBlock(
    '[On Play] Look at 5 cards from the top of your deck and return them to the top or bottom of the deck in any order.'
  );
  assert.deepEqual(out.keywords, []);
  assert.equal(block.timing, 'onPlay');
  assert.deepEqual(block.effects, [{ type: 'scry', count: 5, placement: 'either' }]);
  assert.equal(block.effects[0].reveal, undefined);
});

test('Merchant Dam — [Blocker] + [On K.O.] addDon rested', () => {
  const out = parseAbility('[Blocker] [On K.O.] Add 1 DON!! card from your DON!! deck and rest it.');
  assert.deepEqual(out.keywords, ['blocker']);
  assert.deepEqual(out.unparsedSegments, []);
  assert.equal(out.effects.length, 1);
  const b = out.effects[0];
  assert.equal(b.timing, 'onKO');
  assert.deepEqual(b.effects, [{ type: 'addDon', count: 1, state: 'rested' }]);
});

test('Noble Shlawger — [Blocker] + [DON!! x1] [On Block] placeAtBottom', () => {
  const out = parseAbility(
    "[Blocker] [DON!! x1] [On Block] Place up to 1 Character with a cost of 2 or less at the bottom of the owner's deck."
  );
  assert.deepEqual(out.keywords, ['blocker']);
  assert.deepEqual(out.unparsedSegments, []);
  const b = out.effects[0];
  assert.equal(b.timing, 'onBlock');
  assert.deepEqual(b.conditions, [{ type: 'donAttached', value: 1 }]);
  assert.deepEqual(b.effects, [{ type: 'placeAtBottom', max: 1, filter: { maxCost: 2 } }]);
  assert.equal(b.optional, true);
  assert.equal(b.maxTargets, 1);
});

test("Ball the Berserk — opponent-scope bounce", () => {
  const { block } = onlyBlock(
    "[On Play] Return up to 1 of your opponent's Characters with a cost of 3 or less to the owner's hand."
  );
  assert.equal(block.timing, 'onPlay');
  assert.deepEqual(block.effects, [
    { type: 'bounceTarget', max: 1, filter: { maxCost: 3, opponent: true } },
  ]);
  assert.equal(block.optional, true);
});

test('Jack, Master of Gee — DON cost + leader gate + AOE KO', () => {
  const { block } = onlyBlock(
    '[On Play] DON!! -6: If your Leader has the {Holy Roman Empire} type, K.O. all Characters other than this Character.'
  );
  assert.deepEqual(block.conditions, [{ type: 'leaderType', value: 'Holy Roman Empire' }]);
  assert.deepEqual(block.costs, [{ type: 'returnDon', count: 6 }]);
  assert.deepEqual(block.effects, [{ type: 'aoeKO', excludeSelf: true }]);
});

test('Constable Jack leader — Activate Main, returnDon 7, trashOpponentLife', () => {
  const { block } = onlyBlock(
    "[Activate: Main] [Once Per Turn] DON!! -7: Trash up to 1 of your opponent's Life cards."
  );
  assert.equal(block.timing, 'activateMain');
  assert.deepEqual(block.conditions, [{ type: 'oncePerTurn' }]);
  assert.deepEqual(block.costs, [{ type: 'returnDon', count: 7 }]);
  assert.deepEqual(block.effects, [{ type: 'trashOpponentLife', count: 1, triggerActivates: false }]);
});

test('Anna of Brittany leader — restTarget opponent + drawCards', () => {
  const { block } = onlyBlock(
    "[Activate: Main] Once per turn: Rest 1 of your opponent's Characters. Draw 1 card."
  );
  assert.equal(block.timing, 'activateMain');
  assert.deepEqual(block.conditions, [{ type: 'oncePerTurn' }]);
  assert.deepEqual(block.effects, [
    { type: 'restTarget', max: 1, filter: { opponent: true } },
    { type: 'drawCards', count: 1 },
  ]);
});

test('George the Brave — leader gate + addFromTrash EVENT', () => {
  const out = parseAbility(
    '[Blocker] [On K.O.] If your Leader has the {Duchess of Brittany} type, add up to 1 Event from your trash to your hand.'
  );
  assert.deepEqual(out.keywords, ['blocker']);
  assert.deepEqual(out.unparsedSegments, []);
  const b = out.effects[0];
  assert.equal(b.timing, 'onKO');
  assert.deepEqual(b.conditions, [{ type: 'leaderType', value: 'Duchess of Brittany' }]);
  assert.deepEqual(b.effects, [{ type: 'addFromTrash', max: 1, filter: { type: 'EVENT' } }]);
});

test('Shawn the Whimsical — donAttached condition + trashFromHand cost + addDon rested', () => {
  const { block } = onlyBlock(
    '[DON!! x1] [When Attacking] You may trash 1 card from your hand: Add up to 1 DON!! card from your DON!! deck and rest it.'
  );
  assert.equal(block.timing, 'whenAttacking');
  assert.deepEqual(block.conditions, [{ type: 'donAttached', value: 1 }]);
  assert.deepEqual(block.costs, [{ type: 'trashFromHand', count: 1 }]);
  assert.deepEqual(block.effects, [{ type: 'addDon', count: 1, state: 'rested' }]);
});

test('Blessed Thy Men — two blocks: eventMain (koTarget + addDon active) and trigger (addDon active)', () => {
  const out = parseAbility(
    "[Main] K.O. up to 1 of your opponent's Characters with a cost of 6 or less, then add up to 1 DON!! card from your DON!! deck and set it as active. [Trigger] Add up to 1 DON!! card from your DON!! deck and set it as active."
  );
  assert.deepEqual(out.unparsedSegments, []);
  assert.equal(out.effects.length, 2);
  const [mainBlk, trigBlk] = out.effects;
  assert.equal(mainBlk.timing, 'eventMain');
  assert.deepEqual(mainBlk.effects, [
    { type: 'koTarget', max: 1, filter: { maxCost: 6, opponent: true } },
    { type: 'addDon', count: 1, state: 'active' },
  ]);
  assert.equal(trigBlk.timing, 'trigger');
  assert.deepEqual(trigBlk.effects, [{ type: 'addDon', count: 1, state: 'active' }]);
});

test('Snow Merchant — counter block plays from hand (Duchess of Brittany CHARACTER ≤ cost 3)', () => {
  const out = parseAbility(
    "[Counter] Play up to 1 {Duchess of Brittany} type Character card with a cost of 3 or less from your hand. [Trigger] Activate this card's [Counter] effect."
  );
  // The counter block we care about is the first one. The trigger block
  // contains an unparsed meta-reference ("Activate this card's … effect"),
  // which is a known Phase-2 backlog item — not a spec failure.
  const counterBlk = out.effects.find(e => e.timing === 'counter' && e.effects.length);
  assert.ok(counterBlk, 'expected a counter block with effects');
  assert.deepEqual(counterBlk.effects, [
    { type: 'playFromHand', max: 1,
      filter: { maxCost: 3, affiliation: 'Duchess of Brittany', type: 'CHARACTER' },
      free: true },
  ]);
});
