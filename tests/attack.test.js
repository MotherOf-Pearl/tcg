// Attack resolution tests. Builds battleState directly (bypasses the
// DECLARE_ATTACK / BLOCK / counter UX flow) so we can unit-test just
// the outcome math + broadcast shape.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { srv, resetWorld, twoPlayerGame, messagesOfType } = require('./helpers');

beforeEach(resetWorld);

// Shared setup: arm battleState so defender can call RESOLVE_ATTACK.
function armLeaderAttack(game, p1, attackerPower, defenderLeaderPower) {
  game.players[p1].leader.power = attackerPower;
  game.players[Object.keys(game.players).find(id => id !== p1)].leader.power = defenderLeaderPower;
  const opp = game.players[Object.keys(game.players).find(id => id !== p1)];
  game.phase = 'COUNTER_STEP';
  game.battleState = {
    attackerUid: game.players[p1].leader.uid,
    attackerId: p1,
    attackerName: game.players[p1].leader.name,
    attackerPower,
    targetUid: opp.leader.uid,
    targetName: opp.leader.name,
    targetPower: defenderLeaderPower,
    targetIsLeader: true,
    counterBonus: 0,
  };
}

test('BUG 16 — attacker wins on tie against leader (>= rule)', () => {
  const { roomId, p1, p2, game } = twoPlayerGame();
  armLeaderAttack(game, p1, 5000, 5000);
  const defenderLifeBefore = game.players[p2].life.length;
  srv.handleAction(roomId, p2, { type: 'RESOLVE_ATTACK' });
  assert.equal(game.battleState, null, 'battleState cleared post-resolve');
  assert.equal(game.phase, 'MAIN', 'phase returns to MAIN');
  assert.equal(game.players[p2].life.length, defenderLifeBefore - 1, 'leader hit consumes 1 life');
});

test('ATTACK_OUTCOME leader_hit carries lifeRemaining + names', () => {
  const { roomId, p1, p2, p1ws, p2ws, game } = twoPlayerGame();
  armLeaderAttack(game, p1, 6000, 5000);
  srv.handleAction(roomId, p2, { type: 'RESOLVE_ATTACK' });
  const atkOutcomes = messagesOfType(p1ws, 'ATTACK_OUTCOME');
  const defOutcomes = messagesOfType(p2ws, 'ATTACK_OUTCOME');
  assert.equal(atkOutcomes.length, 1);
  assert.equal(defOutcomes.length, 1);
  const msg = atkOutcomes[0];
  assert.equal(msg.outcome, 'leader_hit');
  assert.equal(msg.attackerId, p1);
  assert.equal(msg.defenderId, p2);
  assert.equal(msg.targetIsLeader, true);
  assert.equal(typeof msg.lifeRemaining, 'number');
  assert.equal(msg.blockerUsed, false);
  assert.equal(msg.counterUsed, false);
});

test('Defender wins on raw power → defender_power_win outcome', () => {
  const { roomId, p1, p2, p1ws, game } = twoPlayerGame();
  // Attack a character — so it becomes defender_power_win when defender is
  // stronger. Give defender a field character with 10k power.
  const opp = game.players[p2];
  const blocker = {
    ...srv.CARD_DB.find(c => c.id === 'OP01-067'),
    uid: 'opp-char-1', rested: false, attachedDon: 0,
  };
  opp.field.push(blocker);
  game.phase = 'COUNTER_STEP';
  game.battleState = {
    attackerUid: game.players[p1].leader.uid,
    attackerId: p1,
    attackerName: game.players[p1].leader.name,
    attackerPower: 1000,
    targetUid: blocker.uid,
    targetName: blocker.name,
    targetPower: 9000,
    targetIsLeader: false,
    counterBonus: 0,
    blockerUsed: false,  // no blocker was played — this is just a bad attack
  };
  srv.handleAction(roomId, p2, { type: 'RESOLVE_ATTACK' });
  const msg = messagesOfType(p1ws, 'ATTACK_OUTCOME')[0];
  assert.equal(msg.outcome, 'defender_power_win');
  assert.equal(msg.blockerUsed, false);
  assert.equal(msg.counterUsed, false);
});

test('Blocker used → outcome "blocked" (precedence over counter)', () => {
  const { roomId, p1, p2, p1ws, game } = twoPlayerGame();
  const opp = game.players[p2];
  const blocker = {
    ...srv.CARD_DB.find(c => c.id === 'ST03-003'),  // Noble Shlawger, 6000 power
    uid: 'opp-blocker-1', rested: true, attachedDon: 0,
  };
  opp.field.push(blocker);
  game.phase = 'COUNTER_STEP';
  game.battleState = {
    attackerUid: game.players[p1].leader.uid,
    attackerId: p1, attackerName: 'Attacker',
    attackerPower: 1000,
    targetUid: blocker.uid, targetName: blocker.name, targetPower: 6000,
    targetIsLeader: false, counterBonus: 0,
    blockerUsed: true,  // a real blocker was used
    counterUsed: false,
  };
  srv.handleAction(roomId, p2, { type: 'RESOLVE_ATTACK' });
  const msg = messagesOfType(p1ws, 'ATTACK_OUTCOME')[0];
  assert.equal(msg.outcome, 'blocked');
  assert.equal(msg.blockerUsed, true);
});

test('Counter used without blocker → outcome "countered"', () => {
  const { roomId, p1, p2, p1ws, game } = twoPlayerGame();
  game.phase = 'COUNTER_STEP';
  game.battleState = {
    attackerUid: game.players[p1].leader.uid,
    attackerId: p1, attackerName: 'Attacker',
    attackerPower: 4000,
    targetUid: game.players[p2].leader.uid, targetName: 'Defender',
    targetPower: 5000,
    targetIsLeader: true, counterBonus: 0,
    blockerUsed: false,
    counterUsed: true,  // counter made attack fail
  };
  srv.handleAction(roomId, p2, { type: 'RESOLVE_ATTACK' });
  const msg = messagesOfType(p1ws, 'ATTACK_OUTCOME')[0];
  assert.equal(msg.outcome, 'countered');
});

test('Character KO outcome when attacker beats character target', () => {
  const { roomId, p1, p2, p1ws, game } = twoPlayerGame();
  const opp = game.players[p2];
  const victim = {
    ...srv.CARD_DB.find(c => c.id === 'OP01-077'),  // FiFi Cat, 1000 power
    uid: 'victim-uid', rested: false, attachedDon: 0,
  };
  opp.field.push(victim);
  game.phase = 'COUNTER_STEP';
  game.battleState = {
    attackerUid: game.players[p1].leader.uid,
    attackerId: p1, attackerName: 'Attacker',
    attackerPower: 5000,
    targetUid: victim.uid, targetName: victim.name, targetPower: 1000,
    targetIsLeader: false, counterBonus: 0,
    blockerUsed: false, counterUsed: false,
  };
  srv.handleAction(roomId, p2, { type: 'RESOLVE_ATTACK' });
  const msg = messagesOfType(p1ws, 'ATTACK_OUTCOME')[0];
  assert.equal(msg.outcome, 'character_koed');
  assert.equal(msg.targetName, victim.name);
  assert.ok(opp.trash.some(c => c.uid === victim.uid), 'KO\'d card in trash');
  assert.equal(opp.field.some(c => c.uid === victim.uid), false, 'KO\'d card off field');
});
