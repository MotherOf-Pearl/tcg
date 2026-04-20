// Phase 5 Priority 5 — meta-references. "Activate this card's [X]
// effect" now parses to {type:'activateOwnEffect', timing:X} and the
// agent re-runs the referenced block's effects inline with the caller's
// resume continuation.
//
// Migrations covered:
//   OP01-087 Snow Merchant     — already pipeline-migrated for counter;
//                                trigger now wired via meta-ref
//   ST03-015 Cig Break         — main + trigger (meta-ref to main)
//   ST03-016 Siege of Londinium — counter + trigger (meta-ref to counter)
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

test('parser emits activateOwnEffect for "Activate this card\'s [X] effect"', () => {
  const out = srv.parseAbility(
    "[Counter] Return up to 1 Character with a cost of 3 or less to the owner's hand. [Trigger] Activate this card's [Counter] effect."
  );
  assert.deepEqual(out.unparsedSegments, []);
  // Exactly 2 blocks — the inner [Counter] inside the meta-ref must NOT
  // create a spurious third block.
  assert.equal(out.effects.length, 2);
  const trigger = out.effects.find(e => e.timing === 'trigger');
  assert.deepEqual(trigger.effects, [{ type: 'activateOwnEffect', timing: 'counter' }]);
});

test('Cig Break CARD_DB carries useNewPipeline:true and parses fully', () => {
  const card = srv.CARD_DB.find(c => c.id === 'ST03-015');
  assert.equal(card.useNewPipeline, true);
  const parsed = srv.PARSED_EFFECTS.get('ST03-015');
  assert.deepEqual(parsed.unparsedSegments, []);
  const trigger = parsed.effects.find(e => e.timing === 'trigger');
  assert.deepEqual(trigger.effects, [{ type: 'activateOwnEffect', timing: 'eventMain' }]);
});

test('Siege of Londinium CARD_DB carries useNewPipeline:true and parses fully', () => {
  const card = srv.CARD_DB.find(c => c.id === 'ST03-016');
  assert.equal(card.useNewPipeline, true);
  const parsed = srv.PARSED_EFFECTS.get('ST03-016');
  assert.deepEqual(parsed.unparsedSegments, []);
  const trigger = parsed.effects.find(e => e.timing === 'trigger');
  assert.deepEqual(trigger.effects, [{ type: 'activateOwnEffect', timing: 'counter' }]);
});

test('Snow Merchant: triggerResolve → activateOwnEffect(counter) → playFromHand window', () => {
  const { p1, p2, game } = twoPlayerGame();
  const snow = { ...srv.CARD_DB.find(c => c.id === 'OP01-087'), uid: 'snow-trig' };
  game.players[p1].trash.push(snow);
  // Eligible candidate in p1 hand (same side as the trigger source).
  const fifi = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'fifi-trig' };
  game.players[p1].hand.push(fifi);

  srv.runPipeline('trigger', game, p1, snow);

  // Meta-ref re-runs the [Counter] block: one playFromHand effect.
  assert.ok(game.playFromHandWindow, 'playFromHand opened via meta-ref');
  assert.equal(game.playFromHandWindow.playerId, p1);
  // The starting hand from PRESET_DECKS['Anna of Brittany'] already
  // contains other Duchess-of-Brittany cost-≤-3 characters, so the
  // candidate list is a superset; just verify our test card is in it.
  assert.ok(game.playFromHandWindow.candidateUids.includes('fifi-trig'),
    'meta-ref produced the correct filtered list including test card');
});
