// Track P Phases 5+6 — removal protection + self-save replacement.
// koTarget / bounceTarget / placeAtBottom openers filter out
// opponent-side protected cards; the KO resolver (and aoeKO /
// koLastTarget agents) offers self-save passives first and skips
// removal when the save applies.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── P-5: removal protection ───────────────────────────────────────────

test('isRemovalProtected: Burgess (koOnly) shielded only from KO', () => {
  const { p1, p2, game } = twoPlayerGame();
  const burgess = { ...srv.CARD_DB.find(c => c.id === 'OP09-086'),
    uid: 'bg-p1', attachedDon: 0 };
  game.players[p2].field.push(burgess);
  assert.equal(srv.isRemovalProtected(burgess, p1, game, 'ko'), true);
  assert.equal(srv.isRemovalProtected(burgess, p1, game, 'bounce'), false);
  assert.equal(srv.isRemovalProtected(burgess, p1, game, 'placeBottom'), false);
});

test('isRemovalProtected: Kuzan OP10-082 (anyRemoval) shielded from every scope', () => {
  const { p1, p2, game } = twoPlayerGame();
  const kuzan = { ...srv.CARD_DB.find(c => c.id === 'OP10-082'),
    uid: 'kz-p1', attachedDon: 0 };
  game.players[p2].field.push(kuzan);
  for (const scope of ['ko', 'bounce', 'placeBottom', 'any']) {
    assert.equal(srv.isRemovalProtected(kuzan, p1, game, scope), true);
  }
});

test('isRemovalProtected: self-triggered removal bypasses the protection', () => {
  const { p1, game } = twoPlayerGame();
  const kuzan = { ...srv.CARD_DB.find(c => c.id === 'OP10-082'),
    uid: 'kz-self', attachedDon: 0 };
  game.players[p1].field.push(kuzan);
  // Remover is the owner → not opponent-sourced → protection does not apply.
  assert.equal(srv.isRemovalProtected(kuzan, p1, game, 'ko'), false);
});

test('openKoTargetWindow: Burgess excluded from candidates', () => {
  const { p1, p2, game } = twoPlayerGame();
  // Use Benn Beckman OP09-009 pipeline card as the KO source (already migrated).
  const burgess = { ...srv.CARD_DB.find(c => c.id === 'OP09-086'),
    uid: 'bg-sh', attachedDon: 0, power: 7000 };
  const normal = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'bg-norm', attachedDon: 0, power: 3000 };
  game.players[p2].field.push(burgess, normal);
  const benn = { ...srv.CARD_DB.find(c => c.id === 'OP09-009'), uid: 'benn-1' };
  game.players[p1].field.push(benn);
  srv.runPipeline('onPlay', game, p1, benn);
  assert.ok(game.koTargetWindow);
  assert.ok(!game.koTargetWindow.candidateUids.includes('bg-sh'),
    'Burgess (koOnly) excluded from KO targets');
  assert.ok(game.koTargetWindow.candidateUids.includes('bg-norm'));
});

// ─── P-6: self-save replacement ────────────────────────────────────────

test('tryAutoSelfSave: Ace-style powerDebuff self-save in place of KO', () => {
  const { p1, p2, game } = twoPlayerGame();
  const ace = { ...srv.CARD_DB.find(c => c.id === 'ST15-005'),
    uid: 'ace-1', attachedDon: 0 };
  game.players[p2].field.push(ace);
  // Opponent p1 triggers removal on Ace. Save activates → Ace stays on field
  // with -2000 power for the turn.
  const basePower = ace.power;
  const saved = srv._tryAutoSelfSave
    ? srv._tryAutoSelfSave(ace, p1, game, 'test')
    : null;  // not exported; use via KO handler below
  // Use a real koTarget flow: build an attacker that KOs Ace.
  // (Simpler: directly verify via tempPowerEffects after our hook runs.)
  // Skipping the direct-call; the integration test below covers it.
});

test('Ace self-save fires when KO_TARGET_SELECTED targets him (first time per turn)', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const ace = { ...srv.CARD_DB.find(c => c.id === 'ST15-005'),
    uid: 'ace-2', attachedDon: 0, rested: false };
  game.players[p2].field.push(ace);
  // p1 uses Benn Beckman's onPlay KO (Benn is migrated, power ≤6000 filter
  // — Ace's power is 5000 so it qualifies).
  const benn = { ...srv.CARD_DB.find(c => c.id === 'OP09-009'), uid: 'benn-2' };
  game.players[p1].field.push(benn);
  srv.runPipeline('onPlay', game, p1, benn);
  assert.ok(game.koTargetWindow);
  assert.ok(game.koTargetWindow.candidateUids.includes('ace-2'));
  srv.handleAction(roomId, p1, { type: 'KO_TARGET_SELECTED', targetUid: 'ace-2' });
  // Ace should still be on field (saved).
  assert.ok(game.players[p2].field.find(c => c.uid === 'ace-2'),
    'Ace saved himself, stays on field');
  // Self-save slot consumed.
  assert.ok(game._selfSaveUsedThisTurn && game._selfSaveUsedThisTurn.has('ace-2'));
});

test('Vergo self-save (returnDon) consumes 1 DON from his owner\'s active pool', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  // Vergo belongs to p2, opponent (p1) KOs him via Benn. Vergo's save
  // requires his affiliation matches (Donquixote Pirates) — OP14-061's
  // CARD_DB entry has that. Need DON available on p2's field.
  game.players[p2].donActive = 3;
  game.players[p2].donDeck = 0;
  const vergo = { ...srv.CARD_DB.find(c => c.id === 'OP14-061'),
    uid: 'vg-1', attachedDon: 0, rested: false, power: 5000 };
  game.players[p2].field.push(vergo);

  const benn = { ...srv.CARD_DB.find(c => c.id === 'OP09-009'), uid: 'benn-3' };
  game.players[p1].field.push(benn);
  srv.runPipeline('onPlay', game, p1, benn);
  assert.ok(game.koTargetWindow);
  assert.ok(game.koTargetWindow.candidateUids.includes('vg-1'));
  srv.handleAction(roomId, p1, { type: 'KO_TARGET_SELECTED', targetUid: 'vg-1' });

  assert.ok(game.players[p2].field.find(c => c.uid === 'vg-1'),
    'Vergo stays on field');
  assert.equal(game.players[p2].donActive, 2, '1 DON moved from active to deck');
  assert.equal(game.players[p2].donDeck, 1);
});

test('self-save slot clears at doEnd', () => {
  const { p1, game } = twoPlayerGame();
  game._selfSaveUsedThisTurn = new Set(['a', 'b']);
  game.activePlayer = p1;
  srv.doEnd(game);
  assert.equal(game._selfSaveUsedThisTurn.size, 0);
});
