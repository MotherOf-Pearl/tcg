// Phase 7 Batch 4 — playFromTrash effect (new). Parser pre-processing
// preserves inline [ExcludeName] brackets through the body-level bracket
// stripper; openPlayFromTrash builds the candidate list from the
// player's trash with affiliation/type/cost/excludeName filters; the
// resolver PLAY_FROM_TRASH_RESOLVE moves the picked card to field
// (rested if flagged) and fires its onPlay.
//
// Deferred from this batch: OP10-082 Kuzan also needs the trashSelf
// cost (new) and has a passive "cannot be removed" clause — Phase 8+.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame } = require('./helpers');

beforeEach(resetWorld);

// ─── Parser ──────────────────────────────────────────────────────────────

test('parser emits playFromTrash for "Play up to N {X} type Character … from your trash rested"', () => {
  const out = srv.parseAbility(
    '[On K.O.] Play up to 1 {Blackbeard Pirates} type Character card with a cost of 5 or less from your trash rested.'
  );
  assert.deepEqual(out.unparsedSegments, []);
  assert.deepEqual(out.effects[0].effects, [
    { type: 'playFromTrash', max: 1,
      filter: { affiliation: 'Blackbeard Pirates', type: 'CHARACTER', maxCost: 5 },
      rested: true },
  ]);
});

test('parser captures excludeName for "other than [Kuzan]" suffix', () => {
  const out = srv.parseAbility(
    '[Main] Play up to 1 {Blackbeard Pirates} type Character card with a cost of 5 or less other than [Kuzan] from your trash.'
  );
  assert.deepEqual(out.effects[0].effects[0].filter.excludeName, 'Kuzan');
  assert.equal(out.effects[0].effects[0].rested, false);
});

// ─── Card flag + migration ──────────────────────────────────────────────

test('Kuzan ST27-003 flag + fully parsed', () => {
  const c = srv.CARD_DB.find(c => c.id === 'ST27-003');
  assert.equal(c.useNewPipeline, true);
  const p = srv.PARSED_EFFECTS.get('ST27-003');
  assert.deepEqual(p.unparsedSegments, []);
});

// ─── Window opener + filter ─────────────────────────────────────────────

test('Kuzan ST27-003 onKO opens playFromTrashWindow filtered by {Blackbeard Pirates} cost ≤5', () => {
  const { p1, game } = twoPlayerGame();
  // Populate p1 trash with eligible + ineligible cards.
  const eligible = { ...srv.CARD_DB.find(c => c.id === 'OP09-009'),
    uid: 'bb-low', affiliation: 'Blackbeard Pirates', cost: 3 };  // match
  const wrongAff = { ...srv.CARD_DB.find(c => c.id === 'OP01-101'),
    uid: 'bb-wrong-aff', affiliation: 'Duchess of Brittany', cost: 3 };
  const tooBig = { ...srv.CARD_DB.find(c => c.id === 'OP09-009'),
    uid: 'bb-big', affiliation: 'Blackbeard Pirates', cost: 8 };
  game.players[p1].trash.push(eligible, wrongAff, tooBig);

  const kuzan = { ...srv.CARD_DB.find(c => c.id === 'ST27-003'), uid: 'kz-1' };
  game.players[p1].trash.push(kuzan);  // onKO → Kuzan is in trash

  srv.runPipeline('onKO', game, p1, kuzan);
  assert.ok(game.playFromTrashWindow);
  assert.deepEqual(game.playFromTrashWindow.candidateUids, ['bb-low']);
  assert.equal(game.playFromTrashWindow.rested, true);
});

// ─── PLAY_FROM_TRASH_RESOLVE moves card to field rested ─────────────────

test('PLAY_FROM_TRASH_RESOLVE moves the picked card from trash to field (rested)', () => {
  const { roomId, p1, game } = twoPlayerGame();
  const revivable = { ...srv.CARD_DB.find(c => c.id === 'OP09-009'),
    uid: 'rv-1', affiliation: 'Blackbeard Pirates', cost: 3, rested: false };
  game.players[p1].trash.push(revivable);
  const kuzan = { ...srv.CARD_DB.find(c => c.id === 'ST27-003'), uid: 'kz-2' };
  game.players[p1].trash.push(kuzan);

  srv.runPipeline('onKO', game, p1, kuzan);
  assert.ok(game.playFromTrashWindow);
  srv.handleAction(roomId, p1, { type: 'PLAY_FROM_TRASH_RESOLVE', cardUid: 'rv-1' });
  assert.equal(game.playFromTrashWindow, null);
  assert.ok(game.players[p1].field.find(c => c.uid === 'rv-1'),
    'card moved to field');
  assert.equal(game.players[p1].trash.find(c => c.uid === 'rv-1'), undefined,
    'removed from trash');
  const onField = game.players[p1].field.find(c => c.uid === 'rv-1');
  assert.equal(onField.rested, true, 'played rested per the effect flag');
});

// ─── Skip path (optional effect) ────────────────────────────────────────

test('PLAY_FROM_TRASH_RESOLVE skip closes the window without moving any card', () => {
  const { roomId, p1, game } = twoPlayerGame();
  const revivable = { ...srv.CARD_DB.find(c => c.id === 'OP09-009'),
    uid: 'rv-2', affiliation: 'Blackbeard Pirates', cost: 3 };
  game.players[p1].trash.push(revivable);
  const kuzan = { ...srv.CARD_DB.find(c => c.id === 'ST27-003'), uid: 'kz-3' };
  game.players[p1].trash.push(kuzan);
  srv.runPipeline('onKO', game, p1, kuzan);
  srv.handleAction(roomId, p1, { type: 'PLAY_FROM_TRASH_RESOLVE', skip: true });
  assert.equal(game.playFromTrashWindow, null);
  // Card stays in trash.
  assert.ok(game.players[p1].trash.find(c => c.uid === 'rv-2'));
  assert.equal(game.players[p1].field.find(c => c.uid === 'rv-2'), undefined);
});
