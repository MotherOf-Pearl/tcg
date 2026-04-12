const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const file = path.join(__dirname, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(file).pipe(res);
  } else {
    res.writeHead(404); res.end();
  }
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();
const clients = new Map();

// ─── CARD DATABASE ───
const CARD_DB = [
  // LEADERS
  { id:'L001', name:'Monkey D. Luffy', type:'LEADER', power:5000, color:'Red', attribute:'Strike', life:5, cost:0, counter:0, ability:'[Activate: Main] You may rest this Leader: Give up to 1 of your Characters +1000 power for this turn.' },
  { id:'L002', name:'Roronoa Zoro', type:'LEADER', power:5000, color:'Green', attribute:'Slash', life:5, cost:0, counter:0, ability:'[Blocker] (You may rest this Leader to make it the target of an enemy attack.)' },
  { id:'L003', name:'Nami', type:'LEADER', power:5000, color:'Blue', attribute:'Special', life:4, cost:0, counter:0, ability:'[Activate: Main] You may rest this Leader: Draw 1 card, then trash 1 card from your hand.' },
  { id:'L004', name:'Trafalgar Law', type:'LEADER', power:5000, color:'Purple', attribute:'Slash', life:5, cost:0, counter:0, ability:'[On Your Turn] This Leader gains +1000 power for each DON!! attached to it.' },
  // CHARACTERS
  { id:'C001', name:'Nami', type:'CHARACTER', power:1000, color:'Red', attribute:'Special', cost:1, counter:2000, ability:'[On Play] Draw 1 card.' },
  { id:'C002', name:'Usopp', type:'CHARACTER', power:2000, color:'Red', attribute:'Ranged', cost:2, counter:1000, ability:'[Blocker]' },
  { id:'C003', name:'Sanji', type:'CHARACTER', power:4000, color:'Red', attribute:'Strike', cost:3, counter:1000, ability:'[Rush] (This card can attack on the turn it is played.)' },
  { id:'C004', name:'Tony Tony Chopper', type:'CHARACTER', power:1000, color:'Red', attribute:'Strike', cost:1, counter:2000, ability:'[On Play] You may trash 1 card: Draw 2 cards.' },
  { id:'C005', name:'Nico Robin', type:'CHARACTER', power:3000, color:'Red', attribute:'Special', cost:3, counter:1000, ability:'[When Attacking] Look at top 3 cards of your deck, put 1 in hand, rest on bottom.' },
  { id:'C006', name:'Franky', type:'CHARACTER', power:5000, color:'Red', attribute:'Strike', cost:5, counter:0, ability:'[Blocker] [DON!! x1] This Character gains +2000 power.' },
  { id:'C007', name:'Brook', type:'CHARACTER', power:3000, color:'Red', attribute:'Slash', cost:3, counter:1000, ability:'[Rush]' },
  { id:'C008', name:'Jinbe', type:'CHARACTER', power:5000, color:'Red', attribute:'Strike', cost:5, counter:0, ability:'[Blocker] [On Play] Rest up to 2 of your opponent\'s Characters.' },
  { id:'C009', name:'Portgas D. Ace', type:'CHARACTER', power:5000, color:'Red', attribute:'Special', cost:4, counter:0, ability:'[Rush] [On Play] Deal 1 damage to your opponent.' },
  { id:'C010', name:'Sabo', type:'CHARACTER', power:6000, color:'Red', attribute:'Strike', cost:5, counter:0, ability:'[On Play] K.O. up to 1 of your opponent\'s Characters with 3000 power or less.' },
  { id:'C011', name:'Whitebeard', type:'CHARACTER', power:8000, color:'Red', attribute:'Strike', cost:7, counter:0, ability:'[Blocker] [On Play] All your opponent\'s Characters get -2000 power this turn.' },
  { id:'C012', name:'Shanks', type:'CHARACTER', power:7000, color:'Red', attribute:'Slash', cost:6, counter:0, ability:'[On Play] Your opponent discards 1 card.' },
  { id:'C013', name:'Boa Hancock', type:'CHARACTER', power:4000, color:'Blue', attribute:'Special', cost:4, counter:1000, ability:'[On Play] Rest up to 1 of your opponent\'s Characters.' },
  { id:'C014', name:'Crocodile', type:'CHARACTER', power:6000, color:'Purple', attribute:'Special', cost:5, counter:0, ability:'[On Play] Look at top 5 cards, take 1, rest on bottom.' },
  { id:'C015', name:'Dracule Mihawk', type:'CHARACTER', power:7000, color:'Green', attribute:'Slash', cost:6, counter:0, ability:'[On Play] K.O. up to 1 Character with 5000 power or less.' },
  // EVENTS
  { id:'E001', name:'Gum-Gum Pistol', type:'EVENT', power:0, color:'Red', cost:2, counter:0, ability:'Give up to 1 of your Leader or Characters +4000 power during this battle. [Trigger] Give up to 1 of your Leader or Characters +2000 power.' },
  { id:'E002', name:'Diable Jambe', type:'EVENT', power:0, color:'Red', cost:3, counter:0, ability:'K.O. up to 1 of your opponent\'s Characters with 3000 power or less. [Trigger] K.O. up to 1 Character with 2000 power or less.' },
  { id:'E003', name:'Conqueror\'s Haki', type:'EVENT', power:0, color:'Red', cost:4, counter:0, ability:'Your opponent discards 2 cards. [Trigger] Your opponent discards 1 card.' },
  { id:'E004', name:'Barriers', type:'EVENT', power:0, color:'Blue', cost:2, counter:0, ability:'Return up to 1 of your opponent\'s Characters to their hand. [Trigger] Return up to 1 Character with cost 3 or less to its owner\'s hand.' },
  { id:'E005', name:'Room', type:'EVENT', power:0, color:'Purple', cost:3, counter:0, ability:'Swap 1 of your Characters with 1 of your opponent\'s Characters. [Trigger] You may play 1 cost-3-or-less Character from your hand.' },
];

function getCard(id) { return CARD_DB.find(c => c.id === id); }

function buildStarterDeck(leaderId) {
  const leader = CARD_DB.find(c => c.id === leaderId);
  if (!leader) return { leader: CARD_DB[0], deck: [] };
  const chars = CARD_DB.filter(c => c.type === 'CHARACTER').slice(0, 8);
  const events = CARD_DB.filter(c => c.type === 'EVENT').slice(0, 3);
  const deck = [];
  chars.forEach(c => { for(let i=0;i<4;i++) deck.push({...c, uid:uuidv4(), rested:false, attachedDon:0}); });
  events.forEach(c => { for(let i=0;i<2;i++) deck.push({...c, uid:uuidv4(), rested:false, attachedDon:0}); });
  return { leader: {...leader, uid:uuidv4(), rested:false, attachedDon:0}, deck: shuffle(deck) };
}

function buildCustomDeck(leaderId, cardList) {
  // cardList: [{id, count}]
  const leader = CARD_DB.find(c => c.id === leaderId);
  if (!leader) return buildStarterDeck('L001');
  const deck = [];
  cardList.forEach(({id, count}) => {
    const card = CARD_DB.find(c => c.id === id);
    if (!card) return;
    for (let i = 0; i < Math.min(count, 4); i++) {
      deck.push({...card, uid:uuidv4(), rested:false, attachedDon:0});
    }
  });
  return { leader: {...leader, uid:uuidv4(), rested:false, attachedDon:0}, deck: shuffle(deck) };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function createPlayerState(leaderId, deckList) {
  const { leader, deck } = deckList ? buildCustomDeck(leaderId, deckList) : buildStarterDeck(leaderId);
  const hand = deck.splice(0, 5);
  const life = deck.splice(0, leader.life);
  return {
    leader, deck, hand, life,
    trash: [], field: [],
    donDeck: 10, donActive: 0, donRested: 0,
    mulliganed: false,
  };
}

function createGame(p1id, p2id, p1deck, p2deck) {
  const players = {
    [p1id]: createPlayerState(p1deck?.leaderId || 'L001', p1deck?.cards),
    [p2id]: createPlayerState(p2deck?.leaderId || 'L002', p2deck?.cards),
  };
  return {
    id: uuidv4(),
    phase: 'MULLIGAN',
    turn: 1,
    activePlayer: p1id,
    players,
    log: ['Game started! Both players: keep your hand or mulligan.'],
    winner: null,
    mulliganDone: { [p1id]: false, [p2id]: false },
    counterWindow: null, // { attackerUid, defenderUid, attackPower, defenderIsLeader, attackerId, defenderId }
    counterDone: { [p1id]: false, [p2id]: false },
  };
}

function send(playerId, msg) {
  const ws = clients.get(playerId);
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(roomId, msg) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.players.forEach(pid => send(pid, msg));
}

function sendState(roomId) {
  const room = rooms.get(roomId);
  if (!room?.game) return;
  room.players.forEach(pid => send(pid, { type: 'GAME_STATE', game: room.game, yourId: pid }));
}

function log(game, msg) { game.log.push(msg); if (game.log.length > 30) game.log.shift(); }

function nextPhase(game) {
  const order = ['MULLIGAN','REFRESH','DRAW','DON','MAIN','END'];
  const i = order.indexOf(game.phase);
  if (i < order.length - 1) {
    game.phase = order[i+1];
    if (game.phase === 'DRAW') doRefresh(game);
    if (game.phase === 'DON') doDraw(game);
    if (game.phase === 'DON') {} // handled by NEXT_PHASE action
    if (game.phase === 'END') doEnd(game);
  }
}

function doRefresh(game) {
  const p = game.players[game.activePlayer];
  p.leader.rested = false;
  p.field.forEach(c => { c.rested = false; });
  p.donActive += p.donRested;
  p.donRested = 0;
  log(game, `Turn ${game.turn}: ${game.activePlayer.slice(0,6)} refreshes all cards.`);
}

function doDraw(game) {
  const p = game.players[game.activePlayer];
  if (p.deck.length > 0) {
    p.hand.push(p.deck.shift());
    log(game, `${game.activePlayer.slice(0,6)} draws a card.`);
  }
}

function doEnd(game) {
  // Discard to hand limit 8
  const p = game.players[game.activePlayer];
  while (p.hand.length > 8) { p.trash.push(p.hand.pop()); }
  // Next player
  const ids = Object.keys(game.players);
  game.activePlayer = ids.find(id => id !== game.activePlayer);
  game.turn++;
  game.phase = 'REFRESH';
  log(game, `--- Turn ${game.turn} begins ---`);
  doRefresh(game);
  game.phase = 'DRAW';
  doDraw(game);
  game.phase = 'DON';
}

function addDon(game) {
  const p = game.players[game.activePlayer];
  const amount = game.turn <= 2 ? 1 : 2;
  const added = Math.min(amount, p.donDeck);
  p.donDeck -= added;
  p.donActive += added;
  log(game, `${game.activePlayer.slice(0,6)} adds ${added} DON!!`);
  game.phase = 'MAIN';
}

function checkWin(game) {
  Object.entries(game.players).forEach(([pid, p]) => {
    const oppId = Object.keys(game.players).find(id => id !== pid);
    const opp = game.players[oppId];
    if (opp.life.length === 0 && !game.winner) {
      // Need one more hit on leader
    }
  });
}

function resolveCounter(roomId) {
  const room = rooms.get(roomId);
  const game = room.game;
  const cw = game.counterWindow;
  if (!cw) return;

  const attacker = game.players[cw.attackerId];
  const defender = game.players[cw.defenderId];

  let finalAttack = cw.attackPower;
  let finalDefend = cw.defendPower;

  if (cw.defenderIsLeader) {
    if (finalAttack > finalDefend) {
      if (defender.life.length > 0) {
        const lifeCard = defender.life.pop();
        defender.hand.push(lifeCard);
        log(game, `💥 Life card flipped! ${lifeCard.name} added to hand. ${defender.life.length} life remaining.`);
        if (defender.life.length === 0) {
          game.winner = cw.attackerId;
          log(game, `🏆 ${cw.attackerId.slice(0,6)} WINS! Opponent has no life cards!`);
        }
      }
    } else {
      log(game, `🛡️ Attack blocked by leader's power!`);
    }
  } else {
    const target = defender.field.find(c => c.uid === cw.defenderUid);
    if (target) {
      if (finalAttack >= finalDefend) {
        defender.field = defender.field.filter(c => c.uid !== cw.defenderUid);
        defender.trash.push(target);
        log(game, `💀 ${target.name} is K.O.'d!`);
      } else {
        log(game, `🛡️ ${target.name} survives the attack!`);
      }
    }
  }

  game.counterWindow = null;
  game.counterDone = { [cw.attackerId]: false, [cw.defenderId]: false };
  sendState(roomId);
}

function handleAction(roomId, playerId, action) {
  const room = rooms.get(roomId);
  if (!room?.game) return;
  const game = room.game;
  if (game.winner) return;

  const p = game.players[playerId];
  const oppId = Object.keys(game.players).find(id => id !== playerId);
  const opp = game.players[oppId];
  const isActive = game.activePlayer === playerId;

  switch (action.type) {

    case 'MULLIGAN': {
      if (game.phase !== 'MULLIGAN' || game.mulliganDone[playerId]) return;
      if (action.doMulligan) {
        game.mulliganDone[playerId] = true;
        p.deck.push(...p.hand);
        p.deck = shuffle(p.deck);
        p.hand = p.deck.splice(0, 5);
        log(game, `${playerId.slice(0,6)} mulligans.`);
      } else {
        game.mulliganDone[playerId] = true;
        log(game, `${playerId.slice(0,6)} keeps their hand.`);
      }
      if (Object.values(game.mulliganDone).every(v => v)) {
        game.phase = 'REFRESH';
        doRefresh(game);
        game.phase = 'DON';
        log(game, 'Both players ready! Turn 1 begins. Add DON!! to start.');
      }
      break;
    }

    case 'NEXT_PHASE': {
      if (!isActive) return;
      if (game.phase === 'DON') { addDon(game); }
      else if (game.phase === 'MAIN') { doEnd(game); }
      else { nextPhase(game); }
      break;
    }

    case 'PLAY_CARD': {
      if (!isActive || game.phase !== 'MAIN') return;
      const idx = p.hand.findIndex(c => c.uid === action.cardUid);
      if (idx === -1) return;
      const card = p.hand[idx];
      if (p.donActive < card.cost) { send(playerId, {type:'ERROR', msg:'Not enough DON!!'}); return; }
      p.donActive -= card.cost;
      p.donRested += card.cost;
      p.hand.splice(idx, 1);
      if (card.type === 'CHARACTER') {
        card.rested = false;
        card.attachedDon = 0;
        p.field.push(card);
        log(game, `${playerId.slice(0,6)} plays ${card.name} (${card.power} power).`);
        applyOnPlay(game, playerId, card, opp);
      } else if (card.type === 'EVENT') {
        p.trash.push(card);
        log(game, `${playerId.slice(0,6)} plays event ${card.name}.`);
        applyEventEffect(game, playerId, card, opp);
      }
      break;
    }

    case 'ATTACH_DON': {
      if (!isActive || game.phase !== 'MAIN') return;
      if (p.donActive < 1) { send(playerId, {type:'ERROR', msg:'No DON!! available'}); return; }
      let target = null;
      if (action.targetUid === p.leader.uid) target = p.leader;
      else target = p.field.find(c => c.uid === action.targetUid);
      if (!target) return;
      p.donActive--;
      p.donRested++;
      target.attachedDon = (target.attachedDon||0) + 1;
      log(game, `${playerId.slice(0,6)} attaches DON!! to ${target.name}. (+1000 power)`);
      break;
    }

    case 'ATTACK': {
      if (!isActive || game.phase !== 'MAIN') return;
      let attacker = null;
      if (action.attackerUid === p.leader.uid) attacker = p.leader;
      else attacker = p.field.find(c => c.uid === action.attackerUid);
      if (!attacker || attacker.rested) { send(playerId, {type:'ERROR', msg:'That card is rested or invalid'}); return; }

      const attackPower = (attacker.power||5000) + (attacker.attachedDon||0)*1000;
      attacker.rested = true;

      let defenderIsLeader = false;
      let defender = null;
      let defendPower = 0;

      if (action.defenderUid === opp.leader.uid) {
        defender = opp.leader;
        defenderIsLeader = true;
        defendPower = (opp.leader.power||5000) + (opp.leader.attachedDon||0)*1000;
      } else {
        defender = opp.field.find(c => c.uid === action.defenderUid);
        if (!defender) { send(playerId, {type:'ERROR', msg:'Invalid target'}); return; }
        defendPower = (defender.power||0) + (defender.attachedDon||0)*1000;
      }

      log(game, `⚔️ ${attacker.name} (${attackPower}) attacks ${defender.name} (${defendPower})!`);

      // Open counter window
      game.counterWindow = {
        attackerUid: attacker.uid, defenderUid: defender.uid,
        attackPower, defendPower, defenderIsLeader,
        attackerId: playerId, defenderId: oppId,
      };
      game.counterDone = { [playerId]: true, [oppId]: false };
      log(game, `🃏 ${oppId.slice(0,6)} may play counter cards!`);
      break;
    }

    case 'COUNTER': {
      if (!game.counterWindow || game.counterWindow.defenderId !== playerId) return;
      const idx = p.hand.findIndex(c => c.uid === action.cardUid);
      if (idx === -1) return;
      const card = p.hand[idx];
      if (!card.counter) { send(playerId, {type:'ERROR', msg:'That card has no counter value'}); return; }
      p.hand.splice(idx, 1);
      p.trash.push(card);
      game.counterWindow.defendPower += card.counter;
      log(game, `🛡️ ${playerId.slice(0,6)} counters with ${card.name} (+${card.counter})! Defend power: ${game.counterWindow.defendPower}`);
      break;
    }

    case 'PASS_COUNTER': {
      if (!game.counterWindow) return;
      game.counterDone[playerId] = true;
      log(game, `${playerId.slice(0,6)} passes counter.`);
      if (Object.values(game.counterDone).every(v => v)) {
        resolveCounter(roomId);
        return;
      }
      break;
    }

    case 'END_TURN': {
      if (!isActive) return;
      doEnd(game);
      break;
    }
  }

  checkWin(game);
  sendState(roomId);
}

function applyOnPlay(game, playerId, card, opp) {
  if (card.ability.includes('Draw 1 card') && card.ability.includes('On Play')) {
    const p = game.players[playerId];
    if (p.deck.length > 0) { p.hand.push(p.deck.shift()); log(game, `${card.name}: drew a card.`); }
  }
  if (card.ability.includes('Rest up to') && card.ability.includes('On Play')) {
    const targets = opp.field.slice(0, card.ability.includes('2') ? 2 : 1);
    targets.forEach(t => { t.rested = true; log(game, `${card.name}: ${t.name} is rested!`); });
  }
  if (card.ability.includes('K.O.') && card.ability.includes('On Play') && card.ability.includes('3000')) {
    const target = opp.field.find(c => (c.power+(c.attachedDon||0)*1000) <= 3000);
    if (target) {
      opp.field = opp.field.filter(c => c.uid !== target.uid);
      opp.trash.push(target);
      log(game, `${card.name}: K.O.'d ${target.name}!`);
    }
  }
  if (card.ability.includes('discard 1') && card.ability.includes('On Play')) {
    if (opp.hand.length > 0) { opp.trash.push(opp.hand.shift()); log(game, `${card.name}: opponent discards!`); }
  }
}

function applyEventEffect(game, playerId, card, opp) {
  const p = game.players[playerId];
  if (card.id === 'E002') {
    const target = opp.field.find(c => (c.power+(c.attachedDon||0)*1000) <= 3000);
    if (target) { opp.field = opp.field.filter(c=>c.uid!==target.uid); opp.trash.push(target); log(game, `K.O.'d ${target.name}!`); }
  }
  if (card.id === 'E003') {
    const n = Math.min(2, opp.hand.length);
    opp.trash.push(...opp.hand.splice(0, n));
    log(game, `Opponent discards ${n} card(s)!`);
  }
  if (card.id === 'E004') {
    const target = opp.field[0];
    if (target) { opp.field.shift(); opp.hand.push(target); log(game, `${target.name} returned to hand!`); }
  }
}

// ─── WEBSOCKET ───
wss.on('connection', (ws) => {
  const clientId = uuidv4();
  clients.set(clientId, ws);
  ws.clientId = clientId;
  ws.send(JSON.stringify({ type:'CONNECTED', clientId, cardDb: CARD_DB }));

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'CREATE_ROOM': {
        const roomId = Math.random().toString(36).substr(2,6).toUpperCase();
        rooms.set(roomId, { id:roomId, players:[clientId], decks:{[clientId]:msg.deck}, game:null });
        ws.roomId = roomId;
        ws.send(JSON.stringify({ type:'ROOM_CREATED', roomId, playerId:clientId }));
        break;
      }
      case 'JOIN_ROOM': {
        const room = rooms.get(msg.roomId);
        if (!room) { ws.send(JSON.stringify({type:'ERROR',msg:'Room not found'})); return; }
        if (room.players.length >= 2) { ws.send(JSON.stringify({type:'ERROR',msg:'Room full'})); return; }
        room.players.push(clientId);
        room.decks[clientId] = msg.deck;
        ws.roomId = msg.roomId;
        ws.send(JSON.stringify({type:'ROOM_JOINED', roomId:msg.roomId, playerId:clientId}));
        const [p1,p2] = room.players;
        room.game = createGame(p1, p2, room.decks[p1], room.decks[p2]);
        broadcast(msg.roomId, {type:'GAME_STARTED'});
        sendState(msg.roomId);
        break;
      }
      case 'ACTION': {
        if (!ws.roomId) return;
        handleAction(ws.roomId, clientId, msg.action);
        break;
      }
      case 'CHAT': {
        if (!ws.roomId) return;
        broadcast(ws.roomId, {type:'CHAT', from:clientId.slice(0,6), text:msg.text});
        break;
      }
      case 'GET_CARD_DB': {
        ws.send(JSON.stringify({type:'CARD_DB', cards: CARD_DB}));
        break;
      }
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    if (ws.roomId) broadcast(ws.roomId, {type:'PLAYER_LEFT', playerId:clientId});
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Boohawk TCG server running on port ${PORT}`));
