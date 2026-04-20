// Phase-4 Batch 1 — George the Brave onKO migrated to the new pipeline.
// Conditional: only fires when owner's leader has "Duchess of Brittany"
// affiliation. Interactive: addFromTrash (Event) → addFromTrashWindow.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

function koGeorgeInTrash(game, ownerId) {
  const george = { ...srv.CARD_DB.find(c => c.id === 'OP01-079'), uid: 'george-1' };
  game.players[ownerId].trash.push(george);
  return george;
}

test('George the Brave CARD_DB carries useNewPipeline:true', () => {
  const g = srv.CARD_DB.find(c => c.id === 'OP01-079');
  assert.equal(g.useNewPipeline, true);
});

test('onKO fires when leader affiliation matches — addFromTrashWindow opens with events only', () => {
  const { p1, p2, game } = twoPlayerGame();
  // twoPlayerGame defaults p1 to Anna of Brittany (leader affiliation
  // "Duchess of Brittany"), so George the Brave on p1's side will pass
  // the leader-type gate.
  assert.match(game.players[p1].leader.affiliation, /Duchess of Brittany/);
  const george = koGeorgeInTrash(game, p1);
  // Seed p1's trash with 1 event and 1 character so the filter is real.
  const event1 = { ...srv.CARD_DB.find(c => c.id === 'ST03-015'), uid: 'ev-1' }; // EVENT
  const chr1   = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'ch-1' }; // CHARACTER
  game.players[p1].trash.push(event1, chr1);
  srv.triggerOnKO(game, p1, george, p2);
  assert.ok(game.addFromTrashWindow, 'addFromTrashWindow opened by pipeline');
  assert.equal(game.addFromTrashWindow.playerId, p1);
  assert.deepEqual(game.addFromTrashWindow.candidateUids, ['ev-1'],
    'only EVENT-typed trash cards are candidates');
  assert.equal(game.addFromTrashWindow.filterType, 'EVENT');
});

test('onKO suppressed when leader affiliation does NOT match', () => {
  const { p1, p2, game } = twoPlayerGame();
  // p2 defaults to Constable Jack (Holy Roman Empire) — George on p2's
  // side fails the {Duchess of Brittany} gate.
  assert.doesNotMatch((game.players[p2].leader.affiliation || ''), /Duchess of Brittany/);
  const george = koGeorgeInTrash(game, p2);
  game.players[p2].trash.push({ ...srv.CARD_DB.find(c => c.id === 'ST03-015'), uid: 'ev-x' });
  srv.triggerOnKO(game, p2, george, p1);
  assert.ok(!game.addFromTrashWindow, 'no window — condition failed');
});

test('onKO with no events in trash → no window opens', () => {
  const { p1, p2, game } = twoPlayerGame();
  const george = koGeorgeInTrash(game, p1);
  // Only characters in trash, no events.
  game.players[p1].trash.push({ ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'chr-only' });
  srv.triggerOnKO(game, p1, george, p2);
  assert.ok(!game.addFromTrashWindow, 'addFromTrashWindow not opened when trash has no matching type');
});

test('pipeline resolution moves selected event from trash to hand', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const george = koGeorgeInTrash(game, p1);
  const ev = { ...srv.CARD_DB.find(c => c.id === 'ST03-015'), uid: 'ev-pick' };
  game.players[p1].trash.push(ev);
  srv.triggerOnKO(game, p1, george, p2);
  assert.ok(game.addFromTrashWindow);
  srv.handleAction(roomId, p1, { type: 'ADD_FROM_TRASH_SELECTED', cardUid: 'ev-pick' });
  assert.equal(game.addFromTrashWindow, null);
  assert.ok(game.players[p1].hand.some(c => c.uid === 'ev-pick'));
  assert.equal(game.players[p1].trash.some(c => c.uid === 'ev-pick'), false);
});
