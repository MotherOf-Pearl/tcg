// Phase-4 Batch 2 — Shawn the Whimsical (OP01-101) migrated to the new
// pipeline. Exercises the COST flow for the first time:
//   [DON!! x1] condition → trashFromHand cost (optional) → addDon rested.
// When the player trashes a card, the pipeline's costsPaid-resume path
// must advance to the addDon effect. On skip the block aborts.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

function placeShawn(game, ownerId, attachedDon) {
  const shawn = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'shawn-1', rested: false, attachedDon };
  game.players[ownerId].field.push(shawn);
  return shawn;
}

test('Shawn the Whimsical CARD_DB carries useNewPipeline:true', () => {
  const s = srv.CARD_DB.find(c => c.id === 'OP01-101');
  assert.equal(s.useNewPipeline, true);
});

test('whenAttacking with 0 attached DON → condition fails, no trash window', () => {
  const { p1, game } = twoPlayerGame();
  const shawn = placeShawn(game, p1, 0);
  game.players[p1].hand.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'hand-1' });
  srv.runPipeline('whenAttacking', game, p1, shawn);
  assert.ok(!game.trashFromHandWindow, 'no cost window when condition fails');
});

test('whenAttacking with 1 attached DON → opens trashFromHand cost window', () => {
  const { p1, game } = twoPlayerGame();
  const shawn = placeShawn(game, p1, 1);
  // Ensure at least one hand card so the cost is payable.
  assert.ok(game.players[p1].hand.length >= 1);
  srv.runPipeline('whenAttacking', game, p1, shawn);
  assert.ok(game.trashFromHandWindow, 'trashFromHandWindow opened by cost agent');
  assert.equal(game.trashFromHandWindow.count, 1);
  assert.equal(game.trashFromHandWindow.optional, true);
  assert.ok(game.trashFromHandWindow.pipelineResume, 'resume stashed on window');
  assert.equal(game.trashFromHandWindow.pipelineResume.costsPaid, true);
  assert.equal(game.trashFromHandWindow.pipelineResume.effectIndex, 0);
});

test('paying the cost advances to addDon (donDeck -1, donRested +1)', () => {
  const { roomId, p1, game } = twoPlayerGame();
  const shawn = placeShawn(game, p1, 1);
  const pick = game.players[p1].hand[0];
  const donDeckBefore   = game.players[p1].donDeck;
  const donRestedBefore = game.players[p1].donRested;
  srv.runPipeline('whenAttacking', game, p1, shawn);
  assert.ok(game.trashFromHandWindow);

  srv.handleAction(roomId, p1, { type: 'TRASH_FROM_HAND_RESOLVE', cardUids: [pick.uid] });
  assert.equal(game.trashFromHandWindow, null);
  assert.ok(game.players[p1].trash.some(c => c.uid === pick.uid), 'paid card in trash');
  assert.equal(game.players[p1].donDeck,   donDeckBefore   - 1, 'addDon fired after cost');
  assert.equal(game.players[p1].donRested, donRestedBefore + 1);
});

test('skipping the cost aborts the block — addDon does NOT fire', () => {
  const { roomId, p1, game } = twoPlayerGame();
  const shawn = placeShawn(game, p1, 1);
  const donDeckBefore   = game.players[p1].donDeck;
  const donRestedBefore = game.players[p1].donRested;
  srv.runPipeline('whenAttacking', game, p1, shawn);
  assert.ok(game.trashFromHandWindow);

  srv.handleAction(roomId, p1, { type: 'TRASH_FROM_HAND_RESOLVE', skip: true });
  assert.equal(game.trashFromHandWindow, null);
  assert.equal(game.players[p1].donDeck,   donDeckBefore,   'no DON added on skip');
  assert.equal(game.players[p1].donRested, donRestedBefore);
});
