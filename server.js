const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Detect base directory: check common Docker paths, then __dirname, then cwd
const BASE_DIR = ['/app', '/mnt/user/appdata/onepiece-game', __dirname, process.cwd()]
  .find(d => fs.existsSync(path.join(d, 'server.js'))) || __dirname;
console.log('BASE_DIR:', BASE_DIR);

const PAGES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/game.html': 'game.html',
  '/deck-editor.html': 'deck-editor.html',
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, 'http://localhost');
  const pathname = parsedUrl.pathname;
  const page = PAGES[pathname];
  if (page) {
    const file = path.join(BASE_DIR, page);
    if (!fs.existsSync(file)) { console.log('File not found:', file); res.writeHead(404); res.end('File not found: ' + file); return; }
    // Force the browser to revalidate HTML on every load so deploys are picked up.
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache, must-revalidate' });
    fs.createReadStream(file).pipe(res);
  } else if (pathname.match(/\.(png|jpg|jpeg)$/)) {
    const file = path.join(BASE_DIR, pathname.slice(1));
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'image/' + (pathname.endsWith('.png') ? 'png' : 'jpeg') });
    fs.createReadStream(file).pipe(res);
  } else if (pathname.match(/\.js$/)) {
    const file = path.join(BASE_DIR, pathname.slice(1));
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    // Same — JS deploys (e.g. background.js) need to bust the browser cache.
    res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache, must-revalidate' });
    fs.createReadStream(file).pipe(res);
  } else if (pathname.match(/\.(mp3|wav|ogg)$/)) {
    const file = path.join(BASE_DIR, pathname.slice(1));
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const ext = pathname.split('.').pop().toLowerCase();
    const ct = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg' }[ext];
    res.writeHead(200, { 'Content-Type': ct, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  } else {
    res.writeHead(404); res.end();
  }
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();
const clients = new Map();

const IMG = (set, id, ext) => `https://raw.githubusercontent.com/MotherOf-Pearl/tcg/main/${set}/${id}.${ext}`;

// ─── CARD DATABASE ───
const CARD_DB = [

  // ══════════════════════════════
  // DOFLAMINGO DECK (Purple)
  // ══════════════════════════════
  { id:'OP14-060', name:'Donquixote Doflamingo', type:'LEADER', color:'Purple', attribute:'Special',
    power:5000, life:5, cost:0, counter:0, image:IMG('OP14','OP14-060','png'),
    ability:"[On Your Opponent's Attack] [Once Per Turn] DON!! -1: Select your Leader or 1 of your {Donquixote Pirates} type Characters. Change the attack target to the selected card." },

  { id:'OP10-065', name:'Sugar', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:1000, cost:1, counter:1000, image:IMG('OP10','OP10-065','jpg'),
    ability:'[Activate: Main] You may rest 1 of your DON!! and this Character: Look at the top 5 cards of your deck, reveal up to 1 {Donquixote Pirates} type card and add it to your hand. Place the rest at the bottom of your deck in any order.' },

  { id:'OP14-067', name:'Dellinger', type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:2000, cost:1, counter:1000, image:IMG('OP14','OP14-067','png'),
    ability:'[On K.O.] Add up to 1 DON!! card from your DON!! deck and rest it; look at 5 cards from the top of your deck, reveal up to 1 {Donquixote Pirates} type card and add it to your hand.' },

  { id:'ST18-001', name:'Usohachi', type:'CHARACTER', color:'Yellow', attribute:'Ranged',
    power:3000, cost:3, counter:2000, image:IMG('ST18','ST18-001','png'),
    ability:"[On Play] If you have 8 or more DON!! cards, rest up to 1 of your opponent's Characters with a cost of 5 or less." },

  { id:'OP10-076', name:'Baby 5', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:1000, cost:3, counter:2000, image:IMG('OP10','OP10-076','jpg'),
    ability:"[On Play] You may discard 1 card from your hand: If your Leader has the {Donquixote Pirates} type, add up to 1 DON!! from your DON!! deck and set it as active." },

  { id:'OP14-072', name:'Baby 5', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:1000, cost:4, counter:1000, image:IMG('OP14','OP14-072','png'),
    ability:'[On Play] Add up to 1 DON!! card from your DON!! deck and set it as active. [On K.O.] DON!! -1: Add up to 1 card from the top of your deck to the top of your Life cards.' },

  { id:'OP14-063', name:'Sugar', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:1000, cost:4, counter:1000, image:IMG('OP14','OP14-063','png'),
    ability:"[On Play] Add up to 1 DON!! card from your DON!! deck and set it as active. [On K.O.] If your opponent has 6 or more DON!! cards on their field, play up to 1 {Donquixote Pirates} type Character card with a cost of 5 or less from your hand." },

  { id:'OP14-061', name:'Vergo', type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:7000, cost:5, counter:0, image:IMG('OP14','OP14-061','png'),
    ability:"[Once Per Turn] If your {Donquixote Pirates} type Character would be removed from the field by your opponent's effect, you may return 1 DON!! card from your field to your DON!! deck instead. [When Attacking] DON!! -1: Give up to 1 of your opponent's Characters -2000 power during this turn." },

  { id:'OP10-072', name:'Donquixote Rosinante', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:6000, cost:5, counter:1000, image:IMG('OP10','OP10-072','jpg'),
    ability:'[On Play] You may trash 1 event card from your hand: Draw 2 cards. [End of Your Turn] If you have 7 or more DON!! cards, set up to 2 of them as active.' },

  { id:'OP14-074', name:'Monet', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:6000, cost:5, counter:1000, image:IMG('OP14','OP14-074','png'),
    ability:"[On Play] If your Leader has the {Donquixote Pirates} type, add up to 1 DON!! card from your DON!! deck and set it as active. [On K.O.] Draw 2 cards and trash 1 card from your hand. Then, add up to 2 DON!! cards from your DON!! deck and rest them." },

  { id:'OP14-068', name:'Trebol', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:5000, cost:5, counter:2000, image:IMG('OP14','OP14-068','png'),
    ability:"[Opponent's Turn] [Once Per Turn] When a DON!! card on your field is returned to your DON!! deck, if your Leader has the {Donquixote Pirates} type, add up to 1 DON!! card from your DON!! deck and rest it." },

  { id:'OP10-071', name:'Donquixote Doflamingo', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:9000, cost:8, counter:0, image:IMG('OP10','OP10-071','jpg'),
    ability:"[On Play] DON!! -1: Play up to 1 {Donquixote Pirates} type Character card with a cost of 5 or less from your hand. [Opponent's Turn] [Once Per Turn] You may rest 1 of your DON!!: add up to 1 Active DON!! from your DON!! deck." },

  { id:'OP11-067', name:'Charlotte Katakuri', type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:8000, cost:8, counter:0, image:IMG('OP11','OP11-067','jpg'),
    ability:'[Blocker] [End of Your Turn] Set up to 2 of your {Big Mom Pirates} type Characters with a cost of 3 or more as active. Then, add up to 1 DON!! card from your DON!! deck and rest it.' },

  { id:'OP14-069', name:'Donquixote Doflamingo', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:10000, cost:10, counter:0, image:IMG('OP14','OP14-069','png'),
    ability:"[On Play] DON!! -3: Choose one: \u2022 If your Leader has the {Donquixote Pirates} type, K.O. up to 1 of your opponent's Characters with a cost of 8 or less. \u2022 Rest up to 3 of your opponent's Characters with a cost of 7 or less." },

  { id:'OP10-078', name:"I can never forgive anyone who laughs at my family...!!", type:'EVENT', color:'Purple',
    power:0, cost:1, counter:0, image:IMG('OP10','OP10-078','jpg'),
    ability:"[Main] [Counter] Look at 3 cards from the top of your deck; reveal up to 1 {Donquixote Pirates} type card other than this card and add it to your hand. Place the rest at the bottom of your deck in any order." },

  { id:'OP13-076', name:'Divine Departure', type:'EVENT', color:'Purple',
    power:0, cost:0, counter:0, image:IMG('OP13','OP13-076','png'),
    ability:"[Main] You may rest 5 of your DON!! cards: Give up to 1 of your opponent's Characters -8000 power during this turn. [Counter] You may trash 1 card from your hand: Up to 1 of your Leader or Character cards gains +3000 power during this battle." },

  { id:'OP07-076', name:'NoroNoro Beam Sword', type:'EVENT', color:'Purple',
    power:0, cost:2, counter:0, image:IMG('OP07','OP07-076','png'),
    ability:"[Counter] DON!! -1: Give up to 1 of your Leader or Character cards +2000 power for this battle. Then, rest up to 1 of your opponent's Characters. [Trigger] Add up to 1 DON!! card from your DON!! deck and set it as active." },

  { id:'OP14-078', name:'Bullet String', type:'EVENT', color:'Purple',
    power:0, cost:2, counter:0, image:IMG('OP14','OP14-078','png'),
    ability:"[Counter] DON!! -1: If your Leader has the {Donquixote Pirates} type, up to 1 of your Leader or Character cards gains +4000 power during this battle." },

  { id:'OP10-079', name:'God Thread', type:'EVENT', color:'Purple',
    power:0, cost:5, counter:0, image:IMG('OP10','OP10-079','jpg'),
    ability:"[Main] K.O. up to 1 of your opponent's Characters with a cost of 5 or less. Then, add up to 1 Active DON!! from your DON!! deck. [Trigger] Add up to 1 Active DON!! from your DON!! deck." },

  // ══════════════════════════════
  // SHANKS DECK (Red)
  // ══════════════════════════════
  { id:'OP09-001', name:'Shanks', type:'LEADER', color:'Red', attribute:'Slash',
    power:5000, life:5, cost:0, counter:0, image:IMG('OP09','OP09-001','jpg'),
    ability:"[Once Per Turn] You may activate this effect when your opponent attacks. Give up to 1 of your opponent's leader or characters -1000 power for the turn." },

  { id:'OP09-002', name:'Uta', type:'CHARACTER', color:'Red', attribute:'Special',
    power:2000, cost:1, counter:1000, image:IMG('OP09','OP09-002','jpg'),
    ability:"[On Play] Look at the top 5 cards of your deck, reveal up to 1 {Red Hair Pirates} type card and add it to your hand. Then, place the rest at the bottom of your deck in any order." },

  { id:'OP01-006', name:'Otama', type:'CHARACTER', color:'Red', attribute:'Special',
    power:0, cost:1, counter:2000, image:IMG('OP01','OP01-006','png'),
    ability:"[On Play] Give up to 1 of your opponent's Characters -2000 power during this turn." },

  { id:'OP09-008', name:'Building Snake', type:'CHARACTER', color:'Red', attribute:'Slash',
    power:2000, cost:1, counter:0, image:IMG('OP09','OP09-008','jpg'),
    ability:"[Activate: Main] You may place this character on the bottom of its owner's deck: Give up to one of your opponent's characters -3000 power for this turn." },

  { id:'OP09-011', name:'Hongo', type:'CHARACTER', color:'Red', attribute:'Strike',
    power:3000, cost:3, counter:2000, image:IMG('OP09','OP09-011','jpg'),
    ability:"[Activate: Main] You may rest this character: If your leader has the {Red Hair Pirates} type, give up to 1 of your opponent's characters -2000 power during this turn." },

  { id:'OP09-014', name:'Limejuice', type:'CHARACTER', color:'Red', attribute:'Special',
    power:3000, cost:3, counter:2000, image:IMG('OP09','OP09-014','jpg'),
    ability:"[On Play] Up to one of your opponents characters with power 4000 or less cannot activate [Blocker] the rest of this turn." },

  { id:'OP12-008', name:'Shanks', type:'CHARACTER', color:'Red', attribute:'Slash',
    power:6000, cost:4, counter:0, image:IMG('OP12','OP12-008','jpg'),
    ability:"[Blocker] [On Your Opponent's Attack] [Once Per Turn] You may trash 1 card from your hand: Give up to 1 of your opponent's Leader or Characters -2000 power during this turn." },

  { id:'OP09-015', name:'Lucky Roux', type:'CHARACTER', color:'Red', attribute:'Ranged',
    power:5000, cost:4, counter:1000, image:IMG('OP09','OP09-015','jpg'),
    ability:"[Blocker] [On K.O.] If your Leader has the {Red Hair Pirates} type, K.O. up to 1 of your opponent's Characters with an original power of 6000 or less." },

  { id:'OP10-011', name:'Tony Tony Chopper', type:'CHARACTER', color:'Yellow', attribute:'Strike',
    power:4000, cost:4, counter:2000, image:IMG('OP10','OP10-011','jpg'),
    ability:"[Blocker] [Opponent's Turn] This character has +2000 power." },

  { id:'PRB02-003', name:'Lucky Roux', type:'CHARACTER', color:'Red', attribute:'Ranged',
    power:2000, cost:4, counter:1000, image:IMG('PRB02','PRB02-003','jpg'),
    ability:"[Blocker] [On Play] You may trash 1 Character card with a power of 6000 or more from your hand: Draw 2 cards." },

  { id:'OP03-013', name:'Marco', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:6000, cost:5, counter:1000, image:IMG('OP03','OP03-013','png'),
    ability:"[Your Turn] [On Play] K.O. up to 1 of your opponent's Characters with 3000 Power or less. [On K.O.] You may trash 1 Event card from your hand. Play this character from the trash as rested." },

  { id:'OP09-013', name:'Yasopp', type:'CHARACTER', color:'Red', attribute:'Ranged',
    power:6000, cost:5, counter:1000, image:IMG('OP09','OP09-013','jpg'),
    ability:"[On Play] Up to one of your leaders gains +1000 power until the end of your opponent's next turn. [DON!! x1] [When Attacking] Up to one of your opponent's characters gets -1000 power for this turn." },

  { id:'ST15-005', name:'Portgas D. Ace', type:'CHARACTER', color:'Red', attribute:'Special',
    power:6000, cost:5, counter:1000, image:IMG('ST15','ST15-005','png'),
    ability:"[Once Per Turn] If this character would be removed from play by one of your opponent's effects, instead you may give this character -2000 power for this turn." },

  { id:'ST23-001', name:'Uta', type:'CHARACTER', color:'Red', attribute:'Special',
    power:4000, cost:6, counter:2000, image:IMG('ST23','ST23-001','jpg'),
    ability:"If you have a Character with 10000 power or more, give this card in your hand -4 cost. [Blocker]" },

  { id:'PRB02-002', name:'Trafalgar Law', type:'CHARACTER', color:'Red', attribute:'Slash',
    power:7000, cost:6, counter:1000, image:IMG('PRB02','PRB02-002','jpg'),
    ability:"[Once Per Turn] If this Character would be removed from the field by your opponent's effect, you may give this Character -2000 power during this turn instead. [When Attacking] Give up to 1 of your opponent's Characters -2000 power during this turn." },

  { id:'OP09-009', name:'Benn Beckman', type:'CHARACTER', color:'Red', attribute:'Ranged',
    power:7000, cost:7, counter:1000, image:IMG('OP09','OP09-009','jpg'),
    ability:"[On Play] K.O. up to 1 of your opponents Characters with a power of 6000 or less." },

  { id:'ST15-002', name:'Edward Newgate', type:'CHARACTER', color:'Red', attribute:'Special',
    power:8000, cost:7, counter:0, image:IMG('ST15','ST15-002','png'),
    ability:"[On Play] Give your leader or one of your characters up to one rested DON!!. [Activate: Main] You may rest this character: K.O. up to one of your opponent's characters with 5000 or less power." },

  { id:'OP08-118', name:'Silvers Rayleigh', type:'CHARACTER', color:'Yellow', attribute:'Slash',
    power:8000, cost:8, counter:0, image:IMG('OP08','OP08-118','png'),
    ability:"[On Play] Choose up to two of your opponents characters: Until the end of your opponents next turn, give one -3000 power and the other -2000 power. After this, K.O. up to one of your opponents characters with a power of 3000 or lower." },

  { id:'ST23-002', name:'Shanks', type:'CHARACTER', color:'Red', attribute:'Slash',
    power:10000, cost:9, counter:0, image:IMG('ST23','ST23-002','jpg'),
    ability:"If your opponent has a Character with 8000 base power or more, give this card in your hand -3 cost. [On Play] If your Leader has the {Red-Haired Pirates} type, your Leader gains +2000 power until the end of your opponent's next End Phase." },

  { id:'OP06-007', name:'Shanks', type:'CHARACTER', color:'Red', attribute:'Slash',
    power:12000, cost:10, counter:0, image:IMG('OP06','OP06-007','png'),
    ability:"[On Play] K.O. up to 1 of your opponent's characters with 10000 power or less." },

  { id:'OP09-004', name:'Shanks', type:'CHARACTER', color:'Red', attribute:'Slash',
    power:12000, cost:10, counter:0, image:IMG('OP09','OP09-004','jpg'),
    ability:"All of your opponents characters have -1000 power. [Rush]" },

  { id:'OP09-021', name:'Red Force', type:'STAGE', color:'Red', attribute:'',
    power:0, cost:2, counter:0, image:IMG('OP09','OP09-021','jpg'),
    ability:"[Activate: Main] You may rest this stage: If your leader has the {Red Hair Pirates} type, give up to one of your opponent's characters -1000 power for this turn." },

  { id:'OP04-016', name:'Bad Manners Kick Course', type:'EVENT', color:'Red',
    power:0, cost:1, counter:0, image:IMG('OP04','OP04-016','png'),
    ability:"[Counter] You may trash 1 card from your hand: Give up to 1 of your leaders or characters +3000 Power this battle. [Trigger] Give up to one of your opponent's leaders or characters -3000 power for this turn." },

  { id:'OP10-018', name:'Kamakura Jussoushi', type:'EVENT', color:'Red',
    power:0, cost:2, counter:0, image:IMG('OP10','OP10-018','jpg'),
    ability:"[Counter] Choose up to 1 of your leader or character, it gains +3000 during this battle. Afterwards, one of your opponent's leader or character gets -2000 during this turn. [Trigger] Choose up to 1 of your leader or character, it gets +1000 during this turn." },

  { id:'OP10-019', name:'Divine Departure', type:'EVENT', color:'Red',
    power:0, cost:1, counter:0, image:IMG('OP10','OP10-019','jpg'),
    ability:"[Main] You may rest 5 DON!!: K.O. up to 1 of your opponent's characters with 8000 Power or less. [Counter] Up to 1 of your Leaders gains +3000 Power during this battle." },

  { id:'OP01-026', name:'Gum-Gum Red Hawk', type:'EVENT', color:'Red',
    power:0, cost:2, counter:0, image:IMG('OP01','OP01-026','png'),
    ability:"[Counter] Your Leader or up to 1 of your Characters gains +4000 power during this battle. Then, K.O. up to 1 of your opponent's Characters with 4000 power or less. [Trigger] Give up to 1 of your opponent's Leader or Characters -10000 power during this turn." },

  { id:'OP09-020', name:"Come on!! We'll fight you!!", type:'EVENT', color:'Red',
    power:0, cost:1, counter:0, image:IMG('OP09','OP09-020','jpg'),
    ability:"[Activate: Main] Look at the top 5 cards of your deck, reveal and add one {Red Hair Pirates} type card to your hand. Place the rest at the bottom of the deck in any order. [Trigger] Draw one card." },

  { id:'ST21-017', name:'Gum-Gum Mole Gun', type:'EVENT', color:'Red',
    power:0, cost:4, counter:0, image:IMG('ST21','ST21-017','jpg'),
    ability:"[Main] Give up to one of your opponents characters -5000 power during this turn. Then, if you have a character with 6000 power or more, K.O. up to one of your opponents characters with a power of 2000 or less. [Trigger] Activate this card's [Main] effect." },

  // ══════════════════════════════
  // BLACKBEARD DECK (Black/Multi)
  // ══════════════════════════════
  { id:'OP09-081', name:'Marshall D. Teach', type:'LEADER', color:'Black', attribute:'Special',
    power:5000, life:5, cost:0, counter:0, image:IMG('OP09','OP09-081','jpg'),
    ability:"Your [On Play] abilities don't activate. [Activate: Main] You may trash one card from your hand: Until the end of your opponent's next turn, your opponent's [On Play] abilities don't activate." },

  { id:'OP05-086', name:'Nefertari Vivi', type:'CHARACTER', color:'Black', attribute:'Wisdom',
    power:1000, cost:1, counter:1000, image:IMG('OP05','OP05-086','png'),
    ability:"If your trash has 10 cards or more, this character gains [Blocker]." },

  { id:'OP09-095', name:'Laffitte', type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:1000, cost:1, counter:1000, image:IMG('OP09','OP09-095','jpg'),
    ability:"[Activate: Main] You may rest this character and one of your DON!!: Look at the top 5 cards of your deck, reveal up to one {Blackbeard Pirates} type card and put it into your hand. Place the rest at the bottom of your deck in any order." },

  { id:'OP11-083', name:'Caribou', type:'CHARACTER', color:'Black', attribute:'Special',
    power:2000, cost:1, counter:2000, image:IMG('OP11','OP11-083','jpg'),
    ability:"[Blocker] [On Play] Trash 2 cards from your hand." },

  { id:'OP09-089', name:'Stronger', type:'CHARACTER', color:'Blue', attribute:'Wisdom',
    power:0, cost:1, counter:2000, image:IMG('OP09','OP09-089','jpg'),
    ability:"[Activate: Main] You may trash one card from your hand and this character: If your leader has the {Blackbeard Pirates} type, draw one card. Then give up to one of your opponents characters -2 cost for the turn." },

  { id:'OP09-088', name:'Shiryuu', type:'CHARACTER', color:'Black', attribute:'Slash',
    power:4000, cost:3, counter:2000, image:IMG('OP09','OP09-088','jpg'),
    ability:"[DON!! x1] [When Attacking] You may trash 2 cards from your hand: Draw 2 cards." },

  { id:'OP09-086', name:'Jesus Burgess', type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:5000, cost:4, counter:1000, image:IMG('OP09','OP09-086','jpg'),
    ability:"This character cannot be K.O'd by your opponents effects. If your leader has the {Blackbeard Pirates} type, this character gets +1000 power for every 4 cards in your trash." },

  { id:'PRB02-015', name:'Shiryu', type:'CHARACTER', color:'Black', attribute:'Slash',
    power:5000, cost:4, counter:1000, image:IMG('PRB02','PRB02-015','jpg'),
    ability:"If your Leader has the {Blackbeard Pirates} type, this Character gains [Blocker]. [On K.O.] If your Leader has the {Blackbeard Pirates} type, K.O. up to 1 of your opponent's Characters with a base cost of 4 or less." },

  { id:'OP10-082', name:'Kuzan', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:5000, cost:5, counter:0, image:IMG('OP10','OP10-082','jpg'),
    ability:"This Character cannot be removed from the field by your opponent's effects. [Activate: Main] You may trash this Character: Draw 1 card. Then, play up to 1 {Blackbeard Pirates} type Character card with a cost of 5 or less other than [Kuzan] from your trash." },

  { id:'OP09-084', name:'Catarina Devon', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:6000, cost:5, counter:1000, image:IMG('OP09','OP09-084','jpg'),
    ability:"[Activate: Main] [Once Per Turn] If your leader has the {Blackbeard Pirates} type, until the end of your opponent's next turn this character gains [Double Attack] and [Banish] or [Blocker]." },

  { id:'ST27-003', name:'Kuzan', type:'CHARACTER', color:'Blue', attribute:'Special',
    power:6000, cost:6, counter:1000, image:IMG('ST27','ST27-003','jpg'),
    ability:"[Blocker] [On K.O.] Play up to 1 {Blackbeard Pirates} type Character card with a cost of 5 or less from your trash rested." },

  { id:'OP09-093', name:'Marshall D. Teach', type:'CHARACTER', color:'Black', attribute:'Special',
    power:12000, cost:10, counter:0, image:IMG('OP09','OP09-093','jpg'),
    ability:"[Blocker] [Activate: Main] [Once Per Turn] If your leader has the {Blackbeard Pirates} type and this character was played this turn, up to one of your opponent's leader effects are negated for the rest of the turn. Then, up to one of your opponent's characters effects are negated until the end of your opponent's next turn, that character also cannot attack." },

  { id:'OP09-096', name:"This is MY AGE!!!!", type:'EVENT', color:'Yellow',
    power:0, cost:1, counter:0, image:IMG('OP09','OP09-096','jpg'),
    ability:"[Main] Look at the top 3 cards of your deck and reveal up to one {Blackbeard Pirates} type card other than [This is MY AGE!!!!] and put it into your hand. Then put the rest of the cards into your trash. [Trigger] Activate this card's [Main] effect." },

  { id:'OP09-097', name:'Black Spiral', type:'EVENT', color:'Black',
    power:0, cost:2, counter:0, image:IMG('OP09','OP09-097','jpg'),
    ability:"[Counter] Nullify the effects of up to 1 of your opponent's leader or character and give them -4000 power during this turn. [Trigger] Nullify the effects of up to 1 of your opponent's leader or character during this turn." },

  { id:'OP09-098', name:'Black Hole', type:'EVENT', color:'Black',
    power:0, cost:4, counter:0, image:IMG('OP09','OP09-098','jpg'),
    ability:"[Main] If your Leader has the {Blackbeard Pirates} type, negate the effect of up to 1 of your opponent's Characters during this turn. Then, if that Character has a cost of 4 or less, K.O. it. [Trigger] Negate the effect of up to 1 of your opponent's Leader or Character cards during this turn." },

  { id:'OP09-099', name:'Fullalead', type:'STAGE', color:'Blue', attribute:'',
    power:0, cost:1, counter:0, image:IMG('OP09','OP09-099','jpg'),
    ability:"[Activate: Main] You may trash 1 card from your hand and rest this Stage: Look at 3 cards from the top of your deck; reveal up to 1 {Blackbeard Pirates} type card and add it to your hand. Then, place the rest at the bottom of your deck in any order." },

  // ══════════════════════════════
  // ANNA OF BRITTANY DECK (Blue)
  // ══════════════════════════════
  { id:'ST03-001', name:'Anna of Brittany', type:'LEADER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:5000, life:5, cost:0, counter:0, image:IMG('ST03','ST03-001','png'),
    ability:"[Activate: Main] Once per turn, you may rest 1 of your Characters: Draw 1 card." },

  { id:'OP01-077', name:'FiFi Cat', type:'CHARACTER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:1000, cost:2, counter:1000, image:IMG('OP01','OP01-077','png'),
    ability:"[On Play] Look at 5 cards from the top of your deck and return them to the top or bottom of the deck in any order." },

  { id:'OP01-079', name:'George the Brave', type:'CHARACTER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:1000, cost:3, counter:1000, image:IMG('OP01','OP01-079','png'),
    ability:"[Blocker] [On K.O.] If your Leader has the {Duchess of Brittany} type, add up to 1 Event from your trash to your hand." },

  { id:'OP01-083', name:'Jesse the Jester', type:'CHARACTER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:3000, cost:2, counter:1000, image:IMG('OP01','OP01-083','png'),
    ability:"[DON!! x1] [Your Turn] If your Leader has the {Duchess of Brittany} type, this Character gains +1000 power for every 2 Events in your trash." },

  { id:'OP01-084', name:'Queen Victoria', type:'CHARACTER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:4000, cost:3, counter:2000, image:IMG('OP01','OP01-084','png'),
    ability:"[DON!! x1] [When Attacking] Look at 5 cards from the top of your deck; reveal up to 1 {Duchess of Brittany} type Event card and add it to your hand. Then, place the rest at the bottom of your deck in any order." },

  { id:'OP01-085', name:'Sarra the Wise', type:'CHARACTER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:3000, cost:2, counter:1000, image:IMG('OP01','OP01-085','png'),
    ability:"[On Play] If your Leader has the {Duchess of Brittany} type, select up to 1 of your opponent's Characters with a cost of 4 or less. The selected Character cannot attack until the end of your opponent's next turn." },

  { id:'ST03-003', name:'Noble Shlawger', type:'CHARACTER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:6000, cost:5, counter:0, image:IMG('ST03','ST03-003','png'),
    ability:"[Blocker] [DON!! x1] [On Block] Place up to 1 Character with a cost of 2 or less at the bottom of the owner's deck." },

  { id:'ST03-014', name:'Ball the Berserk', type:'CHARACTER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:4000, cost:4, counter:1000, image:IMG('ST03','ST03-014','png'),
    ability:"[On Play] Return up to 1 Character with a cost of 3 or less to the owner's hand." },

  { id:'OP01-067', name:'Constable Anna', type:'CHARACTER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:7000, cost:7, counter:1000, image:IMG('OP01','OP01-067','png'),
    ability:"[Banish] [DON!! x1] Give blue Events in your hand -1 cost." },

  { id:'ST03-015', name:'Cig Break', type:'EVENT', color:'Blue', affiliation:'Duchess of Brittany',
    power:0, cost:4, counter:0, image:IMG('ST03','ST03-015','png'),
    ability:"[Main] Return up to 1 Character with a cost of 7 or less to the owner's hand. [Trigger] Activate this card's [Main] effect." },

  { id:'ST03-016', name:'Siege of Londinium', type:'EVENT', color:'Blue', affiliation:'Duchess of Brittany',
    power:0, cost:2, counter:0, image:IMG('ST03','ST03-016','png'),
    ability:"[Counter] Return up to 1 Character with a cost of 3 or less to the owner's hand. [Trigger] Activate this card's [Counter] effect." },

  { id:'ST03-017', name:'Leave Me To My Studies', type:'EVENT', color:'Blue', affiliation:'Duchess of Brittany',
    power:0, cost:2, counter:0, image:IMG('ST03','ST03-017','png'),
    ability:"[Counter] Up to 1 of your Leader or Character cards gains +4000 power during this battle. Then, draw 1 card if you have 3 or less cards in your hand." },

  { id:'OP01-087', name:'Snow Merchant', type:'EVENT', color:'Blue', affiliation:'Duchess of Brittany',
    power:0, cost:2, counter:0, image:IMG('OP01','OP01-087','png'),
    ability:"[Counter] Play up to 1 {Duchess of Brittany} type Character card with a cost of 3 or less from your hand. [Trigger] Activate this card's [Counter] effect." },

  { id:'OP01-090', name:'Schola Montis Belli', type:'STAGE', color:'Blue', attribute:'', affiliation:'Duchess of Brittany',
    power:0, cost:1, counter:0, image:IMG('OP01','OP01-090','png'),
    ability:"[Activate: Main] Look at 5 cards from the top of your deck; reveal up to 1 {Duchess of Brittany} type card other than [Schola Montis Belli] and add it to your hand. Then, place the rest at the bottom of your deck in any order." },

  // ══════════════════════════════
  // KAIDO RAMP DECK (Purple)
  // ══════════════════════════════
  { id:'ST04-001', name:'Constable Jack', type:'LEADER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:5000, life:5, cost:0, counter:0, image:IMG('ST04','ST04-001','png'),
    ability:"[Activate: Main] [Once Per Turn] DON!! -7: Trash up to 1 of your opponent's Life cards." },

  { id:'OP01-100', name:'Merchant Dam', type:'CHARACTER', color:'Purple', attribute:'Wisdom', affiliation:'Holy Roman Empire',
    power:3000, cost:2, counter:1000, image:IMG('OP01','OP01-100','png'),
    ability:"[Blocker]" },

  { id:'ST04-010', name:'Monk Matt', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:3000, cost:3, counter:0, image:IMG('ST04','ST04-010','png'),
    ability:"[On Play] DON!! -1: K.O. up to 1 of your opponent's Characters with a cost of 3 or less. [Trigger] Play this card." },

  { id:'OP01-101', name:'Shawn the Whimsical', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:4000, cost:3, counter:2000, image:IMG('OP01','OP01-101','png'),
    ability:"[DON!! x1] [When Attacking] You may trash 1 card from your hand: Add up to 1 DON!! card from your DON!! deck and rest it." },

  { id:'ST04-008', name:'Noble Gee', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:4000, cost:3, counter:1000, image:IMG('ST04','ST04-008','png'),
    ability:"[On Play] You may trash 1 card from your hand: Add up to 1 DON!! card from your DON!! deck and set it as active." },

  { id:'ST04-002', name:'Dabby the Domeless', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:5000, cost:4, counter:2000, image:IMG('ST04','ST04-002','png'),
    ability:"[On Play] DON!! -1: Play up to 1 [Toad Wizzy] card with a cost of 4 or less from your hand." },

  { id:'ST04-012', name:'Toad Wizzy', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:6000, cost:4, counter:1000, image:IMG('ST04','ST04-012','png'),
    ability:"" },

  { id:'ST04-005', name:'Sam the Tall', type:'CHARACTER', color:'Purple', attribute:'Wisdom', affiliation:'Holy Roman Empire',
    power:6000, cost:5, counter:1000, image:IMG('ST04','ST04-005','png'),
    ability:"[Blocker] [On Play] DON!! -1: Draw 2 cards and trash 1 card from your hand." },

  { id:'ST04-004', name:'Chris the Visually Impaired', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:7000, cost:6, counter:0, image:IMG('ST04','ST04-004','png'),
    ability:"[On Play] DON!! -1: K.O. up to 1 of your opponent's Characters with a cost of 4 or less." },

  { id:'OP01-096', name:'Commander Sam', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:7000, cost:7, counter:0, image:IMG('OP01','OP01-096','png'),
    ability:"[On Play] DON!! -2: K.O. up to 1 of your opponent's Characters with a cost of 3 or less and up to 1 of your opponent's Characters with a cost of 2 or less." },

  { id:'ST04-003', name:'Gee, Infernal Hound-Shlawg', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:10000, cost:9, counter:0, image:IMG('ST04','ST04-003','png'),
    ability:"[On Play] DON!! -5: K.O. up to 1 of your opponent's Characters with a cost of 6 or less. This Character gains [Rush] during this turn." },

  { id:'OP01-094', name:'Jack, Master of Gee', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:12000, cost:10, counter:0, image:IMG('OP01','OP01-094','png'),
    ability:"[On Play] DON!! -6: If your Leader has the {Holy Roman Empire} type, K.O. all Characters other than this Character." },

  { id:'ST04-016', name:'Off to the Market', type:'EVENT', color:'Purple', affiliation:'Holy Roman Empire',
    power:0, cost:1, counter:0, image:IMG('ST04','ST04-016','png'),
    ability:"[Counter] DON!! -1: Up to 1 of your Leader or Character cards gains +4000 power during this battle." },

  { id:'OP01-117', name:'Guard Off Duty', type:'EVENT', color:'Purple', affiliation:'Holy Roman Empire',
    power:0, cost:2, counter:0, image:IMG('OP01','OP01-117','png'),
    ability:"[Main] DON!! -1: Rest up to 1 of your opponent's Characters with a cost of 6 or less." },

  { id:'OP01-119', name:'Redpilled', type:'EVENT', color:'Purple', affiliation:'Holy Roman Empire',
    power:0, cost:2, counter:0, image:IMG('OP01','OP01-119','png'),
    ability:"[Counter] Up to 1 of your Leader or Character cards gains +4000 power during this battle. Then, if you have 2 or less Life cards, add up to 1 DON!! card from your DON!! deck and rest it. [Trigger] Add up to 1 DON!! card from your DON!! deck and set it as active." },

  { id:'ST04-015', name:'Blessed Thy Men', type:'EVENT', color:'Purple', affiliation:'Holy Roman Empire',
    power:0, cost:6, counter:0, image:IMG('ST04','ST04-015','png'),
    ability:"[Main] K.O. up to 1 of your opponent's Characters with a cost of 6 or less, then add up to 1 DON!! card from your DON!! deck and set it as active. [Trigger] Add up to 1 DON!! card from your DON!! deck and set it as active." },

  { id:'ST04-017', name:'GTA Server', type:'STAGE', color:'Purple', attribute:'', affiliation:'Holy Roman Empire',
    power:0, cost:3, counter:0, image:IMG('ST04','ST04-017','png'),
    ability:"[Activate: Main] You may rest this Stage: If your Leader has the {Holy Roman Empire} type, add up to 1 DON!! card from your DON!! deck and rest it." },
];

// ─── PRESET DECKS ───
const PRESET_DECKS = {
  'Anna of Brittany': {
    leaderId: 'ST03-001',
    cards: [
      {id:'OP01-079',count:4},{id:'OP01-077',count:4},{id:'OP01-083',count:4},
      {id:'OP01-085',count:4},{id:'ST03-014',count:3},{id:'OP01-084',count:4},
      {id:'ST03-003',count:4},{id:'OP01-067',count:3},{id:'ST03-015',count:4},
      {id:'ST03-016',count:4},{id:'ST03-017',count:4},{id:'OP01-087',count:4},
      {id:'OP01-090',count:4},
    ]
  },
  'Constable Jack': {
    leaderId: 'ST04-001',
    cards: [
      {id:'OP01-100',count:4},{id:'ST04-010',count:4},{id:'OP01-101',count:4},
      {id:'ST04-008',count:4},{id:'ST04-002',count:4},{id:'ST04-012',count:4},
      {id:'ST04-005',count:4},{id:'ST04-004',count:2},{id:'OP01-096',count:2},
      {id:'ST04-003',count:2},{id:'OP01-094',count:2},{id:'ST04-016',count:4},
      {id:'OP01-117',count:1},{id:'OP01-119',count:3},{id:'ST04-015',count:2},
      {id:'ST04-017',count:4},
    ]
  }
};

function getCard(id) { return CARD_DB.find(c => c.id === id); }

function buildCustomDeck(leaderId, cardList) {
  const leader = CARD_DB.find(c => c.id === leaderId);
  if (!leader) return buildCustomDeck('ST03-001', PRESET_DECKS['Anna of Brittany'].cards);
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

function buildDeckByName(name) {
  const preset = PRESET_DECKS[name] || PRESET_DECKS['Anna of Brittany'];
  return buildCustomDeck(preset.leaderId, preset.cards);
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
  const { leader, deck } = deckList
    ? buildCustomDeck(leaderId, deckList)
    : buildDeckByName('Anna of Brittany');
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
    [p1id]: createPlayerState(p1deck?.leaderId || 'ST03-001', p1deck?.cards || PRESET_DECKS['Anna of Brittany'].cards),
    [p2id]: createPlayerState(p2deck?.leaderId || 'ST04-001', p2deck?.cards || PRESET_DECKS['Constable Jack'].cards),
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
    counterWindow: null,
    counterDone: { [p1id]: false, [p2id]: false },
    firstPlayer: p1id,
    battleState: null, // Phase 1 attack flow: {attackerUid, attackerId, attackerName, attackerPower, targetUid, targetName, targetPower, targetIsLeader, counterBonus}
    triggerWindow: null, // Task#1 [Trigger]: {playerId, card}
    playFromHandWindow: null, // PLAY_FROM_HAND resolver: {playerId, candidateUids, costThreshold, typeName, nameMatch, sourceCardName}
    donReturnWindow: null,    // DON!! -N cost: {playerId, sourceCardUid, sourceCardName, timing, required, available}
    koTargetWindow: null,     // KO target picker: {playerId, candidateUids, remaining, optional, sourceCardName, resumeTiming, resumeCardUid, filterKind, filterValue}
    effectQueue: [],     // Pending interactive steps for chained effects (one window at a time today; full queue is reserved for future multi-window cards).
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
    if (game.phase === 'END') doEnd(game);
  }
}

function doRefresh(game) {
  const p = game.players[game.activePlayer];
  p.leader.rested = false;
  p.leader.usedThisTurn = false;
  // Return attached DON to active pool
  p.donActive += (p.leader.attachedDon || 0);
  p.leader.attachedDon = 0;
  p.field.forEach(c => {
    c.rested = false; c.usedThisTurn = false; c.playedThisTurn = false;
    p.donActive += (c.attachedDon || 0);
    c.attachedDon = 0;
  });
  // Rested DON also becomes active
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
  const p = game.players[game.activePlayer];
  while (p.hand.length > 8) { p.trash.push(p.hand.pop()); }
  const ids = Object.keys(game.players);
  game.activePlayer = ids.find(id => id !== game.activePlayer);
  game.turn++;
  game.phase = 'DRAW';
  log(game, `--- Turn ${game.turn} begins ---`);
  doRefresh(game);
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
  // Win condition checked in resolveCounter
}

function resolveCounter(roomId) {
  const room = rooms.get(roomId);
  const game = room.game;
  const cw = game.counterWindow;
  if (!cw) return;

  const attacker = game.players[cw.attackerId];
  const defender = game.players[cw.defenderId];

  const finalAttack = cw.attackPower;
  const finalDefend = cw.defendPower;

  // Find the attacker card for keyword checks
  const attackerPlayer = game.players[cw.attackerId];
  let attackerCard = null;
  if (attackerPlayer.leader.uid === cw.attackerUid) attackerCard = attackerPlayer.leader;
  else attackerCard = attackerPlayer.field.find(c => c.uid === cw.attackerUid);

  const isDoubleAttack = attackerCard && hasDoubleAttack(attackerCard);
  const isBanish = attackerCard && hasBanish(attackerCard);

  if (cw.defenderIsLeader) {
    if (finalAttack > finalDefend) {
      const hits = isDoubleAttack ? 2 : 1;
      if (isDoubleAttack) log(game, `\uD83D\uDCA5 [Double Attack] Flipping ${hits} life cards!`);
      for (let h = 0; h < hits; h++) {
        if (defender.life.length > 0) {
          const lifeCard = defender.life.pop();
          if (isBanish) {
            defender.trash.push(lifeCard);
            log(game, `\uD83D\uDCA5 [Banish] Life card ${lifeCard.name} sent to trash! ${defender.life.length} life remaining.`);
          } else {
            defender.hand.push(lifeCard);
            log(game, `\uD83D\uDCA5 Life card flipped! ${lifeCard.name} added to hand. ${defender.life.length} life remaining.`);
            // Check for [Trigger] effect on the life card
            applyTriggerEffect(game, cw.defenderId, lifeCard);
          }
          if (defender.life.length === 0) {
            game.winner = cw.attackerId;
            log(game, `\uD83C\uDFC6 ${cw.attackerId.slice(0,6)} WINS! Opponent has no life cards!`);
            break;
          }
        }
      }
    } else {
      log(game, `\uD83D\uDEE1\uFE0F Attack blocked by leader's power!`);
    }
  } else {
    const target = defender.field.find(c => c.uid === cw.defenderUid);
    if (target) {
      if (finalAttack >= finalDefend) {
        defender.field = defender.field.filter(c => c.uid !== cw.defenderUid);
        defender.trash.push(target);
        log(game, `\uD83D\uDC80 ${target.name} is K.O.'d!`);
        // Trigger [On K.O.] for the KO'd character
        triggerOnKO(game, cw.defenderId, target, cw.attackerId);
      } else {
        log(game, `\uD83D\uDEE1\uFE0F ${target.name} survives the attack!`);
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
        // Put hand cards at the bottom of the deck, draw 5 new from the top
        p.deck.push(...p.hand);
        p.hand = p.deck.splice(0, 5);
        log(game, `${playerId.slice(0,6)} mulligans.`);
      } else {
        game.mulliganDone[playerId] = true;
        log(game, `${playerId.slice(0,6)} keeps their hand.`);
      }
      if (Object.values(game.mulliganDone).every(v => v)) {
        doRefresh(game);
        // Turn 1 first player skips card draw, goes straight to DON
        game.phase = 'DON';
        log(game, 'Both players ready! Turn 1 begins. Draw DON to start.');
      }
      break;
    }

    case 'DRAW_CARD': {
      console.log('DRAW_CARD:', { playerId, activePlayer: game.activePlayer, isActive, phase: game.phase });
      if (!isActive || game.phase !== 'DRAW') return;
      if (p.deck.length > 0) {
        p.hand.push(p.deck.shift());
        log(game, `${playerId.slice(0,6)} draws a card.`);
      }
      game.phase = 'DON';
      break;
    }

    case 'DRAW_DON': {
      console.log('DRAW_DON:', { playerId, activePlayer: game.activePlayer, isActive, phase: game.phase, turn: game.turn, isFirstPlayer: playerId === game.firstPlayer });
      if (!isActive || game.phase !== 'DON') return;
      // P1 turn 1 gets 1 DON, everyone else gets 2
      const amount = (game.turn === 1 && playerId === game.firstPlayer) ? 1 : 2;
      const added = Math.min(amount, p.donDeck);
      p.donDeck -= added;
      p.donActive += added;
      log(game, `${playerId.slice(0,6)} adds ${added} DON!!`);
      game.phase = 'MAIN';
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
      // Locate the card in the active player's hand by uid — never read cost from anywhere else.
      const cardUid = action.cardUid;
      const idx = p.hand.findIndex(c => c.uid === cardUid);
      const card = idx !== -1 ? p.hand[idx] : null;
      console.log('PLAY_CARD:', {
        playerId,
        activePlayer: game.activePlayer,
        match: playerId === game.activePlayer,
        cardUid,
        foundInHand: game.players[playerId].hand.some(c => c.uid === cardUid),
        cardCost: card?.cost,
        donActive: game.players[playerId].donActive,
      });
      if (idx === -1) return;
      const cardCost = Number(card.cost) || 0;
      const activeDonCount = p.donActive;
      if (activeDonCount < cardCost) { send(playerId, {type:'ERROR', msg:'Not enough DON!!'}); return; }
      // Deduct EXACTLY card.cost from the active player (playerId is the sender and must equal game.activePlayer here).
      p.donActive = activeDonCount - cardCost;
      p.donRested += cardCost;
      console.log('PLAY_CARD after:', {
        playerId,
        cardCost,
        donActive: p.donActive,
        donRested: p.donRested,
        deducted: activeDonCount - p.donActive,
      });
      p.hand.splice(idx, 1);
      if (card.type === 'CHARACTER') {
        card.rested = false;
        card.attachedDon = 0;
        p.field.push(card);
        card.playedThisTurn = true;
        log(game, `${playerId.slice(0,6)} plays ${card.name} (${card.power} power).`);
        parseAndApply('onPlay', game, playerId, card, opp);
      } else if (card.type === 'STAGE') {
        card.rested = false;
        p.field.push(card);
        log(game, `${playerId.slice(0,6)} plays stage ${card.name}.`);
      } else if (card.type === 'EVENT') {
        p.trash.push(card);
        log(game, `${playerId.slice(0,6)} plays event ${card.name}.`);
        parseAndApply('eventMain', game, playerId, card, opp);
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
      // DON goes onto the card, not into rested pool
      target.attachedDon = (target.attachedDon||0) + 1;
      log(game, `${playerId.slice(0,6)} attaches DON!! to ${target.name}. (+1000 power)`);
      break;
    }

    case 'ACTIVATE_MAIN': {
      if (!isActive || game.phase !== 'MAIN') return;
      let card = null;
      let isLeader = false, isStage = false;
      if (action.cardUid === p.leader.uid) { card = p.leader; isLeader = true; }
      else {
        card = p.field.find(c => c.uid === action.cardUid);
        if (card && card.type === 'STAGE') isStage = true;
      }
      if (!card) return;
      if (!card.ability || !card.ability.includes('[Activate: Main]')) {
        send(playerId, {type:'ERROR', msg:'No [Activate: Main] effect.'});
        return;
      }
      if (card.rested) {
        send(playerId, {type:'ERROR', msg:'Card is rested.'});
        return;
      }
      // [Once Per Turn] gate
      if (card.ability.includes('[Once Per Turn]') && card.usedThisTurn) {
        send(playerId, {type:'ERROR', msg:'Already used this turn.'});
        return;
      }
      // Mark used + rest the card (stages rest too on activate).
      card.usedThisTurn = true;
      card.rested = true;
      log(game, `${card.name}: [Activate: Main] activated.`);
      parseAndApply('activateMain', game, playerId, card, opp);
      break;
    }

    case 'ATTACK': {
      if (!isActive || game.phase !== 'MAIN') return;
      let attacker = null;
      if (action.attackerUid === p.leader.uid) attacker = p.leader;
      else attacker = p.field.find(c => c.uid === action.attackerUid);
      if (!attacker || attacker.rested) { send(playerId, {type:'ERROR', msg:'That card is rested or invalid'}); return; }
      // Cannot attack on turn 1
      if (game.turn === 1 && game.activePlayer === game.firstPlayer) {
        send(playerId, {type:'ERROR', msg:'Cannot attack on turn 1'});
        return;
      }
      // Characters cannot attack the turn they are played (unless Rush)
      if (attacker.playedThisTurn && !(attacker.ability && attacker.ability.includes('[Rush]'))) {
        send(playerId, {type:'ERROR', msg:'This character cannot attack this turn'});
        return;
      }
      if (attacker.type === 'STAGE') { send(playerId, {type:'ERROR', msg:'Stages cannot attack'}); return; }

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

      log(game, `\u2694\uFE0F ${attacker.name} (${attackPower}) attacks ${defender.name} (${defendPower})!`);

      // Trigger [When Attacking] effects
      parseAndApply('whenAttacking', game, playerId, attacker, opp);

      game.counterWindow = {
        attackerUid: attacker.uid, defenderUid: defender.uid,
        attackPower, defendPower, defenderIsLeader,
        attackerId: playerId, defenderId: oppId,
      };
      game.counterDone = { [playerId]: true, [oppId]: false };
      log(game, `\uD83C\uDCF4 ${oppId.slice(0,6)} may play counter cards!`);
      break;
    }

    // ─── Phase 1 attack flow (split from ATTACK) ───
    case 'DECLARE_ATTACK': {
      if (!isActive || game.phase !== 'MAIN') return;
      let attacker = null;
      if (action.attackerUid === p.leader.uid) attacker = p.leader;
      else attacker = p.field.find(c => c.uid === action.attackerUid);
      if (!attacker) { send(playerId, {type:'ERROR', msg:'Invalid attacker'}); return; }
      if (attacker.rested) { send(playerId, {type:'ERROR', msg:'That card is rested'}); return; }
      if (attacker.type === 'STAGE') { send(playerId, {type:'ERROR', msg:'Stages cannot attack'}); return; }
      if (game.turn === 1 && game.activePlayer === game.firstPlayer) {
        send(playerId, {type:'ERROR', msg:'Cannot attack on turn 1'}); return;
      }
      if (attacker.playedThisTurn && !(attacker.ability && attacker.ability.includes('[Rush]'))) {
        send(playerId, {type:'ERROR', msg:'This character cannot attack this turn'}); return;
      }
      const attackerPower = (attacker.power || 0) + (attacker.attachedDon || 0) * 1000;
      attacker.rested = true;
      game.battleState = {
        attackerUid: attacker.uid,
        attackerId: playerId,
        attackerName: attacker.name,
        attackerPower,
        targetUid: null,
        targetName: null,
        targetPower: 0,
        targetIsLeader: false,
        counterBonus: 0,
      };
      game.phase = 'ATTACKING';
      log(game, `\u2694\uFE0F ${attacker.name} declares an attack — choose a target.`);
      break;
    }

    case 'SELECT_TARGET': {
      if (game.phase !== 'ATTACKING' || !game.battleState) return;
      if (game.battleState.attackerId !== playerId) return;
      let target = null;
      let targetIsLeader = false;
      if (action.targetUid === opp.leader.uid) {
        target = opp.leader;
        targetIsLeader = true;
      } else {
        target = opp.field.find(c => c.uid === action.targetUid);
        if (target && target.type !== 'STAGE' && !target.rested) {
          send(playerId, {type:'ERROR', msg:'Cannot attack an active character — target must be rested or be the leader.'});
          return;
        }
      }
      if (!target) { send(playerId, {type:'ERROR', msg:'Invalid target'}); return; }
      if (target.type === 'STAGE') { send(playerId, {type:'ERROR', msg:'Cannot attack a stage'}); return; }
      const targetPower = (target.power || 0) + (target.attachedDon || 0) * 1000;
      game.battleState.targetUid = target.uid;
      game.battleState.targetName = target.name;
      game.battleState.targetPower = targetPower;
      game.battleState.targetIsLeader = targetIsLeader;
      game.phase = 'BLOCK_STEP';
      log(game, `\uD83C\uDFAF ${game.battleState.attackerName} (${game.battleState.attackerPower}) \u2192 ${target.name} (${targetPower})`);
      break;
    }

    case 'CANCEL_ATTACK': {
      if (game.phase !== 'ATTACKING' || !game.battleState) return;
      if (game.battleState.attackerId !== playerId) return;
      let attacker = null;
      if (game.battleState.attackerUid === p.leader.uid) attacker = p.leader;
      else attacker = p.field.find(c => c.uid === game.battleState.attackerUid);
      if (attacker) attacker.rested = false;
      game.battleState = null;
      game.phase = 'MAIN';
      log(game, `Attack cancelled.`);
      break;
    }

    // ─── Phase 2 block step ───
    case 'USE_BLOCKER': {
      if (game.phase !== 'BLOCK_STEP' || !game.battleState) return;
      const defenderId = Object.keys(game.players).find(id => id !== game.battleState.attackerId);
      if (playerId !== defenderId) return;
      const defender = game.players[defenderId];
      const blocker = defender.field.find(c => c.uid === action.blockerUid);
      if (!blocker) { send(playerId, {type:'ERROR', msg:'Invalid blocker'}); return; }
      if (!blocker.ability || !blocker.ability.includes('[Blocker]')) {
        send(playerId, {type:'ERROR', msg:'That card has no [Blocker]'}); return;
      }
      if (blocker.rested) { send(playerId, {type:'ERROR', msg:'Blocker is rested'}); return; }
      // Rest the blocker and redirect the battle target onto it.
      blocker.rested = true;
      game.battleState.targetUid = blocker.uid;
      game.battleState.targetName = blocker.name;
      game.battleState.targetPower = (blocker.power || 0) + (blocker.attachedDon || 0) * 1000;
      game.battleState.targetIsLeader = false;
      game.phase = 'COUNTER_STEP';
      log(game, `\uD83D\uDEE1\uFE0F ${blocker.name} blocks the attack!`);
      break;
    }

    case 'NO_BLOCKER': {
      if (game.phase !== 'BLOCK_STEP' || !game.battleState) return;
      const defenderId = Object.keys(game.players).find(id => id !== game.battleState.attackerId);
      if (playerId !== defenderId) return;
      game.phase = 'COUNTER_STEP';
      log(game, `Defender declines to block.`);
      break;
    }

    // ─── Phase 3 counter step ───
    case 'USE_COUNTER': {
      if (game.phase !== 'COUNTER_STEP' || !game.battleState) return;
      const defenderId = Object.keys(game.players).find(id => id !== game.battleState.attackerId);
      if (playerId !== defenderId) return;
      const defender = game.players[defenderId];
      const idx = defender.hand.findIndex(c => c.uid === action.cardUid);
      if (idx === -1) return;
      const card = defender.hand[idx];
      const cv = counterValueOf(card);
      const hasCounterAbility = !!(card.ability && card.ability.includes('[Counter]'));
      // Eligible if it adds power OR has any [Counter] action effect (e.g. Snow Merchant).
      if (cv <= 0 && !hasCounterAbility) {
        send(playerId, {type:'ERROR', msg:'That card has no counter effect'});
        return;
      }
      defender.hand.splice(idx, 1);
      defender.trash.push(card);
      if (cv > 0) {
        game.battleState.counterBonus = (game.battleState.counterBonus || 0) + cv;
        log(game, `\uD83D\uDEE1\uFE0F ${card.name} +${cv} (counter bonus: ${game.battleState.counterBonus})`);
      } else {
        log(game, `\uD83D\uDEE1\uFE0F ${card.name} played as counter — resolving effect.`);
      }
      // Always fire any [Counter] action effects (play-from-hand, K.O., bounce, draw, …).
      // This is a no-op for character counter cards (they don't have [Counter] in ability).
      if (hasCounterAbility) {
        const oppOfDefender = game.players[Object.keys(game.players).find(id => id !== defenderId)];
        parseAndApply('counter', game, defenderId, card, oppOfDefender);
      }
      break;
    }

    // ─── Phase 4 resolution ───
    case 'RESOLVE_ATTACK': {
      if (game.phase !== 'COUNTER_STEP' || !game.battleState) return;
      const bs = game.battleState;
      const defenderId = Object.keys(game.players).find(id => id !== bs.attackerId);
      // Defender drives resolution (they decide when to stop countering).
      if (playerId !== defenderId) return;

      const attackerPlayer = game.players[bs.attackerId];
      const defender = game.players[defenderId];

      let attackerCard = null;
      if (attackerPlayer.leader.uid === bs.attackerUid) attackerCard = attackerPlayer.leader;
      else attackerCard = attackerPlayer.field.find(c => c.uid === bs.attackerUid);

      const totalDefense = bs.targetPower + (bs.counterBonus || 0);
      // OPTCG tie rules: leader → defender wins ties (>); character → attacker wins ties (>=).
      const attackerWins = bs.targetIsLeader
        ? bs.attackerPower >  totalDefense
        : bs.attackerPower >= totalDefense;

      if (attackerWins) {
        if (bs.targetIsLeader) {
          // Hit the leader. If defender has 0 life left, they lose.
          if (defender.life.length === 0) {
            game.winner = bs.attackerId;
            log(game, `\uD83C\uDFC6 ${bs.attackerName} hits the leader with no life left — ${bs.attackerId.slice(0,6)} WINS!`);
          } else {
            const lifeCard = defender.life.pop();
            defender.hand.push(lifeCard);
            log(game, `\uD83D\uDCA5 ${bs.attackerName} hits the leader! Life card ${lifeCard.name} \u2192 hand. ${defender.life.length} life remaining.`);
            applyTriggerEffect(game, defenderId, lifeCard);
          }
        } else {
          // Hit a character (the original target or the chosen blocker) — KO it.
          const target = defender.field.find(c => c.uid === bs.targetUid);
          if (target) {
            defender.field = defender.field.filter(c => c.uid !== bs.targetUid);
            defender.trash.push(target);
            log(game, `\uD83D\uDC80 ${target.name} K.O.'d! (${bs.attackerPower} vs ${totalDefense})`);
            triggerOnKO(game, defenderId, target, bs.attackerId);
          }
        }
      } else {
        log(game, `\uD83D\uDEE1\uFE0F ${bs.targetName} survives the attack (${bs.attackerPower} vs ${totalDefense}).`);
        // Blocker that wins stays on board, but remains rested (already rested by USE_BLOCKER).
      }

      // Attacker stays rested (already rested by DECLARE_ATTACK).
      game.battleState = null;
      game.phase = 'MAIN';
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
      log(game, `\uD83D\uDEE1\uFE0F ${playerId.slice(0,6)} counters with ${card.name} (+${card.counter})! Defend: ${game.counterWindow.defendPower}`);
      // Apply additional [Counter] effects from the card's ability
      if (card.ability && card.ability.includes('[Counter]')) {
        const counterOppId = Object.keys(game.players).find(id => id !== playerId);
        const counterOpp = game.players[counterOppId];
        parseAndApply('counter', game, playerId, card, counterOpp);
      }
      break;
    }

    case 'BLOCK': {
      if (!game.counterWindow || game.counterWindow.defenderId !== playerId) return;
      const blocker = p.field.find(c => c.uid === action.blockerUid && !c.rested);
      if (!blocker || !blocker.ability || !blocker.ability.includes('[Blocker]')) {
        send(playerId, {type:'ERROR', msg:'Invalid blocker'});
        return;
      }
      blocker.rested = true;
      // Redirect attack to blocker
      game.counterWindow.defenderUid = blocker.uid;
      game.counterWindow.defenderIsLeader = false;
      game.counterWindow.defendPower = (blocker.power||0) + (blocker.attachedDon||0)*1000;
      log(game, `🛡️ ${blocker.name} blocks the attack! (${game.counterWindow.defendPower} power)`);
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

    case 'SCRY_RESOLVE': {
      if (!game.scryWindow || game.scryWindow.playerId !== playerId) return;
      const sw = game.scryWindow;
      const kept = action.keptIndices || []; // indices of cards to keep in hand
      const order = action.order || []; // ordered indices for cards going back to deck
      const placement = action.placement === 'top' ? 'top' : (sw.placement === 'top' ? 'top' : 'bottom');

      // Validate keep count + filters
      if (kept.length > (sw.keepCount || 0)) {
        send(playerId, {type:'ERROR', msg:`May only keep up to ${sw.keepCount} cards.`});
        return;
      }
      for (const idx of kept) {
        const c = sw.cards[idx];
        if (!c) { send(playerId, {type:'ERROR', msg:'Invalid keep index.'}); return; }
        if (sw.keepFilter) {
          const aff = c.affiliation || '';
          if (!aff.toLowerCase().includes(sw.keepFilter.toLowerCase())) {
            send(playerId, {type:'ERROR', msg:`${c.name} is not a {${sw.keepFilter}} card.`});
            return;
          }
        }
        if (sw.keepExcludeName && c.name === sw.keepExcludeName) {
          send(playerId, {type:'ERROR', msg:`Cannot keep another [${sw.keepExcludeName}].`});
          return;
        }
      }

      // Add kept cards to hand
      kept.forEach(idx => {
        if (sw.cards[idx]) p.hand.push(sw.cards[idx]);
      });
      if (kept.length > 0) log(game, `${sw.cardName}: added ${kept.length} card(s) to hand.`);

      // Cards returning to the deck in the player's chosen order (first = top of that placement)
      const remaining = sw.cards.filter((_, idx) => !kept.includes(idx));
      const ordered = order.length > 0
        ? order.map(idx => remaining[idx]).filter(Boolean)
        : remaining;
      // deck[0] = top of deck; unshift places on top, push places on bottom
      if (placement === 'top') p.deck.unshift(...ordered);
      else p.deck.push(...ordered);
      log(game, `${sw.cardName}: returned ${ordered.length} card(s) to ${placement} of deck.`);

      game.scryWindow = null;
      break;
    }

    case 'END_TURN': {
      console.log('END_TURN received', { playerId, activePlayer: game.activePlayer, isActive, phase: game.phase, turn: game.turn, counterWindow: !!game.counterWindow });
      if (!isActive) { console.log('END_TURN rejected: not active player'); return; }
      // Auto-resolve counter window if active
      if (game.counterWindow) {
        console.log('END_TURN: auto-resolving counter window');
        game.counterDone[playerId] = true;
        if (Object.values(game.counterDone).every(v => v)) {
          resolveCounter(roomId);
        }
      }
      doEnd(game);
      console.log('END_TURN complete, new activePlayer:', game.activePlayer, 'turn:', game.turn, 'phase:', game.phase);
      break;
    }

    // ─── Task #1: [Trigger] interactive resolution ───
    case 'KO_TARGET_SELECTED': {
      if (!game.koTargetWindow || game.koTargetWindow.playerId !== playerId) return;
      const w = game.koTargetWindow;
      const oppOfActor = game.players[Object.keys(game.players).find(id => id !== playerId)];
      const finishWindow = () => {
        const resumeTiming  = w.resumeTiming;
        const resumeCardUid = w.resumeCardUid;
        game.koTargetWindow = null;
        if (resumeTiming && resumeCardUid) {
          const owner = game.players[playerId];
          const src = (owner.leader && owner.leader.uid === resumeCardUid) ? owner.leader
                    : (owner.field || []).find(c => c.uid === resumeCardUid);
          if (src) {
            const oppOfSrc = game.players[Object.keys(game.players).find(id => id !== playerId)];
            parseAndApply(resumeTiming, game, playerId, src, oppOfSrc, { koResolved: true });
          }
        }
      };
      if (action.skip) {
        if (!w.optional) { send(playerId, {type:'ERROR', msg:'Must select a K.O. target.'}); return; }
        log(game, `${w.sourceCardName}: K.O. skipped.`);
        finishWindow();
        break;
      }
      const target = oppOfActor.field.find(c => c.uid === action.targetUid);
      if (!target || !w.candidateUids.includes(action.targetUid)) {
        send(playerId, {type:'ERROR', msg:'Invalid K.O. target.'});
        return;
      }
      oppOfActor.field = oppOfActor.field.filter(c => c.uid !== action.targetUid);
      oppOfActor.trash.push(target);
      log(game, `\uD83D\uDC80 ${target.name} K.O.'d!`);
      triggerOnKO(game, Object.keys(game.players).find(id => id !== playerId), target, playerId);

      // Multi-target: decrement and re-filter (the just-KO'd card is gone).
      w.remaining -= 1;
      if (w.remaining > 0) {
        const stillThere = oppOfActor.field
          .filter(c => w.candidateUids.includes(c.uid))
          .map(c => c.uid);
        if (stillThere.length > 0) {
          w.candidateUids = stillThere;
          break; // window stays open
        }
      }
      finishWindow();
      break;
    }

    case 'RETURN_DON': {
      if (!game.donReturnWindow || game.donReturnWindow.playerId !== playerId) return;
      const w = game.donReturnWindow;
      const sel = action.selections || {};
      const fromActive = parseInt(sel.fromActive) || 0;
      const fromRested = parseInt(sel.fromRested) || 0;
      const fromCards  = Array.isArray(sel.fromCards) ? sel.fromCards : [];
      const totalSel = fromActive + fromRested
        + fromCards.reduce((s, fc) => s + (parseInt(fc.amount) || 0), 0);
      if (totalSel !== w.required) {
        send(playerId, {type:'ERROR', msg:`Must return exactly ${w.required} DON!! (selected ${totalSel}).`});
        return;
      }
      const owner = game.players[playerId];
      if (fromActive < 0 || fromActive > owner.donActive) {
        send(playerId, {type:'ERROR', msg:'Invalid active DON!! count.'}); return;
      }
      if (fromRested < 0 || fromRested > owner.donRested) {
        send(playerId, {type:'ERROR', msg:'Invalid rested DON!! count.'}); return;
      }
      // Validate per-card amounts before mutating anything.
      const targets = [];
      for (const fc of fromCards) {
        const amt = parseInt(fc.amount) || 0;
        if (amt <= 0) continue;
        let target = null;
        if (fc.cardUid === owner.leader.uid) target = owner.leader;
        else target = owner.field.find(c => c.uid === fc.cardUid);
        if (!target) { send(playerId, {type:'ERROR', msg:'Invalid card.'}); return; }
        if (amt > (target.attachedDon || 0)) {
          send(playerId, {type:'ERROR', msg:`Not enough DON on ${target.name}.`}); return;
        }
        targets.push({ target, amt });
      }
      // Apply
      owner.donActive -= fromActive;
      owner.donRested -= fromRested;
      for (const { target, amt } of targets) target.attachedDon -= amt;
      owner.donDeck += w.required;
      log(game, `${w.sourceCardName}: returned ${w.required} DON!! to deck.`);

      // Resume the original effect with cost-already-paid.
      const sourceCard = (owner.leader.uid === w.sourceCardUid) ? owner.leader
                       : owner.field.find(c => c.uid === w.sourceCardUid);
      const timing = w.timing;
      game.donReturnWindow = null;
      if (sourceCard) {
        const oppOfSource = game.players[Object.keys(game.players).find(id => id !== playerId)];
        parseAndApply(timing, game, playerId, sourceCard, oppOfSource, { donCostPaid: true });
      }
      break;
    }

    case 'TRIGGER_RESOLVE': {
      if (!game.triggerWindow) return;
      if (game.triggerWindow.playerId !== playerId) return;
      const tw = game.triggerWindow;
      if (action.activate) {
        // Event triggers: the card moves from hand → trash before resolving its effect
        // (per OPTCG rules; an Event "trashes itself" when its [Trigger] is activated).
        if (tw.card.type === 'EVENT') {
          const owner = game.players[playerId];
          const hidx = owner.hand.findIndex(c => c.uid === tw.card.uid);
          if (hidx !== -1) {
            owner.hand.splice(hidx, 1);
            owner.trash.push(tw.card);
            log(game, `[Trigger] ${tw.card.name} → trash.`);
          }
        }
        const oppOfTrigger = game.players[Object.keys(game.players).find(id => id !== playerId)];
        log(game, `[Trigger] ${tw.card.name} activated!`);
        parseAndApply('trigger', game, playerId, tw.card, oppOfTrigger);
      } else {
        log(game, `[Trigger] ${tw.card.name} skipped.`);
      }
      game.triggerWindow = null;
      break;
    }

    case 'PLAY_FROM_HAND_RESOLVE': {
      if (!game.playFromHandWindow) return;
      const w = game.playFromHandWindow;
      if (w.playerId !== playerId) return;
      const owner = game.players[playerId];
      if (action.skip) {
        log(game, `${w.sourceCardName || 'Effect'}: choice skipped.`);
        game.playFromHandWindow = null;
        break;
      }
      if (!action.cardUid || !w.candidateUids.includes(action.cardUid)) {
        send(playerId, {type:'ERROR', msg:'Invalid card pick.'});
        return;
      }
      const hidx = owner.hand.findIndex(c => c.uid === action.cardUid);
      if (hidx === -1) { game.playFromHandWindow = null; break; }
      const picked = owner.hand.splice(hidx, 1)[0];
      // Match PLAY_CARD's deploy semantics so the free-played card behaves identically
      // to a hand-deployed one (including [On Play] firing).
      picked.rested = false;
      picked.attachedDon = 0;
      picked.usedThisTurn = false;
      picked.playedThisTurn = true;
      owner.field.push(picked);
      log(game, `${w.sourceCardName || 'Effect'}: played ${picked.name} from hand for free.`);
      // Clear window before firing onPlay (which may itself open another window).
      game.playFromHandWindow = null;
      // Always fire [On Play] for the deployed card — same as the normal PLAY_CARD path.
      const opp2 = game.players[Object.keys(game.players).find(id => id !== playerId)];
      log(game, `${picked.name}: triggering [On Play].`);
      parseAndApply('onPlay', game, playerId, picked, opp2);
      break;
    }
  }

  checkWin(game);
  sendState(roomId);
}

// ─── KEYWORD EFFECT INTERPRETER ───

// Helper: draw N cards
function drawCards(p, count, game, cardName) {
  let drawn = 0;
  for (let i = 0; i < count && p.deck.length > 0; i++) {
    p.hand.push(p.deck.shift());
    drawn++;
  }
  if (drawn > 0) log(game, `${cardName}: drew ${drawn} card(s).`);
  return drawn;
}

// Helper: KO opponent character with power <= threshold
function koByPower(opp, threshold, game, cardName) {
  const target = opp.field.find(c => c.type === 'CHARACTER' && (c.power + (c.attachedDon || 0) * 1000) <= threshold);
  if (target) {
    opp.field = opp.field.filter(c => c.uid !== target.uid);
    opp.trash.push(target);
    log(game, `${cardName}: K.O.'d ${target.name} (power <= ${threshold})!`);
    return target;
  }
  return null;
}

// Helper: KO opponent character with cost <= threshold
function koByCost(opp, threshold, game, cardName) {
  const target = opp.field.find(c => c.type === 'CHARACTER' && (c.cost || 0) <= threshold);
  if (target) {
    opp.field = opp.field.filter(c => c.uid !== target.uid);
    opp.trash.push(target);
    log(game, `${cardName}: K.O.'d ${target.name} (cost <= ${threshold})!`);
    return target;
  }
  return null;
}

// Helper: add DON from DON deck
function addDonFromDeck(p, count, rested, game, cardName) {
  let added = 0;
  for (let i = 0; i < count && p.donDeck > 0; i++) {
    p.donDeck--;
    if (rested) p.donRested++;
    else p.donActive++;
    added++;
  }
  if (added > 0) log(game, `${cardName}: added ${added} DON!! (${rested ? 'rested' : 'active'}).`);
  return added;
}

// Helper: bounce character by power threshold back to owner's hand
function bounceByPower(opp, threshold, game, cardName) {
  const target = opp.field.find(c => c.type === 'CHARACTER' && (c.power + (c.attachedDon || 0) * 1000) <= threshold);
  if (target) {
    opp.field = opp.field.filter(c => c.uid !== target.uid);
    target.attachedDon = 0;
    opp.hand.push(target);
    log(game, `${cardName}: returned ${target.name} to hand (power <= ${threshold}).`);
    return target;
  }
  return null;
}

// Helper: bounce character by cost threshold back to owner's hand
function bounceByCost(targetPlayer, threshold, game, cardName) {
  const target = targetPlayer.field.find(c => c.type === 'CHARACTER' && (c.cost || 0) <= threshold);
  if (target) {
    targetPlayer.field = targetPlayer.field.filter(c => c.uid !== target.uid);
    target.attachedDon = 0;
    targetPlayer.hand.push(target);
    log(game, `${cardName}: returned ${target.name} to hand (cost <= ${threshold}).`);
    return target;
  }
  return null;
}

// Helper: rest opponent character(s)
function restOpponentCharacter(opp, game, cardName, costThreshold) {
  let target;
  if (costThreshold !== undefined) {
    target = opp.field.find(c => c.type === 'CHARACTER' && !c.rested && (c.cost || 0) <= costThreshold);
  } else {
    target = opp.field.find(c => c.type === 'CHARACTER' && !c.rested);
  }
  if (target) {
    target.rested = true;
    log(game, `${cardName}: rested ${target.name}!`);
    return target;
  }
  return null;
}

// Helper: give power reduction to an opponent's character
function givePowerReduction(opp, amount, game, cardName) {
  const target = opp.field.find(c => c.type === 'CHARACTER');
  if (target) {
    target.power = Math.max(0, target.power - amount);
    log(game, `${cardName}: gave ${target.name} -${amount} power! (now ${target.power})`);
    if (target.power <= 0) {
      opp.field = opp.field.filter(c => c.uid !== target.uid);
      opp.trash.push(target);
      log(game, `${target.name} was K.O.'d by power reduction!`);
      return target;
    }
  }
  return null;
}

// Helper: check if card has enough attached DON for conditional effects
function checkDonRequirement(card, text) {
  const donMatch = text.match(/\[DON!!\s*x(\d+)\]/);
  if (donMatch) {
    const required = parseInt(donMatch[1]);
    return (card.attachedDon || 0) >= required;
  }
  return true; // no DON requirement
}

// Helper: check if card has [Blocker]
function hasBlocker(card) {
  return card.ability && card.ability.includes('[Blocker]');
}

// Helper: check if card has [Double Attack]
function hasDoubleAttack(card) {
  return card.ability && card.ability.includes('[Double Attack]');
}

// Helper: check if card has [Banish]
function hasBanish(card) {
  return card.ability && card.ability.includes('[Banish]');
}

// Helper: check if card has [Rush]
function hasRush(card) {
  return card.ability && card.ability.includes('[Rush]');
}

// Helper: numeric counter value of a card. Characters use card.counter; events
// with [Counter] in their ability text get the +N power found in the effect.
function counterValueOf(card) {
  if (card.counter && card.counter > 0) return card.counter;
  if (card.ability && card.ability.includes('[Counter]')) {
    const m = card.ability.match(/\+(\d+)\s*power/i);
    if (m) return parseInt(m[1], 10);
  }
  return 0;
}

// Helper: extract effect text after a timing keyword
function extractEffect(ability, keyword) {
  const idx = ability.indexOf(keyword);
  if (idx === -1) return null;
  let text = ability.substring(idx + keyword.length).trim();
  // Trim to the next timing keyword or end
  const nextKeywords = ['[On Play]', '[On K.O.]', '[When Attacking]', '[Blocker]', '[Counter]',
    '[Trigger]', '[Activate: Main]', '[Rush]', '[Double Attack]', '[Banish]',
    "[On Your Opponent's Attack]", "[Opponent's Turn]", '[Once Per Turn]',
    '[End of Your Turn]', '[Your Turn]', '[Main]'];
  let endIdx = text.length;
  for (const nk of nextKeywords) {
    const ni = text.indexOf(nk);
    if (ni > 0 && ni < endIdx) endIdx = ni;
  }
  return text.substring(0, endIdx).trim();
}

// Helper: auto-play a character from hand with cost <= threshold
function autoPlayFromHand(p, costThreshold, game, cardName, typeFilter) {
  const idx = p.hand.findIndex(c => c.type === 'CHARACTER' && (c.cost || 0) <= costThreshold &&
    (!typeFilter || c.ability.includes(typeFilter) || c.name.includes(typeFilter)));
  if (idx !== -1) {
    const card = p.hand.splice(idx, 1)[0];
    card.rested = false;
    card.attachedDon = card.attachedDon || 0;
    p.field.push(card);
    log(game, `${cardName}: played ${card.name} from hand (cost <= ${costThreshold}).`);
    return card;
  }
  return null;
}

// ─── PLAY_FROM_HAND interactive resolver ──────────────────────────────────────
// Opens game.playFromHandWindow so the player picks which Character to deploy
// for free. Pattern: "Play up to 1 [{TYPE} type] Character card with a cost of
// N or less from your hand". `typeName` filters by card.affiliation; `nameMatch`
// targets a specific named card (e.g. ST04-002 references [Toad Wizzy]).
function openPlayFromHand(game, playerId, opts) {
  const p = game.players[playerId];
  const { costThreshold = 99, typeName = null, nameMatch = null, sourceCardName = '' } = opts || {};
  const candidates = p.hand.filter(c => {
    if (c.type !== 'CHARACTER') return false;
    if ((c.cost || 0) > costThreshold) return false;
    if (nameMatch && c.name !== nameMatch) return false;
    if (typeName) {
      const aff = c.affiliation || '';
      if (!aff.toLowerCase().includes(typeName.toLowerCase())) return false;
    }
    return true;
  });
  if (candidates.length === 0) {
    let why = '';
    if      (nameMatch) why = ` matching [${nameMatch}]`;
    else if (typeName)  why = ` for {${typeName}}`;
    log(game, `${sourceCardName || 'Effect'}: no valid Characters in hand${why} (cost ${costThreshold} or less).`);
    return false;
  }
  game.playFromHandWindow = {
    playerId,
    candidateUids: candidates.map(c => c.uid),
    costThreshold,
    typeName: typeName || '',
    nameMatch: nameMatch || '',
    sourceCardName,
  };
  log(game, `${sourceCardName || 'Effect'}: choose a Character to play for free` +
            (typeName ? ` ({${typeName}})` : '') + ` (${candidates.length} option(s)).`);
  return true;
}

// Extract "{Type Name} type Character" affiliation filter from an effect snippet.
function extractTypeFilter(text) {
  const m = text.match(/\{([^}]+)\}\s*type\s*Character/i);
  return m ? m[1] : null;
}

// Open the interactive DON!!-return window for a "DON!! -N: <effect>" cost. The
// player will pick which DON to send back to the deck (active/rested/attached).
// Returns true if the window opened, false if the player can't afford the cost
// (sum of donActive + donRested + every attachedDon < required).
function openDonReturn(game, playerId, card, required, timing) {
  const p = game.players[playerId];
  const attachedSources = [];
  if (p.leader && (p.leader.attachedDon || 0) > 0) {
    attachedSources.push({ cardUid: p.leader.uid, cardName: p.leader.name, attached: p.leader.attachedDon });
  }
  p.field.forEach(c => {
    if ((c.attachedDon || 0) > 0) {
      attachedSources.push({ cardUid: c.uid, cardName: c.name, attached: c.attachedDon });
    }
  });
  const totalAttached = attachedSources.reduce((s, a) => s + a.attached, 0);
  const totalAvailable = p.donActive + p.donRested + totalAttached;
  if (totalAvailable < required) {
    log(game, `${card.name}: not enough DON!! to pay (need ${required}, have ${totalAvailable}).`);
    return false;
  }
  game.donReturnWindow = {
    playerId,
    sourceCardUid: card.uid,
    sourceCardName: card.name,
    timing,
    required,
    available: {
      donActive: p.donActive,
      donRested: p.donRested,
      attachedDon: attachedSources,
    },
  };
  log(game, `${card.name}: choose ${required} DON!! to return to deck.`);
  return true;
}

// Open the interactive KO target picker. Returns true if at least one valid target
// exists and the window opened, false otherwise (the caller should fall through).
// `count` defaults to 1 — for multi-target ("K.O. up to N"), the window stays open
// until the count is exhausted or the player skips.
function openKoTargetWindow(game, playerId, opts) {
  const opp = game.players[Object.keys(game.players).find(id => id !== playerId)];
  const candidates = opp.field.filter(c => c.type === 'CHARACTER' && opts.filter(c));
  if (candidates.length === 0) {
    log(game, `${opts.sourceCardName}: no valid K.O. targets.`);
    return false;
  }
  game.koTargetWindow = {
    playerId,
    candidateUids: candidates.map(c => c.uid),
    remaining: opts.count || 1,
    optional: opts.optional !== false,
    sourceCardName: opts.sourceCardName,
    filterKind:  opts.filterKind  || 'character',
    filterValue: opts.filterValue || '',
    resumeTiming:  opts.resumeTiming  || null,
    resumeCardUid: opts.resumeCardUid || null,
  };
  log(game, `${opts.sourceCardName}: choose a K.O. target (${candidates.length} option(s)).`);
  return true;
}

// Generic scry opener — handles any
//   "Look at top N cards [reveal up to M {Type} type card] [other than [Name]]
//    and add it to your hand[. Then place the rest at the (top|bottom)]"
// pattern. Used by [On Play], [Activate: Main], [Counter], [When Attacking], etc.
function tryOpenScryFromEffect(game, playerId, card, effect) {
  const p = game.players[playerId];
  const lookMatch = effect.match(/[Ll]ook at.*?(\d+) cards? from the top/i);
  if (!lookMatch) return false;
  const lookCount = Math.min(parseInt(lookMatch[1]), p.deck.length);
  if (lookCount <= 0) return false;
  const revealMatch = effect.match(/reveal up to (\d+)/i);
  const keepCount = revealMatch ? parseInt(revealMatch[1]) : 0;
  const keepFilter = extractTypeFilter(effect);  // e.g. "Duchess of Brittany"
  // "other than [Name]" — exclude from keep candidates by name.
  const otherThanMatch = effect.match(/other than \[([^\]]+)\]/i);
  const keepExcludeName = otherThanMatch ? otherThanMatch[1].trim() : null;
  const placement = /place the rest at the bottom/i.test(effect) ? 'bottom' : 'top';
  game.scryWindow = {
    playerId,
    cards: p.deck.splice(0, lookCount),
    keepCount,
    keepFilter,        // affiliation filter (e.g. "Duchess of Brittany")
    keepExcludeName,   // name to exclude (e.g. "Schola Montis Belli")
    cardName: card.name,
    placement,
  };
  log(game, `${card.name}: looking at top ${lookCount} cards…`);
  return true;
}

// Extract "[Card Name] card" name filter (skips bracketed keywords like [On Play]).
function extractNameFilter(text) {
  const KW = new Set(['On Play','On K.O.','Activate: Main','Main','Counter','Trigger','Blocker',
    'Rush','Banish','Double Attack','Once Per Turn','When Attacking','On Block',
    'End of Your Turn','Your Turn',"Opponent's Turn","On Your Opponent's Attack"]);
  const ms = text.match(/\[([^\]]+)\]\s*card/i);
  if (!ms) return null;
  const candidate = ms[1].trim();
  if (KW.has(candidate) || candidate.startsWith('DON')) return null;
  return candidate;
}

// ─── CENTRAL EFFECT PARSER ───

function parseAndApply(timing, game, playerId, card, opp, opts = {}) {
  const ab = card.ability || '';
  if (!ab) return;
  const p = game.players[playerId];

  // ── [Rush] ──
  if (timing === 'onPlay' && hasRush(card)) {
    log(game, `${card.name} has [Rush] — can attack this turn!`);
  }

  // ── [Blocker] tracking ──
  if (timing === 'onPlay' && hasBlocker(card)) {
    log(game, `${card.name} has [Blocker].`);
  }

  // ── [Activate: Main] — log only ──
  if (timing === 'onPlay' && ab.includes('[Activate: Main]')) {
    log(game, `${card.name} has [Activate: Main] ability (manual activation needed).`);
  }

  // ── [On Play] effects ──
  if (timing === 'onPlay' && ab.includes('[On Play]')) {
    const effect = extractEffect(ab, '[On Play]');
    if (!effect) return;

    // Check DON!! requirement before [On Play] (e.g. "[On Play] DON!! -1:")
    // Open the interactive DON-return window the first time we see this card; once
    // RETURN_DON is resolved, parseAndApply re-runs with opts.donCostPaid=true and we
    // skip past this block.
    const donCostMatch = effect.match(/^DON!!\s*-(\d+)\s*:/);
    if (donCostMatch && !opts.donCostPaid) {
      const donCost = parseInt(donCostMatch[1]);
      if (!openDonReturn(game, playerId, card, donCost, 'onPlay')) return;
      return; // pause until RETURN_DON resolves
    }

    // Draw N cards
    const drawMatch = effect.match(/[Dd]raw (\d+) card/);
    if (drawMatch) {
      drawCards(p, parseInt(drawMatch[1]), game, card.name);
    }

    // K.O. by power — interactive
    const koPowerMatch = effect.match(/K\.O\.\s+up to (\d+).*?(\d+)\s*[Pp]ower or less/i);
    if (koPowerMatch && !effect.includes('cost of') && !opts.koResolved) {
      const threshold = parseInt(koPowerMatch[2]);
      const count = parseInt(koPowerMatch[1]);
      if (openKoTargetWindow(game, playerId, {
        filter: c => (c.power || 0) + (c.attachedDon || 0) * 1000 <= threshold,
        sourceCardName: card.name, count, optional: true,
        filterKind: 'power', filterValue: threshold,
        resumeTiming: 'onPlay', resumeCardUid: card.uid,
      })) return;
    }

    // K.O. by cost — interactive
    const koCostMatch = effect.match(/K\.O\.\s+up to (\d+).*?cost of (\d+) or less/i);
    if (koCostMatch && !opts.koResolved) {
      const count = parseInt(koCostMatch[1]);
      const threshold = parseInt(koCostMatch[2]);
      if (openKoTargetWindow(game, playerId, {
        filter: c => (c.cost || 0) <= threshold,
        sourceCardName: card.name, count, optional: true,
        filterKind: 'cost', filterValue: threshold,
        resumeTiming: 'onPlay', resumeCardUid: card.uid,
      })) return;
    }

    // K.O. up to 1 of your opponent's Characters (no threshold — any character) — interactive
    if (/K\.O\.\s+up to 1 of your opponent's Characters\.?$/i.test(effect) && !opts.koResolved) {
      if (openKoTargetWindow(game, playerId, {
        filter: c => true,
        sourceCardName: card.name, count: 1, optional: true,
        filterKind: 'any', filterValue: '',
        resumeTiming: 'onPlay', resumeCardUid: card.uid,
      })) return;
    }

    // Rest opponent character (with optional cost threshold)
    if (/rest up to 1.*opponent/i.test(effect)) {
      const costMatch = effect.match(/cost of (\d+) or less/);
      if (costMatch) {
        restOpponentCharacter(opp, game, card.name, parseInt(costMatch[1]));
      } else {
        restOpponentCharacter(opp, game, card.name);
      }
    }

    // Rest multiple opponent characters
    const restMultiMatch = effect.match(/[Rr]est up to (\d+) of your opponent's Characters/);
    if (restMultiMatch && parseInt(restMultiMatch[1]) > 1) {
      const count = parseInt(restMultiMatch[1]);
      const costMatch = effect.match(/cost of (\d+) or less/);
      for (let i = 0; i < count; i++) {
        restOpponentCharacter(opp, game, card.name, costMatch ? parseInt(costMatch[1]) : undefined);
      }
    }

    // Give power reduction
    const powerRedMatch = effect.match(/[Gg]ive.*?opponent.*?-(\d+000)\s*power/i);
    if (powerRedMatch) {
      givePowerReduction(opp, parseInt(powerRedMatch[1]), game, card.name);
    }

    // Add DON rested
    if (/[Aa]dd up to 1 DON!!.*rest/i.test(effect)) {
      addDonFromDeck(p, 1, true, game, card.name);
    }
    // Add DON active
    else if (/[Aa]dd up to 1 DON!!.*active/i.test(effect) || /[Aa]dd up to 1 DON!!.*set it as active/i.test(effect)) {
      addDonFromDeck(p, 1, false, game, card.name);
    }
    // Generic add DON (defaults to rested)
    else if (/[Aa]dd up to (\d+) DON!!/i.test(effect) && !effect.includes('active')) {
      const donMatch = effect.match(/[Aa]dd up to (\d+) DON!!/i);
      if (donMatch) addDonFromDeck(p, parseInt(donMatch[1]), true, game, card.name);
    }

    // Return character to hand by cost
    const bounceCostMatch = effect.match(/[Rr]eturn up to 1 Character.*?cost of (\d+) or less.*?hand/i);
    if (bounceCostMatch) {
      bounceByCost(opp, parseInt(bounceCostMatch[1]), game, card.name);
    }

    // Return character to hand by power
    const bouncePowerMatch = effect.match(/[Rr]eturn up to 1 Character.*?(\d+)\s*power or less.*?hand/i);
    if (bouncePowerMatch && !bounceCostMatch) {
      bounceByPower(opp, parseInt(bouncePowerMatch[1]), game, card.name);
    }

    // Look at X cards from top of deck — open scry window
    if (!drawMatch) tryOpenScryFromEffect(game, playerId, card, effect);

    // Play character from hand (interactive)
    const playMatch = effect.match(/[Pp]lay up to 1.*?cost of (\d+) or less.*?hand/i);
    if (playMatch) {
      openPlayFromHand(game, playerId, {
        costThreshold: parseInt(playMatch[1]),
        typeName: extractTypeFilter(effect),
        nameMatch: extractNameFilter(effect),
        sourceCardName: card.name,
      });
    }
  }

  // ── [On K.O.] effects ──
  if (timing === 'onKO' && ab.includes('[On K.O.]')) {
    const effect = extractEffect(ab, '[On K.O.]');
    if (!effect) return;

    // Check DON!! cost for On K.O.
    const donCostMatch = effect.match(/^DON!!\s*-(\d+)\s*:/);
    if (donCostMatch && !opts.donCostPaid) {
      const donCost = parseInt(donCostMatch[1]);
      if (!openDonReturn(game, playerId, card, donCost, 'onKO')) return;
      return;
    }

    // Draw N cards
    const drawMatch = effect.match(/[Dd]raw (\d+) card/);
    if (drawMatch) {
      drawCards(p, parseInt(drawMatch[1]), game, card.name);
    }

    // Add DON rested
    if (/[Aa]dd up to (\d+) DON!!.*rest/i.test(effect)) {
      const donMatch = effect.match(/[Aa]dd up to (\d+) DON!!/i);
      addDonFromDeck(p, donMatch ? parseInt(donMatch[1]) : 1, true, game, card.name);
    }
    // Add DON active
    else if (/[Aa]dd up to (\d+) DON!!.*active/i.test(effect)) {
      const donMatch = effect.match(/[Aa]dd up to (\d+) DON!!/i);
      addDonFromDeck(p, donMatch ? parseInt(donMatch[1]) : 1, false, game, card.name);
    }

    // Play this character from trash as rested
    if (/[Pp]lay this character from the trash as rested/i.test(effect)) {
      const inTrash = p.trash.find(c => c.uid === card.uid);
      if (inTrash) {
        p.trash = p.trash.filter(c => c.uid !== card.uid);
        inTrash.rested = true;
        inTrash.attachedDon = 0;
        p.field.push(inTrash);
        log(game, `${card.name}: returned to the field from trash (rested)!`);
      }
    }

    // Play character from hand with cost threshold (interactive)
    const playMatch = effect.match(/[Pp]lay up to 1.*?cost of (\d+) or less.*?hand/i);
    if (playMatch) {
      openPlayFromHand(game, playerId, {
        costThreshold: parseInt(playMatch[1]),
        typeName: extractTypeFilter(effect),
        nameMatch: extractNameFilter(effect),
        sourceCardName: card.name,
      });
    }

    // Play character from trash with cost threshold
    const playTrashMatch = effect.match(/[Pp]lay up to 1.*?Character.*?cost of (\d+) or less.*?trash/i);
    if (playTrashMatch) {
      const costThreshold = parseInt(playTrashMatch[1]);
      const idx = p.trash.findIndex(c => c.type === 'CHARACTER' && (c.cost || 0) <= costThreshold);
      if (idx !== -1) {
        const revived = p.trash.splice(idx, 1)[0];
        revived.rested = true;
        revived.attachedDon = 0;
        p.field.push(revived);
        log(game, `${card.name}: played ${revived.name} from trash (rested).`);
      }
    }

    // K.O. opponent character by power — interactive
    const koPowerMatch = effect.match(/K\.O\.\s+up to (\d+).*?(\d+)\s*power or less/i);
    if (koPowerMatch && !effect.includes('cost of') && !opts.koResolved) {
      const count = parseInt(koPowerMatch[1]);
      const threshold = parseInt(koPowerMatch[2]);
      if (openKoTargetWindow(game, playerId, {
        filter: c => (c.power || 0) + (c.attachedDon || 0) * 1000 <= threshold,
        sourceCardName: card.name, count, optional: true,
        filterKind: 'power', filterValue: threshold,
        resumeTiming: 'onKO', resumeCardUid: card.uid,
      })) return;
    }

    // K.O. opponent character by cost — interactive
    const koCostMatch = effect.match(/K\.O\.\s+up to (\d+).*?(?:base )?cost of (\d+) or less/i);
    if (koCostMatch && !opts.koResolved) {
      const count = parseInt(koCostMatch[1]);
      const threshold = parseInt(koCostMatch[2]);
      if (openKoTargetWindow(game, playerId, {
        filter: c => (c.cost || 0) <= threshold,
        sourceCardName: card.name, count, optional: true,
        filterKind: 'cost', filterValue: threshold,
        resumeTiming: 'onKO', resumeCardUid: card.uid,
      })) return;
    }

    // Look at cards (simplified: draw 1)
    if (/[Ll]ook at.*?(\d+) cards? from the top/i.test(effect) && !drawMatch) {
      if (p.deck.length > 0) {
        p.hand.push(p.deck.shift());
        log(game, `${card.name}: searched top of deck (simplified).`);
      }
    }

    // Add life card
    if (/[Aa]dd up to 1 card from the top of your deck to.*?[Ll]ife/i.test(effect)) {
      if (p.deck.length > 0) {
        p.life.push(p.deck.shift());
        log(game, `${card.name}: added a card to life (now ${p.life.length}).`);
      }
    }
  }

  // ── [When Attacking] effects ──
  if (timing === 'whenAttacking' && ab.includes('[When Attacking]')) {
    // Check DON!! requirement
    const donReqMatch = ab.match(/\[DON!!\s*x(\d+)\]\s*\[When Attacking\]/);
    if (donReqMatch) {
      const required = parseInt(donReqMatch[1]);
      if ((card.attachedDon || 0) < required) return;
    }

    const effect = extractEffect(ab, '[When Attacking]');
    if (!effect) return;

    // Check DON!! cost to activate
    const donCostMatch = effect.match(/^DON!!\s*-(\d+)\s*:/);
    if (donCostMatch && !opts.donCostPaid) {
      const donCost = parseInt(donCostMatch[1]);
      if (!openDonReturn(game, playerId, card, donCost, 'whenAttacking')) return;
      return;
    }

    // Power reduction to opponent's character
    const powerRedMatch = effect.match(/[Gg]ive.*?opponent.*?-(\d+000)\s*power/i);
    if (powerRedMatch) {
      givePowerReduction(opp, parseInt(powerRedMatch[1]), game, card.name);
    }

    // K.O. by power — interactive
    const koPowerMatch = effect.match(/K\.O\.\s+up to (\d+).*?(\d+)\s*[Pp]ower or less/i);
    if (koPowerMatch && !opts.koResolved) {
      const count = parseInt(koPowerMatch[1]);
      const threshold = parseInt(koPowerMatch[2]);
      if (openKoTargetWindow(game, playerId, {
        filter: c => (c.power || 0) + (c.attachedDon || 0) * 1000 <= threshold,
        sourceCardName: card.name, count, optional: true,
        filterKind: 'power', filterValue: threshold,
        resumeTiming: 'whenAttacking', resumeCardUid: card.uid,
      })) return;
    }

    // Self power boost
    const selfBoostMatch = effect.match(/\+(\d+000)\s*power/i);
    if (selfBoostMatch && !powerRedMatch) {
      const boost = parseInt(selfBoostMatch[1]);
      card.power += boost;
      log(game, `${card.name}: gained +${boost} power this turn! (now ${card.power})`);
    }

    // Draw cards
    const drawMatch = effect.match(/[Dd]raw (\d+) card/);
    if (drawMatch) {
      drawCards(p, parseInt(drawMatch[1]), game, card.name);
    }
  }

  // ── [Counter] effects for EVENTs ──
  if (timing === 'counter') {
    // Check for counter effects beyond the base counter value
    const counterEffect = extractEffect(ab, '[Counter]');
    if (!counterEffect) return;

    // Power boost (already handled by counter value, but parse for additional effects)
    const boostMatch = counterEffect.match(/gains?\s*\+(\d+000)\s*power/i);

    // Draw cards from counter effect
    const drawMatch = counterEffect.match(/[Dd]raw (\d+) card/);
    if (drawMatch) {
      drawCards(p, parseInt(drawMatch[1]), game, card.name);
    }

    // Bounce by cost
    const bounceCostMatch = counterEffect.match(/[Rr]eturn up to 1 Character.*?cost of (\d+) or less.*?hand/i);
    if (bounceCostMatch) {
      bounceByCost(opp, parseInt(bounceCostMatch[1]), game, card.name);
    }

    // Rest opponent character
    if (/rest up to 1.*opponent/i.test(counterEffect)) {
      restOpponentCharacter(opp, game, card.name);
    }

    // Power reduction in counter
    const powerRedMatch = counterEffect.match(/opponent.*?-(\d+000)\s*power/i);
    if (powerRedMatch) {
      givePowerReduction(opp, parseInt(powerRedMatch[1]), game, card.name);
    }

    // K.O. in counter — interactive
    const koPowerMatch = counterEffect.match(/K\.O\.\s+up to (\d+).*?(\d+)\s*[Pp]ower or less/i);
    if (koPowerMatch && !opts.koResolved) {
      const count = parseInt(koPowerMatch[1]);
      const threshold = parseInt(koPowerMatch[2]);
      if (openKoTargetWindow(game, playerId, {
        filter: c => (c.power || 0) + (c.attachedDon || 0) * 1000 <= threshold,
        sourceCardName: card.name, count, optional: true,
        filterKind: 'power', filterValue: threshold,
        resumeTiming: 'counter', resumeCardUid: card.uid,
      })) return;
    }

    // Play character from hand (interactive — opens playFromHandWindow for the player)
    const playMatch = counterEffect.match(/[Pp]lay up to 1.*?cost of (\d+) or less.*?hand/i);
    if (playMatch) {
      openPlayFromHand(game, playerId, {
        costThreshold: parseInt(playMatch[1]),
        typeName: extractTypeFilter(counterEffect),
        nameMatch: extractNameFilter(counterEffect),
        sourceCardName: card.name,
      });
    }

    // Nullify effects + power reduction
    const nullifyPowerMatch = counterEffect.match(/[Nn]ullify.*?-(\d+000)\s*power/i);
    if (nullifyPowerMatch) {
      givePowerReduction(opp, parseInt(nullifyPowerMatch[1]), game, card.name);
    }
  }

  // ── [Trigger] effects ──
  if (timing === 'trigger') {
    if (!ab.includes('[Trigger]')) return;
    const effect = extractEffect(ab, '[Trigger]');
    if (!effect) return;

    // Draw cards
    const drawMatch = effect.match(/[Dd]raw (\d+) card/i);
    if (drawMatch) {
      drawCards(p, parseInt(drawMatch[1]), game, card.name);
    }

    // Add DON active
    if (/[Aa]dd up to 1.*?DON!!.*active/i.test(effect)) {
      addDonFromDeck(p, 1, false, game, card.name);
    }
    // Add DON rested
    else if (/[Aa]dd up to 1.*?DON!!/i.test(effect)) {
      addDonFromDeck(p, 1, true, game, card.name);
    }

    // Power reduction
    const powerRedMatch = effect.match(/-(\d+000)\s*power/i);
    if (powerRedMatch) {
      givePowerReduction(opp, parseInt(powerRedMatch[1]), game, card.name);
    }

    // Bounce by cost
    const bounceCostMatch = effect.match(/[Rr]eturn up to 1 Character.*?cost of (\d+) or less/i);
    if (bounceCostMatch) {
      bounceByCost(opp, parseInt(bounceCostMatch[1]), game, card.name);
    }

    // Activate Main effect (for triggers that say "Activate this card's [Main] effect")
    if (/[Aa]ctivate this card's \[Main\] effect/i.test(effect)) {
      parseEventMain(game, playerId, card, opp);
    }

    // Activate Counter effect (forwards to the existing 'counter' timing parser).
    // Note: many [Counter] effects are "+N power during this battle" — when fired off life
    // outside an active battle, those have no effect today. Action-style counters
    // (bounce/play-from-hand/K.O.) still resolve.
    if (/[Aa]ctivate this card's \[Counter\] effect/i.test(effect)) {
      parseAndApply('counter', game, playerId, card, opp);
    }

    // Positive buff to own card — TODO: needs per-card temp +N tracking.
    const buffMatch = effect.match(/(?:gets?|gains?)\s*\+(\d+000)\s*(?:power|during)/i);
    if (buffMatch && !/-(\d+000)/.test(effect)) {
      log(game, `${card.name}: +${buffMatch[1]} buff (TODO — per-card temp buffs not yet wired).`);
    }

    // Effect negation — TODO: needs per-card "effects negated this turn" flag.
    if (/[Nn]egate the effect|[Nn]ullify the effects?/.test(effect)) {
      log(game, `${card.name}: opponent effect negation (TODO — flag not yet wired).`);
    }
  }

  // ── Event [Main] effects (for PLAY_CARD EVENT) ──
  if (timing === 'eventMain') {
    parseEventMain(game, playerId, card, opp);
  }

  // ── [Activate: Main] effects (for ACTIVATE_MAIN action) ──
  if (timing === 'activateMain' && ab.includes('[Activate: Main]')) {
    const effect = extractEffect(ab, '[Activate: Main]');
    if (!effect) return;

    // DON!! -N cost (interactive: open the return-DON window)
    const donCostMatch = effect.match(/^DON!!\s*-(\d+)\s*:/);
    if (donCostMatch && !opts.donCostPaid) {
      const donCost = parseInt(donCostMatch[1]);
      if (!openDonReturn(game, playerId, card, donCost, 'activateMain')) {
        send(playerId, {type:'ERROR', msg:`Need ${donCost} DON!! to activate.`});
        return;
      }
      return;
    }

    // Draw N cards
    const drawMatch = effect.match(/[Dd]raw (\d+) card/);
    if (drawMatch) drawCards(p, parseInt(drawMatch[1]), game, card.name);

    // Look at top N → reveal {Type} → add to hand → place rest
    if (!drawMatch) tryOpenScryFromEffect(game, playerId, card, effect);

    // Add up to N DON!! from deck
    if (/[Aa]dd up to 1 DON!!.*set it as active/i.test(effect)) {
      addDonFromDeck(p, 1, false, game, card.name);
    } else if (/[Aa]dd up to 1 DON!!/i.test(effect)) {
      addDonFromDeck(p, 1, true, game, card.name);
    }

    // K.O. opponent character — interactive
    const koPowerMatch = effect.match(/K\.O\.\s+up to (\d+).*?(\d+)\s*[Pp]ower or less/i);
    if (koPowerMatch && !opts.koResolved) {
      const count = parseInt(koPowerMatch[1]);
      const threshold = parseInt(koPowerMatch[2]);
      if (openKoTargetWindow(game, playerId, {
        filter: c => (c.power || 0) + (c.attachedDon || 0) * 1000 <= threshold,
        sourceCardName: card.name, count, optional: true,
        filterKind: 'power', filterValue: threshold,
        resumeTiming: 'activateMain', resumeCardUid: card.uid,
      })) return;
    }
    const koCostMatch = effect.match(/K\.O\.\s+up to (\d+).*?cost of (\d+) or less/i);
    if (koCostMatch && !opts.koResolved) {
      const count = parseInt(koCostMatch[1]);
      const threshold = parseInt(koCostMatch[2]);
      if (openKoTargetWindow(game, playerId, {
        filter: c => (c.cost || 0) <= threshold,
        sourceCardName: card.name, count, optional: true,
        filterKind: 'cost', filterValue: threshold,
        resumeTiming: 'activateMain', resumeCardUid: card.uid,
      })) return;
    }

    // Power reduction to opponent character
    const powerRedMatch = effect.match(/[Gg]ive.*?opponent.*?-(\d+000)\s*power/i);
    if (powerRedMatch) givePowerReduction(opp, parseInt(powerRedMatch[1]), game, card.name);

    // Play character from hand (interactive)
    const playMatch = effect.match(/[Pp]lay up to 1.*?cost of (\d+) or less.*?hand/i);
    if (playMatch) {
      openPlayFromHand(game, playerId, {
        costThreshold: parseInt(playMatch[1]),
        typeName: extractTypeFilter(effect),
        nameMatch: extractNameFilter(effect),
        sourceCardName: card.name,
      });
    }
  }
}

// Separate parser for Event [Main] effects
function parseEventMain(game, playerId, card, opp) {
  const ab = card.ability || '';
  const p = game.players[playerId];

  if (!ab.includes('[Main]')) return;

  // Extract the [Main] portion only
  const mainIdx = ab.indexOf('[Main]');
  let mainText = ab.substring(mainIdx + 6).trim();
  // Cut at [Counter] or [Trigger]
  for (const stop of ['[Counter]', '[Trigger]']) {
    const si = mainText.indexOf(stop);
    if (si > 0) mainText = mainText.substring(0, si).trim();
  }

  // Check DON!! rest cost (e.g. "You may rest 5 of your DON!! cards:")
  const restDonMatch = mainText.match(/rest (\d+).*?DON!!/i);
  if (restDonMatch) {
    const restCost = parseInt(restDonMatch[1]);
    if (p.donActive < restCost) {
      log(game, `${card.name}: not enough active DON!! (need ${restCost}).`);
      return;
    }
    p.donActive -= restCost;
    p.donRested += restCost;
  }

  // K.O. by power — interactive
  const koPowerMatch = mainText.match(/K\.O\.\s+up to (\d+).*?(\d+)\s*[Pp]ower or less/i);
  if (koPowerMatch && !mainText.includes('cost of')) {
    const count = parseInt(koPowerMatch[1]);
    const threshold = parseInt(koPowerMatch[2]);
    if (openKoTargetWindow(game, playerId, {
      filter: c => (c.power || 0) + (c.attachedDon || 0) * 1000 <= threshold,
      sourceCardName: card.name, count, optional: true,
      filterKind: 'power', filterValue: threshold,
      // Event main effects are one-shot — no resume callback needed (the event is in trash by now).
    })) return;
  }

  // K.O. by cost — interactive
  const koCostMatch = mainText.match(/K\.O\.\s+up to (\d+).*?cost of (\d+) or less/i);
  if (koCostMatch) {
    const count = parseInt(koCostMatch[1]);
    const threshold = parseInt(koCostMatch[2]);
    if (openKoTargetWindow(game, playerId, {
      filter: c => (c.cost || 0) <= threshold,
      sourceCardName: card.name, count, optional: true,
      filterKind: 'cost', filterValue: threshold,
    })) return;
  }

  // Power reduction
  const powerRedMatch = mainText.match(/-(\d+000)\s*power/i);
  if (powerRedMatch && !koPowerMatch) {
    givePowerReduction(opp, parseInt(powerRedMatch[1]), game, card.name);
  }

  // Draw cards
  const drawMatch = mainText.match(/[Dd]raw (\d+) card/);
  if (drawMatch) {
    drawCards(p, parseInt(drawMatch[1]), game, card.name);
  }

  // Look at top N, add card to hand (search)
  if (/[Ll]ook at.*?(\d+) cards?/i.test(mainText) && !drawMatch) {
    if (p.deck.length > 0) {
      p.hand.push(p.deck.shift());
      log(game, `${card.name}: searched top of deck (simplified).`);
    }
  }

  // Return/bounce by cost
  const bounceCostMatch = mainText.match(/[Rr]eturn up to 1 Character.*?cost of (\d+) or less.*?hand/i);
  if (bounceCostMatch) {
    bounceByCost(opp, parseInt(bounceCostMatch[1]), game, card.name);
  }

  // Add DON active
  if (/[Aa]dd up to 1.*?[Aa]ctive DON!!/i.test(mainText) || /[Aa]dd up to 1 DON!!.*active/i.test(mainText)) {
    addDonFromDeck(p, 1, false, game, card.name);
  }
}

// Trigger [On K.O.] for a KO'd character
function triggerOnKO(game, ownerId, card, killerId) {
  if (!card.ability || !card.ability.includes('[On K.O.]')) return;
  const owner = game.players[ownerId];
  const opp = game.players[killerId];
  if (!owner || !opp) return;
  parseAndApply('onKO', game, ownerId, card, opp);
}

// Check and apply [Trigger] when a life card is flipped
function applyTriggerEffect(game, playerId, card) {
  if (!card.ability || !card.ability.includes('[Trigger]')) return;
  // Task#1: don't auto-fire — open a window so the player can choose Activate/Skip.
  game.triggerWindow = { playerId, card };
  log(game, `[Trigger] ${card.name} revealed off life — defender may activate.`);
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
