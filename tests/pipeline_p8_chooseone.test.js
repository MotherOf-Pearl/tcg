// Phase 5 Priority 8 (commit 3) — "Choose one:" branching. Doflamingo
// (OP14-069) is the only active card using this format today; the
// parser + agent + window + CHOOSE_ONE_SELECTED handler covered here
// are the generic machinery for any future "Choose one" card.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── Parser ──────────────────────────────────────────────────────────────

test('parser emits chooseOne with per-branch conditions + effects', () => {
  const out = srv.parseAbility(
    "[On Play] DON!! -3: Choose one: \u2022 If your Leader has the {Donquixote Pirates} type, K.O. up to 1 of your opponent's Characters with a cost of 8 or less. \u2022 Rest up to 3 of your opponent's Characters with a cost of 7 or less."
  );
  assert.deepEqual(out.unparsedSegments, []);
  const block = out.effects[0];
  assert.equal(block.timing, 'onPlay');
  assert.deepEqual(block.costs, [{ type: 'returnDon', count: 3 }]);
  // Outer block has NO leaderType — that condition belongs to branch 0.
  assert.deepEqual(block.conditions, []);
  assert.equal(block.effects.length, 1);
  const ch = block.effects[0];
  assert.equal(ch.type, 'chooseOne');
  assert.equal(ch.branches.length, 2);
  assert.deepEqual(ch.branches[0].conditions,
    [{ type: 'leaderType', value: 'Donquixote Pirates' }]);
  assert.deepEqual(ch.branches[0].effects,
    [{ type: 'koTarget', max: 1, filter: { maxCost: 8, opponent: true } }]);
  assert.deepEqual(ch.branches[1].conditions, []);
  assert.deepEqual(ch.branches[1].effects,
    [{ type: 'restTarget', max: 3, filter: { opponent: true, maxCost: 7 } }]);
});

// ─── Card flag ───────────────────────────────────────────────────────────

test('Doflamingo OP14-069 flag + fully parsed', () => {
  const c = srv.CARD_DB.find(c => c.id === 'OP14-069');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('OP14-069');
  assert.deepEqual(p.unparsedSegments, []);
});

// ─── Sequencer: chooseOne opens window with branch availability ─────────

test('chooseOne opens chooseOneWindow; branch[0] available only when leader matches', () => {
  const { p1, p2, game } = twoPlayerGame();
  // Give p1 a Donquixote Pirates leader affiliation so branch 0 is eligible.
  game.players[p1].leader.affiliation = 'Donquixote Pirates';
  game.players[p1].donActive = 5;  // plenty for DON!! -3 cost.
  // Opponent character eligible for either branch.
  const opp = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'opp-dof', rested: false, attachedDon: 0 };
  game.players[p2].field.push(opp);

  const dof = { ...srv.CARD_DB.find(c => c.id === 'OP14-069'), uid: 'dof-1' };
  game.players[p1].field.push(dof);
  srv.runPipeline('onPlay', game, p1, dof);

  // DON!! -3 cost opens donReturnWindow first.
  assert.ok(game.donReturnWindow, 'DON cost window opened first');
  srv.handleAction('TESTROOM', p1, {
    type: 'RETURN_DON',
    selections: { fromActive: 3, fromRested: 0, fromCards: [] },
  });
  assert.equal(game.donReturnWindow, null);

  assert.ok(game.chooseOneWindow, 'chooseOneWindow opened after cost paid');
  assert.equal(game.chooseOneWindow.branches.length, 2);
  assert.equal(game.chooseOneWindow.branches[0].available, true);
  assert.equal(game.chooseOneWindow.branches[1].available, true);
});

test('chooseOne branch[0] disabled when leader condition fails', () => {
  const { p1, p2, game } = twoPlayerGame();
  // Leave p1 leader as Anna of Brittany (not Donquixote Pirates).
  game.players[p1].donActive = 5;
  const opp = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'opp-dof2', rested: false, attachedDon: 0 };
  game.players[p2].field.push(opp);
  const dof = { ...srv.CARD_DB.find(c => c.id === 'OP14-069'), uid: 'dof-2' };
  game.players[p1].field.push(dof);
  srv.runPipeline('onPlay', game, p1, dof);
  srv.handleAction('TESTROOM', p1, {
    type: 'RETURN_DON',
    selections: { fromActive: 3, fromRested: 0, fromCards: [] },
  });
  assert.ok(game.chooseOneWindow);
  assert.equal(game.chooseOneWindow.branches[0].available, false,
    'leaderType condition failed — K.O. branch unavailable');
  assert.equal(game.chooseOneWindow.branches[1].available, true);
});

// ─── Branch resolution: KO branch ────────────────────────────────────────

test('CHOOSE_ONE_SELECTED branch[0] runs koTarget with cost filter', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.players[p1].leader.affiliation = 'Donquixote Pirates';
  game.players[p1].donActive = 5;
  // Both cost-3 (eligible) and cost-10 (excluded by ≤8 filter) opponents.
  const small = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'opp-small', rested: false, attachedDon: 0 };
  const big = { ...srv.CARD_DB.find(c => c.id === 'OP01-094'),
    uid: 'opp-big', rested: false, attachedDon: 0 };
  game.players[p2].field.push(small, big);

  const dof = { ...srv.CARD_DB.find(c => c.id === 'OP14-069'), uid: 'dof-3' };
  game.players[p1].field.push(dof);
  srv.runPipeline('onPlay', game, p1, dof);
  srv.handleAction(roomId, p1, {
    type: 'RETURN_DON',
    selections: { fromActive: 3, fromRested: 0, fromCards: [] },
  });
  assert.ok(game.chooseOneWindow);

  srv.handleAction(roomId, p1, { type: 'CHOOSE_ONE_SELECTED', branchIndex: 0 });
  assert.equal(game.chooseOneWindow, null);

  assert.ok(game.koTargetWindow, 'branch[0] opened koTargetWindow');
  assert.ok(game.koTargetWindow.candidateUids.includes('opp-small'));
  assert.ok(!game.koTargetWindow.candidateUids.includes('opp-big'),
    'cost-10 excluded by ≤8 filter');
});

// ─── Branch resolution: Rest branch ──────────────────────────────────────

test('CHOOSE_ONE_SELECTED branch[1] runs restTarget with cost filter', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  // Non-Donquixote leader — only branch 1 should be picked.
  game.players[p1].donActive = 5;
  const opp = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'opp-rest', rested: false, attachedDon: 0 };
  game.players[p2].field.push(opp);

  const dof = { ...srv.CARD_DB.find(c => c.id === 'OP14-069'), uid: 'dof-4' };
  game.players[p1].field.push(dof);
  srv.runPipeline('onPlay', game, p1, dof);
  srv.handleAction(roomId, p1, {
    type: 'RETURN_DON',
    selections: { fromActive: 3, fromRested: 0, fromCards: [] },
  });
  assert.ok(game.chooseOneWindow);

  srv.handleAction(roomId, p1, { type: 'CHOOSE_ONE_SELECTED', branchIndex: 1 });
  assert.equal(game.chooseOneWindow, null);
  assert.ok(game.restTargetWindow, 'branch[1] opened restTargetWindow');
  assert.ok(game.restTargetWindow.candidateUids.includes('opp-rest'));
});

test('CHOOSE_ONE_SELECTED rejects a branch whose condition is unmet', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  // Non-Donquixote leader → branch[0] unavailable.
  game.players[p1].donActive = 5;
  const opp = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'opp-z', rested: false, attachedDon: 0 };
  game.players[p2].field.push(opp);

  const dof = { ...srv.CARD_DB.find(c => c.id === 'OP14-069'), uid: 'dof-5' };
  game.players[p1].field.push(dof);
  srv.runPipeline('onPlay', game, p1, dof);
  srv.handleAction(roomId, p1, {
    type: 'RETURN_DON',
    selections: { fromActive: 3, fromRested: 0, fromCards: [] },
  });
  assert.ok(game.chooseOneWindow);
  srv.handleAction(roomId, p1, { type: 'CHOOSE_ONE_SELECTED', branchIndex: 0 });
  // Branch 0 refused — window should still be open.
  assert.ok(game.chooseOneWindow, 'window stays open on invalid branch pick');
  assert.ok(!game.koTargetWindow, 'K.O. branch effect did NOT fire');
});
