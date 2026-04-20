// Phase 5 Priority 8 (commit 1) — effect suppression infrastructure +
// negateEffect parser/agent. Cards aren't migrated yet; this locks the
// mechanics down so next commits can flip flags on real cards.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── Parser ──────────────────────────────────────────────────────────────

test('parser — "Negate the effect of up to N of …" emits suppressTarget effects', () => {
  const out = srv.parseAbility(
    "[Main] Negate the effect of up to 1 of your opponent's Leader or Character cards during this turn."
  );
  assert.deepEqual(out.unparsedSegments, []);
  assert.deepEqual(out.effects[0].effects, [
    { type: 'suppressTarget', kind: 'effects', max: 1, targetKind: 'leaderOrCharacter', duration: 'thisTurn' },
  ]);
});

test('parser — "characters effects are negated until opponent\'s next turn" → duration opponentNextTurn', () => {
  const out = srv.parseAbility(
    "[On Play] Up to one of your opponent's characters effects are negated until the end of your opponent's next turn."
  );
  assert.deepEqual(out.unparsedSegments, []);
  assert.deepEqual(out.effects[0].effects, [
    { type: 'suppressTarget', kind: 'effects', max: 1, targetKind: 'character', duration: 'opponentNextTurn' },
  ]);
});

// ─── Enforcement helpers ─────────────────────────────────────────────────

test('isEffectsSuppressed — true iff suppressions has { kind: "effects" }', () => {
  assert.equal(srv.isEffectsSuppressed(null), false);
  assert.equal(srv.isEffectsSuppressed({}), false);
  assert.equal(srv.isEffectsSuppressed({ suppressions: [] }), false);
  assert.equal(srv.isEffectsSuppressed({ suppressions: [{ kind: 'attack', expiresAtTurn: 5 }] }), false);
  assert.equal(srv.isEffectsSuppressed({ suppressions: [{ kind: 'effects', expiresAtTurn: 5 }] }), true);
});

// ─── Enforcement: triggerOnKO respects effects suppression ───────────────

test('triggerOnKO suppressed → onKO abilities do not fire', () => {
  const { p1, p2, game } = twoPlayerGame();
  const dam = { ...srv.CARD_DB.find(c => c.id === 'OP01-100'), uid: 'dam-supp',
    suppressions: [{ kind: 'effects', expiresAtTurn: game.turn + 5 }] };
  game.players[p2].trash.push(dam);
  const donDeckBefore = game.players[p2].donDeck;
  srv.triggerOnKO(game, p2, dam, p1);
  assert.equal(game.players[p2].donDeck, donDeckBefore,
    'suppressed card skips its onKO addDon');
});

// ─── Sequencer: suppressTarget opens a suppressionTargetWindow ───────────

test('suppressTarget effect opens suppressionTargetWindow with candidates from opponent side', () => {
  const { p1, p2, game } = twoPlayerGame();
  // Put a cost-3 opponent character on p2's field so the picker has a candidate.
  const victim = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'p2-v', rested: false, attachedDon: 0 };
  game.players[p2].field.push(victim);
  // Synthesise a driver card that will go through runPipeline with a
  // negateEffect block. We don't need a real CARD_DB entry — just a
  // parsed entry we can plant into PARSED_EFFECTS.
  const driver = { id: 'TEST-DRV-1', name: 'Test Driver', type: 'EVENT',
    useNewPipeline: true, uid: 'drv-1' };
  srv.PARSED_EFFECTS.set(driver.id, srv.parseAbility(
    "[Main] Negate the effect of up to 1 of your opponent's Characters during this turn."
  ));
  game.players[p1].trash.push(driver);

  srv.runPipeline('eventMain', game, p1, driver);
  assert.ok(game.suppressionTargetWindow, 'suppression window opened');
  assert.equal(game.suppressionTargetWindow.playerId, p1);
  assert.equal(game.suppressionTargetWindow.kind, 'effects');
  assert.equal(game.suppressionTargetWindow.targetKind, 'character');
  assert.equal(game.suppressionTargetWindow.duration, 'thisTurn');
  assert.deepEqual(game.suppressionTargetWindow.candidateUids, ['p2-v']);

  srv.PARSED_EFFECTS.delete(driver.id);
});

test('SUPPRESSION_TARGET_SELECTED pushes suppressions entry to picked target', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const victim = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'p2-v2', rested: false, attachedDon: 0 };
  game.players[p2].field.push(victim);
  const driver = { id: 'TEST-DRV-2', name: 'Test Driver 2', type: 'EVENT',
    useNewPipeline: true, uid: 'drv-2' };
  srv.PARSED_EFFECTS.set(driver.id, srv.parseAbility(
    "[Main] Negate the effect of up to 1 of your opponent's Characters during this turn."
  ));
  game.players[p1].trash.push(driver);

  srv.runPipeline('eventMain', game, p1, driver);
  assert.ok(game.suppressionTargetWindow);
  srv.handleAction(roomId, p1, { type: 'SUPPRESSION_TARGET_SELECTED', targetUid: 'p2-v2' });

  assert.equal(game.suppressionTargetWindow, null);
  const target = game.players[p2].field.find(c => c.uid === 'p2-v2');
  assert.ok(Array.isArray(target.suppressions));
  assert.equal(target.suppressions.length, 1);
  assert.equal(target.suppressions[0].kind, 'effects');

  srv.PARSED_EFFECTS.delete(driver.id);
});

// ─── Enforcement: pipeline respects post-selection suppression ──────────

test('after suppression applied, triggerOnKO on target skips its pipeline', () => {
  const { p1, p2, game } = twoPlayerGame();
  // Put a real pipelined card on p1's side and suppress it.
  const george = { ...srv.CARD_DB.find(c => c.id === 'OP01-079'),
    uid: 'g-supp', rested: false, attachedDon: 0,
    suppressions: [{ kind: 'effects', expiresAtTurn: game.turn + 1 }] };
  // George's onKO would normally open addFromTrash if leader matches.
  game.players[p1].trash.push(george);
  const originalHandLen = game.players[p1].hand.length;
  srv.triggerOnKO(game, p1, george, p2);
  // No addFromTrashWindow should have opened — suppressed.
  assert.ok(!game.addFromTrashWindow);
});
