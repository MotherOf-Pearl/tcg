// Phase-4 Batch 1 — Blessed Thy Men (ST04-015) migrated to the new
// pipeline. This is the first CHAINED effect: [Main] koTarget (cost ≤ 6
// opponent character) THEN addDon active. The second effect must fire
// AUTOMATICALLY after the KO window resolves — that's the real stress
// test of the sequencer's resume mechanism.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

test('Blessed Thy Men CARD_DB carries useNewPipeline:true', () => {
  const btm = srv.CARD_DB.find(c => c.id === 'ST04-015');
  assert.equal(btm.useNewPipeline, true);
});

test('eventMain runs koTarget then resumes to addDon active — full chain', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  // Put a cost ≤ 6 opponent character on p2's field so the KO window has
  // a valid target.
  const victim = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'victim-1', cost: 2, rested: false, attachedDon: 0 };
  game.players[p2].field.push(victim);

  // Simulate p1 playing Blessed Thy Men: the event is already in p1's
  // trash when the pipeline fires (per the new-pipeline code path that
  // pushes first, then runs).
  const btm = { ...srv.CARD_DB.find(c => c.id === 'ST04-015'), uid: 'btm-1' };
  game.players[p1].trash.push(btm);
  const donDeckBefore   = game.players[p1].donDeck;
  const donActiveBefore = game.players[p1].donActive;

  srv.runPipeline('eventMain', game, p1, btm);

  // First effect: koTarget should have opened its window.
  assert.ok(game.koTargetWindow, 'koTargetWindow opened by first effect');
  assert.equal(game.koTargetWindow.playerId, p1);
  assert.ok(game.koTargetWindow.pipelineResume, 'pipelineResume stashed on window for chain');
  assert.equal(game.koTargetWindow.pipelineResume.blockIndex, 0);
  assert.equal(game.koTargetWindow.pipelineResume.effectIndex, 1, 'resume points at next effect (addDon)');

  // Second effect must NOT have fired yet — pipeline paused.
  assert.equal(game.players[p1].donDeck, donDeckBefore, 'donDeck untouched before KO resolves');

  // Resolve the KO: p1 picks victim.
  srv.handleAction(roomId, p1, { type: 'KO_TARGET_SELECTED', targetUid: 'victim-1' });

  // KO applied.
  assert.equal(game.koTargetWindow, null);
  assert.ok(game.players[p2].trash.some(c => c.uid === 'victim-1'), 'victim moved to trash');
  // Chain resumed — addDon active fired.
  assert.equal(game.players[p1].donDeck,   donDeckBefore   - 1, 'donDeck decremented by addDon');
  assert.equal(game.players[p1].donActive, donActiveBefore + 1, 'donActive incremented (state=active)');
});

test('eventMain skipping the KO window still resumes to addDon (optional=true)', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const victim = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'), uid: 'v-skip', cost: 2, rested: false, attachedDon: 0 };
  game.players[p2].field.push(victim);
  const btm = { ...srv.CARD_DB.find(c => c.id === 'ST04-015'), uid: 'btm-skip' };
  game.players[p1].trash.push(btm);
  const donDeckBefore   = game.players[p1].donDeck;
  const donActiveBefore = game.players[p1].donActive;

  srv.runPipeline('eventMain', game, p1, btm);
  assert.ok(game.koTargetWindow);
  // Player skips the KO — window is optional per parsed "up to 1".
  srv.handleAction(roomId, p1, { type: 'KO_TARGET_SELECTED', skip: true });
  assert.equal(game.koTargetWindow, null);
  // Victim should still be on field.
  assert.ok(game.players[p2].field.some(c => c.uid === 'v-skip'));
  // Chain resumed — DON still added.
  assert.equal(game.players[p1].donDeck,   donDeckBefore   - 1);
  assert.equal(game.players[p1].donActive, donActiveBefore + 1);
});

test('eventMain when no valid KO targets → first effect no-ops, chain continues to addDon', () => {
  const { p1, game } = twoPlayerGame();
  // No characters on opponent field at all.
  const btm = { ...srv.CARD_DB.find(c => c.id === 'ST04-015'), uid: 'btm-none' };
  game.players[p1].trash.push(btm);
  const donDeckBefore   = game.players[p1].donDeck;
  const donActiveBefore = game.players[p1].donActive;

  const res = srv.runPipeline('eventMain', game, p1, btm);
  // Per TCG "then" semantics: each clause resolves independently. If the
  // first effect has no targets it simply no-ops and the block continues
  // to the next effect. The sequencer reflects this — `no-targets`
  // doesn't abort the block, only `window-open` / `unsupported` do.
  assert.equal(res.status, 'done', 'block completed even though first effect no-opped');
  assert.equal(game.players[p1].donDeck,   donDeckBefore   - 1, 'addDon still fired (donDeck -1)');
  assert.equal(game.players[p1].donActive, donActiveBefore + 1, 'addDon still fired (donActive +1)');
});
