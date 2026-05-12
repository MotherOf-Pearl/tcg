// Pure client-side predicate helpers extracted from game.html so they can be
// unit-tested under node --test without spinning a DOM. Loaded as a plain
// <script src="client_predicates.js"> in game.html (functions land on
// window) and CommonJS-exported here so tests/ can require it.
//
// Each helper mirrors a server gate so the client never surfaces an action
// the server will reject (cf. §1-3-2 — engine must not be asked to perform
// impossible actions; UX corollary: do not offer them).

(function (root) {

  // Mirrors server-side isAttackerOnTheirFirstTurn (server.js:3445) on the
  // §6-5-6-1 "Neither player can battle on their first turn" gate. Reads
  // the authoritative hasTakenFirstTurn flag the server broadcasts on
  // every GAME_STATE. Fail-closed: a missing player or missing flag is
  // treated as "still first turn" so the Attack button stays hidden.
  function clientIsAttackerOnTheirFirstTurn(game, playerId) {
    const p = game && game.players && game.players[playerId];
    return !p || !p.hasTakenFirstTurn;
  }

  // Pure predicate for the per-card Attack button visibility check
  // (mirrors the conditions in game.html selectCard's field/leader
  // branch). Takes the full game + acting playerId + the card's uid so
  // it can locate the card in either leader or field and derive the
  // "source" itself.
  //
  //  - Hidden if the card is rested (§7-1-1-1 — attackers must be
  //    active to rest as cost).
  //  - Hidden if the player is on their first turn (§6-5-6-1).
  //  - Hidden if a field Character was played this turn and lacks
  //    [Rush] (§6-5-3-2 — "Characters cannot attack the turn they are
  //    played unless they have [Rush]"). Does not apply to leaders.
  //  - Hidden if the card cannot be found (defensive).
  function shouldShowBtnAttack(game, playerId, cardUid) {
    const p = game && game.players && game.players[playerId];
    if (!p) return false;
    let card = null;
    let source = null;
    if (p.leader && p.leader.uid === cardUid) {
      card = p.leader;
      source = 'leader';
    } else if (Array.isArray(p.field)) {
      const found = p.field.find(c => c && c.uid === cardUid);
      if (found) {
        card = found;
        source = 'field';
      }
    }
    if (!card) return false;
    if (card.rested) return false;
    if (clientIsAttackerOnTheirFirstTurn(game, playerId)) return false;
    const ab = card.ability || '';
    if (source === 'field' && card.playedThisTurn && !ab.includes('[Rush]')) return false;
    return true;
  }

  const api = { clientIsAttackerOnTheirFirstTurn, shouldShowBtnAttack };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  // Expose on the browser global. The game.html inline script also
  // declares a function named clientIsAttackerOnTheirFirstTurn (a thin
  // playerId-only wrapper that reads the current `game`); to avoid the
  // function-declaration hoisting clobbering this (game, playerId) form
  // we publish the pure version under a namespaced name as well.
  if (root) {
    root.__clientPredicates = api;
    root.shouldShowBtnAttack = shouldShowBtnAttack;
  }
})(typeof window !== 'undefined' ? window : null);
