// Phase-4 Batch 3 — Anna of Brittany leader [Activate: Main] migrated.
//   [Activate: Main] Once per turn: Rest 1 of your opponent's Characters.
//   Draw 1 card.
//
// Exercises a multi-step activateMain: restTarget (interactive window)
// → drawCards (synchronous). The chain resume must fire the draw after
// the rest window resolves.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

test('Anna of Brittany (leader) CARD_DB carries useNewPipeline:true', () => {
  const anna = srv.CARD_DB.find(c => c.id === 'ST03-001');
  assert.equal(anna.useNewPipeline, true);
});

test('activateMain opens restTargetWindow when opponent has an active character', () => {
  const { p1, p2, game } = twoPlayerGame();
  // Put an ACTIVE (not rested) opponent character on p2's field.
  const target = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'opp-tgt', rested: false, attachedDon: 0 };
  game.players[p2].field.push(target);
  // Also add a rested one so we verify filtering.
  game.players[p2].field.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'opp-rested', rested: true, attachedDon: 0 });
  const leader = game.players[p1].leader;  // Anna of Brittany

  srv.runPipeline('activateMain', game, p1, leader);
  assert.ok(game.restTargetWindow, 'restTargetWindow opened');
  assert.equal(game.restTargetWindow.playerId, p1);
  assert.deepEqual(game.restTargetWindow.candidateUids, ['opp-tgt'],
    'only non-rested opponent characters qualify');
  assert.ok(game.restTargetWindow.pipelineResume, 'resume stashed for chain');
});

test('picking a rest target rests it AND triggers the draw chain', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const target = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'opp-anna', rested: false, attachedDon: 0 };
  game.players[p2].field.push(target);
  const handLenBefore = game.players[p1].hand.length;
  const deckLenBefore = game.players[p1].deck.length;

  srv.runPipeline('activateMain', game, p1, game.players[p1].leader);
  assert.ok(game.restTargetWindow);
  srv.handleAction(roomId, p1, { type: 'REST_TARGET_SELECTED', targetUid: 'opp-anna' });

  assert.equal(game.restTargetWindow, null, 'window cleared');
  const rested = game.players[p2].field.find(c => c.uid === 'opp-anna');
  assert.equal(rested.rested, true, 'target rested');
  assert.equal(game.players[p1].hand.length, handLenBefore + 1, 'draw fired via chain');
  assert.equal(game.players[p1].deck.length, deckLenBefore - 1);
});

test('no active opponent characters → abort-block: no window, no draw', () => {
  const { p1, p2, game } = twoPlayerGame();
  // Opponent has only a rested character — restTarget filters to active only.
  game.players[p2].field.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'only-rested', rested: true, attachedDon: 0 });
  const handLenBefore = game.players[p1].hand.length;
  const res = srv.runPipeline('activateMain', game, p1, game.players[p1].leader);
  // restTarget returns 'abort-block' (vs koTarget's 'no-targets' silent
  // skip) so the entire activation blocks — matching the BUG-5/6 spec
  // that Anna's Activate Main must be refused when no valid targets.
  assert.equal(res.status, 'abort-block');
  assert.ok(!game.restTargetWindow);
  assert.equal(game.players[p1].hand.length, handLenBefore,
    'Anna draw does NOT fire when rest target is unavailable');
});
