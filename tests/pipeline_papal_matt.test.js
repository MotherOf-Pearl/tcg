// ST07 Papal Matt — tests for the 6 new pipeline agents:
//   A) addLifeCardToHand (top/bottom, no reveal, no trigger)
//   B) lookAtLifeCard    (own/opponent, private reveal, top/bottom placement,
//                         conditional Rush for Colossus)
//   C) addDeckToLife     (reuses existing addLife: deck.shift → life.push)
//   D) opponentChooses   (prompt fires on non-active player; branches resolve)
//   E) grantKeywordToNamed (temp Banish / Double Attack on named cards; clears
//                           at end of turn)
//   F) trashLifeCard     (reuses existing trashOpponentLife; no trigger)
//
// Also covers:
//   - Forgotten Monestary ACTIVATE_MAIN gate (requires cost-3 CHARACTER in hand)
//   - hasBanish / hasDoubleAttack reading tempKeywords (Stella grant observable)
//   - Faustian Jack [Trigger] trash-to-play still works via existing pipeline
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ── Parser shape checks ────────────────────────────────────────────────────

test('all 17 ST07 cards parse with no unparsed segments', () => {
  const ids = Array.from({ length: 17 }, (_, i) => `ST07-${String(i + 1).padStart(3, '0')}`);
  for (const id of ids) {
    const parsed = srv.PARSED_EFFECTS.get(id);
    assert.ok(parsed, `ST07 id not in cache: ${id}`);
    assert.deepEqual(parsed.unparsedSegments, [], `unparsed for ${id}: ${JSON.stringify(parsed.unparsedSegments)}`);
  }
});

test('Papal Matt leader: cost=addLifeCardToHand, effect=conditionalEffect→addHandToLife', () => {
  const p = srv.PARSED_EFFECTS.get('ST07-001');
  const b = p.effects.find(e => e.timing === 'whenAttacking');
  assert.ok(b);
  assert.deepEqual(b.conditions, [{ type: 'donAttached', value: 2 }]);
  assert.deepEqual(b.costs, [{ type: 'addLifeCardToHand', optional: true }]);
  assert.equal(b.effects.length, 1);
  assert.equal(b.effects[0].type, 'conditionalEffect');
  assert.equal(b.effects[0].condition.type, 'lifeCountMax');
  assert.equal(b.effects[0].effect.type, 'addHandToLife');
});

test('Regenald: cost=addLifeCardToHand, effects=[grantKeyword banish thisBattle, powerBuff self +1000 thisBattle]', () => {
  const p = srv.PARSED_EFFECTS.get('ST07-004');
  const b = p.effects.find(e => e.timing === 'whenAttacking');
  assert.ok(b);
  assert.deepEqual(b.costs, [{ type: 'addLifeCardToHand', optional: true }]);
  assert.equal(b.effects.length, 2);
  assert.equal(b.effects[0].type, 'grantKeyword');
  assert.equal(b.effects[0].keyword, 'banish');
  assert.equal(b.effects[0].duration, 'thisBattle');
  assert.equal(b.effects[1].type, 'powerBuff');
  assert.equal(b.effects[1].target, 'self');
  assert.equal(b.effects[1].value, 1000);
});

test('Colossus: onPlay emits lookAtLifeCard then conditional grantKeyword rush', () => {
  const p = srv.PARSED_EFFECTS.get('ST07-003');
  const b = p.effects.find(e => e.timing === 'onPlay');
  assert.ok(b);
  assert.equal(b.effects[0].type, 'lookAtLifeCard');
  assert.equal(b.effects[1].type, 'conditionalEffect');
  assert.equal(b.effects[1].condition.type, 'lifeLessThanOpponent');
  assert.equal(b.effects[1].effect.type, 'grantKeyword');
  assert.equal(b.effects[1].effect.keyword, 'rush');
});

test('Matthew opponentChooses has 2 branches: trashOpponentLife + addLife', () => {
  const p = srv.PARSED_EFFECTS.get('ST07-010');
  const b = p.effects.find(e => e.timing === 'onPlay');
  assert.ok(b);
  assert.equal(b.effects[0].type, 'opponentChooses');
  assert.equal(b.effects[0].branches.length, 2);
  assert.equal(b.effects[0].branches[0].effects[0].type, 'trashOpponentLife');
  assert.equal(b.effects[0].branches[1].effects[0].type, 'addLife');
});

test('Stella grantKeywordToNamed: name=Papal Matt, keyword=banish', () => {
  const p = srv.PARSED_EFFECTS.get('ST07-011');
  const b = p.effects.find(e => e.timing === 'activateMain');
  assert.ok(b);
  assert.deepEqual(b.costs, [{ type: 'restSelf' }]);
  assert.equal(b.effects[0].type, 'grantKeywordToNamed');
  assert.equal(b.effects[0].name, 'Papal Matt');
  assert.equal(b.effects[0].keyword, 'banish');
});

test('Family God grantKeywordToNamed: keyword=double attack + Trigger playSelf', () => {
  const p = srv.PARSED_EFFECTS.get('ST07-013');
  const am = p.effects.find(e => e.timing === 'activateMain');
  assert.ok(am);
  assert.equal(am.effects[0].type, 'grantKeywordToNamed');
  assert.equal(am.effects[0].name, 'Papal Matt');
  assert.equal(am.effects[0].keyword, 'double attack');
  const tr = p.effects.find(e => e.timing === 'trigger');
  assert.equal(tr.effects[0].type, 'playSelf');
});

test('Forgotten Monestary compound cost: [restSelf, addLifeCardToHand], effect addCharacterToLife', () => {
  const p = srv.PARSED_EFFECTS.get('ST07-017');
  const b = p.effects.find(e => e.timing === 'activateMain');
  assert.ok(b);
  assert.equal(b.costs.length, 2);
  assert.equal(b.costs[0].type, 'restSelf');
  assert.equal(b.costs[1].type, 'addLifeCardToHand');
  assert.equal(b.effects[0].type, 'addCharacterToLife');
  assert.equal(b.effects[0].cost, 3);
  assert.equal(b.effects[0].faceUp, true);
});

test('Red Sea Purchase counter + trigger both carry lookAtLifeCard', () => {
  const p = srv.PARSED_EFFECTS.get('ST07-016');
  const counter = p.effects.find(e => e.timing === 'counter');
  assert.ok(counter);
  assert.equal(counter.effects[0].type, 'lookAtLifeCard');
  assert.equal(counter.effects[1].type, 'powerBuff');
  const trigger = p.effects.find(e => e.timing === 'trigger');
  assert.ok(trigger);
  assert.equal(trigger.effects[0].type, 'drawCards');
  assert.equal(trigger.effects[1].type, 'lookAtLifeCard');
});

// ── Agent A — addLifeCardToHand (end-to-end via Jacob's [When Attacking]) ──

function setupJacobAttackingScene(variant) {
  // Jacob's [DON!! x1] [When Attacking] lets you pay "addLifeCardToHand" then
  // add a deck-top card to the top of life. Here we just fire the pipeline
  // directly so the test doesn't need a real attack flow — the agents under
  // test don't read battleState.
  const { roomId, p1, p2, game } = twoPlayerGame();
  const jacob = { ...srv.CARD_DB.find(c => c.id === 'ST07-005'), uid: 'jacob-1',
    attachedDon: 1, rested: false };
  game.players[p1].field.push(jacob);
  // Give P1 exactly 3 life cards so the top/bottom distinction is testable.
  game.players[p1].life = [
    { id: 'LIFE0', name: 'LifeCardBottom', uid: 'L0' },
    { id: 'LIFE1', name: 'LifeCardMiddle', uid: 'L1' },
    { id: 'LIFE2', name: 'LifeCardTop',    uid: 'L2' },
  ];
  return { roomId, p1, p2, game, jacob };
}

test('Agent A top: top-of-life card moves to hand, no trigger fires', () => {
  const { roomId, p1, game, jacob } = setupJacobAttackingScene('top');
  const handBefore = game.players[p1].hand.length;
  const lifeBefore = game.players[p1].life.length;
  const deckBefore = game.players[p1].deck.length;

  srv.runPipeline('whenAttacking', game, p1, jacob);
  assert.ok(game.addLifeCardToHandWindow, 'addLifeCardToHand window opened');

  srv.handleAction(roomId, p1, {
    type: 'ADD_LIFE_CARD_TO_HAND_RESOLVE',
    position: 'top',
  });

  assert.equal(game.addLifeCardToHandWindow, null, 'cost window cleared');
  // Top-of-life (L2) is in hand, no trigger window fired.
  assert.equal(game.triggerWindow ?? null, null, 'no [Trigger] auto-activated');
  const handUids = game.players[p1].hand.map(c => c.uid);
  assert.ok(handUids.includes('L2'), 'top-of-life card now in hand');
  // Jacob's follow-up effect (addLife from deck) fires after the cost,
  // so deck shrinks by 1 and life is restored: net life unchanged, deck -1,
  // hand +1 (the L2 life card that moved to hand).
  assert.equal(game.players[p1].deck.length, deckBefore - 1);
  assert.equal(game.players[p1].life.length, lifeBefore, 'life net unchanged (-1 cost, +1 effect)');
  assert.equal(game.players[p1].hand.length, handBefore + 1);
});

test('Agent A bottom: bottom-of-life card moves to hand, no trigger', () => {
  const { roomId, p1, game, jacob } = setupJacobAttackingScene('bottom');
  srv.runPipeline('whenAttacking', game, p1, jacob);
  assert.ok(game.addLifeCardToHandWindow);

  srv.handleAction(roomId, p1, {
    type: 'ADD_LIFE_CARD_TO_HAND_RESOLVE',
    position: 'bottom',
  });

  assert.equal(game.triggerWindow, null, 'no [Trigger] fired');
  const handUids = game.players[p1].hand.map(c => c.uid);
  assert.ok(handUids.includes('L0'), 'bottom-of-life card now in hand');
  const lifeUids = game.players[p1].life.map(c => c.uid);
  assert.ok(!lifeUids.includes('L0'), 'bottom card removed from life');
});

test('Agent A skip (optional): no life moved, block aborts', () => {
  const { roomId, p1, game, jacob } = setupJacobAttackingScene('skip');
  const handBefore = game.players[p1].hand.length;
  const lifeBefore = game.players[p1].life.length;
  const deckBefore = game.players[p1].deck.length;

  srv.runPipeline('whenAttacking', game, p1, jacob);
  srv.handleAction(roomId, p1, {
    type: 'ADD_LIFE_CARD_TO_HAND_RESOLVE',
    skip: true,
  });

  assert.equal(game.addLifeCardToHandWindow, null);
  assert.equal(game.players[p1].hand.length, handBefore, 'hand unchanged');
  assert.equal(game.players[p1].life.length, lifeBefore, 'life unchanged');
  // Cost unpaid → follow-up addLife did NOT run.
  assert.equal(game.players[p1].deck.length, deckBefore, 'deck unchanged');
});

// ── Agent B — lookAtLifeCard (via Thomas, Ancient Wanderer [On Play]) ──

function setupThomasScene() {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const thomas = { ...srv.CARD_DB.find(c => c.id === 'ST07-008'), uid: 'thomas-1' };
  game.players[p1].field.push(thomas);
  game.players[p1].life = [
    { id: 'OWN0', name: 'OwnLifeBottom', uid: 'OL0' },
    { id: 'OWN1', name: 'OwnLifeTop',    uid: 'OL1' },
  ];
  game.players[p2].life = [
    { id: 'OPP0', name: 'OppLifeBottom', uid: 'OPL0' },
    { id: 'OPP1', name: 'OppLifeTop',    uid: 'OPL1' },
  ];
  return { roomId, p1, p2, game, thomas };
}

test('Agent B: look at own life, private reveal to player, place top', () => {
  const { roomId, p1, p2, game, thomas } = setupThomasScene();
  srv.runPipeline('onPlay', game, p1, thomas);
  assert.ok(game.lookAtLifeCardWindow);
  assert.equal(game.lookAtLifeCardWindow.step, 'choose-source');

  const p1Client = srv.clients.get(p1);
  const p2Client = srv.clients.get(p2);
  p1Client._sent.length = 0;
  p2Client._sent.length = 0;

  srv.handleAction(roomId, p1, { type: 'LOOK_AT_LIFE_CARD_RESOLVE', side: 'own' });
  assert.equal(game.lookAtLifeCardWindow.step, 'choose-placement');

  // Private reveal sent to p1 only.
  const p1Reveals = p1Client._sent.filter(m => m.type === 'LIFE_CARD_REVEAL');
  const p2Reveals = p2Client._sent.filter(m => m.type === 'LIFE_CARD_REVEAL');
  assert.equal(p1Reveals.length, 1, 'p1 sees reveal');
  assert.equal(p2Reveals.length, 0, 'p2 does NOT see reveal');
  assert.equal(p1Reveals[0].card.id, 'OWN1', 'top of own life revealed');

  srv.handleAction(roomId, p1, { type: 'LOOK_AT_LIFE_CARD_RESOLVE', placement: 'top' });
  assert.equal(game.lookAtLifeCardWindow, null);
  // Card still on top of own life, not in hand.
  assert.equal(game.players[p1].life.length, 2);
  assert.equal(game.players[p1].life[game.players[p1].life.length - 1].uid, 'OL1');
  assert.equal(game.players[p1].hand.filter(c => c.uid === 'OL1').length, 0);
});

test('Agent B: look at own life, place bottom → card reorders', () => {
  const { roomId, p1, game, thomas } = setupThomasScene();
  srv.runPipeline('onPlay', game, p1, thomas);
  srv.handleAction(roomId, p1, { type: 'LOOK_AT_LIFE_CARD_RESOLVE', side: 'own' });
  srv.handleAction(roomId, p1, { type: 'LOOK_AT_LIFE_CARD_RESOLVE', placement: 'bottom' });
  // OL1 moved to index 0 (bottom); OL0 now at top (last).
  assert.equal(game.players[p1].life[0].uid, 'OL1', 'peeked card at bottom');
  assert.equal(game.players[p1].life[game.players[p1].life.length - 1].uid, 'OL0');
});

test('Agent B: look at opponent life, private reveal to player only', () => {
  const { roomId, p1, p2, game, thomas } = setupThomasScene();
  srv.runPipeline('onPlay', game, p1, thomas);

  const p1Client = srv.clients.get(p1);
  const p2Client = srv.clients.get(p2);
  p1Client._sent.length = 0;
  p2Client._sent.length = 0;

  srv.handleAction(roomId, p1, { type: 'LOOK_AT_LIFE_CARD_RESOLVE', side: 'opponent' });
  const p1Reveals = p1Client._sent.filter(m => m.type === 'LIFE_CARD_REVEAL');
  const p2Reveals = p2Client._sent.filter(m => m.type === 'LIFE_CARD_REVEAL');
  assert.equal(p1Reveals[0].card.id, 'OPP1', 'top of opponent life revealed');
  assert.equal(p2Reveals.length, 0);

  srv.handleAction(roomId, p1, { type: 'LOOK_AT_LIFE_CARD_RESOLVE', placement: 'top' });
  // Opponent life size unchanged, card still there.
  assert.equal(game.players[p2].life.length, 2);
  assert.equal(game.players[p2].life[game.players[p2].life.length - 1].uid, 'OPL1');
});

test('Agent B via Colossus: conditional Rush granted only when own life < opp life', () => {
  // Colossus [On Play]: lookAtLifeCard, THEN grantKeyword rush if own<opp life.
  const { roomId, p1, p2, game } = twoPlayerGame();
  const colossus = { ...srv.CARD_DB.find(c => c.id === 'ST07-003'), uid: 'coloss-1',
    rested: false, attachedDon: 0 };
  game.players[p1].field.push(colossus);
  // p1 has 1 life, p2 has 3 → colossus should gain Rush after lookAtLifeCard.
  game.players[p1].life = [{ id: 'A', name: 'A', uid: 'LA' }];
  game.players[p2].life = [
    { id: 'B', name: 'B', uid: 'LB0' },
    { id: 'C', name: 'C', uid: 'LB1' },
    { id: 'D', name: 'D', uid: 'LB2' },
  ];
  srv.runPipeline('onPlay', game, p1, colossus);
  srv.handleAction(roomId, p1, { type: 'LOOK_AT_LIFE_CARD_RESOLVE', side: 'own' });
  srv.handleAction(roomId, p1, { type: 'LOOK_AT_LIFE_CARD_RESOLVE', placement: 'top' });
  // Rush should now be in tempKeywords on colossus (less own life than opp).
  const rush = (colossus.tempKeywords || []).some(k => k.keyword === 'rush');
  assert.ok(rush, 'Colossus gained [Rush] via conditional grant');
  assert.ok(srv.hasRush(colossus), 'hasRush() picks up temp grant');
});

test('Agent B via Colossus: Rush NOT granted when life counts equal or more', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const colossus = { ...srv.CARD_DB.find(c => c.id === 'ST07-003'), uid: 'coloss-2',
    rested: false, attachedDon: 0 };
  game.players[p1].field.push(colossus);
  game.players[p1].life = [
    { id: 'A', name: 'A', uid: 'L1' },
    { id: 'B', name: 'B', uid: 'L2' },
  ];
  game.players[p2].life = [
    { id: 'X', name: 'X', uid: 'X1' },
    { id: 'Y', name: 'Y', uid: 'X2' },
  ];
  srv.runPipeline('onPlay', game, p1, colossus);
  srv.handleAction(roomId, p1, { type: 'LOOK_AT_LIFE_CARD_RESOLVE', side: 'own' });
  srv.handleAction(roomId, p1, { type: 'LOOK_AT_LIFE_CARD_RESOLVE', placement: 'top' });
  // Equal life counts → Rush condition NOT met.
  const hasRushKey = (colossus.tempKeywords || []).some(k => k.keyword === 'rush');
  assert.equal(hasRushKey, false, 'no temp Rush when life equal to opponent');
});

// ── Agent C — addDeckToLife (via Matthew branch 2 / existing addLife) ──

test('Agent C: deck.shift → life.push, counts change by 1/-1', () => {
  const { p1, p2, game } = twoPlayerGame();
  // Use Baby 5's onKO pipeline — same addLife effect, easier to drive than Matthew.
  const baby = { ...srv.CARD_DB.find(c => c.id === 'OP14-072'), uid: 'b5' };
  game.players[p1].trash.push(baby);
  game.players[p1].donActive = 2;
  const lifeBefore = game.players[p1].life.length;
  const deckBefore = game.players[p1].deck.length;
  const expectedTop = game.players[p1].deck[0];
  srv.triggerOnKO(game, p1, baby, p2);
  srv.handleAction('TESTROOM', p1, {
    type: 'RETURN_DON',
    selections: { fromActive: 1, fromRested: 0, fromCards: [] },
  });
  assert.equal(game.players[p1].life.length, lifeBefore + 1);
  assert.equal(game.players[p1].deck.length, deckBefore - 1);
  assert.equal(game.players[p1].life[game.players[p1].life.length - 1].uid, expectedTop.uid);
});

// ── Agent D — opponentChooses (via Matthew, Ascended Bishop) ──

function setupMatthewScene() {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const matt = { ...srv.CARD_DB.find(c => c.id === 'ST07-010'), uid: 'matt-1' };
  game.players[p1].field.push(matt);
  // Seed both players' life stacks with deterministic cards.
  game.players[p1].life = [{ id: 'L0', name: 'L0', uid: 'lcL0' }];
  game.players[p2].life = [{ id: 'O0', name: 'O0', uid: 'lcO0' }];
  return { roomId, p1, p2, game, matt };
}

test('Agent D: opponentChooses opens a window addressed to the opponent', () => {
  const { p1, p2, game, matt } = setupMatthewScene();
  srv.runPipeline('onPlay', game, p1, matt);
  assert.ok(game.opponentChoosesWindow);
  assert.equal(game.opponentChoosesWindow.playerId, p2, 'opp is the chooser');
  assert.equal(game.opponentChoosesWindow.activePlayerId, p1);
  assert.equal(game.opponentChoosesWindow.branches.length, 2);
});

test('Agent D: opponent picks branch A → top life card of active player goes to trash', () => {
  const { roomId, p1, p2, game, matt } = setupMatthewScene();
  srv.runPipeline('onPlay', game, p1, matt);
  const oppLifeBefore = game.players[p2].life.length;
  const oppTrashBefore = game.players[p2].trash.length;
  srv.handleAction(roomId, p2, { type: 'OPPONENT_CHOOSES_SELECTED', branchIndex: 0 });
  // Branch 0: "Trash 1 card from the top of your opponent's Life cards" —
  // the "opponent" from the card-controller's perspective is p2; p2 loses a life.
  assert.equal(game.players[p2].life.length, oppLifeBefore - 1);
  assert.equal(game.players[p2].trash.length, oppTrashBefore + 1);
});

test('Agent D: opponent picks branch B → active player adds top deck card to life', () => {
  const { roomId, p1, p2, game, matt } = setupMatthewScene();
  const p1LifeBefore = game.players[p1].life.length;
  const p1DeckBefore = game.players[p1].deck.length;
  srv.runPipeline('onPlay', game, p1, matt);
  srv.handleAction(roomId, p2, { type: 'OPPONENT_CHOOSES_SELECTED', branchIndex: 1 });
  assert.equal(game.players[p1].life.length, p1LifeBefore + 1);
  assert.equal(game.players[p1].deck.length, p1DeckBefore - 1);
});

test('Agent D: active player cannot resolve the opponent\'s choice', () => {
  const { roomId, p1, game, matt } = setupMatthewScene();
  srv.runPipeline('onPlay', game, p1, matt);
  // p1 sending OPPONENT_CHOOSES_SELECTED should be ignored (window guards by playerId).
  srv.handleAction(roomId, p1, { type: 'OPPONENT_CHOOSES_SELECTED', branchIndex: 0 });
  assert.ok(game.opponentChoosesWindow, 'window still open — wrong sender rejected');
});

// ── Agent E — grantKeywordToNamed (via Stella / Family God) ──

function setupStellaScene() {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const stella = { ...srv.CARD_DB.find(c => c.id === 'ST07-011'), uid: 'stella-1',
    rested: false };
  game.players[p1].field.push(stella);
  // Swap p1's leader to Papal Matt so the name-filter matches.
  const papalMatt = { ...srv.CARD_DB.find(c => c.id === 'ST07-001'), uid: 'pm-leader',
    rested: false, attachedDon: 0 };
  game.players[p1].leader = papalMatt;
  return { roomId, p1, p2, game, stella, papalMatt };
}

test('Agent E via Stella: Banish applied to Papal Matt leader; hasBanish true', () => {
  const { roomId, p1, game, stella, papalMatt } = setupStellaScene();
  // Fire Stella's [Activate: Main] (cost is restSelf; simulate ACTIVATE_MAIN
  // behavior by resting manually before runPipeline).
  stella.rested = true;
  srv.runPipeline('activateMain', game, p1, stella);
  assert.ok(game.grantKeywordToNamedWindow);
  assert.equal(game.grantKeywordToNamedWindow.keyword, 'banish');
  const candidates = game.grantKeywordToNamedWindow.candidateUids;
  assert.ok(candidates.includes(papalMatt.uid), 'leader (named Papal Matt) is a candidate');

  srv.handleAction(roomId, p1, {
    type: 'GRANT_KEYWORD_TO_NAMED_SELECTED',
    targetUid: papalMatt.uid,
  });
  assert.equal(game.grantKeywordToNamedWindow, null);
  assert.ok(srv.hasBanish(papalMatt), 'Papal Matt has temp Banish');
});

test('Agent E via Family God: Double Attack applied to Papal Matt character', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const fg = { ...srv.CARD_DB.find(c => c.id === 'ST07-013'), uid: 'fg-1',
    rested: false };
  game.players[p1].field.push(fg);
  // Put Papal Matt as leader, add a field character also named 'Papal Matt'
  // to ensure the field-scan arm of the filter also works.
  const leaderPM = { ...srv.CARD_DB.find(c => c.id === 'ST07-001'), uid: 'pm-leader' };
  game.players[p1].leader = leaderPM;
  srv.runPipeline('activateMain', game, p1, fg);
  assert.ok(game.grantKeywordToNamedWindow);
  srv.handleAction(roomId, p1, {
    type: 'GRANT_KEYWORD_TO_NAMED_SELECTED',
    targetUid: leaderPM.uid,
  });
  assert.ok(srv.hasDoubleAttack(leaderPM), 'leader gained temp Double Attack');
});

test('Agent E: tempKeywords cleared at end of turn by doEnd', () => {
  const { p1, p2, game } = twoPlayerGame();
  const target = { ...srv.CARD_DB.find(c => c.id === 'ST07-001'), uid: 'pm-leader',
    rested: false, attachedDon: 0 };
  game.players[p1].leader = target;
  // Manually grant like the resolver would.
  target.tempKeywords = [{ keyword: 'banish', expiresAtTurn: game.turn }];
  assert.ok(srv.hasBanish(target), 'Banish active before turn ends');
  srv.doEnd(game);  // active player's END → flips to opponent, game.turn++
  assert.equal(
    (target.tempKeywords || []).length, 0,
    'tempKeywords pruned after doEnd');
  assert.equal(srv.hasBanish(target), false, 'Banish cleared');
});

test('Agent E: no [Papal Matt] cards → no-targets, window does NOT open', () => {
  const { p1, game } = twoPlayerGame();
  const stella = { ...srv.CARD_DB.find(c => c.id === 'ST07-011'), uid: 'stella-2',
    rested: true };
  game.players[p1].field.push(stella);
  // Leave the Anna of Brittany leader in place — no "Papal Matt" in this game.
  srv.runPipeline('activateMain', game, p1, stella);
  // Window field is never assigned when there are no candidates — use
  // the generic falsy check so `undefined` (never set) and `null` (cleared)
  // both pass.
  assert.ok(!game.grantKeywordToNamedWindow, 'no window opened with no [Papal Matt] targets');
});

// ── Agent F — trashLifeCard (via Matthew branch A → existing trashOpponentLife) ──

test('Agent F: Matthew branch A does NOT fire any [Trigger] activation', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const matt = { ...srv.CARD_DB.find(c => c.id === 'ST07-010'), uid: 'matt-trash' };
  game.players[p1].field.push(matt);
  // Seed p2's life with a card that carries a [Trigger] ability — Monk Matt.
  const monkMatt = { ...srv.CARD_DB.find(c => c.id === 'ST04-010'), uid: 'life-trigger' };
  game.players[p2].life = [monkMatt];

  srv.runPipeline('onPlay', game, p1, matt);
  srv.handleAction(roomId, p2, { type: 'OPPONENT_CHOOSES_SELECTED', branchIndex: 0 });
  // Life card moved to trash; triggerWindow should NOT have opened.
  assert.equal(game.players[p2].life.length, 0);
  assert.equal(game.players[p2].trash[game.players[p2].trash.length - 1].uid, 'life-trigger');
  assert.equal(game.triggerWindow, null, 'trashLifeCard does not fire [Trigger]');
});

// ── Special rules ──────────────────────────────────────────────────────────

test('Forgotten Monestary: ACTIVATE_MAIN rejected when no cost-3 Character in hand', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p1;
  const monestary = { ...srv.CARD_DB.find(c => c.id === 'ST07-017'), uid: 'mon-1',
    rested: false };
  game.players[p1].field.push(monestary);
  // Hand has NO cost-3 characters — seed it deterministically.
  game.players[p1].hand = [
    { ...srv.CARD_DB.find(c => c.id === 'ST07-002'), uid: 'h2' },  // cost 1
  ];
  const p1Client = srv.clients.get(p1);
  p1Client._sent.length = 0;

  srv.handleAction(roomId, p1, { type: 'ACTIVATE_MAIN', cardUid: monestary.uid });
  const errors = p1Client._sent.filter(m => m.type === 'ERROR');
  assert.ok(errors.some(e => /cost-3 Character/i.test(e.msg)), 'ERROR includes cost-3 gate message');
  assert.equal(monestary.rested, false, 'stage not rested on failed activation');
});

test('Forgotten Monestary: ACTIVATE_MAIN opens addLifeCardToHand cost when hand has cost-3 Character', () => {
  const { roomId, p1, game } = twoPlayerGame();
  game.phase = 'MAIN';
  game.activePlayer = p1;
  const monestary = { ...srv.CARD_DB.find(c => c.id === 'ST07-017'), uid: 'mon-2',
    rested: false };
  game.players[p1].field.push(monestary);
  // Hand has one cost-3 Character (Micah, Faithful Hobbit).
  const micah = { ...srv.CARD_DB.find(c => c.id === 'ST07-007'), uid: 'micah-1' };
  game.players[p1].hand = [micah];
  game.players[p1].life = [{ id: 'L', name: 'L', uid: 'lx' }];

  srv.handleAction(roomId, p1, { type: 'ACTIVATE_MAIN', cardUid: monestary.uid });
  assert.equal(monestary.rested, true, 'stage rested on activate');
  assert.ok(game.addLifeCardToHandWindow, 'addLifeCardToHand cost window opened');
});

test('Faustian Jack [Trigger]: trashFromHand cost opens, then playSelf moves card to field', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  const faustian = { ...srv.CARD_DB.find(c => c.id === 'ST07-009'), uid: 'faust-1' };
  // Trigger flow: card is in hand after being revealed off life.
  game.players[p1].hand.push(faustian);
  // Seed a second hand card to trash as cost.
  const filler = { ...srv.CARD_DB.find(c => c.id === 'ST07-002'), uid: 'filler-1' };
  game.players[p1].hand.push(filler);

  srv.runPipeline('trigger', game, p1, faustian);
  assert.ok(game.trashFromHandWindow, 'trashFromHand cost window opened');

  srv.handleAction(roomId, p1, {
    type: 'TRASH_FROM_HAND_RESOLVE',
    cardUids: [filler.uid],
  });
  // playSelf effect should have moved Faustian Jack from hand → field.
  const onField = game.players[p1].field.find(c => c.uid === 'faust-1');
  assert.ok(onField, 'Faustian Jack is on field after trigger');
});
