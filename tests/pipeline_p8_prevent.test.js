// Phase 5 Priority 8 (commit 2) — attack prevention + blocker-ability
// suppression. Sarra the Wise (OP01-085) locks a picked opponent
// Character out of attacking until their next turn ends; Limejuice
// (OP09-014) prevents [Blocker] activation on a picked opponent with
// power ≤ 4000 for the rest of the turn.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── Parser ──────────────────────────────────────────────────────────────

test('parser — Sarra compound "select + cannot attack" → suppressTarget(attack)', () => {
  const out = srv.parseAbility(
    "[On Play] If your Leader has the {Duchess of Brittany} type, select up to 1 of your opponent's Characters with a cost of 4 or less. The selected Character cannot attack until the end of your opponent's next turn."
  );
  assert.deepEqual(out.unparsedSegments, []);
  assert.equal(out.effects.length, 1);
  const block = out.effects[0];
  assert.equal(block.timing, 'onPlay');
  assert.deepEqual(block.conditions,
    [{ type: 'leaderType', value: 'Duchess of Brittany' }]);
  assert.equal(block.optional, true, '"up to" phrase collapses into placeholder → still optional');
  assert.deepEqual(block.effects, [
    { type: 'suppressTarget', kind: 'attack', max: 1, targetKind: 'character',
      filter: { maxCost: 4 }, duration: 'opponentNextTurn' },
  ]);
});

test('parser — Limejuice "cannot activate [Blocker]" → suppressTarget(blockerAbility)', () => {
  const out = srv.parseAbility(
    "[On Play] Up to one of your opponents characters with power 4000 or less cannot activate [Blocker] the rest of this turn."
  );
  assert.deepEqual(out.unparsedSegments, []);
  // The inline [Blocker] must NOT be harvested as a Limejuice keyword.
  assert.ok(!out.keywords.includes('blocker'),
    'inline [Blocker] inside "cannot activate" is not a keyword on this card');
  assert.equal(out.effects.length, 1);
  assert.deepEqual(out.effects[0].effects, [
    { type: 'suppressTarget', kind: 'blockerAbility', max: 1, targetKind: 'character',
      filter: { maxPower: 4000 }, duration: 'thisTurn' },
  ]);
});

// ─── Card flags ──────────────────────────────────────────────────────────

test('Sarra the Wise (OP01-085) flag + fully parsed', () => {
  const c = srv.CARD_DB.find(c => c.id === 'OP01-085');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('OP01-085');
  assert.deepEqual(p.unparsedSegments, []);
});

test('Limejuice (OP09-014) flag + fully parsed', () => {
  const c = srv.CARD_DB.find(c => c.id === 'OP09-014');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('OP09-014');
  assert.deepEqual(p.unparsedSegments, []);
});

// ─── Sarra onPlay — rest-target semantics (updated from attack suppression) ───

test('Sarra onPlay opens restTargetWindow with cost-filtered candidates', () => {
  const { p1, p2, game } = twoPlayerGame();
  // Leader on p1 side is Anna of Brittany (Duchess of Brittany) by default.
  const smallOpp = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'opp-cost3', rested: false, attachedDon: 0 };  // cost-3 Shawn
  const bigOpp = { ...srv.CARD_DB.find(c => c.id === 'OP01-094'),
    uid: 'opp-cost10', rested: false, attachedDon: 0 };  // cost-10 Jack
  game.players[p2].field.push(smallOpp, bigOpp);

  const sarra = { ...srv.CARD_DB.find(c => c.id === 'OP01-085'), uid: 'sarra-1' };
  game.players[p1].field.push(sarra);
  srv.runPipeline('onPlay', game, p1, sarra);

  assert.ok(game.restTargetWindow, 'rest target window opened');
  assert.deepEqual(game.restTargetWindow.candidateUids, ['opp-cost3'],
    'cost-4 filter excludes the cost-10 character');
});

test('Sarra with non-Duchess leader: leaderType condition fails → no window', () => {
  const { p1, p2, game } = twoPlayerGame();
  // Overwrite p1 leader to a non-Duchess affiliation so the condition fails.
  game.players[p1].leader = { ...srv.CARD_DB.find(c => c.id === 'ST04-001'),
    uid: 'leader-nondoc' };
  const opp = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'opp-x', rested: false, attachedDon: 0 };
  game.players[p2].field.push(opp);

  const sarra = { ...srv.CARD_DB.find(c => c.id === 'OP01-085'), uid: 'sarra-2' };
  game.players[p1].field.push(sarra);
  srv.runPipeline('onPlay', game, p1, sarra);

  assert.ok(!game.restTargetWindow, 'no window when leaderType condition unmet');
});

test('REST_TARGET_SELECTED rests the picked opponent character', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const opp = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'opp-att', rested: false, attachedDon: 0 };
  game.players[p2].field.push(opp);
  const sarra = { ...srv.CARD_DB.find(c => c.id === 'OP01-085'), uid: 'sarra-3' };
  game.players[p1].field.push(sarra);

  srv.runPipeline('onPlay', game, p1, sarra);
  assert.ok(game.restTargetWindow);
  srv.handleAction(roomId, p1, { type: 'REST_TARGET_SELECTED', targetUid: 'opp-att' });
  assert.equal(game.restTargetWindow, null);

  const t = game.players[p2].field.find(c => c.uid === 'opp-att');
  assert.equal(t.rested, true, 'target is rested');
});

// ─── Limejuice onPlay — blocker suppression end-to-end ───────────────────

test('Limejuice onPlay opens suppressionTargetWindow (blockerAbility) with power filter', () => {
  const { p1, p2, game } = twoPlayerGame();
  const small = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'opp-low', rested: false, attachedDon: 0, power: 4000 };
  const big = { ...srv.CARD_DB.find(c => c.id === 'OP01-094'),
    uid: 'opp-high', rested: false, attachedDon: 0, power: 12000 };
  game.players[p2].field.push(small, big);

  const lime = { ...srv.CARD_DB.find(c => c.id === 'OP09-014'), uid: 'lime-1' };
  game.players[p1].field.push(lime);
  srv.runPipeline('onPlay', game, p1, lime);

  assert.ok(game.suppressionTargetWindow, 'window opened');
  assert.equal(game.suppressionTargetWindow.kind, 'blockerAbility');
  assert.equal(game.suppressionTargetWindow.duration, 'thisTurn');
  assert.deepEqual(game.suppressionTargetWindow.candidateUids, ['opp-low'],
    'power 4000 filter excludes the 12k character');
});

test('SUPPRESSION_TARGET_SELECTED (blockerAbility) → USE_BLOCKER refused for picked target', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  // Put a [Blocker] character on p2 field — George the Brave (OP01-079) has [Blocker].
  const blocker = { ...srv.CARD_DB.find(c => c.id === 'OP01-079'),
    uid: 'opp-blocker', rested: false, attachedDon: 0 };
  game.players[p2].field.push(blocker);
  const lime = { ...srv.CARD_DB.find(c => c.id === 'OP09-014'), uid: 'lime-2' };
  game.players[p1].field.push(lime);

  srv.runPipeline('onPlay', game, p1, lime);
  assert.ok(game.suppressionTargetWindow);
  assert.ok(game.suppressionTargetWindow.candidateUids.includes('opp-blocker'));
  srv.handleAction(roomId, p1, { type: 'SUPPRESSION_TARGET_SELECTED', targetUid: 'opp-blocker' });

  const t = game.players[p2].field.find(c => c.uid === 'opp-blocker');
  assert.equal(t.suppressions[0].kind, 'blockerAbility');

  // Simulate p1 attacking p2 leader; p2 tries to USE_BLOCKER with the
  // suppressed blocker — must be refused.
  const attacker = { ...srv.CARD_DB.find(c => c.id === 'OP01-077'),
    uid: 'p1-att', rested: false, attachedDon: 0, playedThisTurn: false };
  game.players[p1].field.push(attacker);
  game.activePlayer = p1;
  game.phase = 'MAIN';
  game.turn = 2;
  srv.handleAction(roomId, p1, {
    type: 'DECLARE_ATTACK', attackerUid: 'p1-att', targetUid: game.players[p2].leader.uid,
  });
  assert.ok(game.battleState, 'attack opened');
  srv.handleAction(roomId, p2, { type: 'USE_BLOCKER', blockerUid: 'opp-blocker' });
  // Blocker is suppressed → battleState.targetUid should NOT have changed
  // to the blocker (i.e. defender still the leader).
  assert.notEqual(game.battleState.targetUid, 'opp-blocker',
    'suppressed blocker ignored; leader remains the target');
});
