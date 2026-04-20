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
    power:5000, life:5, cost:0, counter:0, image:IMG('OP14','OP14-060','png'), useNewPipeline:true,
    ability:"[On Your Opponent's Attack] [Once Per Turn] DON!! -1: Select your Leader or 1 of your {Donquixote Pirates} type Characters. Change the attack target to the selected card." },

  { id:'OP10-065', name:'Sugar', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:1000, cost:1, counter:1000, image:IMG('OP10','OP10-065','jpg'), useNewPipeline:true,
    ability:'[Activate: Main] You may rest 1 of your DON!! and this Character: Look at the top 5 cards of your deck, reveal up to 1 {Donquixote Pirates} type card and add it to your hand. Place the rest at the bottom of your deck in any order.' },

  { id:'OP14-067', name:'Dellinger', type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:2000, cost:1, counter:1000, image:IMG('OP14','OP14-067','png'), useNewPipeline:true,
    ability:'[On K.O.] Add up to 1 DON!! card from your DON!! deck and rest it; look at 5 cards from the top of your deck, reveal up to 1 {Donquixote Pirates} type card and add it to your hand.' },

  { id:'ST18-001', name:'Usohachi', type:'CHARACTER', color:'Yellow', attribute:'Ranged',
    power:3000, cost:3, counter:2000, image:IMG('ST18','ST18-001','png'), useNewPipeline:true,
    ability:"[On Play] If you have 8 or more DON!! cards, rest up to 1 of your opponent's Characters with a cost of 5 or less." },

  { id:'OP10-076', name:'Baby 5', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:1000, cost:3, counter:2000, image:IMG('OP10','OP10-076','jpg'), useNewPipeline:true,
    ability:"[On Play] You may discard 1 card from your hand: If your Leader has the {Donquixote Pirates} type, add up to 1 DON!! from your DON!! deck and set it as active." },

  { id:'OP14-072', name:'Baby 5', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:1000, cost:4, counter:1000, image:IMG('OP14','OP14-072','png'), useNewPipeline:true,
    ability:'[On Play] Add up to 1 DON!! card from your DON!! deck and set it as active. [On K.O.] DON!! -1: Add up to 1 card from the top of your deck to the top of your Life cards.' },

  { id:'OP14-063', name:'Sugar', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:1000, cost:4, counter:1000, image:IMG('OP14','OP14-063','png'),
    ability:"[On Play] Add up to 1 DON!! card from your DON!! deck and set it as active. [On K.O.] If your opponent has 6 or more DON!! cards on their field, play up to 1 {Donquixote Pirates} type Character card with a cost of 5 or less from your hand." },

  { id:'OP14-061', name:'Vergo', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Donquixote Pirates',
    power:7000, cost:5, counter:0, image:IMG('OP14','OP14-061','png'),
    ability:"[Once Per Turn] If your {Donquixote Pirates} type Character would be removed from the field by your opponent's effect, you may return 1 DON!! card from your field to your DON!! deck instead. [When Attacking] DON!! -1: Give up to 1 of your opponent's Characters -2000 power during this turn." },

  { id:'OP10-072', name:'Donquixote Rosinante', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:6000, cost:5, counter:1000, image:IMG('OP10','OP10-072','jpg'), useNewPipeline:true,
    ability:'[On Play] You may trash 1 event card from your hand: Draw 2 cards. [End of Your Turn] If you have 7 or more DON!! cards, set up to 2 of them as active.' },

  { id:'OP14-074', name:'Monet', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:6000, cost:5, counter:1000, image:IMG('OP14','OP14-074','png'), useNewPipeline:true,
    ability:"[On Play] If your Leader has the {Donquixote Pirates} type, add up to 1 DON!! card from your DON!! deck and set it as active. [On K.O.] Draw 2 cards and trash 1 card from your hand. Then, add up to 2 DON!! cards from your DON!! deck and rest them." },

  { id:'OP14-068', name:'Trebol', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:5000, cost:5, counter:2000, image:IMG('OP14','OP14-068','png'),
    ability:"[Opponent's Turn] [Once Per Turn] When a DON!! card on your field is returned to your DON!! deck, if your Leader has the {Donquixote Pirates} type, add up to 1 DON!! card from your DON!! deck and rest it." },

  { id:'OP10-071', name:'Donquixote Doflamingo', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:9000, cost:8, counter:0, image:IMG('OP10','OP10-071','jpg'),
    ability:"[On Play] DON!! -1: Play up to 1 {Donquixote Pirates} type Character card with a cost of 5 or less from your hand. [Opponent's Turn] [Once Per Turn] You may rest 1 of your DON!!: add up to 1 Active DON!! from your DON!! deck." },

  { id:'OP11-067', name:'Charlotte Katakuri', type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:8000, cost:8, counter:0, image:IMG('OP11','OP11-067','jpg'), useNewPipeline:true,
    ability:'[Blocker] [End of Your Turn] Set up to 2 of your {Big Mom Pirates} type Characters with a cost of 3 or more as active. Then, add up to 1 DON!! card from your DON!! deck and rest it.' },

  { id:'OP14-069', name:'Donquixote Doflamingo', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:10000, cost:10, counter:0, image:IMG('OP14','OP14-069','png'), useNewPipeline:true,
    ability:"[On Play] DON!! -3: Choose one: \u2022 If your Leader has the {Donquixote Pirates} type, K.O. up to 1 of your opponent's Characters with a cost of 8 or less. \u2022 Rest up to 3 of your opponent's Characters with a cost of 7 or less." },

  { id:'OP10-078', name:"I can never forgive anyone who laughs at my family...!!", type:'EVENT', color:'Purple',
    power:0, cost:1, counter:0, image:IMG('OP10','OP10-078','jpg'),
    ability:"[Main] [Counter] Look at 3 cards from the top of your deck; reveal up to 1 {Donquixote Pirates} type card other than this card and add it to your hand. Place the rest at the bottom of your deck in any order." },

  { id:'OP13-076', name:'Divine Departure', type:'EVENT', color:'Purple',
    power:0, cost:0, counter:0, image:IMG('OP13','OP13-076','png'),
    ability:"[Main] You may rest 5 of your DON!! cards: Give up to 1 of your opponent's Characters -8000 power during this turn. [Counter] You may trash 1 card from your hand: Up to 1 of your Leader or Character cards gains +3000 power during this battle." },

  { id:'OP07-076', name:'NoroNoro Beam Sword', type:'EVENT', color:'Purple',
    power:0, cost:2, counter:0, image:IMG('OP07','OP07-076','png'), useNewPipeline:true,
    ability:"[Counter] DON!! -1: Give up to 1 of your Leader or Character cards +2000 power for this battle. Then, rest up to 1 of your opponent's Characters. [Trigger] Add up to 1 DON!! card from your DON!! deck and set it as active." },

  { id:'OP14-078', name:'Bullet String', type:'EVENT', color:'Purple',
    power:0, cost:2, counter:0, image:IMG('OP14','OP14-078','png'), useNewPipeline:true,
    ability:"[Counter] DON!! -1: If your Leader has the {Donquixote Pirates} type, up to 1 of your Leader or Character cards gains +4000 power during this battle." },

  { id:'OP10-079', name:'God Thread', type:'EVENT', color:'Purple',
    power:0, cost:5, counter:0, image:IMG('OP10','OP10-079','jpg'), useNewPipeline:true,
    ability:"[Main] K.O. up to 1 of your opponent's Characters with a cost of 5 or less. Then, add up to 1 Active DON!! from your DON!! deck. [Trigger] Add up to 1 Active DON!! from your DON!! deck." },

  // ══════════════════════════════
  // SHANKS DECK (Red)
  // ══════════════════════════════
  { id:'OP09-001', name:'Shanks', type:'LEADER', color:'Red', attribute:'Slash',
    power:5000, life:5, cost:0, counter:0, image:IMG('OP09','OP09-001','jpg'),
    ability:"[Once Per Turn] You may activate this effect when your opponent attacks. Give up to 1 of your opponent's leader or characters -1000 power for the turn." },

  { id:'OP09-002', name:'Uta', type:'CHARACTER', color:'Red', attribute:'Special',
    power:2000, cost:1, counter:1000, image:IMG('OP09','OP09-002','jpg'), useNewPipeline:true,
    ability:"[On Play] Look at the top 5 cards of your deck, reveal up to 1 {Red Hair Pirates} type card and add it to your hand. Then, place the rest at the bottom of your deck in any order." },

  { id:'OP01-006', name:'Otama', type:'CHARACTER', color:'Red', attribute:'Special',
    power:0, cost:1, counter:2000, image:IMG('OP01','OP01-006','png'), useNewPipeline:true,
    ability:"[On Play] Give up to 1 of your opponent's Characters -2000 power during this turn." },

  { id:'OP09-008', name:'Building Snake', type:'CHARACTER', color:'Red', attribute:'Slash',
    power:2000, cost:1, counter:0, image:IMG('OP09','OP09-008','jpg'),
    ability:"[Activate: Main] You may place this character on the bottom of its owner's deck: Give up to one of your opponent's characters -3000 power for this turn." },

  { id:'OP09-011', name:'Hongo', type:'CHARACTER', color:'Red', attribute:'Strike',
    power:3000, cost:3, counter:2000, image:IMG('OP09','OP09-011','jpg'), useNewPipeline:true,
    ability:"[Activate: Main] You may rest this character: If your leader has the {Red Hair Pirates} type, give up to 1 of your opponent's characters -2000 power during this turn." },

  { id:'OP09-014', name:'Limejuice', type:'CHARACTER', color:'Red', attribute:'Special',
    power:3000, cost:3, counter:2000, image:IMG('OP09','OP09-014','jpg'), useNewPipeline:true,
    ability:"[On Play] Up to one of your opponents characters with power 4000 or less cannot activate [Blocker] the rest of this turn." },

  { id:'OP12-008', name:'Shanks', type:'CHARACTER', color:'Red', attribute:'Slash',
    power:6000, cost:4, counter:0, image:IMG('OP12','OP12-008','jpg'), useNewPipeline:true,
    ability:"[Blocker] [On Your Opponent's Attack] [Once Per Turn] You may trash 1 card from your hand: Give up to 1 of your opponent's Leader or Characters -2000 power during this turn." },

  { id:'OP09-015', name:'Lucky Roux', type:'CHARACTER', color:'Red', attribute:'Ranged',
    power:5000, cost:4, counter:1000, image:IMG('OP09','OP09-015','jpg'), useNewPipeline:true,
    ability:"[Blocker] [On K.O.] If your Leader has the {Red Hair Pirates} type, K.O. up to 1 of your opponent's Characters with an original power of 6000 or less." },

  { id:'OP10-011', name:'Tony Tony Chopper', type:'CHARACTER', color:'Yellow', attribute:'Strike',
    power:4000, cost:4, counter:2000, image:IMG('OP10','OP10-011','jpg'),
    ability:"[Blocker] [Opponent's Turn] This character has +2000 power." },

  { id:'PRB02-003', name:'Lucky Roux', type:'CHARACTER', color:'Red', attribute:'Ranged',
    power:2000, cost:4, counter:1000, image:IMG('PRB02','PRB02-003','jpg'), useNewPipeline:true,
    ability:"[Blocker] [On Play] You may trash 1 Character card with a power of 6000 or more from your hand: Draw 2 cards." },

  { id:'OP03-013', name:'Marco', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:6000, cost:5, counter:1000, image:IMG('OP03','OP03-013','png'), useNewPipeline:true,
    ability:"[Your Turn] [On Play] K.O. up to 1 of your opponent's Characters with 3000 Power or less. [On K.O.] You may trash 1 Event card from your hand. Play this character from the trash as rested." },

  { id:'OP09-013', name:'Yasopp', type:'CHARACTER', color:'Red', attribute:'Ranged',
    power:6000, cost:5, counter:1000, image:IMG('OP09','OP09-013','jpg'), useNewPipeline:true,
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
    power:7000, cost:7, counter:1000, image:IMG('OP09','OP09-009','jpg'), useNewPipeline:true,
    ability:"[On Play] K.O. up to 1 of your opponents Characters with a power of 6000 or less." },

  { id:'ST15-002', name:'Edward Newgate', type:'CHARACTER', color:'Red', attribute:'Special',
    power:8000, cost:7, counter:0, image:IMG('ST15','ST15-002','png'), useNewPipeline:true,
    ability:"[On Play] Give your leader or one of your characters up to one rested DON!!. [Activate: Main] You may rest this character: K.O. up to one of your opponent's characters with 5000 or less power." },

  { id:'OP08-118', name:'Silvers Rayleigh', type:'CHARACTER', color:'Yellow', attribute:'Slash',
    power:8000, cost:8, counter:0, image:IMG('OP08','OP08-118','png'), useNewPipeline:true,
    ability:"[On Play] Choose up to two of your opponents characters: Until the end of your opponents next turn, give one -3000 power and the other -2000 power. After this, K.O. up to one of your opponents characters with a power of 3000 or lower." },

  { id:'ST23-002', name:'Shanks', type:'CHARACTER', color:'Red', attribute:'Slash',
    power:10000, cost:9, counter:0, image:IMG('ST23','ST23-002','jpg'),
    ability:"If your opponent has a Character with 8000 base power or more, give this card in your hand -3 cost. [On Play] If your Leader has the {Red-Haired Pirates} type, your Leader gains +2000 power until the end of your opponent's next End Phase." },

  { id:'OP06-007', name:'Shanks', type:'CHARACTER', color:'Red', attribute:'Slash',
    power:12000, cost:10, counter:0, image:IMG('OP06','OP06-007','png'), useNewPipeline:true,
    ability:"[On Play] K.O. up to 1 of your opponent's characters with 10000 power or less." },

  { id:'OP09-004', name:'Shanks', type:'CHARACTER', color:'Red', attribute:'Slash',
    power:12000, cost:10, counter:0, image:IMG('OP09','OP09-004','jpg'),
    ability:"All of your opponents characters have -1000 power. [Rush]" },

  { id:'OP09-021', name:'Red Force', type:'STAGE', color:'Red', attribute:'',
    power:0, cost:2, counter:0, image:IMG('OP09','OP09-021','jpg'), useNewPipeline:true,
    ability:"[Activate: Main] You may rest this stage: If your leader has the {Red Hair Pirates} type, give up to one of your opponent's characters -1000 power for this turn." },

  { id:'OP04-016', name:'Bad Manners Kick Course', type:'EVENT', color:'Red',
    power:0, cost:1, counter:0, image:IMG('OP04','OP04-016','png'), useNewPipeline:true,
    ability:"[Counter] You may trash 1 card from your hand: Give up to 1 of your leaders or characters +3000 Power this battle. [Trigger] Give up to one of your opponent's leaders or characters -3000 power for this turn." },

  { id:'OP10-018', name:'Kamakura Jussoushi', type:'EVENT', color:'Red',
    power:0, cost:2, counter:0, image:IMG('OP10','OP10-018','jpg'), useNewPipeline:true,
    ability:"[Counter] Choose up to 1 of your leader or character, it gains +3000 during this battle. Afterwards, one of your opponent's leader or character gets -2000 during this turn. [Trigger] Choose up to 1 of your leader or character, it gets +1000 during this turn." },

  { id:'OP10-019', name:'Divine Departure', type:'EVENT', color:'Red',
    power:0, cost:1, counter:0, image:IMG('OP10','OP10-019','jpg'),
    ability:"[Main] You may rest 5 DON!!: K.O. up to 1 of your opponent's characters with 8000 Power or less. [Counter] Up to 1 of your Leaders gains +3000 Power during this battle." },

  { id:'OP01-026', name:'Gum-Gum Red Hawk', type:'EVENT', color:'Red',
    power:0, cost:2, counter:0, image:IMG('OP01','OP01-026','png'), useNewPipeline:true,
    ability:"[Counter] Your Leader or up to 1 of your Characters gains +4000 power during this battle. Then, K.O. up to 1 of your opponent's Characters with 4000 power or less. [Trigger] Give up to 1 of your opponent's Leader or Characters -10000 power during this turn." },

  { id:'OP09-020', name:"Come on!! We'll fight you!!", type:'EVENT', color:'Red',
    power:0, cost:1, counter:0, image:IMG('OP09','OP09-020','jpg'), useNewPipeline:true,
    ability:"[Activate: Main] Look at the top 5 cards of your deck, reveal and add one {Red Hair Pirates} type card to your hand. Place the rest at the bottom of the deck in any order. [Trigger] Draw one card." },

  { id:'ST21-017', name:'Gum-Gum Mole Gun', type:'EVENT', color:'Red',
    power:0, cost:4, counter:0, image:IMG('ST21','ST21-017','jpg'), useNewPipeline:true,
    ability:"[Main] Give up to one of your opponents characters -5000 power during this turn. Then, if you have a character with 6000 power or more, K.O. up to one of your opponents characters with a power of 2000 or less. [Trigger] Activate this card's [Main] effect." },

  // ══════════════════════════════
  // BLACKBEARD DECK (Black/Multi)
  // ══════════════════════════════
  { id:'OP09-081', name:'Marshall D. Teach', type:'LEADER', color:'Black', attribute:'Special',
    power:5000, life:5, cost:0, counter:0, image:IMG('OP09','OP09-081','jpg'), useNewPipeline:true,
    ability:"Your [On Play] abilities don't activate. [Activate: Main] You may trash one card from your hand: Until the end of your opponent's next turn, your opponent's [On Play] abilities don't activate." },

  { id:'OP05-086', name:'Nefertari Vivi', type:'CHARACTER', color:'Black', attribute:'Wisdom',
    power:1000, cost:1, counter:1000, image:IMG('OP05','OP05-086','png'),
    ability:"If your trash has 10 cards or more, this character gains [Blocker]." },

  { id:'OP09-095', name:'Laffitte', type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:1000, cost:1, counter:1000, image:IMG('OP09','OP09-095','jpg'),
    ability:"[Activate: Main] You may rest this character and one of your DON!!: Look at the top 5 cards of your deck, reveal up to one {Blackbeard Pirates} type card and put it into your hand. Place the rest at the bottom of your deck in any order." },

  { id:'OP11-083', name:'Caribou', type:'CHARACTER', color:'Black', attribute:'Special',
    power:2000, cost:1, counter:2000, image:IMG('OP11','OP11-083','jpg'), useNewPipeline:true,
    ability:"[Blocker] [On Play] Trash 2 cards from your hand." },

  { id:'OP09-089', name:'Stronger', type:'CHARACTER', color:'Blue', attribute:'Wisdom',
    power:0, cost:1, counter:2000, image:IMG('OP09','OP09-089','jpg'), useNewPipeline:true,
    ability:"[Activate: Main] You may trash one card from your hand and this character: If your leader has the {Blackbeard Pirates} type, draw one card. Then give up to one of your opponents characters -2 cost for the turn." },

  { id:'OP09-088', name:'Shiryuu', type:'CHARACTER', color:'Black', attribute:'Slash',
    power:4000, cost:3, counter:2000, image:IMG('OP09','OP09-088','jpg'), useNewPipeline:true,
    ability:"[DON!! x1] [When Attacking] You may trash 2 cards from your hand: Draw 2 cards." },

  { id:'OP09-086', name:'Jesus Burgess', type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:5000, cost:4, counter:1000, image:IMG('OP09','OP09-086','jpg'),
    ability:"This character cannot be K.O'd by your opponents effects. If your leader has the {Blackbeard Pirates} type, this character gets +1000 power for every 4 cards in your trash." },

  { id:'PRB02-015', name:'Shiryu', type:'CHARACTER', color:'Black', attribute:'Slash',
    power:5000, cost:4, counter:1000, image:IMG('PRB02','PRB02-015','jpg'),
    ability:"If your Leader has the {Blackbeard Pirates} type, this Character gains [Blocker]. [On K.O.] If your Leader has the {Blackbeard Pirates} type, K.O. up to 1 of your opponent's Characters with a base cost of 4 or less." },

  { id:'OP10-082', name:'Kuzan', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:5000, cost:5, counter:0, image:IMG('OP10','OP10-082','jpg'), useNewPipeline:true,
    ability:"This Character cannot be removed from the field by your opponent's effects. [Activate: Main] You may trash this Character: Draw 1 card. Then, play up to 1 {Blackbeard Pirates} type Character card with a cost of 5 or less other than [Kuzan] from your trash." },

  { id:'OP09-084', name:'Catarina Devon', type:'CHARACTER', color:'Purple', attribute:'Special',
    power:6000, cost:5, counter:1000, image:IMG('OP09','OP09-084','jpg'),
    ability:"[Activate: Main] [Once Per Turn] If your leader has the {Blackbeard Pirates} type, until the end of your opponent's next turn this character gains [Double Attack] and [Banish] or [Blocker]." },

  { id:'ST27-003', name:'Kuzan', type:'CHARACTER', color:'Blue', attribute:'Special',
    power:6000, cost:6, counter:1000, image:IMG('ST27','ST27-003','jpg'), useNewPipeline:true,
    ability:"[Blocker] [On K.O.] Play up to 1 {Blackbeard Pirates} type Character card with a cost of 5 or less from your trash rested." },

  { id:'OP09-093', name:'Marshall D. Teach', type:'CHARACTER', color:'Black', attribute:'Special',
    power:12000, cost:10, counter:0, image:IMG('OP09','OP09-093','jpg'),
    ability:"[Blocker] [Activate: Main] [Once Per Turn] If your leader has the {Blackbeard Pirates} type and this character was played this turn, up to one of your opponent's leader effects are negated for the rest of the turn. Then, up to one of your opponent's characters effects are negated until the end of your opponent's next turn, that character also cannot attack." },

  { id:'OP09-096', name:"This is MY AGE!!!!", type:'EVENT', color:'Yellow',
    power:0, cost:1, counter:0, image:IMG('OP09','OP09-096','jpg'), useNewPipeline:true,
    ability:"[Main] Look at the top 3 cards of your deck and reveal up to one {Blackbeard Pirates} type card other than [This is MY AGE!!!!] and put it into your hand. Then put the rest of the cards into your trash. [Trigger] Activate this card's [Main] effect." },

  { id:'OP09-097', name:'Black Spiral', type:'EVENT', color:'Black',
    power:0, cost:2, counter:0, image:IMG('OP09','OP09-097','jpg'),
    ability:"[Counter] Nullify the effects of up to 1 of your opponent's leader or character and give them -4000 power during this turn. [Trigger] Nullify the effects of up to 1 of your opponent's leader or character during this turn." },

  { id:'OP09-098', name:'Black Hole', type:'EVENT', color:'Black',
    power:0, cost:4, counter:0, image:IMG('OP09','OP09-098','jpg'), useNewPipeline:true,
    ability:"[Main] If your Leader has the {Blackbeard Pirates} type, negate the effect of up to 1 of your opponent's Characters during this turn. Then, if that Character has a cost of 4 or less, K.O. it. [Trigger] Negate the effect of up to 1 of your opponent's Leader or Character cards during this turn." },

  { id:'OP09-099', name:'Fullalead', type:'STAGE', color:'Blue', attribute:'',
    power:0, cost:1, counter:0, image:IMG('OP09','OP09-099','jpg'),
    ability:"[Activate: Main] You may trash 1 card from your hand and rest this Stage: Look at 3 cards from the top of your deck; reveal up to 1 {Blackbeard Pirates} type card and add it to your hand. Then, place the rest at the bottom of your deck in any order." },

  // ══════════════════════════════
  // ANNA OF BRITTANY DECK (Blue)
  // ══════════════════════════════
  { id:'ST03-001', name:'Anna of Brittany', type:'LEADER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:5000, life:5, cost:0, counter:0, image:IMG('ST03','ST03-001','png'), useNewPipeline:true,
    ability:"[Activate: Main] Once per turn: Rest 1 of your opponent's Characters. Draw 1 card." },

  { id:'OP01-077', name:'FiFi Cat', type:'CHARACTER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:1000, cost:2, counter:1000, image:IMG('OP01','OP01-077','png'), useNewPipeline:true,
    ability:"[On Play] Look at 5 cards from the top of your deck and return them to the top or bottom of the deck in any order." },

  { id:'OP01-079', name:'George the Brave', type:'CHARACTER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:1000, cost:3, counter:1000, image:IMG('OP01','OP01-079','png'), useNewPipeline:true,
    ability:"[Blocker] [On K.O.] If your Leader has the {Duchess of Brittany} type, add up to 1 Event from your trash to your hand." },

  { id:'OP01-083', name:'Jesse the Jester', type:'CHARACTER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:3000, cost:2, counter:1000, image:IMG('OP01','OP01-083','png'),
    ability:"[DON!! x1] [Your Turn] If your Leader has the {Duchess of Brittany} type, this Character gains +1000 power for every 2 Events in your trash." },

  { id:'OP01-084', name:'Queen Victoria', type:'CHARACTER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:4000, cost:3, counter:2000, image:IMG('OP01','OP01-084','png'), useNewPipeline:true,
    ability:"[DON!! x1] [When Attacking] Look at 5 cards from the top of your deck; reveal up to 1 {Duchess of Brittany} type Event card and add it to your hand. Then, place the rest at the bottom of your deck in any order." },

  { id:'OP01-085', name:'Sarra the Wise', type:'CHARACTER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:3000, cost:2, counter:1000, image:IMG('OP01','OP01-085','png'), useNewPipeline:true,
    ability:"[On Play] If your Leader has the {Duchess of Brittany} type, select up to 1 of your opponent's Characters with a cost of 4 or less. The selected Character cannot attack until the end of your opponent's next turn." },

  { id:'ST03-003', name:'Noble Shlawger', type:'CHARACTER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:6000, cost:5, counter:0, image:IMG('ST03','ST03-003','png'), useNewPipeline:true,
    ability:"[Blocker] [DON!! x1] [On Block] Place up to 1 Character with a cost of 2 or less at the bottom of the owner's deck." },

  { id:'ST03-014', name:'Ball the Berserk', type:'CHARACTER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:4000, cost:4, counter:1000, image:IMG('ST03','ST03-014','png'), useNewPipeline:true,
    ability:"[On Play] Return 1 of your opponent's Characters with a cost of 3 or less to the owner's hand." },

  { id:'OP01-067', name:'Constable Anna', type:'CHARACTER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:7000, cost:7, counter:1000, image:IMG('OP01','OP01-067','png'),
    ability:"[Banish] [DON!! x1] Give blue Events in your hand -1 cost." },

  { id:'OP01-070', name:'Anna, Master of FiFi', type:'CHARACTER', color:'Blue', attribute:'Special', affiliation:'Duchess of Brittany',
    power:9000, cost:9, counter:0, image:IMG('OP01','OP01-070','png'), useNewPipeline:true,
    ability:"[On Play] Place up to 1 Character with a cost of 7 or less at the bottom of the owner's deck." },

  { id:'ST03-015', name:'Cig Break', type:'EVENT', color:'Blue', affiliation:'Duchess of Brittany',
    power:0, cost:4, counter:0, image:IMG('ST03','ST03-015','png'), useNewPipeline:true,
    ability:"[Main] Return up to 1 Character with a cost of 7 or less to the owner's hand. [Trigger] Activate this card's [Main] effect." },

  { id:'ST03-016', name:'Siege of Londinium', type:'EVENT', color:'Blue', affiliation:'Duchess of Brittany',
    power:0, cost:2, counter:0, image:IMG('ST03','ST03-016','png'), useNewPipeline:true,
    ability:"[Counter] Return up to 1 Character with a cost of 3 or less to the owner's hand. [Trigger] Activate this card's [Counter] effect." },

  { id:'ST03-017', name:'Leave Me To My Studies', type:'EVENT', color:'Blue', affiliation:'Duchess of Brittany',
    power:0, cost:2, counter:0, image:IMG('ST03','ST03-017','png'),
    ability:"[Counter] Up to 1 of your Leader or Character cards gains +4000 power during this battle. Then, draw 1 card if you have 3 or less cards in your hand." },

  { id:'OP01-087', name:'Snow Merchant', type:'EVENT', color:'Blue', affiliation:'Duchess of Brittany',
    power:0, cost:2, counter:0, image:IMG('OP01','OP01-087','png'), useNewPipeline:true,
    ability:"[Counter] Play up to 1 {Duchess of Brittany} type Character card with a cost of 3 or less from your hand. [Trigger] Activate this card's [Counter] effect." },

  { id:'OP01-090', name:'Schola Montis Belli', type:'STAGE', color:'Blue', attribute:'', affiliation:'Duchess of Brittany',
    power:0, cost:1, counter:0, image:IMG('OP01','OP01-090','png'), useNewPipeline:true,
    ability:"[Activate: Main] Look at 5 cards from the top of your deck; reveal up to 1 {Duchess of Brittany} type card other than [Schola Montis Belli] and add it to your hand. Then, place the rest at the bottom of your deck in any order." },

  // ══════════════════════════════
  // KAIDO RAMP DECK (Purple)
  // ══════════════════════════════
  { id:'ST04-001', name:'Constable Jack', type:'LEADER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:5000, life:5, cost:0, counter:0, image:IMG('ST04','ST04-001','png'), useNewPipeline:true,
    ability:"[Activate: Main] [Once Per Turn] DON!! -7: Trash up to 1 of your opponent's Life cards." },

  { id:'OP01-100', name:'Merchant Dam', type:'CHARACTER', color:'Purple', attribute:'Wisdom', affiliation:'Holy Roman Empire',
    power:3000, cost:2, counter:1000, image:IMG('OP01','OP01-100','png'), useNewPipeline:true,
    ability:"[Blocker] [On K.O.] Add 1 DON!! card from your DON!! deck and rest it." },

  { id:'ST04-010', name:'Monk Matt', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:3000, cost:3, counter:0, image:IMG('ST04','ST04-010','png'), useNewPipeline:true,
    ability:"[On Play] DON!! -1: K.O. up to 1 of your opponent's Characters with a cost of 3 or less. [Trigger] Play this card." },

  { id:'OP01-101', name:'Shawn the Whimsical', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:4000, cost:3, counter:2000, image:IMG('OP01','OP01-101','png'), useNewPipeline:true,
    ability:"[DON!! x1] [When Attacking] You may trash 1 card from your hand: Add up to 1 DON!! card from your DON!! deck and rest it." },

  { id:'ST04-008', name:'Noble Gee', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:4000, cost:3, counter:1000, image:IMG('ST04','ST04-008','png'), useNewPipeline:true,
    ability:"[On Play] You may trash 1 card from your hand: Add up to 1 DON!! card from your DON!! deck and set it as active." },

  { id:'ST04-002', name:'Dabby the Domeless', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:5000, cost:4, counter:2000, image:IMG('ST04','ST04-002','png'), useNewPipeline:true,
    ability:"[On Play] DON!! -1: Play up to 1 [Toad Wizzy] card with a cost of 4 or less from your hand." },

  { id:'ST04-012', name:'Toad Wizzy', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:6000, cost:4, counter:1000, image:IMG('ST04','ST04-012','png'), hasAlt:true,
    ability:"" },

  { id:'ST04-005', name:'Sam the Tall', type:'CHARACTER', color:'Purple', attribute:'Wisdom', affiliation:'Holy Roman Empire',
    power:6000, cost:5, counter:1000, image:IMG('ST04','ST04-005','png'), useNewPipeline:true,
    ability:"[Blocker] [On Play] DON!! -1: Draw 2 cards and trash 1 card from your hand." },

  { id:'ST04-004', name:'Chris the Visually Impaired', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:7000, cost:6, counter:0, image:IMG('ST04','ST04-004','png'), useNewPipeline:true,
    ability:"[On Play] DON!! -1: K.O. up to 1 of your opponent's Characters with a cost of 4 or less." },

  { id:'OP01-096', name:'Commander Sam', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:7000, cost:7, counter:0, image:IMG('OP01','OP01-096','png'), useNewPipeline:true,
    ability:"[On Play] DON!! -2: K.O. up to 1 of your opponent's Characters with a cost of 3 or less and up to 1 of your opponent's Characters with a cost of 2 or less." },

  { id:'ST04-003', name:'Gee, Infernal Hound-Shlawg', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:10000, cost:9, counter:0, image:IMG('ST04','ST04-003','png'), useNewPipeline:true,
    ability:"[On Play] DON!! -5: K.O. up to 1 of your opponent's Characters with a cost of 6 or less. This Character gains [Rush] during this turn." },

  { id:'OP01-094', name:'Jack, Master of Gee', type:'CHARACTER', color:'Purple', attribute:'Strike', affiliation:'Holy Roman Empire',
    power:12000, cost:10, counter:0, image:IMG('OP01','OP01-094','png'), useNewPipeline:true,
    ability:"[On Play] DON!! -6: If your Leader has the {Holy Roman Empire} type, K.O. all Characters other than this Character." },

  { id:'ST04-016', name:'Off to the Market', type:'EVENT', color:'Purple', affiliation:'Holy Roman Empire',
    power:0, cost:1, counter:0, image:IMG('ST04','ST04-016','png'), useNewPipeline:true,
    ability:"[Counter] DON!! -1: Up to 1 of your Leader or Character cards gains +4000 power during this battle." },

  { id:'OP01-117', name:'Guard Off Duty', type:'EVENT', color:'Purple', affiliation:'Holy Roman Empire',
    power:0, cost:2, counter:0, image:IMG('OP01','OP01-117','png'), hasAlt:true, useNewPipeline:true,
    ability:"[Main] DON!! -1: Rest up to 1 of your opponent's Characters with a cost of 6 or less." },

  { id:'OP01-119', name:'Redpilled', type:'EVENT', color:'Purple', affiliation:'Holy Roman Empire',
    power:0, cost:2, counter:0, image:IMG('OP01','OP01-119','png'),
    ability:"[Counter] Up to 1 of your Leader or Character cards gains +4000 power during this battle. Then, if you have 2 or less Life cards, add up to 1 DON!! card from your DON!! deck and rest it. [Trigger] Add up to 1 DON!! card from your DON!! deck and set it as active." },

  { id:'ST04-015', name:'Blessed Thy Men', type:'EVENT', color:'Purple', affiliation:'Holy Roman Empire',
    power:0, cost:6, counter:0, image:IMG('ST04','ST04-015','png'), useNewPipeline:true,
    ability:"[Main] K.O. up to 1 of your opponent's Characters with a cost of 6 or less, then add up to 1 DON!! card from your DON!! deck and set it as active. [Trigger] Add up to 1 DON!! card from your DON!! deck and set it as active." },

  { id:'ST04-017', name:'GTA Server', type:'STAGE', color:'Purple', attribute:'', affiliation:'Holy Roman Empire',
    power:0, cost:3, counter:0, image:IMG('ST04','ST04-017','png'), useNewPipeline:true,
    ability:"[Activate: Main] You may rest this Stage: If your Leader has the {Holy Roman Empire} type, add up to 1 DON!! card from your DON!! deck and rest it." },
];

// ─── PRESET DECKS ───
const PRESET_DECKS = {
  'Anna of Brittany': {
    leaderId: 'ST03-001',
    cards: [
      {id:'OP01-079',count:4},{id:'OP01-077',count:4},{id:'OP01-083',count:2},
      {id:'OP01-085',count:4},{id:'ST03-014',count:3},{id:'OP01-084',count:4},
      {id:'ST03-003',count:4},{id:'OP01-067',count:3},{id:'OP01-070',count:2},
      {id:'ST03-015',count:4},{id:'ST03-016',count:4},{id:'ST03-017',count:4},
      {id:'OP01-087',count:4},{id:'OP01-090',count:4},
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
  // Per-card debug log so missing-card / wrong-id problems are visible in
  // server logs. SKIP warnings here mean the client sent an id that isn't in
  // CARD_DB (likely stale localStorage from before the card was added).
  console.log(`[buildCustomDeck] leader=${leaderId} (${leader.name}); ${cardList.length} entries`);
  cardList.forEach(({id, count}) => {
    const card = CARD_DB.find(c => c.id === id);
    if (!card) {
      console.warn(`[buildCustomDeck]   SKIP — id "${id}" not in CARD_DB`);
      return;
    }
    const copies = Math.min(count, 4);
    console.log(`[buildCustomDeck]   +${copies}x ${id} (${card.name})`);
    for (let i = 0; i < copies; i++) {
      deck.push({...card, uid:uuidv4(), rested:false, attachedDon:0});
    }
  });
  console.log(`[buildCustomDeck] built deck: ${deck.length} cards`);
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
  // Coin flip who goes first. activePlayer mirrors firstPlayer for turn 1
  // so both fields agree during mulligan / DON phase.
  const firstPlayerId = Math.random() < 0.5 ? p1id : p2id;
  console.log('createGame: firstPlayer', firstPlayerId.slice(0, 6), 'of', [p1id, p2id].map(i => i.slice(0, 6)).join(','));
  return {
    id: uuidv4(),
    phase: 'MULLIGAN',
    turn: 1,
    activePlayer: firstPlayerId,
    players,
    log: ['Game started! Both players: keep your hand or mulligan.'],
    winner: null,
    mulliganDone: { [p1id]: false, [p2id]: false },
    counterWindow: null,
    counterDone: { [p1id]: false, [p2id]: false },
    firstPlayer: firstPlayerId,
    battleState: null, // Phase 1 attack flow: {attackerUid, attackerId, attackerName, attackerPower, targetUid, targetName, targetPower, targetIsLeader, counterBonus}
    triggerWindow: null, // Task#1 [Trigger]: {playerId, card}
    playFromHandWindow: null, // PLAY_FROM_HAND resolver: {playerId, candidateUids, costThreshold, typeName, nameMatch, sourceCardName}
    playFromTrashWindow: null, // Phase 7: {playerId, candidateUids, filter, rested, sourceCardName, pipelineResume}
    attackRedirectWindow: null, // Track-P: {playerId, candidateUids, sourceCardName, pipelineResume}
    donReturnWindow: null,    // DON!! -N cost: {playerId, sourceCardUid, sourceCardName, timing, required, available}
    koTargetWindow: null,     // KO target picker: {playerId, candidateUids, remaining, optional, sourceCardName, resumeTiming, resumeCardUid, filterKind, filterValue}
    // Bug 5 — TRASH_FROM_HAND_COST: parsed from "You may trash N card(s) from your hand: <effect>".
    // Resume re-runs parseAndApply with opts.trashCostPaid so the post-colon effect fires.
    trashFromHandWindow: null, // {playerId, count, optional, sourceCardName, filterType, filterPowerMin, resumeTiming, resumeCardUid}
    // Bug 6 — BOUNCE_TARGET: parsed from "Return up to N Character with cost/power N or less".
    // Highlights valid field characters; clicked card returns to its OWNER's hand.
    bounceTargetWindow: null,  // {playerId, candidateUids, filterKind, filterValue, optional, sourceCardName, resumeTiming, resumeCardUid}
    // Bug 8 — temporary power buffs from triggers/effects.
    // Each entry: {targetUid, amount, expiresAtTurn, kind: 'turn'|'battle', source}
    // Cleanup: doEnd prunes by turn; RESOLVE_ATTACK prunes kind:'battle'.
    tempPowerEffects: [],
    tempCostEffects: [],   // Track-P: {targetUid, amount, expiresAtTurn} — lowers effective cost for filter checks.
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
  const endingPlayerId = game.activePlayer;
  // Phase 8 — fire [End of Your Turn] abilities on the ending player's
  // leader/field cards before the turn flips. Only pipeline-migrated
  // cards participate; legacy parseAndApply path didn't emit endOfTurn.
  const endCards = [
    ...(p.leader && p.leader.useNewPipeline ? [p.leader] : []),
    ...(p.field || []).filter(c => c && c.useNewPipeline),
  ];
  for (const c of endCards) {
    const parsed = PARSED_EFFECTS.get(c.id);
    if (parsed && (parsed.effects || []).some(b => b.timing === 'endOfTurn')) {
      runPipeline('endOfTurn', game, endingPlayerId, c);
    }
  }
  while (p.hand.length > 8) { p.trash.push(p.hand.pop()); }
  const ids = Object.keys(game.players);
  game.activePlayer = ids.find(id => id !== game.activePlayer);
  game.turn++;
  game.phase = 'DRAW';
  log(game, `--- Turn ${game.turn} begins ---`);
  // Bug 8 — drop any expired temp power buffs. "thisTurn" buffs expire at end
  // of the turn that just ended (expiresAtTurn = old turn = game.turn - 1, now
  // strictly less than current turn). "opponentNextTurn" buffs persist one more
  // turn (expiresAtTurn = old turn + 1 = current turn).
  if (game.tempPowerEffects && game.tempPowerEffects.length) {
    game.tempPowerEffects = game.tempPowerEffects.filter(e => {
      if (e.kind === 'battle') return true; // cleared in RESOLVE_ATTACK, not here
      return (e.expiresAtTurn == null) || (e.expiresAtTurn >= game.turn);
    });
  }
  // Track-P — prune expired tempCostEffects identically to power buffs.
  if (game.tempCostEffects && game.tempCostEffects.length) {
    game.tempCostEffects = game.tempCostEffects.filter(e =>
      (e.expiresAtTurn == null) || e.expiresAtTurn >= game.turn);
  }
  // Track-P — prune expired global onPlay suppressions.
  if (Array.isArray(game._onPlaySuppressions) && game._onPlaySuppressions.length) {
    game._onPlaySuppressions = game._onPlaySuppressions.filter(s =>
      (s.expiresAtTurn == null) || s.expiresAtTurn >= game.turn);
  }
  // Track-P Phase 6 — clear per-turn self-save slots.
  if (game._selfSaveUsedThisTurn) game._selfSaveUsedThisTurn.clear();
  // Phase 5 Priority 8 — prune expired suppressions. Same expiry
  // semantics as tempPowerEffects: thisTurn-kind gets expiresAtTurn
  // equal to the turn they were applied on (now < game.turn → dropped).
  const pruneSuppressions = (card) => {
    if (!card || !Array.isArray(card.suppressions) || card.suppressions.length === 0) return;
    card.suppressions = card.suppressions.filter(s => (s.expiresAtTurn == null) || s.expiresAtTurn >= game.turn);
  };
  // Phase 7 — temp keyword grants expire identically.
  const pruneTempKeywords = (card) => {
    if (!card || !Array.isArray(card.tempKeywords) || card.tempKeywords.length === 0) return;
    card.tempKeywords = card.tempKeywords.filter(k => (k.expiresAtTurn == null) || k.expiresAtTurn >= game.turn);
  };
  for (const pid of Object.keys(game.players)) {
    const pl = game.players[pid];
    pruneSuppressions(pl.leader);
    pruneTempKeywords(pl.leader);
    (pl.field || []).forEach(c => { pruneSuppressions(c); pruneTempKeywords(c); });
  }
  doRefresh(game);
}

// Phase 5 Priority 8 — suppression helpers. Each checks whether the
// given card has an active suppression of the given kind. Returning
// truthy means the caller should skip / reject the operation.
function isEffectsSuppressed(card) {
  return !!(card && Array.isArray(card.suppressions) && card.suppressions.some(s => s.kind === 'effects'));
}
function isAttackSuppressed(card) {
  return !!(card && Array.isArray(card.suppressions) && card.suppressions.some(s => s.kind === 'attack'));
}
function isBlockerAbilitySuppressed(card) {
  return !!(card && Array.isArray(card.suppressions) && card.suppressions.some(s => s.kind === 'blockerAbility'));
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
      // Guard: must be in MULLIGAN phase AND this playerId must be a known
      // mulligan slot (rejects stray UUIDs that aren't in the game) AND not
      // already resolved.
      if (game.phase !== 'MULLIGAN' ||
          !Object.prototype.hasOwnProperty.call(game.mulliganDone, playerId) ||
          game.mulliganDone[playerId]) {
        console.log('MULLIGAN rejected:', { playerId, doMulligan: action.doMulligan, phase: game.phase, mulliganDone: game.mulliganDone });
        return;
      }
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
      console.log('MULLIGAN:', { playerId, doMulligan: action.doMulligan, mulliganDone: game.mulliganDone });
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
      // Track-P Phase 4 — honour handCostDiscount passives (Uta, Shanks).
      const cardCost = handPlayCostFor(p, card, game);
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
        // P5/P8 — effects suppression gates the onPlay fire. The card
        // still enters play; only its triggered ability is muted.
        // Track-P — Teach-style global [On Play] suppression takes
        // precedence for the active player.
        if (isEffectsSuppressed(card) || isOnPlaySuppressed(game, playerId)) {
          log(game, `${card.name}: [On Play] suppressed.`);
        } else if (card.useNewPipeline) {
          // Phase-4 routing: new-pipeline characters run through runPipeline;
          // legacy characters stay on parseAndApply.
          runPipeline('onPlay', game, playerId, card);
        } else {
          parseAndApply('onPlay', game, playerId, card, opp);
        }
      } else if (card.type === 'STAGE') {
        card.rested = false;
        p.field.push(card);
        log(game, `${playerId.slice(0,6)} plays stage ${card.name}.`);
      } else if (card.type === 'EVENT') {
        log(game, `${playerId.slice(0,6)} plays event ${card.name}.`);
        if (card.useNewPipeline) {
          // Push to trash FIRST so resumePipeline's leader/field/trash
          // lookup finds the event by uid when its windows resolve. The
          // legacy parseAndApply path stays in the else branch with the
          // original ordering so existing event cards are unaffected.
          p.trash.push(card);
          runPipeline('eventMain', game, playerId, card);
        } else {
          // Bug 1 — fire the [Main] effect BEFORE moving to trash so any
          // interactive window opens against an in-flight event. Push to
          // trash unconditionally afterward — the event's own card object
          // is already off the player's hand and held by reference, so
          // any pending resume window keeps a valid `card`.
          parseAndApply('eventMain', game, playerId, card, opp);
          p.trash.push(card);
        }
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
      // P8 — effects suppression blocks the Activate: Main fire.
      if (isEffectsSuppressed(card)) {
        send(playerId, {type:'ERROR', msg:`${card.name}: [Activate: Main] suppressed by opponent effect.`});
        return;
      }
      // Mark used + rest the card (stages rest too on activate).
      card.usedThisTurn = true;
      card.rested = true;
      log(game, `${card.name}: [Activate: Main] activated.`);
      if (card.useNewPipeline) {
        runPipeline('activateMain', game, playerId, card);
      } else {
        parseAndApply('activateMain', game, playerId, card, opp);
      }
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
      // P8 — effects suppression blocks the triggered ability.
      if (isEffectsSuppressed(attacker)) {
        log(game, `${attacker.name}: [When Attacking] suppressed by opponent effect.`);
      } else if (attacker.useNewPipeline) runPipeline('whenAttacking', game, playerId, attacker);
      else parseAndApply('whenAttacking', game, playerId, attacker, opp);

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
      // P8 — attack suppression (Sarra the Wise-style "cannot attack until…").
      if (isAttackSuppressed(attacker)) {
        send(playerId, {type:'ERROR', msg:'That card cannot attack.'}); return;
      }
      const attackerPower = effectivePowerOf(attacker, game);
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
      // Bug 9 — fire [When Attacking] effects through the central parser. The
      // parser checks any [DON!! xN] gate and may open trash-from-hand / DON-cost
      // / KO target windows. If the effect modifies attacker power (e.g. +N self
      // boost), refresh battleState.attackerPower so the overlay/arrow reflect it.
      // P8 — effects suppression blocks the triggered ability; attack itself
      // still proceeds (attack suppression is a separate kind, checked above).
      if (isEffectsSuppressed(attacker)) {
        log(game, `${attacker.name}: [When Attacking] suppressed by opponent effect.`);
      } else if (attacker.useNewPipeline) runPipeline('whenAttacking', game, playerId, attacker);
      else parseAndApply('whenAttacking', game, playerId, attacker, opp);
      game.battleState.attackerPower = effectivePowerOf(attacker, game);
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
      const targetPower = effectivePowerOf(target, game);
      game.battleState.targetUid = target.uid;
      game.battleState.targetName = target.name;
      game.battleState.targetPower = targetPower;
      game.battleState.targetIsLeader = targetIsLeader;
      game.phase = 'BLOCK_STEP';
      log(game, `\uD83C\uDFAF ${game.battleState.attackerName} (${game.battleState.attackerPower}) \u2192 ${target.name} (${targetPower})`);
      // Track-P — fire [On Your Opponent's Attack] on defender's side
      // AFTER target is set. This unifies timing so redirect-style
      // effects (Doflamingo) and simple reactions (Shanks OP12-008)
      // share a fire point and both have access to battleState.targetUid.
      const defenderCards = [
        ...(opp.leader && opp.leader.useNewPipeline ? [opp.leader] : []),
        ...(opp.field || []).filter(c => c && c.useNewPipeline),
      ];
      for (const c of defenderCards) {
        const parsed = PARSED_EFFECTS.get(c.id);
        if (parsed && (parsed.effects || []).some(b => b.timing === 'onYourOpponentsAttack')) {
          runPipeline('onYourOpponentsAttack', game, playerId === Object.keys(game.players)[0]
            ? Object.keys(game.players)[1] : Object.keys(game.players)[0], c);
        }
      }
      // Refresh target power in case an effect lowered it.
      if (game.battleState) game.battleState.targetPower = effectivePowerOf(target, game);
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
    // Bug 7 — scalable USE_BLOCKER: must rest blocker, fully replace battleState
    // target fields, force phase = COUNTER_STEP. Power uses effectivePowerOf so
    // any temp buff (Bug 8) on the blocker is reflected in the defending power
    // immediately. The surrounding handleAction call to sendState broadcasts the
    // new state — the client redraws the SVG arrow and shows the counter step
    // panel from the COUNTER_STEP branch in renderGame.
    case 'USE_BLOCKER': {
      if (game.phase !== 'BLOCK_STEP' || !game.battleState) return;
      const defenderId = Object.keys(game.players).find(id => id !== game.battleState.attackerId);
      if (playerId !== defenderId) return;
      const defender = game.players[defenderId];
      const blocker = defender.field.find(c => c.uid === action.blockerUid);
      if (!blocker) { send(playerId, {type:'ERROR', msg:'Invalid blocker'}); return; }
      if (!hasBlocker(blocker, game)) {
        send(playerId, {type:'ERROR', msg:'That card has no [Blocker]'}); return;
      }
      if (blocker.rested) { send(playerId, {type:'ERROR', msg:'Blocker is rested'}); return; }
      // P8 — "cannot activate [Blocker]" (Limejuice-style). Attack proceeds
      // normally as if no blocker was declared.
      if (isBlockerAbilitySuppressed(blocker)) {
        send(playerId, {type:'ERROR', msg:'Blocker ability is suppressed.'}); return;
      }
      blocker.rested = true;
      game.battleState.targetUid     = blocker.uid;
      game.battleState.targetName    = blocker.name;
      game.battleState.targetPower   = effectivePowerOf(blocker, game);
      game.battleState.targetIsLeader = false;
      // BUG 5 — flag so RESOLVE_ATTACK can distinguish "blocked by blocker"
      // from "defender won through raw power" in its outcome broadcast.
      game.battleState.blockerUsed = true;
      // Reset any prior counter bonus — counters are paid AFTER the block step.
      game.battleState.counterBonus = 0;
      game.phase = 'COUNTER_STEP';
      log(game, `\uD83D\uDEE1\uFE0F ${blocker.name} blocks the attack! (power: ${game.battleState.targetPower})`);
      // Phase 3 opt-in — cards flagged useNewPipeline route their
      // [On Block] effect through the multi-agent pipeline. Every other
      // card's [On Block] still depends on parseAndApply (which doesn't
      // currently wire onBlock at all — that's the point of the migration).
      // P8 — effects suppression blocks the [On Block] fire.
      if (isEffectsSuppressed(blocker)) {
        log(game, `${blocker.name}: [On Block] suppressed by opponent effect.`);
      } else if (blocker.useNewPipeline) {
        runPipeline('onBlock', game, defenderId, blocker);
      }
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
      // BUG 4 — Event counter cards cost DON equal to their printed cost;
      // Character counters (trash from hand for their Counter value) cost 0.
      // Enforce before splicing so the card stays in hand on failure.
      if (card.type === 'EVENT') {
        const cost = card.cost || 0;
        if (cost > defender.donActive) {
          send(playerId, {type:'ERROR', msg:`Not enough active DON (need ${cost}, have ${defender.donActive})`});
          return;
        }
        defender.donActive -= cost;
        defender.donRested += cost;
      }
      defender.hand.splice(idx, 1);
      defender.trash.push(card);
      // BUG 3 — flag set whenever the defender plays any counter (power or
      // ability). RESOLVE_ATTACK consults this to choose between the
      // "Attack countered!" and "No damage — defender wins!" wordings.
      game.battleState.counterUsed = true;
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
        // P8 — effects suppression mutes the [Counter] ability. The card
        // still discards for its counter value; only the ability fire is
        // blocked.
        if (isEffectsSuppressed(card)) {
          log(game, `${card.name}: [Counter] ability suppressed by opponent effect.`);
        } else if (card.useNewPipeline) {
          // Phase-5 Priority-1 routing: new-pipeline counter events
          // (NoroNoro Beam Sword, Bad Manners Kick Course) run their
          // [Counter] block through runPipeline.
          runPipeline('counter', game, defenderId, card);
        } else {
          parseAndApply('counter', game, defenderId, card, oppOfDefender);
        }
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
      // BUG 16 — house rule: attacker wins every tie (leader AND character).
      // Diverges from published OPTCG tie rules (defender usually wins leader
      // ties on a >). User explicitly asked for >= across the board.
      const attackerWins = bs.attackerPower >= totalDefense;

      // Outcome payload assembled as we resolve — broadcast after so both
      // clients can render a role-specific transient banner (BUG 2) and
      // immediately drop the battle arrow.
      const outcome = {
        type: 'ATTACK_OUTCOME',
        attackerId: bs.attackerId,
        defenderId,
        attackerName: bs.attackerName,
        targetName: bs.targetName,
        targetIsLeader: !!bs.targetIsLeader,
        attackerWins,
        outcome: 'blocked',   // will be overwritten below
        lifeRemaining: defender.life.length,
        doubleAttack: !!(attackerCard && hasDoubleAttack(attackerCard)),
        blockerUsed: !!bs.blockerUsed,
        counterUsed: !!bs.counterUsed,
      };

      if (attackerWins) {
        if (bs.targetIsLeader) {
          // Hit the leader. If defender has 0 life left, they lose.
          if (defender.life.length === 0) {
            game.winner = bs.attackerId;
            log(game, `\uD83C\uDFC6 ${bs.attackerName} hits the leader with no life left — ${bs.attackerId.slice(0,6)} WINS!`);
            outcome.outcome = 'game_won';
          } else {
            const lifeCard = defender.life.pop();
            defender.hand.push(lifeCard);
            log(game, `\uD83D\uDCA5 ${bs.attackerName} hits the leader! Life card ${lifeCard.name} \u2192 hand. ${defender.life.length} life remaining.`);
            applyTriggerEffect(game, defenderId, lifeCard);
            outcome.outcome = 'leader_hit';
            outcome.lifeRemaining = defender.life.length;
          }
        } else {
          // Hit a character (the original target or the chosen blocker) — KO it.
          const target = defender.field.find(c => c.uid === bs.targetUid);
          if (target) {
            defender.field = defender.field.filter(c => c.uid !== bs.targetUid);
            defender.trash.push(target);
            dropTempEffectsFor(game, target.uid);
            log(game, `\uD83D\uDC80 ${target.name} K.O.'d! (${bs.attackerPower} vs ${totalDefense})`);
            triggerOnKO(game, defenderId, target, bs.attackerId);
            outcome.outcome = 'character_koed';
          }
        }
      } else {
        log(game, `\uD83D\uDEE1\uFE0F ${bs.targetName} survives the attack (${bs.attackerPower} vs ${totalDefense}).`);
        // BUG 3 (this batch) — outcome categorisation now has four cases:
        //   blocked           — a Blocker card intercepted the attack
        //   countered         — a counter card pushed defense past attack
        //   defender_power_win — raw power survived (no blocker, no counter)
        //   attack_failed     — leader attack where defender held the line
        // blocker takes precedence over counter in the wording, since the
        // blocker IS the reason the attack didn't hit the leader; the
        // counter bonus just made that blocker's power higher.
        if (bs.blockerUsed)          outcome.outcome = 'blocked';
        else if (bs.counterUsed)     outcome.outcome = 'countered';
        else if (bs.targetIsLeader)  outcome.outcome = 'attack_failed';
        else                         outcome.outcome = 'defender_power_win';
        // Blocker that wins stays on board, but remains rested (already rested by USE_BLOCKER).
      }

      // Attacker stays rested (already rested by DECLARE_ATTACK).
      // Bug 8 — drop "during this battle" temp power buffs now that the battle is over.
      if (game.tempPowerEffects && game.tempPowerEffects.length) {
        game.tempPowerEffects = game.tempPowerEffects.filter(e => e.kind !== 'battle');
      }
      game.battleState = null;
      game.phase = 'MAIN';
      broadcast(roomId, outcome);
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
        if (card.useNewPipeline) {
          runPipeline('counter', game, playerId, card);
        } else {
          parseAndApply('counter', game, playerId, card, counterOpp);
        }
      }
      break;
    }

    case 'BLOCK': {
      if (!game.counterWindow || game.counterWindow.defenderId !== playerId) return;
      const blocker = p.field.find(c => c.uid === action.blockerUid && !c.rested);
      if (!blocker || !hasBlocker(blocker, game)) {
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
      const pipelineResume = sw.pipelineResume;  // captured before clear
      const kept = action.keptIndices || []; // indices of cards to keep in hand

      // Validate keep count + filters
      if (kept.length > (sw.keepCount || 0)) {
        send(playerId, {type:'ERROR', msg:`May only keep up to ${sw.keepCount} cards.`});
        return;
      }
      for (const idx of kept) {
        const c = sw.cards[idx];
        if (!c) { send(playerId, {type:'ERROR', msg:'Invalid keep index.'}); return; }
        if (sw.keepCardType && c.type !== sw.keepCardType) {
          send(playerId, {type:'ERROR', msg:`${c.name} is not an ${sw.keepCardType.toLowerCase()} card.`});
          return;
        }
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

      // Add kept cards to hand — and broadcast each one as a REVEAL so the
      // opponent sees what was picked. Scales to every scry effect: Schola
      // Montis Belli, Queen Victoria, and any future card whose resolver
      // flows through SCRY_RESOLVE.
      kept.forEach(idx => {
        const c = sw.cards[idx];
        if (!c) return;
        p.hand.push(c);
        broadcast(roomId, {
          type: 'REVEAL_CARD',
          card: { id: c.id, name: c.name, image: c.image || '', ability: c.ability || '' },
          revealedBy: playerId,
          source: sw.cardName,
        });
      });
      if (kept.length > 0) log(game, `${sw.cardName}: added ${kept.length} card(s) to hand.`);

      // Placement — two modes:
      //   split mode ('either'): client sends topOrder + bottomOrder; we
      //     unshift the top pile (first = deepest top) and push the bottom
      //     pile (first = nearest to existing bottom).
      //   single mode ('top' / 'bottom'): client sends order + placement
      //     override; existing behavior.
      const remaining = sw.cards.filter((_, idx) => !kept.includes(idx));
      if (sw.placement === 'trash') {
        // "This is MY AGE" variant: un-kept cards go to the player's trash
        // rather than back to the deck. No ordering choice needed.
        p.trash.push(...remaining);
        log(game, `${sw.cardName}: trashed ${remaining.length} card(s) from the reveal.`);
      } else if (sw.placement === 'either' && (action.topOrder || action.bottomOrder)) {
        const topCards = (action.topOrder    || []).map(i => remaining[i]).filter(Boolean);
        const botCards = (action.bottomOrder || []).map(i => remaining[i]).filter(Boolean);
        // deck[0] = top; unshift(a,b,c) → deck becomes [a,b,c,...], so first in topCards
        // lands at deck[0] (the very top), matching "first clicked = top".
        if (topCards.length) p.deck.unshift(...topCards);
        if (botCards.length) p.deck.push(...botCards);
        log(game, `${sw.cardName}: returned ${topCards.length} to top, ${botCards.length} to bottom.`);
      } else {
        const order = action.order || [];
        const placement = action.placement === 'top' ? 'top' : (sw.placement === 'top' ? 'top' : 'bottom');
        const ordered = order.length > 0
          ? order.map(idx => remaining[idx]).filter(Boolean)
          : remaining;
        if (placement === 'top') p.deck.unshift(...ordered);
        else p.deck.push(...ordered);
        log(game, `${sw.cardName}: returned ${ordered.length} card(s) to ${placement} of deck.`);
      }

      game.scryWindow = null;
      // Phase-4 Batch 3: new-pipeline scry (FiFi Cat and future cards)
      // chains to the next effect. Legacy scry from parseAndApply has
      // no resume path and simply ends here.
      if (pipelineResume) resumePipeline(game, playerId, pipelineResume);
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
        const pipelineResume = w.pipelineResume;
        game.koTargetWindow = null;
        // Phase-4: new-pipeline cards take precedence — the pipeline's
        // own chain state is authoritative.
        if (pipelineResume) {
          resumePipeline(game, playerId, pipelineResume);
          return;
        }
        if (resumeTiming && resumeCardUid) {
          const owner = game.players[playerId];
          const src = (owner.leader && owner.leader.uid === resumeCardUid) ? owner.leader
                    : (owner.field || []).find(c => c.uid === resumeCardUid);
          if (src) {
            const oppOfSrc = game.players[Object.keys(game.players).find(id => id !== playerId)];
            // BUG 7 — Chris the Visually Impaired and every other DON-cost-
            // then-K.O. card re-opened the DON return prompt on resume
            // because the new opts didn't carry donCostPaid forward. The
            // DON block in parseAndApply only short-circuits when
            // donCostPaid is truthy. Propagating it here closes the loop.
            // Safe for cards without a DON cost — donCostMatch is null in
            // that case and both branches of the DON block are skipped.
            parseAndApply(resumeTiming, game, playerId, src, oppOfSrc, { koResolved: true, donCostPaid: true });
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
      // Track-P Phase 6 — self-save passives (Ace, Law, Vergo). If the
      // target card carries a selfSaveReplacement and its once-per-turn
      // slot is open, auto-apply the alternative and skip the K.O.
      if (tryAutoSelfSave(target, playerId, game, w.sourceCardName)) {
        finishWindow();
        break;
      }
      oppOfActor.field = oppOfActor.field.filter(c => c.uid !== action.targetUid);
      oppOfActor.trash.push(target);
      dropTempEffectsFor(game, target.uid);
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
      const pipelineResume = w.pipelineResume;
      const timing = w.timing;
      const sourceCardUid = w.sourceCardUid;
      game.donReturnWindow = null;
      // Phase-4: new-pipeline cards get their own resume path.
      if (pipelineResume) {
        resumePipeline(game, playerId, pipelineResume);
        break;
      }
      // Legacy parseAndApply resume — checks leader/field only (events in
      // trash are a known miss in the legacy flow; pipeline cards don't
      // have that bug).
      const sourceCard = (owner.leader.uid === sourceCardUid) ? owner.leader
                       : owner.field.find(c => c.uid === sourceCardUid);
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
        // P8 — effects suppression: trigger fire is blocked when the
        // card (now in trash) carries a suppression. Rare in practice
        // since suppressions usually target cards on the field.
        if (isEffectsSuppressed(tw.card)) {
          log(game, `${tw.card.name}: [Trigger] suppressed by opponent effect.`);
        } else if (tw.card.useNewPipeline) {
          // Phase 5 Priority 5 — route new-pipeline cards through
          // runPipeline for their [Trigger] block. Snow Merchant is the
          // first card that benefits (its [Trigger] block contains a
          // meta-ref to its own [Counter] block).
          runPipeline('trigger', game, playerId, tw.card);
        } else {
          parseAndApply('trigger', game, playerId, tw.card, oppOfTrigger);
        }
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
      const pipelineResume = w.pipelineResume;  // capture before clear
      if (action.skip) {
        log(game, `${w.sourceCardName || 'Effect'}: choice skipped.`);
        game.playFromHandWindow = null;
        if (pipelineResume) resumePipeline(game, playerId, pipelineResume);
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
      if (isOnPlaySuppressed(game, playerId)) {
        log(game, `${picked.name}: [On Play] suppressed.`);
      } else {
        log(game, `${picked.name}: triggering [On Play].`);
        if (picked.useNewPipeline) runPipeline('onPlay', game, playerId, picked);
        else parseAndApply('onPlay', game, playerId, picked, opp2);
      }
      // After the played card's own onPlay resolves, continue the chain
      // for the effect that DISPATCHED the play (e.g. Snow Merchant's
      // counter → playFromHand → caller's next effect, if any).
      if (pipelineResume) resumePipeline(game, playerId, pipelineResume);
      break;
    }

    // Track-P partial — Doflamingo redirect resolver. Mutates
    // battleState.targetUid to the picked own card and refreshes
    // target name/power for the overlay.
    case 'ATTACK_REDIRECT_SELECTED': {
      if (!game.attackRedirectWindow || game.attackRedirectWindow.playerId !== playerId) return;
      const w = game.attackRedirectWindow;
      const pipelineResume = w.pipelineResume;
      if (action.skip) {
        game.attackRedirectWindow = null;
        log(game, `${w.sourceCardName}: redirect skipped.`);
        if (pipelineResume) resumePipeline(game, playerId, pipelineResume);
        break;
      }
      if (!action.targetUid || !w.candidateUids.includes(action.targetUid)) {
        send(playerId, {type:'ERROR', msg:'Invalid redirect target.'});
        return;
      }
      // Locate the chosen card on defender's own side.
      const me = game.players[playerId];
      const newTarget = (me.leader && me.leader.uid === action.targetUid) ? me.leader
                     : (me.field || []).find(c => c.uid === action.targetUid);
      if (!newTarget || !game.battleState) {
        game.attackRedirectWindow = null;
        if (pipelineResume) resumePipeline(game, playerId, pipelineResume);
        break;
      }
      game.battleState.targetUid = newTarget.uid;
      game.battleState.targetName = newTarget.name;
      game.battleState.targetPower = effectivePowerOf(newTarget, game);
      game.battleState.targetIsLeader = (me.leader && me.leader.uid === newTarget.uid);
      log(game, `${w.sourceCardName}: attack redirected to ${newTarget.name}.`);
      game.attackRedirectWindow = null;
      if (pipelineResume) resumePipeline(game, playerId, pipelineResume);
      break;
    }

    // Phase 7 — resolver for playFromTrash window. Moves the chosen
    // Character from trash to field (rested if the window flags so) and
    // fires its onPlay pipeline, mirroring PLAY_FROM_HAND_RESOLVE.
    case 'PLAY_FROM_TRASH_RESOLVE': {
      if (!game.playFromTrashWindow || game.playFromTrashWindow.playerId !== playerId) return;
      const w = game.playFromTrashWindow;
      const owner = game.players[playerId];
      const pipelineResume = w.pipelineResume;
      if (action.skip) {
        if (!w.optional) { send(playerId, {type:'ERROR', msg:'Must pick a target.'}); return; }
        log(game, `${w.sourceCardName}: skipped.`);
        game.playFromTrashWindow = null;
        if (pipelineResume) resumePipeline(game, playerId, pipelineResume);
        break;
      }
      if (!action.cardUid || !w.candidateUids.includes(action.cardUid)) {
        send(playerId, {type:'ERROR', msg:'Invalid pick.'});
        return;
      }
      const tidx = owner.trash.findIndex(c => c.uid === action.cardUid);
      if (tidx === -1) { game.playFromTrashWindow = null; break; }
      const picked = owner.trash.splice(tidx, 1)[0];
      picked.rested = w.rested === true;
      picked.attachedDon = 0;
      picked.usedThisTurn = false;
      picked.playedThisTurn = true;
      owner.field.push(picked);
      log(game, `${w.sourceCardName}: played ${picked.name} from trash${picked.rested ? ' (rested)' : ''}.`);
      game.playFromTrashWindow = null;
      const opp2 = game.players[Object.keys(game.players).find(id => id !== playerId)];
      if (isOnPlaySuppressed(game, playerId)) {
        log(game, `${picked.name}: [On Play] suppressed.`);
      } else {
        log(game, `${picked.name}: triggering [On Play].`);
        if (picked.useNewPipeline) runPipeline('onPlay', game, playerId, picked);
        else parseAndApply('onPlay', game, playerId, picked, opp2);
      }
      if (pipelineResume) resumePipeline(game, playerId, pipelineResume);
      break;
    }

    // Bug 5 — resolve "You may trash N card(s) from your hand:" cost. Player either
    // confirms a selection (cards trashed → resume effect) or skips (no effect fires).
    case 'TRASH_FROM_HAND_RESOLVE': {
      if (!game.trashFromHandWindow || game.trashFromHandWindow.playerId !== playerId) return;
      const w = game.trashFromHandWindow;
      const owner = game.players[playerId];
      const finishWindow = (paid) => {
        const resumeTiming = w.resumeTiming;
        const resumeCardUid = w.resumeCardUid;
        const pipelineResume = w.pipelineResume;
        const sourceName = w.sourceCardName;
        const selfRevive = w._selfRevive;
        game.trashFromHandWindow = null;
        if (!paid) return;
        // Track-P partial — Marco-style self-revive finalisation. Move
        // the source card from trash → field in the requested state.
        if (selfRevive) {
          const tidx = owner.trash.findIndex(c => c.uid === selfRevive.cardUid);
          if (tidx !== -1) {
            const picked = owner.trash.splice(tidx, 1)[0];
            picked.rested = (selfRevive.reviveState === 'rested');
            picked.attachedDon = 0;
            picked.usedThisTurn = false;
            picked.playedThisTurn = true;
            owner.field.push(picked);
            log(game, `${selfRevive.sourceName}: revived from trash${picked.rested ? ' (rested)' : ''}.`);
          }
        }
        // Phase-4: new-pipeline cards take precedence.
        if (pipelineResume) {
          resumePipeline(game, playerId, pipelineResume);
          return;
        }
        if (resumeTiming && resumeCardUid) {
          const src = findSourceCard(owner, resumeCardUid);
          if (src) {
            const oppOfSrc = game.players[Object.keys(game.players).find(id => id !== playerId)];
            parseAndApply(resumeTiming, game, playerId, src, oppOfSrc, { trashCostPaid: true });
          } else {
            log(game, `${sourceName}: source card no longer accessible — effect aborted.`);
          }
        }
      };
      if (action.skip) {
        if (!w.optional) { send(playerId, {type:'ERROR', msg:'Must trash cards to fire this effect.'}); return; }
        log(game, `${w.sourceCardName}: trash cost declined — effect skipped.`);
        finishWindow(false);
        break;
      }
      const sel = Array.isArray(action.cardUids) ? action.cardUids : [];
      if (sel.length !== w.count) { send(playerId, {type:'ERROR', msg:`Must trash exactly ${w.count} card(s).`}); return; }
      // Validate each card: must be in hand AND match filters.
      const picked = [];
      for (const uid of sel) {
        const idx = owner.hand.findIndex(c => c.uid === uid);
        if (idx === -1) { send(playerId, {type:'ERROR', msg:'Card not in hand.'}); return; }
        const c = owner.hand[idx];
        if (w.filterType && c.type !== w.filterType) { send(playerId, {type:'ERROR', msg:`Must trash ${w.filterType.toLowerCase()} cards.`}); return; }
        if (w.filterPowerMin != null && (c.power || 0) < w.filterPowerMin) {
          send(playerId, {type:'ERROR', msg:`Card power below ${w.filterPowerMin}.`}); return;
        }
        picked.push({ idx, card: c });
      }
      // Move from hand to trash. Sort indices descending so splice doesn't shift earlier picks.
      picked.sort((a, b) => b.idx - a.idx);
      for (const { idx, card } of picked) {
        owner.hand.splice(idx, 1);
        owner.trash.push(card);
      }
      log(game, `${w.sourceCardName}: trashed ${picked.length} card(s) — ${picked.map(p => p.card.name).join(', ')}.`);
      finishWindow(true);
      break;
    }

    // Bug 6 — resolve bounce target selection. Returns the chosen Character to
    // its OWNER's hand (not the actor's), strips its attached DON, and removes
    // any temp power buffs targeting that uid.
    case 'BOUNCE_TARGET_SELECTED': {
      if (!game.bounceTargetWindow || game.bounceTargetWindow.playerId !== playerId) return;
      const w = game.bounceTargetWindow;
      const finishWindow = () => {
        const resumeTiming = w.resumeTiming;
        const resumeCardUid = w.resumeCardUid;
        const pipelineResume = w.pipelineResume;
        game.bounceTargetWindow = null;
        // Phase-4: new-pipeline path first.
        if (pipelineResume) {
          resumePipeline(game, playerId, pipelineResume);
          return;
        }
        if (resumeTiming && resumeCardUid) {
          const owner = game.players[playerId];
          const src = findSourceCard(owner, resumeCardUid);
          if (src) {
            const oppOfSrc = game.players[Object.keys(game.players).find(id => id !== playerId)];
            parseAndApply(resumeTiming, game, playerId, src, oppOfSrc, { bounceResolved: true });
          }
        }
      };
      if (action.skip) {
        if (!w.optional) { send(playerId, {type:'ERROR', msg:'Must select a target to bounce.'}); return; }
        log(game, `${w.sourceCardName}: bounce skipped.`);
        finishWindow();
        break;
      }
      if (!action.targetUid || !w.candidateUids.includes(action.targetUid)) {
        send(playerId, {type:'ERROR', msg:'Invalid bounce target.'});
        return;
      }
      // Find which side owns the target — either player's field is fair game.
      let ownerOfTarget = null;
      for (const pid of Object.keys(game.players)) {
        const pl = game.players[pid];
        if (pl.field.some(c => c.uid === action.targetUid)) { ownerOfTarget = pl; break; }
      }
      if (!ownerOfTarget) { send(playerId, {type:'ERROR', msg:'Target no longer on field.'}); return; }
      const target = ownerOfTarget.field.find(c => c.uid === action.targetUid);
      ownerOfTarget.field = ownerOfTarget.field.filter(c => c.uid !== action.targetUid);
      target.attachedDon = 0;
      target.rested = false;
      target.playedThisTurn = false;
      dropTempEffectsFor(game, action.targetUid);
      ownerOfTarget.hand.push(target);
      log(game, `${w.sourceCardName}: returned ${target.name} to hand.`);
      finishWindow();
      break;
    }

    // BUG 5 (this batch) — rest-target resolution. Flips c.rested on the
    // picked opponent character, then resumes parseAndApply so follow-up
    // clauses (e.g. Anna's "Draw 1 card") can fire.
    case 'REST_TARGET_SELECTED': {
      if (!game.restTargetWindow || game.restTargetWindow.playerId !== playerId) return;
      const w = game.restTargetWindow;
      const oppOfActor = game.players[Object.keys(game.players).find(id => id !== playerId)];
      const finishWindow = () => {
        const resumeTiming  = w.resumeTiming;
        const resumeCardUid = w.resumeCardUid;
        const pipelineResume = w.pipelineResume;
        game.restTargetWindow = null;
        // Phase-4 Batch 3: new-pipeline cards (Anna of Brittany) chain
        // resume here; legacy cards still flow through parseAndApply.
        if (pipelineResume) {
          resumePipeline(game, playerId, pipelineResume);
          return;
        }
        if (resumeTiming && resumeCardUid) {
          const owner = game.players[playerId];
          const src = (owner.leader && owner.leader.uid === resumeCardUid) ? owner.leader
                    : (owner.field || []).find(c => c.uid === resumeCardUid);
          if (src) {
            const oppOfSrc = game.players[Object.keys(game.players).find(id => id !== playerId)];
            parseAndApply(resumeTiming, game, playerId, src, oppOfSrc, { restResolved: true, donCostPaid: true });
          }
        }
      };
      if (action.skip) {
        if (!w.optional) { send(playerId, {type:'ERROR', msg:'Must select a character to rest.'}); return; }
        log(game, `${w.sourceCardName}: rest skipped.`);
        finishWindow();
        break;
      }
      if (!action.targetUid || !w.candidateUids.includes(action.targetUid)) {
        send(playerId, {type:'ERROR', msg:'Invalid rest target.'});
        return;
      }
      const target = oppOfActor.field.find(c => c.uid === action.targetUid);
      if (!target) { send(playerId, {type:'ERROR', msg:'Target no longer on field.'}); return; }
      target.rested = true;
      log(game, `${w.sourceCardName}: rested ${target.name}.`);
      finishWindow();
      break;
    }

    // Phase-5 Priority-8 resolver: player picked a target to apply a
    // suppression to. Pushes a { kind, expiresAtTurn } entry onto the
    // target's suppressions array. doEnd prunes expired entries.
    case 'SUPPRESSION_TARGET_SELECTED': {
      if (!game.suppressionTargetWindow || game.suppressionTargetWindow.playerId !== playerId) return;
      const w = game.suppressionTargetWindow;
      const pipelineResume = w.pipelineResume;
      if (action.skip) {
        if (!w.optional) { send(playerId, {type:'ERROR', msg:'Must select a suppression target.'}); return; }
        log(game, `${w.sourceCardName}: suppression skipped.`);
        game.suppressionTargetWindow = null;
        if (pipelineResume) resumePipeline(game, playerId, pipelineResume);
        break;
      }
      if (!action.targetUid || !w.candidateUids.includes(action.targetUid)) {
        send(playerId, {type:'ERROR', msg:'Invalid target.'}); return;
      }
      // Locate the target on either field or as a leader.
      let target = null;
      for (const pid of Object.keys(game.players)) {
        const pl = game.players[pid];
        if (pl.leader && pl.leader.uid === action.targetUid) { target = pl.leader; break; }
        const hit = (pl.field || []).find(c => c.uid === action.targetUid);
        if (hit) { target = hit; break; }
      }
      if (!target) { send(playerId, {type:'ERROR', msg:'Target gone.'}); return; }
      // Compute expiresAtTurn. 'thisTurn' keeps the buff for the rest of
      // the current turn; doEnd drops it at the end (same math as
      // tempPowerEffects). 'opponentNextTurn' persists one extra turn.
      const expiresAtTurn = w.duration === 'opponentNextTurn' ? (game.turn + 1) : game.turn;
      if (!Array.isArray(target.suppressions)) target.suppressions = [];
      target.suppressions.push({
        kind: w.kind, expiresAtTurn, source: w.sourceCardName,
      });
      log(game, `${w.sourceCardName}: ${target.name} is now suppressed (${w.kind}) until turn ${expiresAtTurn}.`);
      // Phase 8 — track the picked target for ifLastTarget / koLastTarget
      // follow-ups (Black Hole). Cleared after the dependent effect runs.
      game._lastPickedTargetUid = target.uid;
      game.suppressionTargetWindow = null;
      if (pipelineResume) resumePipeline(game, playerId, pipelineResume);
      break;
    }

    // Phase-5 Priority-8 (3/3) resolver: player picked which branch of a
    // "Choose one:" card to run (Doflamingo OP14-069). Runs the branch
    // effects in sequence; if any effect opens a window, its resume
    // carries the outer pipelineResume so the pipeline continues after
    // the branch completes. Branches for P8-3 have at most one effect
    // — multi-effect branches are deferred (not present in CARD_DB).
    case 'CHOOSE_ONE_SELECTED': {
      if (!game.chooseOneWindow || game.chooseOneWindow.playerId !== playerId) return;
      const w = game.chooseOneWindow;
      const pipelineResume = w.pipelineResume;
      const branchIndex = action.branchIndex;
      const branch = (w.branches || [])[branchIndex];
      if (!branch) { send(playerId, {type:'ERROR', msg:'Invalid branch.'}); return; }
      if (!branch.available) { send(playerId, {type:'ERROR', msg:'Branch not available (condition unmet).'}); return; }
      // Locate source card for ctx rebuild.
      const owner = game.players[playerId];
      const src = (owner.leader && owner.leader.uid === w.sourceCardUid) ? owner.leader
               : (owner.field || []).find(c => c.uid === w.sourceCardUid)
               || (owner.trash || []).find(c => c.uid === w.sourceCardUid);
      game.chooseOneWindow = null;
      if (!src) {
        if (pipelineResume) resumePipeline(game, playerId, pipelineResume);
        break;
      }
      const ctx = { game, playerId, card: src, player: owner, _blockOptional: true };
      log(game, `${w.sourceCardName}: picked branch #${branchIndex + 1}.`);
      let opened = false;
      for (const eff of (branch.effects || [])) {
        const res = agentApplyEffect(eff, ctx, pipelineResume);
        if (res && res.status === 'window-open') { opened = true; break; }
      }
      if (!opened && pipelineResume) resumePipeline(game, playerId, pipelineResume);
      break;
    }

    // Phase-5 Priority-1 resolver: player picked a target for a temp
    // ±power buff (NoroNoro Beam Sword, Bad Manners Kick Course,
    // Yasopp). applyTempPower keeps the buff in tempPowerEffects with
    // the chosen expiry; the renderer already uses that for overlays.
    case 'POWER_BUFF_TARGET_SELECTED': {
      if (!game.powerBuffTargetWindow || game.powerBuffTargetWindow.playerId !== playerId) return;
      const w = game.powerBuffTargetWindow;
      const pipelineResume = w.pipelineResume;
      if (action.skip) {
        if (!w.optional) { send(playerId, {type:'ERROR', msg:'Must select a target.'}); return; }
        log(game, `${w.sourceCardName}: power buff skipped.`);
        game.powerBuffTargetWindow = null;
        if (pipelineResume) resumePipeline(game, playerId, pipelineResume);
        break;
      }
      if (!action.targetUid || !w.candidateUids.includes(action.targetUid)) {
        send(playerId, {type:'ERROR', msg:'Invalid target.'});
        return;
      }
      // Track-P — when the window is opened in cost-debuff mode the
      // resolver writes into tempCostEffects instead of tempPowerEffects.
      if (w.mode === 'cost') {
        const expiresAtTurn = (w.duration === 'opponentNextTurn') ? (game.turn + 1) : game.turn;
        if (!Array.isArray(game.tempCostEffects)) game.tempCostEffects = [];
        game.tempCostEffects.push({
          targetUid: action.targetUid, amount: w.amount, expiresAtTurn,
          source: w.sourceCardName,
        });
        log(game, `${w.sourceCardName}: target cost modified by ${w.amount}.`);
      } else {
        applyTempPower(game, action.targetUid, w.amount, w.duration, w.sourceCardName);
      }
      game.powerBuffTargetWindow = null;
      if (pipelineResume) resumePipeline(game, playerId, pipelineResume);
      break;
    }

    // Phase 3 UI-agent resolver: player picked a character to place at the
    // bottom of its owner's deck (Noble Shlawger's [On Block]). Mirrors
    // the bounce-target flow but pushes to deck instead of hand. The card
    // loses attached DON / rested / played-this-turn flags on the way out,
    // and any temp power effects targeting it are dropped.
    case 'PLACE_AT_BOTTOM_SELECTED': {
      if (!game.placeAtBottomWindow || game.placeAtBottomWindow.playerId !== playerId) return;
      const w = game.placeAtBottomWindow;
      const pipelineResume = w.pipelineResume;  // captured before window clears
      if (action.skip) {
        if (!w.optional) { send(playerId, {type:'ERROR', msg:'Must select a target.'}); return; }
        log(game, `${w.sourceCardName}: place-at-bottom skipped.`);
        game.placeAtBottomWindow = null;
        if (pipelineResume) resumePipeline(game, playerId, pipelineResume);
        break;
      }
      if (!action.targetUid || !w.candidateUids.includes(action.targetUid)) {
        send(playerId, {type:'ERROR', msg:'Invalid target.'});
        return;
      }
      let ownerOfTarget = null;
      for (const pid of Object.keys(game.players)) {
        if (game.players[pid].field.some(c => c.uid === action.targetUid)) {
          ownerOfTarget = game.players[pid];
          break;
        }
      }
      if (!ownerOfTarget) { send(playerId, {type:'ERROR', msg:'Target no longer on field.'}); return; }
      const idx = ownerOfTarget.field.findIndex(c => c.uid === action.targetUid);
      const target = ownerOfTarget.field[idx];
      ownerOfTarget.field.splice(idx, 1);
      target.attachedDon = 0;
      target.rested = false;
      target.playedThisTurn = false;
      dropTempEffectsFor(game, target.uid);
      ownerOfTarget.deck.push(target);
      log(game, `${w.sourceCardName}: placed ${target.name} at the bottom of its owner's deck.`);
      game.placeAtBottomWindow = null;
      if (pipelineResume) resumePipeline(game, playerId, pipelineResume);
      break;
    }

    // Resolve add-from-trash selection (George the Brave & friends). This is
    // the tail of the effect, so there is no resumeTiming to re-enter.
    case 'ADD_FROM_TRASH_SELECTED': {
      if (!game.addFromTrashWindow || game.addFromTrashWindow.playerId !== playerId) return;
      const w = game.addFromTrashWindow;
      const owner = game.players[playerId];
      const pipelineResume = w.pipelineResume;  // captured before the window is cleared
      if (action.skip) {
        if (!w.optional) { send(playerId, {type:'ERROR', msg:'Must select a card from trash.'}); return; }
        log(game, `${w.sourceCardName}: add-from-trash skipped.`);
        game.addFromTrashWindow = null;
        if (pipelineResume) resumePipeline(game, playerId, pipelineResume);
        break;
      }
      if (!action.cardUid || !w.candidateUids.includes(action.cardUid)) {
        send(playerId, {type:'ERROR', msg:'Invalid trash selection.'});
        return;
      }
      const idx = owner.trash.findIndex(c => c.uid === action.cardUid);
      if (idx === -1) { send(playerId, {type:'ERROR', msg:'Card no longer in trash.'}); return; }
      const picked = owner.trash.splice(idx, 1)[0];
      owner.hand.push(picked);
      log(game, `${w.sourceCardName}: added ${picked.name} from trash to hand.`);
      game.addFromTrashWindow = null;
      if (pipelineResume) resumePipeline(game, playerId, pipelineResume);
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
  const target = opp.field.find(c => c.type === 'CHARACTER' && (c.power + (c.attachedDon || 0) * 1000 + tempPowerSum(game, c.uid)) <= threshold);
  if (target) {
    opp.field = opp.field.filter(c => c.uid !== target.uid);
    opp.trash.push(target);
    dropTempEffectsFor(game, target.uid);
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
    dropTempEffectsFor(game, target.uid);
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
function hasBlocker(card, game) {
  if (!card) return false;
  // Track-P Phase 3 — if a conditional [Blocker] passive exists, defer
  // to its evaluation; the literal "[Blocker]" in the ability text is
  // the embedded bracket inside the conditional phrase (PRB02-015),
  // not a static grant.
  const passives = (game && PASSIVE_EFFECTS) ? (PASSIVE_EFFECTS.get(card.id) || []) : [];
  const conditionalBlocker = passives.find(p => p.type === 'conditionalKeyword' && p.keyword === 'blocker');
  if (conditionalBlocker) {
    if (!game) return false;
    const owner = findCardOwner(game, card.uid);
    if (!owner) return false;
    return _passiveConditionsOk(conditionalBlocker.conditions, card, game, owner);
  }
  if (card.ability && card.ability.includes('[Blocker]')) return true;
  return false;
}

// Helper: check if card has [Double Attack]
function hasDoubleAttack(card) {
  return card.ability && card.ability.includes('[Double Attack]');
}

// Helper: check if card has [Banish]
function hasBanish(card) {
  return card.ability && card.ability.includes('[Banish]');
}

// Helper: check if card has [Rush]. Phase 7 — also considers temporary
// keyword grants from grantKeyword effects (Gee, Infernal Hound-Shlawg).
function hasRush(card) {
  if (card && card.ability && card.ability.includes('[Rush]')) return true;
  if (card && Array.isArray(card.tempKeywords)
      && card.tempKeywords.some(k => k.keyword === 'rush')) return true;
  return false;
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
// Phase 7 — opens playFromTrashWindow so the player picks which trashed
// Character to deploy (optionally rested). Filter supports affiliation,
// type, maxCost, excludeName — matching the parsed playFromTrash effect.
function openPlayFromTrash(game, playerId, opts) {
  const p = game.players[playerId];
  const { filter = {}, rested = false, sourceCardName = '',
          pipelineResume = null, max = 1, optional = true } = opts || {};
  const candidates = (p.trash || []).filter(c => {
    if (filter.type && c.type !== filter.type) return false;
    if (filter.maxCost != null && (c.cost || 0) > filter.maxCost) return false;
    if (filter.affiliation) {
      const aff = c.affiliation || '';
      if (!aff.toLowerCase().includes(filter.affiliation.toLowerCase())) return false;
    }
    if (filter.excludeName && c.name === filter.excludeName) return false;
    return true;
  });
  if (candidates.length === 0) {
    log(game, `${sourceCardName || 'Effect'}: no eligible Character in trash.`);
    return false;
  }
  game.playFromTrashWindow = {
    playerId,
    candidateUids: candidates.map(c => c.uid),
    filter, rested, sourceCardName, optional, max,
    pipelineResume,
  };
  log(game, `${sourceCardName}: choose a Character from trash (${candidates.length} option(s)).`);
  return true;
}

// Opens game.playFromHandWindow so the player picks which Character to deploy
// for free. Pattern: "Play up to 1 [{TYPE} type] Character card with a cost of
// N or less from your hand". `typeName` filters by card.affiliation; `nameMatch`
// targets a specific named card (e.g. ST04-002 references [Toad Wizzy]).
function openPlayFromHand(game, playerId, opts) {
  const p = game.players[playerId];
  const { costThreshold = 99, typeName = null, nameMatch = null, sourceCardName = '',
          pipelineResume = null } = opts || {};
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
    // Phase-5 chain resume — PLAY_FROM_HAND_RESOLVE routes through
    // resumePipeline when set.
    pipelineResume,
  };
  log(game, `${sourceCardName || 'Effect'}: choose a Character to play for free` +
            (typeName ? ` ({${typeName}})` : '') + ` (${candidates.length} option(s)).`);
  return true;
}

// Extract "{Type Name} type Character/Event/Stage" affiliation filter from an
// effect snippet. Used by both play-from-hand candidate filtering AND scry
// reveal-filter, so the trailing card-kind word is required (avoids false
// positives like "{X} type" appearing in unrelated grammar).
function extractTypeFilter(text) {
  const m = text.match(/\{([^}]+)\}\s*type\s*(?:Character|Event|Stage)\b/i);
  return m ? m[1] : null;
}

// Companion to extractTypeFilter — returns the card kind being filtered to,
// e.g. "{Duchess of Brittany} type Event card" → 'EVENT'. Used to enforce the
// type half of the filter inside scry windows so Queen Victoria's reveal only
// accepts Events even when other affiliated cards are revealed.
function extractCardTypeFilter(text) {
  const m = text.match(/\{[^}]+\}\s*type\s*(Character|Event|Stage)\b/i);
  return m ? m[1].toUpperCase() : null;
}

// Open the interactive DON!!-return window for a "DON!! -N: <effect>" cost. The
// player will pick which DON to send back to the deck (active/rested/attached).
// Returns true if the window opened, false if the player can't afford the cost
// (sum of donActive + donRested + every attachedDon < required).
function openDonReturn(game, playerId, card, required, timing, opts = {}) {
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
    // Phase-4 chain resume (Batch 2) — RETURN_DON hands off to the
    // pipeline resumer when this is set, instead of calling parseAndApply.
    pipelineResume: opts.pipelineResume || null,
  };
  log(game, `${card.name}: choose ${required} DON!! to return to deck.`);
  return true;
}

// Open the interactive KO target picker. Returns true if at least one valid target
// exists and the window opened, false otherwise (the caller should fall through).
// `count` defaults to 1 — for multi-target ("K.O. up to N"), the window stays open
// until the count is exhausted or the player skips.
// BUG 5 (this batch) — opens the interactive rest-target picker. Candidates
// are active (non-rested) opponent CHARACTER cards; optional defaults to
// false (user must pick). Returns false when no active opponent characters
// exist — caller uses that to block the activation entirely.
function openRestTargetWindow(game, playerId, opts) {
  const opp = game.players[Object.keys(game.players).find(id => id !== playerId)];
  const { sourceCardName = '', optional = false, resumeTiming = null, resumeCardUid = null,
          costThreshold = null, pipelineResume = null } = opts || {};
  const candidates = (opp.field || []).filter(c =>
    c.type === 'CHARACTER' && !c.rested &&
    (costThreshold == null || (c.cost || 0) <= costThreshold)
  );
  if (candidates.length === 0) {
    log(game, `${sourceCardName}: no active opponent characters to rest.`);
    return false;
  }
  game.restTargetWindow = {
    playerId,
    candidateUids: candidates.map(c => c.uid),
    optional,
    sourceCardName,
    resumeTiming, resumeCardUid,
    pipelineResume,
  };
  log(game, `${sourceCardName}: choose an opponent Character to rest (${candidates.length} option(s)).`);
  return true;
}

function openKoTargetWindow(game, playerId, opts) {
  const opp = game.players[Object.keys(game.players).find(id => id !== playerId)];
  // Track-P Phase 5 — exclude opponent's KO-protected characters.
  const candidates = opp.field.filter(c =>
    c.type === 'CHARACTER' && opts.filter(c) &&
    !isRemovalProtected(c, playerId, game, 'ko'));
  if (candidates.length === 0) {
    log(game, `${opts.sourceCardName}: no valid K.O. targets.`);
    return false;
  }
  game.koTargetWindow = {
    playerId,
    candidateUids: candidates.map(c => c.uid),
    initialCount: opts.count || 1,
    remaining: opts.count || 1,
    optional: opts.optional !== false,
    sourceCardName: opts.sourceCardName,
    filterKind:  opts.filterKind  || 'character',
    filterValue: opts.filterValue || '',
    resumeTiming:  opts.resumeTiming  || null,
    resumeCardUid: opts.resumeCardUid || null,
    // Phase-4 chain resume — when set, the KO_TARGET_SELECTED finishWindow
    // routes through resumePipeline instead of parseAndApply.
    pipelineResume: opts.pipelineResume || null,
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
  // placement is one of:
  //   'bottom' — forced bottom ("place the rest at the bottom")
  //   'either' — player assigns each remaining card to top or bottom
  //              ("return them to the top or bottom of the deck in any order")
  //   'top'    — forced top (fallback / legacy)
  let placement;
  if (/place the rest at the bottom/i.test(effect)) placement = 'bottom';
  else if (/top or bottom/i.test(effect)) placement = 'either';
  else placement = 'top';
  game.scryWindow = {
    playerId,
    cards: p.deck.splice(0, lookCount),
    keepCount,
    keepFilter,        // affiliation filter (e.g. "Duchess of Brittany")
    keepCardType: extractCardTypeFilter(effect), // 'EVENT'|'CHARACTER'|'STAGE'|null
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

// ─── Bug 5/6/8 helpers ────────────────────────────────────────────────────

// Effective power = printed power + 1000 per attached DON + sum of any
// game.tempPowerEffects targeting this card + any continuous passive (e.g.
// Jesse the Jester). Used everywhere battle math happens on the server
// (DECLARE_ATTACK, USE_BLOCKER, RESOLVE_ATTACK) so passives affect actual
// battle outcomes — not just the displayed power on the client.
// Track-P Phase 6 — self-save replacement. Checks whether a card
// about to be removed by opponent-sourced effect carries a
// selfSaveReplacement passive and a once-per-turn slot is available.
// On match, applies the alternative in place of removal and returns
// true (caller skips the removal step). Simplification: auto-applies
// without player confirmation — a proper picker UI is future work.
// Supports:
//   powerDebuffSelf  (Ace, Law) — give self -N power for the turn
//   returnDon        (Vergo) — return 1 own DON from field to deck
function tryAutoSelfSave(card, removerPlayerId, game, sourceCardName) {
  if (!card || !game) return false;
  const passives = PASSIVE_EFFECTS.get(card.id) || [];
  const save = passives.find(p => p.type === 'selfSaveReplacement');
  if (!save) return false;
  const owner = findCardOwner(game, card.uid);
  if (!owner || owner.playerId === removerPlayerId) return false;
  // Vergo's save is affiliation-gated — only fires when THE card being
  // removed matches the affiliation clause.
  if (save.scope === 'affiliation' && save.affiliation) {
    const aff = (card.affiliation || '').toLowerCase();
    if (!aff.includes(save.affiliation.toLowerCase())) return false;
  }
  if (!game._selfSaveUsedThisTurn) game._selfSaveUsedThisTurn = new Set();
  const hasOnceGate = (save.conditions || []).some(c => c.type === 'oncePerTurn');
  if (hasOnceGate && game._selfSaveUsedThisTurn.has(card.uid)) return false;
  // Apply the alternative.
  if (save.replaceWith === 'powerDebuffSelf') {
    applyTempPower(game, card.uid, -Math.abs(save.amount || 0),
      save.duration || 'thisTurn', sourceCardName);
  } else if (save.replaceWith === 'returnDon') {
    // Return 1 DON from field (prefer active) back to deck.
    if ((owner.player.donActive || 0) > 0) {
      owner.player.donActive--;
      owner.player.donDeck++;
    } else if ((owner.player.donRested || 0) > 0) {
      owner.player.donRested--;
      owner.player.donDeck++;
    } else {
      return false;  // no DON available — save can't pay its cost
    }
  } else {
    return false;
  }
  if (hasOnceGate) game._selfSaveUsedThisTurn.add(card.uid);
  log(game, `${card.name}: self-save applied (${save.replaceWith}) instead of removal.`);
  return true;
}

// Track-P Phase 5 — removal protection check. Returns true if `card`
// carries a removalProtection passive (koOnly or anyRemoval) AND the
// would-be-remover belongs to a different player (opponent-sourced).
//   scope: 'ko' | 'bounce' | 'placeBottom' | 'any'
// A 'koOnly' passive only applies when scope==='ko'; 'anyRemoval'
// applies to all scopes. Cards whose owner is the remover (self-
// triggered removals) bypass the gate.
function isRemovalProtected(card, removerPlayerId, game, scope) {
  if (!card || !game) return false;
  const owner = findCardOwner(game, card.uid);
  if (!owner || owner.playerId === removerPlayerId) return false;
  for (const p of (PASSIVE_EFFECTS.get(card.id) || [])) {
    if (p.type !== 'removalProtection' || p.source !== 'opponent') continue;
    if (p.scope === 'anyRemoval') return true;
    if (p.scope === 'koOnly' && scope === 'ko') return true;
  }
  return false;
}

// Track-P — check whether [On Play] abilities are suppressed for a
// given player. Returns true if:
//   (a) the player's leader carries a passive onPlaySuppression
//       (Teach OP09-081: "Your [On Play] abilities don't activate"), OR
//   (b) a timed entry on game._onPlaySuppressions is still active.
function isOnPlaySuppressed(game, playerId) {
  if (!game || !game.players || !playerId) return false;
  // Passive — check the player's own leader for self-suppression.
  const me = game.players[playerId];
  if (me && me.leader) {
    const entries = PASSIVE_EFFECTS.get(me.leader.id) || [];
    for (const e of entries) {
      if (e.type === 'onPlaySuppression' && e.side === 'self') return true;
    }
  }
  // Timed — prune as we read; entries with expiresAtTurn < current turn
  // have lapsed (doEnd also prunes proactively).
  const timed = game._onPlaySuppressions || [];
  for (const s of timed) {
    if (s.targetPlayerId === playerId &&
        (s.expiresAtTurn == null || s.expiresAtTurn >= game.turn)) {
      return true;
    }
  }
  return false;
}

// Track-P Phase 4 — effective hand-play cost for a card. Base card.cost
// minus any handCostDiscount passive entries whose conditions evaluate
// true in the current game state (Uta ST23-001: own char ≥10k power;
// Shanks ST23-002: opp char ≥8k base power).
function handPlayCostFor(player, card, game) {
  if (!card) return 0;
  let cost = Number(card.cost) || 0;
  if (!game) return Math.max(0, cost);
  const passives = PASSIVE_EFFECTS.get(card.id) || [];
  if (passives.length === 0) return Math.max(0, cost);
  // Locate the player's id so condition helpers can reach across.
  const playerId = Object.keys(game.players).find(id => game.players[id] === player);
  const owner = { playerId, player };
  for (const p of passives) {
    if (p.type !== 'handCostDiscount') continue;
    if (_passiveConditionsOk(p.conditions, card, game, owner)) {
      cost -= (p.discount || 0);
    }
  }
  return Math.max(0, cost);
}

// Track-P — effective cost of a card on field. Base c.cost plus any
// active tempCostEffects (e.g. Stronger's -2 cost for the turn). Used
// by target-filter checks that gate on "cost N or less".
function effectiveCostOf(card, game) {
  if (!card) return 0;
  let c = card.cost || 0;
  const effs = (game && game.tempCostEffects) || [];
  for (const e of effs) if (e.targetUid === card.uid) c += (e.amount || 0);
  return Math.max(0, c);
}

function effectivePowerOf(card, game) {
  if (!card) return 0;
  let p = (card.power || 0) + (card.attachedDon || 0) * 1000;
  const effs = (game && game.tempPowerEffects) || [];
  for (const e of effs) if (e.targetUid === card.uid) p += (e.amount || 0);
  p += passivePowerBuffTyped(card, game);
  return Math.max(0, p);
}

// Track P Phase 2 — typed passive power evaluator. Aggregates every
// passive entry that affects this card's power: own-card
// scaledPowerBuff (Jesse, Burgess), scopedPowerBuff (Chopper), and
// globalPowerModifier entries on the opposing side (OP09-004 Shanks).
function passivePowerBuffTyped(card, game) {
  if (!card || !game || !game.players) return 0;
  const owner = findCardOwner(game, card.uid);
  if (!owner) return 0;
  let total = 0;

  for (const p of (PASSIVE_EFFECTS.get(card.id) || [])) {
    if (!_passiveScopeOk(p, game, owner)) continue;
    if (!_passiveConditionsOk(p.conditions, card, game, owner)) continue;
    if (p.type === 'scaledPowerBuff') {
      let count = 0;
      if (p.source === 'eventsInTrash') {
        count = (owner.player.trash || []).filter(c => c.type === 'EVENT').length;
      } else if (p.source === 'trashCards') {
        count = (owner.player.trash || []).length;
      }
      total += Math.floor(count / (p.per || 1)) * (p.amount || 0);
    } else if (p.type === 'scopedPowerBuff') {
      total += (p.amount || 0);
    }
  }

  // Global modifiers emitted by the opposing side's cards that affect
  // characters on THIS card's side.
  const oppId = Object.keys(game.players).find(id => id !== owner.playerId);
  const opp = game.players[oppId];
  if (opp) {
    const sources = [opp.leader, ...(opp.field || [])].filter(Boolean);
    for (const src of sources) {
      for (const gp of (PASSIVE_EFFECTS.get(src.id) || [])) {
        if (gp.type !== 'globalPowerModifier') continue;
        if (gp.side === 'opponent' && gp.target === 'characters' && card.type === 'CHARACTER') {
          total += (gp.amount || 0);
        }
      }
    }
  }

  return total;
}

function _passiveScopeOk(entry, game, owner) {
  if (!entry.scope || entry.scope === 'always') return true;
  if (entry.scope === 'yourTurn') return game.activePlayer === owner.playerId;
  if (entry.scope === 'opponentsTurn') return game.activePlayer !== owner.playerId;
  return true;
}

function _passiveConditionsOk(conditions, card, game, owner) {
  if (!Array.isArray(conditions)) return true;
  for (const c of conditions) {
    if (c.type === 'donAttached') {
      if ((card.attachedDon || 0) < c.value) return false;
    } else if (c.type === 'leaderType') {
      const aff = ((owner.player.leader && owner.player.leader.affiliation) || '').toLowerCase();
      if (!aff.includes(c.value.toLowerCase())) return false;
    } else if (c.type === 'ownTrashCountMin') {
      if ((owner.player.trash || []).length < c.value) return false;
    } else if (c.type === 'ownCharacterPowerMin') {
      const powerOf = (c2) => (c2.power || 0) + (c2.attachedDon || 0) * 1000;
      if (!(owner.player.field || []).some(c2 => c2.type === 'CHARACTER' && powerOf(c2) >= c.value)) return false;
    } else if (c.type === 'oppCharacterPowerMin') {
      const oppId = Object.keys(game.players).find(id => id !== owner.playerId);
      const opp = game.players[oppId];
      if (!opp) return false;
      if (!(opp.field || []).some(c2 => c2.type === 'CHARACTER' && (c2.power || 0) >= c.value)) return false;
    }
  }
  return true;
}

// Locate the player who owns a given card (leader OR field). Returns
// { playerId, player } or null. Used by passive-effect helpers that need
// to evaluate context (whose turn is it, what's in their trash, etc.).
function findCardOwner(game, uid) {
  if (!game || !game.players || !uid) return null;
  for (const pid of Object.keys(game.players)) {
    const pl = game.players[pid];
    if (pl.leader && pl.leader.uid === uid) return { playerId: pid, player: pl };
    if ((pl.field || []).some(c => c.uid === uid)) return { playerId: pid, player: pl };
  }
  return null;
}

// Continuous passive power buff parser. Today's pattern (Jesse the Jester):
//   "[DON!! xN] [Your Turn] [If your Leader has the {AFFIL} type,]
//    this Character gains +PWR power for every M Events in your trash."
// Recomputed on every effectivePowerOf() call — never stored, never expires.
// Conditions, all required:
//   - card has ≥ N attached DON
//   - it's the card owner's turn (game.activePlayer === owner.playerId)
//   - if {AFFIL} clause present, owner's leader's affiliation matches
// Buff = floor(eventsInOwnerTrash / M) * PWR.
function passivePowerBuff(card, game) {
  if (!card || !card.ability || !game || !game.players) return 0;
  const m = card.ability.match(
    /\[DON!!\s*x(\d+)\]\s*\[Your Turn\](.*?)(?:gains?|gets?)\s*\+(\d+)\s*power for every (\d+) Events?\s+in your trash/i
  );
  if (!m) return 0;
  const donReq   = parseInt(m[1]);
  const condText = m[2];
  const powerInc = parseInt(m[3]);
  const divisor  = parseInt(m[4]);
  if ((card.attachedDon || 0) < donReq) return 0;
  const owner = findCardOwner(game, card.uid);
  if (!owner) return 0;
  if (game.activePlayer !== owner.playerId) return 0;
  const affMatch = condText.match(/\{([^}]+)\}\s*type/);
  if (affMatch) {
    const lAff = (owner.player.leader && owner.player.leader.affiliation || '').toLowerCase();
    if (!lAff.includes(affMatch[1].toLowerCase())) return 0;
  }
  if (!divisor) return 0;
  const eventCount = (owner.player.trash || []).filter(c => c.type === 'EVENT').length;
  return Math.floor(eventCount / divisor) * powerInc;
}

// Strip any temp power effects targeting a card that just left the field
// (KO'd, bounced). Without this, a future card reusing the same uid (rare,
// but possible after shuffle) would inherit stale buffs.
function dropTempEffectsFor(game, uid) {
  if (!game || !game.tempPowerEffects) return;
  game.tempPowerEffects = game.tempPowerEffects.filter(e => e.targetUid !== uid);
}

// Apply a temp power buff. `expiresOn` keys:
//   'thisTurn'        → expires at end of CURRENT turn
//   'opponentNextTurn'→ expires at end of opponent's next turn (game.turn+1)
//   'thisBattle'      → expires when current battle resolves (RESOLVE_ATTACK)
function applyTempPower(game, targetUid, amount, expiresOn, sourceCardName) {
  if (!targetUid || !amount) return;
  if (!game.tempPowerEffects) game.tempPowerEffects = [];
  const entry = { targetUid, amount, source: sourceCardName || '' };
  if (expiresOn === 'thisBattle') entry.kind = 'battle';
  else if (expiresOn === 'opponentNextTurn') { entry.kind = 'turn'; entry.expiresAtTurn = (game.turn || 1) + 1; }
  else { entry.kind = 'turn'; entry.expiresAtTurn = (game.turn || 1); }
  game.tempPowerEffects.push(entry);
  log(game, `${sourceCardName}: applied ${amount > 0 ? '+' : ''}${amount} power buff (${expiresOn}).`);
}

// Detects "You may trash N card(s)/event card/Character card... from your hand:"
// at the START of an effect text. Returns {count, filterType, filterPowerMin,
// rest} or null. `rest` is the effect AFTER the colon (what runs once the cost
// is paid). The "card(s)" / "event card" / "Character card with a power of N or
// more" variants are all collapsed into a single normalized shape.
function parseTrashFromHandCost(effect) {
  if (!effect) return null;
  // Try the most specific patterns first.
  // "You may trash N Character card(s) with a power of M or more from your hand:"
  let m = effect.match(/^[\s•·-]*You may (?:trash|discard) (\d+) Character cards? with a power of (\d+) or more from your hand:\s*/i);
  if (m) return { count: parseInt(m[1]), filterType: 'CHARACTER', filterPowerMin: parseInt(m[2]), rest: effect.substring(m[0].length).trim() };
  // "You may trash N event card(s) from your hand:"
  m = effect.match(/^[\s•·-]*You may (?:trash|discard) (\d+) [Ee]vent cards? from your hand:\s*/i);
  if (m) return { count: parseInt(m[1]), filterType: 'EVENT', filterPowerMin: null, rest: effect.substring(m[0].length).trim() };
  // Generic "You may trash N card(s) from your hand:" (also covers "discard").
  m = effect.match(/^[\s•·-]*You may (?:trash|discard) (\d+) cards? from your hand:\s*/i);
  if (m) return { count: parseInt(m[1]), filterType: null, filterPowerMin: null, rest: effect.substring(m[0].length).trim() };
  return null;
}

// Detect MANDATORY "trash N card(s) from your hand" inside an effect — i.e.
// no "you may" prefix and no trailing colon (which would be a cost). Returns
// {count, filterType, filterPowerMin} or null. Used by Sam the Tall and any
// card whose ability includes a forced discard as part of the resolution
// (e.g. "Draw 2 cards and trash 1 card from your hand"). The optional bit on
// the resolver window is then `false` so the player CANNOT skip.
function parseMandatoryTrashFromHand(effect) {
  if (!effect) return null;
  // Most-specific filters first so "Character card with N+ power" wins over the generic match.
  let m = effect.match(/(?<!\bmay\s)(?:and )?trash (\d+) Character cards? with a power of (\d+) or more from your hand(?!\s*:)/i);
  if (m) return { count: parseInt(m[1]), filterType: 'CHARACTER', filterPowerMin: parseInt(m[2]) };
  m = effect.match(/(?<!\bmay\s)(?:and )?trash (\d+) [Ee]vent cards? from your hand(?!\s*:)/i);
  if (m) return { count: parseInt(m[1]), filterType: 'EVENT', filterPowerMin: null };
  m = effect.match(/(?<!\bmay\s)(?:and )?trash (\d+) cards? from your hand(?!\s*:)/i);
  if (m) return { count: parseInt(m[1]), filterType: null, filterPowerMin: null };
  return null;
}

// Detect bounce target patterns:
//   "Return up to N Character with a cost of M or less to the owner's hand"
//   "Return up to N Character with M power or less to the owner's hand"
// Returns { count, filterKind: 'cost'|'power', filterValue } or null.
function parseBounceTarget(effect) {
  if (!effect) return null;
  // BUG 13 — "(?:up to )?" makes mandatory phrasings ("Return 1 Character…")
  // match too. The `optional` flag is derived from whether "you may" or
  // "up to" appears anywhere in the effect text — scalable to every bounce.
  const opt = /\b(?:you may|up to)\b/i.test(effect);
  // BUG 2 (this batch) — scope is 'opponent' when the effect explicitly
  // targets "your opponent's Character(s)"; otherwise 'any' (either side
  // of the field, matching TCG "Character" phrasing). Scales to every
  // bounce effect.
  const scope = /\byour opponent'?s? Character/i.test(effect) ? 'opponent' : 'any';
  let m = effect.match(/[Rr]eturn (?:up to )?(\d+) (?:of your opponent'?s? )?Character.*?cost of (\d+) or less.*?(?:owner'?s? )?hand/i);
  if (m) return { count: parseInt(m[1]), filterKind: 'cost',  filterValue: parseInt(m[2]), optional: opt, scope };
  m = effect.match(/[Rr]eturn (?:up to )?(\d+) (?:of your opponent'?s? )?Character.*?(\d+)\s*power or less.*?(?:owner'?s? )?hand/i);
  if (m) return { count: parseInt(m[1]), filterKind: 'power', filterValue: parseInt(m[2]), optional: opt, scope };
  return null;
}

// Detect "gains/has +N power until end of opponent's next turn" / "during this turn"
// / "during this battle" / "until end of opponent's next end phase" patterns.
// Returns { amount, expiresOn, target: 'leader'|'character'|'leaderOrCharacter' } or null.
function parseTempPowerBuff(effect) {
  if (!effect) return null;
  // "Up to one of your leader[s]" / "your leader" → target leader
  // "Up to 1 of your leader or character cards" → leaderOrCharacter
  // "this Character" / "this character" → self
  const m = effect.match(/(?:[Gg]ains?|[Hh]as|[Gg]ets?)\s*\+(\d+)\s*power\s+(until (?:the )?end of (?:your )?opponent'?s? next (?:turn|end phase)|during this turn|during this battle|for this turn|for this battle)/i);
  if (!m) return null;
  const amount = parseInt(m[1]);
  const when = m[2].toLowerCase();
  let expiresOn = 'thisTurn';
  if (when.includes("opponent")) expiresOn = 'opponentNextTurn';
  else if (when.includes('battle')) expiresOn = 'thisBattle';
  // Decide target shape from the leading clause.
  const lead = effect.substring(0, m.index).toLowerCase();
  let target = 'leaderOrCharacter';
  if (/this character|this leader/.test(lead)) target = 'self';
  else if (/your leader/.test(lead) && !/character/.test(lead)) target = 'leader';
  else if (/leader or character/.test(lead)) target = 'leaderOrCharacter';
  return { amount, expiresOn, target };
}

// Open the trash-from-hand-cost interactive resolver. Returns true if a window
// was opened (caller must `return`), false if the player has no eligible cards
// AND the cost is required (effect aborts), or false if `count` is 0.
function openTrashFromHand(game, playerId, opts) {
  const p = game.players[playerId];
  const { count, optional = true, filterType = null, filterPowerMin = null,
          sourceCardName = '', resumeTiming = null, resumeCardUid = null,
          pipelineResume = null } = opts || {};
  if (!count || count <= 0) return false;
  // Eligibility: card must match filterType + filterPowerMin.
  const isEligible = (c) => {
    if (filterType && c.type !== filterType) return false;
    if (filterPowerMin != null && (c.power || 0) < filterPowerMin) return false;
    return true;
  };
  const candidates = (p.hand || []).filter(isEligible);
  if (candidates.length < count) {
    // Not enough cards to pay. If optional, the effect simply doesn't fire (no resume).
    log(game, `${sourceCardName}: not enough eligible hand cards to trash (need ${count}, have ${candidates.length}). Effect skipped.`);
    return false;
  }
  game.trashFromHandWindow = {
    playerId, count, optional, sourceCardName,
    filterType, filterPowerMin,
    resumeTiming, resumeCardUid,
    candidateUids: candidates.map(c => c.uid),
    // Phase-4 chain resume (Batch 2) — set by agentPayCosts.
    pipelineResume,
  };
  log(game, `${sourceCardName}: trash ${count} ${filterType ? filterType.toLowerCase() + ' ' : ''}card${count===1?'':'s'} from hand to fire effect.`);
  return true;
}

// Parses the tail effect "add up to N (Event|Character)? card(s)? from your
// trash to your hand". Returns { count, filterType } or null. filterType is
// 'EVENT' / 'CHARACTER' / null. Designed to match every card with this phrase,
// not just George the Brave — any [On K.O.] effect text containing this
// clause routes here.
function parseAddFromTrashToHand(effect) {
  if (!effect) return null;
  const m = effect.match(/add up to (\d+)\s+(Event|Character)?\s*cards?\s+from your trash to your hand/i);
  if (!m) return null;
  return { count: parseInt(m[1]), filterType: m[2] ? m[2].toUpperCase() : null };
}

// Evaluates an optional "If your Leader has the {AFFIL} type," gate at the
// start of an effect clause. Returns true when no gate is present OR the
// player's leader's affiliation string matches (case-insensitive substring,
// same rule used by passivePowerBuff).
function leaderAffiliationGatePasses(effect, player) {
  const m = effect && effect.match(/If your Leader has the \{([^}]+)\}\s*type/i);
  if (!m) return true;
  const lAff = ((player && player.leader && player.leader.affiliation) || '').toLowerCase();
  return lAff.includes(m[1].toLowerCase());
}

// Open the interactive add-from-trash picker. Candidates are cards already in
// the player's trash matching filterType (or all trash cards if null). If no
// eligible card exists the window doesn't open and the effect simply logs.
function openAddFromTrash(game, playerId, opts) {
  const p = game.players[playerId];
  const { count = 1, filterType = null, optional = true, sourceCardName = '',
          pipelineResume = null } = opts || {};
  const isEligible = (c) => !filterType || c.type === filterType;
  const candidates = (p.trash || []).filter(isEligible);
  if (candidates.length === 0) {
    const label = filterType ? filterType.toLowerCase() + 's' : 'cards';
    log(game, `${sourceCardName}: no ${label} in trash.`);
    return false;
  }
  game.addFromTrashWindow = {
    playerId, max: count, optional, sourceCardName, filterType,
    candidateUids: candidates.map(c => c.uid),
    // Phase-4 chain resume — ADD_FROM_TRASH_SELECTED hands off to
    // resumePipeline when this is set.
    pipelineResume,
  };
  const what = filterType ? `an ${filterType.toLowerCase()}` : 'a card';
  log(game, `${sourceCardName}: choose ${what} from your trash to add to your hand.`);
  return true;
}

// Open the bounce-target picker. Targets are CHARACTERS (own + opponent) on the
// field that match the cost/power filter. Returns true if window opened.
function openBounceTarget(game, playerId, opts) {
  const opp = game.players[Object.keys(game.players).find(id => id !== playerId)];
  const me  = game.players[playerId];
  const { filterKind, filterValue, optional = true, sourceCardName = '',
          resumeTiming = null, resumeCardUid = null, scope = 'any',
          pipelineResume = null } = opts || {};
  const matches = (c) => {
    if (c.type !== 'CHARACTER') return false;
    if (filterKind === 'cost') return (c.cost || 0) <= filterValue;
    if (filterKind === 'power') return ((c.power || 0) + (c.attachedDon || 0) * 1000) <= filterValue;
    return true;
  };
  // BUG 2 (this batch) — scope decides which fields contribute candidates.
  // 'opponent' = opp only; 'any' = both sides. Unchanged from prior when
  // scope defaults to 'any'.
  // Track-P Phase 5 — exclude opponent-side removal-protected cards
  // (Kuzan OP10-082 anyRemoval). Burgess (koOnly) is not protected
  // from bounce — only from KO.
  const protectedOk = (c) => !isRemovalProtected(c, playerId, game, 'bounce');
  const candidates = scope === 'opponent'
    ? opp.field.filter(c => matches(c) && protectedOk(c))
    : [...me.field.filter(matches),
       ...opp.field.filter(c => matches(c) && protectedOk(c))];
  if (candidates.length === 0) {
    log(game, `${sourceCardName}: no valid bounce targets.`);
    return false;
  }
  game.bounceTargetWindow = {
    playerId,
    candidateUids: candidates.map(c => c.uid),
    filterKind, filterValue, optional, sourceCardName,
    resumeTiming, resumeCardUid,
    pipelineResume,
  };
  log(game, `${sourceCardName}: choose a Character to return (${candidates.length} option(s)).`);
  return true;
}

// Locate the source card by uid across leader/field/trash for the given player.
// Used by resume-handlers: an event's source card is in trash; an [On Play] /
// [When Attacking] source is on the field.
function findSourceCard(player, uid) {
  if (!player) return null;
  if (player.leader && player.leader.uid === uid) return player.leader;
  return (player.field || []).find(c => c.uid === uid)
      || (player.trash || []).find(c => c.uid === uid)
      || null;
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
    let effect = extractEffect(ab, '[On Play]');
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
    if (donCostMatch && opts.donCostPaid) effect = effect.substring(donCostMatch[0].length).trim();

    // Bug 5 — "You may trash N card(s) from your hand: <effect>" cost. Open the
    // interactive picker; on resume re-enters here with opts.trashCostPaid=true and
    // we strip the cost prefix so the parser sees only the post-colon effect.
    const trashCost = parseTrashFromHandCost(effect);
    if (trashCost && !opts.trashCostPaid) {
      if (openTrashFromHand(game, playerId, {
        count: trashCost.count, optional: true,
        filterType: trashCost.filterType, filterPowerMin: trashCost.filterPowerMin,
        sourceCardName: card.name,
        resumeTiming: 'onPlay', resumeCardUid: card.uid,
      })) return;
      // Couldn't open (no eligible cards) — effect aborts.
      return;
    }
    if (trashCost && opts.trashCostPaid) effect = trashCost.rest;

    // Bug 8 — temp power buff at On Play (e.g. Yasopp: "Up to one of your leaders
    // gains +1000 power until the end of your opponent's next turn").
    const buff = parseTempPowerBuff(effect);
    if (buff && !opts.tempBuffApplied) {
      // Auto-pick: leader → own leader; self → this card; leaderOrCharacter → own leader.
      let targetUid = null;
      if (buff.target === 'self') targetUid = card.uid;
      else targetUid = p.leader.uid;
      applyTempPower(game, targetUid, buff.amount, buff.expiresOn, card.name);
      // Mark applied; if there are sibling effects after (rare), they still process below.
      opts.tempBuffApplied = true;
    }

    // Bug 6 — bounce target picker.
    const bounce = parseBounceTarget(effect);
    if (bounce && !opts.bounceResolved) {
      if (openBounceTarget(game, playerId, {
        filterKind: bounce.filterKind, filterValue: bounce.filterValue,
        optional: bounce.optional, scope: bounce.scope, sourceCardName: card.name,
        resumeTiming: 'onPlay', resumeCardUid: card.uid,
      })) return;
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

    // BUG 17 — AOE K.O. ("K.O. all Characters other than this Character").
    // Non-interactive — every matching opponent character goes to trash in
    // one pass, each firing its own [On K.O.] via triggerOnKO. Leader
    // affiliation gate (when present) is enforced via the existing helper.
    // Scales to any AOE K.O. line with this phrasing.
    if (/K\.O\.\s+all Characters other than this Character/i.test(effect) && !opts.aoeKoResolved) {
      if (leaderAffiliationGatePasses(effect, p)) {
        const victims = (opp.field || []).filter(c => c.type === 'CHARACTER' && c.uid !== card.uid);
        const oppId = Object.keys(game.players).find(id => id !== playerId);
        for (const target of victims) {
          opp.field = opp.field.filter(c => c.uid !== target.uid);
          opp.trash.push(target);
          dropTempEffectsFor(game, target.uid);
          log(game, `\uD83D\uDC80 ${target.name} K.O.'d by ${card.name}!`);
          triggerOnKO(game, oppId, target, playerId);
        }
        opts.aoeKoResolved = true;
      } else {
        log(game, `${card.name}: leader affiliation does not match — AOE K.O. skipped.`);
      }
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

    // MANDATORY trash from hand — fires LAST so any draws/searches above have
    // already enlarged the hand the player picks from. No "you may" → no skip.
    // resumeTiming is null because the trash IS the final step; nothing else
    // needs to re-fire after the player picks (no risk of re-entering this
    // block and double-drawing).
    const mandTrash = parseMandatoryTrashFromHand(effect);
    if (mandTrash && !opts.mandatoryTrashDone) {
      openTrashFromHand(game, playerId, {
        count: mandTrash.count, optional: false,
        filterType: mandTrash.filterType, filterPowerMin: mandTrash.filterPowerMin,
        sourceCardName: card.name,
        resumeTiming: null, resumeCardUid: null,
      });
    }
  }

  // ── [On K.O.] effects ──
  if (timing === 'onKO' && ab.includes('[On K.O.]')) {
    let effect = extractEffect(ab, '[On K.O.]');
    if (!effect) return;

    // Check DON!! cost for On K.O.
    const donCostMatch = effect.match(/^DON!!\s*-(\d+)\s*:/);
    if (donCostMatch && !opts.donCostPaid) {
      const donCost = parseInt(donCostMatch[1]);
      if (!openDonReturn(game, playerId, card, donCost, 'onKO')) return;
      return;
    }
    if (donCostMatch && opts.donCostPaid) effect = effect.substring(donCostMatch[0].length).trim();

    // Bug 5 — trash-from-hand cost on [On K.O.] effects.
    const trashCost = parseTrashFromHandCost(effect);
    if (trashCost && !opts.trashCostPaid) {
      if (openTrashFromHand(game, playerId, {
        count: trashCost.count, optional: true,
        filterType: trashCost.filterType, filterPowerMin: trashCost.filterPowerMin,
        sourceCardName: card.name,
        resumeTiming: 'onKO', resumeCardUid: card.uid,
      })) return;
      return;
    }
    if (trashCost && opts.trashCostPaid) effect = trashCost.rest;

    // Bug 6 — bounce target on [On K.O.] effects.
    const bounce = parseBounceTarget(effect);
    if (bounce && !opts.bounceResolved) {
      if (openBounceTarget(game, playerId, {
        filterKind: bounce.filterKind, filterValue: bounce.filterValue,
        optional: bounce.optional, scope: bounce.scope, sourceCardName: card.name,
        resumeTiming: 'onKO', resumeCardUid: card.uid,
      })) return;
    }

    // Bug 8 — temp power buff at [On K.O.].
    const buff = parseTempPowerBuff(effect);
    if (buff && !opts.tempBuffApplied) {
      const targetUid = (buff.target === 'self') ? card.uid : p.leader.uid;
      applyTempPower(game, targetUid, buff.amount, buff.expiresOn, card.name);
      opts.tempBuffApplied = true;
    }

    // Draw N cards
    const drawMatch = effect.match(/[Dd]raw (\d+) card/);
    if (drawMatch) {
      drawCards(p, parseInt(drawMatch[1]), game, card.name);
    }

    // Add DON rested — matches "Add N DON!!" and "Add up to N DON!!" so
    // Merchant Dam ("Add 1 DON!! ... rest it") and any future card using
    // the up-to shape both resolve here.
    if (/[Aa]dd (?:up to )?(\d+) DON!!.*rest/i.test(effect)) {
      const donMatch = effect.match(/[Aa]dd (?:up to )?(\d+) DON!!/i);
      addDonFromDeck(p, donMatch ? parseInt(donMatch[1]) : 1, true, game, card.name);
    }
    // Add DON active
    else if (/[Aa]dd (?:up to )?(\d+) DON!!.*active/i.test(effect)) {
      const donMatch = effect.match(/[Aa]dd (?:up to )?(\d+) DON!!/i);
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

    // "Add up to N [Event|Character] from your trash to your hand." Scalable
    // to every [On K.O.] card with this phrase. Optional affiliation gate
    // "If your Leader has the {AFFIL} type," is checked first — fails
    // silently when the leader doesn't match (George the Brave outside a
    // Duchess of Brittany leader, etc.).
    const addFromTrash = parseAddFromTrashToHand(effect);
    if (addFromTrash) {
      if (leaderAffiliationGatePasses(effect, p)) {
        openAddFromTrash(game, playerId, {
          count: addFromTrash.count,
          filterType: addFromTrash.filterType,
          optional: true,
          sourceCardName: card.name,
        });
      } else {
        log(game, `${card.name}: leader affiliation does not match — effect skipped.`);
      }
    }

    // MANDATORY trash from hand (e.g. Monet OP14-074: "Draw 2 cards and trash
    // 1 card from your hand"). Same scalable resolver as [On Play] — no skip.
    const mandTrash = parseMandatoryTrashFromHand(effect);
    if (mandTrash && !opts.mandatoryTrashDone) {
      openTrashFromHand(game, playerId, {
        count: mandTrash.count, optional: false,
        filterType: mandTrash.filterType, filterPowerMin: mandTrash.filterPowerMin,
        sourceCardName: card.name,
        resumeTiming: null, resumeCardUid: null,
      });
    }
  }

  // ── [When Attacking] effects ──
  if (timing === 'whenAttacking' && ab.includes('[When Attacking]')) {
    // Bug 9 — [DON!! xN] [When Attacking] gate. Effect ONLY fires if attached DON!! ≥ N.
    // Pattern matches both orderings just in case (the deck always uses [DON!! xN] first).
    const donReqMatch = ab.match(/\[DON!!\s*x(\d+)\]\s*\[When Attacking\]/)
                     || ab.match(/\[When Attacking\]\s*\[DON!!\s*x(\d+)\]/);
    if (donReqMatch) {
      const required = parseInt(donReqMatch[1]);
      if ((card.attachedDon || 0) < required) {
        log(game, `${card.name}: [When Attacking] requires ${required} attached DON!! (have ${card.attachedDon || 0}).`);
        return;
      }
    }

    let effect = extractEffect(ab, '[When Attacking]');
    if (!effect) return;

    // Check DON!! cost to activate
    const donCostMatch = effect.match(/^DON!!\s*-(\d+)\s*:/);
    if (donCostMatch && !opts.donCostPaid) {
      const donCost = parseInt(donCostMatch[1]);
      if (!openDonReturn(game, playerId, card, donCost, 'whenAttacking')) return;
      return;
    }
    if (donCostMatch && opts.donCostPaid) effect = effect.substring(donCostMatch[0].length).trim();

    // Bug 5 + 9 — "You may trash N cards from your hand: <effect>" cost.
    const trashCost = parseTrashFromHandCost(effect);
    if (trashCost && !opts.trashCostPaid) {
      if (openTrashFromHand(game, playerId, {
        count: trashCost.count, optional: true,
        filterType: trashCost.filterType, filterPowerMin: trashCost.filterPowerMin,
        sourceCardName: card.name,
        resumeTiming: 'whenAttacking', resumeCardUid: card.uid,
      })) return;
      return;
    }
    if (trashCost && opts.trashCostPaid) effect = trashCost.rest;

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

    // Scry: "Look at top N → reveal up to M {Type} type [Event|Character|Stage] card
    // → add to hand → place rest at the bottom in any order". Same resolver used by
    // [On Play] / [Activate: Main]; here it fires on attack declaration so e.g. Queen
    // Victoria pulls a {Duchess of Brittany} type Event card when she attacks with DON.
    if (!drawMatch) tryOpenScryFromEffect(game, playerId, card, effect);

    // MANDATORY trash from hand at [When Attacking] (scalable for any future card).
    const mandTrash = parseMandatoryTrashFromHand(effect);
    if (mandTrash && !opts.mandatoryTrashDone) {
      openTrashFromHand(game, playerId, {
        count: mandTrash.count, optional: false,
        filterType: mandTrash.filterType, filterPowerMin: mandTrash.filterPowerMin,
        sourceCardName: card.name,
        resumeTiming: null, resumeCardUid: null,
      });
    }
  }

  // ── [Counter] effects for EVENTs ──
  if (timing === 'counter') {
    let counterEffect = extractEffect(ab, '[Counter]');
    if (!counterEffect) return;

    // DON!! -N cost on a [Counter] effect (e.g. NoroNoro Beam Sword: "[Counter] DON!! -1: ...").
    const donCostMatch = counterEffect.match(/^DON!!\s*-(\d+)\s*:/);
    if (donCostMatch && !opts.donCostPaid) {
      const donCost = parseInt(donCostMatch[1]);
      if (!openDonReturn(game, playerId, card, donCost, 'counter')) return;
      return;
    }
    if (donCostMatch && opts.donCostPaid) counterEffect = counterEffect.substring(donCostMatch[0].length).trim();

    // Bug 5 — trash-from-hand cost on [Counter] effects (e.g. Divine Departure OP13-076).
    const trashCost = parseTrashFromHandCost(counterEffect);
    if (trashCost && !opts.trashCostPaid) {
      if (openTrashFromHand(game, playerId, {
        count: trashCost.count, optional: true,
        filterType: trashCost.filterType, filterPowerMin: trashCost.filterPowerMin,
        sourceCardName: card.name,
        resumeTiming: 'counter', resumeCardUid: card.uid,
      })) return;
      return;
    }
    if (trashCost && opts.trashCostPaid) counterEffect = trashCost.rest;

    // Bug 8 — temp power buff (e.g. "Up to 1 of your Leader gains +3000 power during this battle").
    const buff = parseTempPowerBuff(counterEffect);
    if (buff && !opts.tempBuffApplied) {
      // Counter buffs are auto-applied to the OWN leader (the most common target);
      // for action-style counters during a battle, this stacks on bs.counterBonus
      // when the defender's effective power is recomputed.
      const targetUid = (buff.target === 'self') ? card.uid : p.leader.uid;
      applyTempPower(game, targetUid, buff.amount, buff.expiresOn, card.name);
      // For "during this battle" buffs from counters by the defender, also add to
      // counterBonus so the immediate battle math reflects the buff.
      if (buff.expiresOn === 'thisBattle' && game.battleState
          && game.battleState.targetUid === targetUid) {
        game.battleState.counterBonus = (game.battleState.counterBonus || 0) + buff.amount;
      }
      opts.tempBuffApplied = true;
    }

    // Bug 6 — bounce target picker.
    const bounce = parseBounceTarget(counterEffect);
    if (bounce && !opts.bounceResolved) {
      if (openBounceTarget(game, playerId, {
        filterKind: bounce.filterKind, filterValue: bounce.filterValue,
        optional: bounce.optional, scope: bounce.scope, sourceCardName: card.name,
        resumeTiming: 'counter', resumeCardUid: card.uid,
      })) return;
    }

    // Draw cards from counter effect
    const drawMatch = counterEffect.match(/[Dd]raw (\d+) card/);
    if (drawMatch) {
      drawCards(p, parseInt(drawMatch[1]), game, card.name);
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

    // Bug 6 — interactive bounce target picker for [Trigger] bounces.
    const bounce = parseBounceTarget(effect);
    if (bounce && !opts.bounceResolved) {
      if (openBounceTarget(game, playerId, {
        filterKind: bounce.filterKind, filterValue: bounce.filterValue,
        optional: bounce.optional, scope: bounce.scope, sourceCardName: card.name,
        resumeTiming: 'trigger', resumeCardUid: card.uid,
      })) return;
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

    // Bug 8 — temp power buff from [Trigger] (e.g. "Choose up to 1 of your leader
    // or character, it gets +1000 during this turn"). Auto-target the leader.
    const buff = parseTempPowerBuff(effect);
    if (buff && !opts.tempBuffApplied) {
      const targetUid = (buff.target === 'self') ? card.uid : p.leader.uid;
      applyTempPower(game, targetUid, buff.amount, buff.expiresOn, card.name);
      opts.tempBuffApplied = true;
    }

    // Effect negation — TODO: needs per-card "effects negated this turn" flag.
    if (/[Nn]egate the effect|[Nn]ullify the effects?/.test(effect)) {
      log(game, `${card.name}: opponent effect negation (TODO — flag not yet wired).`);
    }
  }

  // ── Event [Main] effects (for PLAY_CARD EVENT) ──
  if (timing === 'eventMain') {
    parseEventMain(game, playerId, card, opp, opts);
  }

  // ── [Activate: Main] effects (for ACTIVATE_MAIN action) ──
  if (timing === 'activateMain' && ab.includes('[Activate: Main]')) {
    let effect = extractEffect(ab, '[Activate: Main]');
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
    if (donCostMatch && opts.donCostPaid) effect = effect.substring(donCostMatch[0].length).trim();

    // Bug 5 — trash-from-hand cost on [Activate: Main] effects.
    const trashCost = parseTrashFromHandCost(effect);
    if (trashCost && !opts.trashCostPaid) {
      if (openTrashFromHand(game, playerId, {
        count: trashCost.count, optional: true,
        filterType: trashCost.filterType, filterPowerMin: trashCost.filterPowerMin,
        sourceCardName: card.name,
        resumeTiming: 'activateMain', resumeCardUid: card.uid,
      })) return;
      return;
    }
    if (trashCost && opts.trashCostPaid) effect = trashCost.rest;

    // Bug 6 — bounce target picker.
    const bounce = parseBounceTarget(effect);
    if (bounce && !opts.bounceResolved) {
      if (openBounceTarget(game, playerId, {
        filterKind: bounce.filterKind, filterValue: bounce.filterValue,
        optional: bounce.optional, scope: bounce.scope, sourceCardName: card.name,
        resumeTiming: 'activateMain', resumeCardUid: card.uid,
      })) return;
    }

    // Bug 8 — temp power buff.
    const buff = parseTempPowerBuff(effect);
    if (buff && !opts.tempBuffApplied) {
      const targetUid = (buff.target === 'self') ? card.uid : p.leader.uid;
      applyTempPower(game, targetUid, buff.amount, buff.expiresOn, card.name);
      opts.tempBuffApplied = true;
    }

    // BUG 5 (this batch) — interactive rest-opponent-character picker for
    // Activate Main effects. Parses "Rest [up to] N of your opponent's
    // Character(s)" (optional threshold). Must be placed BEFORE the Draw
    // block so Anna's "Rest … Draw 1 card" resolves in order (rest first,
    // then draw on resume). Scales to every "rest opponent character"
    // effect on this timing.
    const restMatch = effect.match(/[Rr]est (?:up to )?(\d+) of your opponent'?s? Character/i);
    if (restMatch && !opts.restResolved) {
      const costMatch = effect.match(/cost of (\d+) or less/);
      const isOpt = /\b(?:you may|up to)\b/i.test(effect);
      if (openRestTargetWindow(game, playerId, {
        sourceCardName: card.name,
        optional: isOpt,
        costThreshold: costMatch ? parseInt(costMatch[1]) : null,
        resumeTiming: 'activateMain', resumeCardUid: card.uid,
      })) return;
      // No valid targets → block the whole activation by returning early.
      // openRestTargetWindow already logged "no active opponent characters".
      if (!isOpt) {
        send(playerId, {type:'ERROR', msg:'No active opponent characters to rest.'});
        return;
      }
    }

    // Draw N cards
    const drawMatch = effect.match(/[Dd]raw (\d+) card/);
    if (drawMatch) drawCards(p, parseInt(drawMatch[1]), game, card.name);

    // BUG 6 (this batch) — Constable Jack and any card with the pattern
    // "Trash up to N of your opponent's Life cards". Moves top N life
    // cards straight to the opponent's trash — no hand, no [Trigger]
    // activation. Scales to every "trash life" effect that bypasses
    // Trigger; if a future effect explicitly says "add to hand" or
    // "activate Trigger" we'd need a separate branch.
    const lifeTrashMatch = effect.match(/[Tt]rash up to (\d+) of your opponent'?s? Life cards?/i);
    if (lifeTrashMatch && !opts.lifeTrashResolved) {
      const want = Math.min(parseInt(lifeTrashMatch[1]), opp.life.length);
      for (let i = 0; i < want; i++) {
        const lifeCard = opp.life.pop();
        if (!lifeCard) break;
        opp.trash.push(lifeCard);
        log(game, `${card.name}: trashed opponent's life card ${lifeCard.name}. ${opp.life.length} life remaining.`);
      }
      opts.lifeTrashResolved = true;
    }

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

// Separate parser for Event [Main] effects.
// Routed through `opts` like parseAndApply so trash-cost / DON-cost / bounce / KO
// resolvers can pause + resume. The resume path (TRASH_FROM_HAND_RESOLVE,
// RETURN_DON, etc.) calls back into this function via parseAndApply('eventMain').
function parseEventMain(game, playerId, card, opp, opts = {}) {
  const ab = card.ability || '';
  const p = game.players[playerId];
  if (!ab.includes('[Main]')) return;

  // Extract just the [Main] block (cut at [Counter] / [Trigger]).
  const mainIdx = ab.indexOf('[Main]');
  let mainText = ab.substring(mainIdx + 6).trim();
  for (const stop of ['[Counter]', '[Trigger]']) {
    const si = mainText.indexOf(stop);
    if (si > 0) mainText = mainText.substring(0, si).trim();
  }

  // DON!! -N: cost (active+rested+attached DON returns to deck).
  const donCostMatch = mainText.match(/^DON!!\s*-(\d+)\s*:/);
  if (donCostMatch && !opts.donCostPaid) {
    const donCost = parseInt(donCostMatch[1]);
    if (!openDonReturn(game, playerId, card, donCost, 'eventMain')) return;
    return;
  }
  if (donCostMatch && opts.donCostPaid) mainText = mainText.substring(donCostMatch[0].length).trim();

  // "You may rest N of your DON!! cards:" cost — pay or abort.
  const restDonMatch = mainText.match(/^You may rest (\d+)(?:\s*of your)?\s*DON!!.*?:/i);
  if (restDonMatch && !opts.restDonCostPaid) {
    const restCost = parseInt(restDonMatch[1]);
    if (p.donActive < restCost) {
      log(game, `${card.name}: not enough active DON!! to rest (need ${restCost}, have ${p.donActive}).`);
      return;
    }
    p.donActive -= restCost;
    p.donRested += restCost;
    log(game, `${card.name}: rested ${restCost} DON!!.`);
    mainText = mainText.substring(restDonMatch[0].length).trim();
    opts.restDonCostPaid = true;
  } else if (restDonMatch && opts.restDonCostPaid) {
    mainText = mainText.substring(restDonMatch[0].length).trim();
  }

  // Bug 5 — trash-from-hand cost on [Main] events.
  const trashCost = parseTrashFromHandCost(mainText);
  if (trashCost && !opts.trashCostPaid) {
    if (openTrashFromHand(game, playerId, {
      count: trashCost.count, optional: true,
      filterType: trashCost.filterType, filterPowerMin: trashCost.filterPowerMin,
      sourceCardName: card.name,
      resumeTiming: 'eventMain', resumeCardUid: card.uid,
    })) return;
    return;
  }
  if (trashCost && opts.trashCostPaid) mainText = trashCost.rest;

  // Bug 6 — bounce target picker for "Return up to N character" event mains
  // (e.g. Cig Break: "[Main] Return up to 1 Character with a cost of 7 or less to the owner's hand").
  const bounce = parseBounceTarget(mainText);
  if (bounce && !opts.bounceResolved) {
    if (openBounceTarget(game, playerId, {
      filterKind: bounce.filterKind, filterValue: bounce.filterValue,
      optional: bounce.optional, scope: bounce.scope, sourceCardName: card.name,
      resumeTiming: 'eventMain', resumeCardUid: card.uid,
    })) return;
  }

  // Bug 8 — temp power buff from [Main] event.
  const buff = parseTempPowerBuff(mainText);
  if (buff && !opts.tempBuffApplied) {
    const targetUid = p.leader.uid;
    applyTempPower(game, targetUid, buff.amount, buff.expiresOn, card.name);
    opts.tempBuffApplied = true;
  }

  // K.O. by power — interactive
  const koPowerMatch = mainText.match(/K\.O\.\s+up to (\d+).*?(\d+)\s*[Pp]ower or less/i);
  if (koPowerMatch && !mainText.includes('cost of') && !opts.koResolved) {
    const count = parseInt(koPowerMatch[1]);
    const threshold = parseInt(koPowerMatch[2]);
    if (openKoTargetWindow(game, playerId, {
      filter: c => (c.power || 0) + (c.attachedDon || 0) * 1000 + tempPowerSum(game, c.uid) <= threshold,
      sourceCardName: card.name, count, optional: true,
      filterKind: 'power', filterValue: threshold,
      resumeTiming: 'eventMain', resumeCardUid: card.uid,
    })) return;
  }

  // K.O. by cost — interactive
  const koCostMatch = mainText.match(/K\.O\.\s+up to (\d+).*?cost of (\d+) or less/i);
  if (koCostMatch && !opts.koResolved) {
    const count = parseInt(koCostMatch[1]);
    const threshold = parseInt(koCostMatch[2]);
    if (openKoTargetWindow(game, playerId, {
      filter: c => (c.cost || 0) <= threshold,
      sourceCardName: card.name, count, optional: true,
      filterKind: 'cost', filterValue: threshold,
      resumeTiming: 'eventMain', resumeCardUid: card.uid,
    })) return;
  }

  // Rest opponent character (with optional cost threshold)
  if (/rest up to 1.*opponent/i.test(mainText)) {
    const costMatch = mainText.match(/cost of (\d+) or less/);
    if (costMatch) restOpponentCharacter(opp, game, card.name, parseInt(costMatch[1]));
    else restOpponentCharacter(opp, game, card.name);
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

  // Add DON active / rested
  if (/[Aa]dd up to (\d+) (?:Active )?DON!!.*(?:set it as active|active)/i.test(mainText)) {
    const m = mainText.match(/[Aa]dd up to (\d+) (?:Active )?DON!!/i);
    addDonFromDeck(p, m ? parseInt(m[1]) : 1, false, game, card.name);
  } else if (/[Aa]dd up to (\d+) DON!!.*rest/i.test(mainText)) {
    const m = mainText.match(/[Aa]dd up to (\d+) DON!!/i);
    addDonFromDeck(p, m ? parseInt(m[1]) : 1, true, game, card.name);
  }
}

// Sum of temp power effects on a given uid (used by K.O. eligibility filters
// so a buffed character isn't K.O.'d when the threshold says otherwise).
function tempPowerSum(game, uid) {
  if (!game || !game.tempPowerEffects) return 0;
  let s = 0;
  for (const e of game.tempPowerEffects) if (e.targetUid === uid) s += (e.amount || 0);
  return s;
}

// Trigger [On K.O.] for a KO'd character
function triggerOnKO(game, ownerId, card, killerId) {
  if (!card.ability || !card.ability.includes('[On K.O.]')) return;
  // P5/P8 — effects suppression gates every event-driven ability fire.
  if (isEffectsSuppressed(card)) {
    log(game, `${card.name}: [On K.O.] suppressed by opponent effect.`);
    return;
  }
  const owner = game.players[ownerId];
  const opp = game.players[killerId];
  if (!owner || !opp) return;
  // Phase-4 routing: cards migrated to the new pipeline handle their own
  // onKO via runPipeline. parseAndApply stays authoritative for everyone
  // else.
  if (card.useNewPipeline) {
    runPipeline('onKO', game, ownerId, card);
    return;
  }
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

// ═════════════════════════════════════════════════════════════════════════
// PHASE 1 — Card effect ROUTER (parseAbility) + PARSED_EFFECTS cache.
//
// This is step 1 of the multi-agent migration. parseAbility(text) is a
// pure function that converts an ability string into a structured effect
// tree matching the schema the user specified. At server startup we run
// it over every CARD_DB entry and cache the result in PARSED_EFFECTS.
// Nothing in this block is called from runtime gameplay — parseAndApply
// continues to own effect resolution. This phase only produces data and
// a coverage report, so we can see which abilities parse cleanly and
// which ones reveal regex gaps before we build Timing / Conditions /
// Costs / Effects / Sequencer / UI agents.
//
// Schema produced by parseAbility(text):
//
//   {
//     raw: "original ability text",
//     keywords: string[],       // 'blocker' | 'rush' | 'doubleAttack' | 'banish'
//     effects: EffectBlock[],   // one block per [Timing]
//     unparsedSegments: string[] // diagnostic: effect text we didn't understand
//   }
//
//   EffectBlock = {
//     timing: string,            // 'onPlay' | 'onKO' | 'onBlock' | 'whenAttacking' |
//                                //   'onYourOpponentsAttack' | 'trigger' | 'counter' |
//                                //   'main' | 'activateMain' | 'endOfTurn'
//     conditions: Condition[],
//     costs: Cost[],
//     effects: Effect[],
//     optional: boolean,
//     maxTargets: number | null
//   }
//
//   Condition = { type: 'donAttached'|'leaderType'|'donCountMin'|'lifeCountMax'|
//                       'scope'|'oncePerTurn', value?: any }
//   Cost      = { type: 'returnDon'|'trashFromHand'|'restDon'|'restSelf'|'trashSelf',
//                 count?: number, filterType?: string, filterPowerMin?: number }
//   Effect    = one of the shapes listed in EFFECT_CATALOG (see below).

const PARSED_EFFECTS = new Map();
// Track P Phase 1 — passive/continuous effects, keyed by card id. Each
// entry is an array of typed passive records evaluated on every
// effectivePowerOf / hasBlocker / handPlayCost / isRemovalProtected
// read. Distinct from PARSED_EFFECTS (which drives event-timed
// abilities) — passives don't fire, they modify state lookups.
const PASSIVE_EFFECTS = new Map();

const KEYWORD_MAP = {
  '[Blocker]'       : 'blocker',
  '[Rush]'          : 'rush',
  '[Double Attack]' : 'doubleAttack',
  '[Banish]'        : 'banish',
};

// Timing markers we recognise. [Your Turn] / [Opponent's Turn] are
// scopes, not timings — they get captured as a condition on whatever
// timing is present.
const TIMING_MAP = {
  '[On Play]'                   : 'onPlay',
  '[On K.O.]'                   : 'onKO',
  '[On Block]'                  : 'onBlock',
  '[When Attacking]'            : 'whenAttacking',
  "[On Your Opponent's Attack]" : 'onYourOpponentsAttack',
  '[Trigger]'                   : 'trigger',
  '[Counter]'                   : 'counter',
  '[Main]'                      : 'eventMain',
  '[Activate: Main]'            : 'activateMain',
  '[End of Your Turn]'          : 'endOfTurn',
};

const PASSIVE_SCOPE_MAP = {
  '[Your Turn]'       : 'yourTurn',
  "[Opponent's Turn]" : 'opponentsTurn',
};

// Documentation-only: the set of Effect shapes parseAbility can emit.
// Listed here so future agents (Cost / Effect / UI) can see the contract.
// drawCards      {count}
// addDon         {count, state: 'active'|'rested'}
// aoeKO          {excludeSelf}
// koTarget       {max, filter:{maxCost?, maxPower?, opponent}}
// bounceTarget   {max, filter:{maxCost?, maxPower?, opponent}}
// restTarget     {max, filter:{maxCost?, opponent}}
// placeAtBottom  {max, filter:{maxCost?}}
// scry           {count, placement:'top'|'bottom'|'either', reveal?:{count, filter}}
// trashOpponentLife {count, triggerActivates}
// addFromTrash   {max, filter?:{type}}
// powerBuff      {target, value, duration}
// scaledPowerBuff{per, amount, source}
// playFromHand   {max, filter, free}
// powerDebuff    {value, target}

// Track P Phase 1 — passive/continuous effect parser. Scans the raw
// ability text for continuous-effect shapes and emits typed entries.
// These are cached in PASSIVE_EFFECTS and consulted at runtime by the
// various evaluators (effectivePowerOf, hasBlocker, etc.). Each entry:
//   { type, scope?, conditions?, ...payload }
function parsePassive(text) {
  const out = [];
  if (!text) return out;

  // scaledPowerBuff (Jesse the Jester):
  //   "[DON!! xN] [Your Turn] [If your Leader has the {AFFIL} type,]
  //    this Character gains +P power for every M Events in your trash"
  let m = text.match(
    /\[DON!!\s*x(\d+)\]\s*\[Your Turn\](.*?)(?:gains?|gets?)\s*\+(\d+)\s*power for every (\d+) Events?\s+in your trash/i
  );
  if (m) {
    const entry = {
      type: 'scaledPowerBuff',
      scope: 'yourTurn',
      conditions: [{ type: 'donAttached', value: parseInt(m[1]) }],
      per: parseInt(m[4]),
      amount: parseInt(m[3]),
      source: 'eventsInTrash',
    };
    const affMatch = m[2].match(/\{([^}]+)\}\s*type/);
    if (affMatch) entry.conditions.push({ type: 'leaderType', value: affMatch[1] });
    out.push(entry);
  }

  // scaledPowerBuff (Burgess — "gets +1000 power for every 4 cards in your trash")
  m = text.match(/gets?\s*\+(\d+)\s*power for every (\d+) cards? in your trash/i);
  if (m) {
    const entry = {
      type: 'scaledPowerBuff',
      scope: 'always',
      conditions: [],
      per: parseInt(m[2]),
      amount: parseInt(m[1]),
      source: 'trashCards',
    };
    const affMatch = text.match(/[Ii]f your leader has the \{([^}]+)\}\s*type/);
    if (affMatch) entry.conditions.push({ type: 'leaderType', value: affMatch[1] });
    out.push(entry);
  }

  // scopedPowerBuff (Chopper): "[Opponent's Turn] This character has +N power"
  m = text.match(/\[Opponent's Turn\][^.\[]*?[Tt]his character has\s*\+(\d+)\s*power/i);
  if (m) {
    out.push({
      type: 'scopedPowerBuff',
      scope: 'opponentsTurn',
      amount: parseInt(m[1]),
    });
  }
  // Also match "[Your Turn] This character has +N power" if any card uses it.
  m = text.match(/\[Your Turn\][^.\[]*?[Tt]his character has\s*\+(\d+)\s*power/i);
  if (m) {
    out.push({
      type: 'scopedPowerBuff',
      scope: 'yourTurn',
      amount: parseInt(m[1]),
    });
  }

  // globalPowerModifier (OP09-004 Shanks):
  //   "All of your opponents characters have -N power"
  m = text.match(/[Aa]ll of your opponent'?s?\s+characters have\s*-(\d+)\s*power/i);
  if (m) {
    out.push({
      type: 'globalPowerModifier',
      side: 'opponent',
      target: 'characters',
      amount: -parseInt(m[1]),
    });
  }

  // conditionalKeyword — several shapes:
  //   "If your trash has N cards or more, this character gains [KEYWORD]"
  //   "If your Leader has the {X} type, this Character gains [KEYWORD]"
  m = text.match(/[Ii]f your trash has (\d+) cards? or more,\s*this character gains \[([^\]]+)\]/i);
  if (m) {
    out.push({
      type: 'conditionalKeyword',
      conditions: [{ type: 'ownTrashCountMin', value: parseInt(m[1]) }],
      keyword: m[2].toLowerCase(),
    });
  }
  m = text.match(/[Ii]f your Leader has the \{([^}]+)\}\s*type,\s*this Character gains \[([^\]]+)\]/i);
  if (m) {
    out.push({
      type: 'conditionalKeyword',
      conditions: [{ type: 'leaderType', value: m[1] }],
      keyword: m[2].toLowerCase(),
    });
  }
  m = text.match(/[Ii]f you have a Character with (\d+) power or more,\s*this character gains \[([^\]]+)\]/i);
  if (m) {
    out.push({
      type: 'conditionalKeyword',
      conditions: [{ type: 'ownCharacterPowerMin', value: parseInt(m[1]) }],
      keyword: m[2].toLowerCase(),
    });
  }

  // handCostDiscount — "If <cond>, give this card in your hand -N cost"
  //   Uta ST23-001: ownCharacterPowerMin
  //   Shanks ST23-002: opponentCharacterPowerMin (base)
  m = text.match(/[Ii]f you have a Character with (\d+) power or more,\s*give this card in your hand\s*-(\d+)\s*cost/i);
  if (m) {
    out.push({
      type: 'handCostDiscount',
      conditions: [{ type: 'ownCharacterPowerMin', value: parseInt(m[1]) }],
      discount: parseInt(m[2]),
    });
  }
  m = text.match(/[Ii]f your opponent has a Character with (\d+) (?:base )?power or more,\s*give this card in your hand\s*-(\d+)\s*cost/i);
  if (m) {
    out.push({
      type: 'handCostDiscount',
      conditions: [{ type: 'oppCharacterPowerMin', value: parseInt(m[1]) }],
      discount: parseInt(m[2]),
    });
  }

  // removalProtection —
  //   "This character cannot be K.O'd by your opponent's effects" (Burgess)
  //   "This Character cannot be removed from the field by your opponent's effects" (Kuzan)
  if (/[Tt]his character cannot be K\.?O\.?'d by your opponent'?s? effects/i.test(text)) {
    out.push({ type: 'removalProtection', source: 'opponent', scope: 'koOnly' });
  }
  if (/[Tt]his Character cannot be removed from the field by your opponent'?s? effects/i.test(text)) {
    out.push({ type: 'removalProtection', source: 'opponent', scope: 'anyRemoval' });
  }

  // onPlaySuppression (Teach leader OP09-081, passive clause):
  //   "Your [On Play] abilities don't activate" — disables all [On Play]
  //   abilities of the player whose leader this is (Teach's tradeoff).
  if (/[Yy]our \[On Play\] abilities don't activate/.test(text)) {
    out.push({ type: 'onPlaySuppression', side: 'self', scope: 'always' });
  }

  // selfSaveReplacement — "If this character would be removed from [play|the field]
  //   by (one of )your opponent's effect(s), (instead )you may give this character
  //   -N000 power (during|for) this turn (instead)."
  m = text.match(
    /[Ii]f this [Cc]haracter would be removed from (?:play|the field) by (?:one of )?your opponent'?s? effects?,?\s*(?:instead\s*)?you may give this [Cc]haracter\s*-(\d+)(?:000)?\s*power\s*(?:during|for) this turn(?:\s+instead)?/i
  );
  if (m) {
    out.push({
      type: 'selfSaveReplacement',
      replaceWith: 'powerDebuffSelf',
      amount: parseInt(m[1]) * (m[1].length <= 2 ? 1000 : 1),
      duration: 'thisTurn',
      conditions: /\[Once Per Turn\]/i.test(text) ? [{ type: 'oncePerTurn' }] : [],
    });
  }
  // Vergo variant: "you may return 1 DON!! card from your field to your DON!! deck instead"
  m = text.match(
    /[Ii]f your \{([^}]+)\}\s*type Character would be removed from the field by your opponent'?s? effect,?\s*you may return (\d+) DON!! card from your field to your DON!! deck instead/i
  );
  if (m) {
    out.push({
      type: 'selfSaveReplacement',
      replaceWith: 'returnDon',
      donCount: parseInt(m[2]),
      scope: 'affiliation',
      affiliation: m[1],
      conditions: /\[Once Per Turn\]/i.test(text) ? [{ type: 'oncePerTurn' }] : [],
    });
  }

  return out;
}

function parseAbility(text) {
  const out = { raw: text || '', keywords: [], effects: [], unparsedSegments: [] };
  if (!text) return out;

  // Phase 5 Priority 5 — pre-process "Activate this card's [X] effect"
  // meta-references. Replace with a placeholder so the splitter doesn't
  // treat the embedded [Timing] bracket as a new block boundary.
  let processed = text.replace(
    /[Aa]ctivate this card'?s?\s*\[([^\]]+)\]\s*effect/g,
    (raw, inner) => {
      const timing = TIMING_MAP['[' + inner + ']'];
      return timing ? `\u00a7ACTIVATE_${timing}\u00a7` : raw;
    }
  );

  // Phase 5 Priority 8 — pre-process the "select up to N … The selected
  // … cannot attack …" compound (Sarra the Wise). Two sentences are
  // collapsed into a single suppressTarget placeholder so the segment
  // splitter doesn't separate the target-pick from its effect.
  processed = processed.replace(
    /select up to (one|\d+) of your opponent'?s? (leaders? or characters?|leaders?|characters?)(?:\s+[^.]*?cost of (\d+) or less)?\.?\s*The selected (?:Character|Leader) cannot attack(?:\s+[^.]*?)?(?:until (?:the )?end of (?:your )?opponent'?s? next (?:turn|end phase)|during this turn|for this turn)/gi,
    (_m, count, kindStr, costStr) => {
      const n = (count || '1').toLowerCase() === 'one' ? 1 : parseInt(count);
      const label = (kindStr || '').toLowerCase();
      const tk = /\bor\b/.test(label) ? 'leaderOrCharacter'
               : /character/.test(label) ? 'character' : 'leader';
      const cost = costStr ? parseInt(costStr) : '';
      const dur = /until/i.test(_m) ? 'opponentNextTurn' : 'thisTurn';
      return `\u00a7SUPPRESS_attack_${n}_${tk}_${cost}_${dur}\u00a7`;
    }
  );

  // Track-P partial — Teach (OP09-081) active suppression clause. The
  // "[On Play]" brackets would be stripped by the body-level stripper;
  // pre-process the whole "opponent's [On Play] abilities don't
  // activate" phrase into a placeholder whose duration is captured
  // separately from the preceding "until …" clause.
  processed = processed.replace(
    /[Yy]our opponent'?s? \[On Play\] abilities don't activate/g,
    '\u00a7SUPPRESS_ONPLAY_OPPONENT\u00a7'
  );

  // Track-P partial — Teach passive clause. Strip "Your [On Play]
  // abilities don't activate." entirely from the body so the [On Play]
  // bracket doesn't look like a timing marker. The passive parser
  // still sees it in the raw text (parsePassive uses the original).
  processed = processed.replace(
    /[Yy]our \[On Play\] abilities don't activate\.\s*/g,
    ''
  );

  // Track-P partial — Doflamingo leader (OP14-060) attack redirect.
  //   "Select your Leader or 1 of your {X} type Characters. Change the
  //    attack target to the selected card."
  // Collapses to a single §REDIRECT_<aff>§ placeholder so the picker
  // + mutation happen as one logical effect.
  processed = processed.replace(
    /[Ss]elect your Leader or (?:\d+|one) of your \{([^}]+)\}\s*type Characters?\.\s*Change the attack target to the selected card/g,
    (_m, aff) => `\u00a7REDIRECT_${aff.replace(/\s+/g, '-')}\u00a7`
  );

  // Track-P partial — Rayleigh multi-pick split. Rewrites
  //   "Choose up to two of your opponents characters: Until the end
  //    of your opponents next turn, give one -N power and the other
  //    -M power"
  // into two sequential single-target powerDebuff segments so the
  // existing picker chains naturally (player picks one for -N, then
  // another for -M). Accuracy: the user can target the same character
  // twice, totalling the debuffs — slightly more flexible than the
  // spec but not harmful.
  processed = processed.replace(
    /[Cc]hoose up to two of your opponents characters: [Uu]ntil the end of your opponents next turn, give one\s*-(\d+)\s*power and the other\s*-(\d+)\s*power/g,
    (_m, a1, a2) => `Give up to one of your opponents characters -${a1} power until end of opponent's next turn. Give up to one of your opponents characters -${a2} power until end of opponent's next turn`
  );

  // Track-P partial — "You may trash N <Type> card from your hand. Play
  // this character from the trash as (rested|active)." (Marco OP03-013).
  // The optional hand-trash cost is written with a period rather than a
  // colon, so the block-level cost matcher misses it. Encode the whole
  // compound into a single selfRevive placeholder.
  processed = processed.replace(
    /[Yy]ou may trash (\d+) (Character|Event) cards? from your hand\.\s*Play this character from the trash as (rested|active)/g,
    (_m, n, t, state) => `\u00a7REVIVE_${n}_${t}_${state}\u00a7`
  );

  // Phase 7 — pre-process "Play up to N … from your trash [rested]". Encodes
  // affiliation/type/cost/exclude-name/rested-flag into a placeholder so
  // the inline [ExcludeName] bracket survives the body bracket stripper.
  processed = processed.replace(
    /[Pp]lay up to (\d+)\s+\{([^}]+)\}\s*type\s+(Character|Event|Stage)?\s*cards?(?:\s+with\s+(?:a\s+)?cost of (\d+) or less)?(?:\s+other than \[([^\]]+)\])?\s+from your trash(\s+rested)?/g,
    (_m, n, aff, type, cost, excl, rested) => {
      const a = aff.replace(/\s+/g, '-');
      const t = type || '';
      const c = cost || '';
      const e = excl ? excl.replace(/\s+/g, '-') : '';
      const r = rested ? '1' : '0';
      return `\u00a7PFT_${n}_${a}_${t}_${c}_${e}_${r}\u00a7`;
    }
  );

  // Track F — convert "; <newEffect>" to ". <newEffect>" when the
  // semicolon separates independent effects rather than a scry
  // continuation. Dellinger: "rest it; look at …" → two effects.
  // Limit to addDon-then-look-at to avoid disturbing scry's internal
  // "cards; reveal" which is a conjunction.
  processed = processed.replace(
    /(DON!![^;.]*?rest it);(\s*[Ll]ook at)/g, '$1.$2'
  );

  // Track F — Commander Sam dual K.O. Splits
  //   "K.O. up to N … cost of X or less and up to M … cost of Y or less"
  // into two sentences so the segment splitter emits two koTarget effects.
  processed = processed.replace(
    /([Kk]\.O\. up to \d+ of your opponent'?s? Characters? with a cost of \d+ or less) and (up to \d+ of your opponent'?s? Characters? with a cost of \d+ or less)/g,
    '$1. K.O. $2'
  );

  // Track F — mandatory hand-trash after Draw (Sam the Tall, Monet).
  //   "Draw N cards and trash M cards from your hand" → two segments:
  //   drawCards + trashFromHandEffect.
  processed = processed.replace(
    /([Dd]raw (?:\d+|one) cards?) and trash ((?:\d+|one) cards? from your hand)/g,
    '$1. Trash $2'
  );

  // Track F — preserve bracketed card-name filters ("[Name] card") from
  // the body-level [tag] stripper. Keywords/timings go through the
  // negative list so we don't wrap those.
  processed = processed.replace(
    /\[([^\]]+)\]\s+card/g,
    (full, name) => {
      if (/^(Blocker|Double Attack|Banish|Rush|On Play|On K\.O\.|On Block|Trigger|Counter|Main|Activate: Main|When Attacking|End of Your Turn|Your Turn|Opponent's Turn|Once Per Turn|DON!! x\d+)$/.test(name)) return full;
      return `\u00a7NAME_${name.replace(/\s+/g, '|')}\u00a7 card`;
    }
  );

  // Track-P — preserve remaining inline [Name] exclusions ("other than
  // [Foo]") through the body-level bracket stripper. Runs AFTER
  // effect-specific placeholders (playFromTrash etc.) that already
  // capture their own excludeName so this only catches leftovers
  // (scry for "This is MY AGE").
  processed = processed.replace(/other than \[([^\]]+)\]/g, (_m, name) => {
    return `other than \u00a7EXCLUDE_${name.replace(/\s+/g, '|')}\u00a7`;
  });

  // Phase 7 — pre-process "This Character gains [KEYWORD] during this turn"
  // (and opponent-next-turn variant). Protects the bracketed keyword from
  // the body-level [tag] stripper that runs in _parseBlock, so the
  // grantKeyword effect can carry the keyword through to the agent.
  processed = processed.replace(
    /[Tt]his [Cc]haracter gains \[([^\]]+)\](?:\s+(until the end of your opponent'?s?\s+next turn|during this turn|for this turn|until the end of this turn))?/g,
    (_m, kw, durText) => {
      const dur = durText && /opponent/i.test(durText) ? 'opponentNextTurn' : 'thisTurn';
      return `\u00a7GRANT_${kw.toLowerCase().replace(/\s+/g, '-')}_${dur}\u00a7`;
    }
  );

  // Phase 5 Priority 8 — pre-process "cannot activate [Blocker]" (Limejuice).
  // This ALSO protects the inline [Blocker] bracket from the keyword scan
  // that would otherwise falsely tag Limejuice as a [Blocker] card.
  processed = processed.replace(
    /[Uu]p to (one|\d+) of your opponent'?s?\s*(characters?|leaders?)(?:\s+with\s+(?:a\s+)?(?:cost of (\d+) or less|power (\d+) or less))?\s*cannot activate \[Blocker\][^.]*?(?:(?:for|during) this turn|the rest of this turn)?/gi,
    (_m, count, kindStr, costStr, powStr) => {
      const n = (count || '1').toLowerCase() === 'one' ? 1 : parseInt(count);
      const tk = /character/i.test(kindStr) ? 'character' : 'leader';
      const maxCost = costStr ? parseInt(costStr) : '';
      const maxPower = powStr ? parseInt(powStr) : '';
      return `\u00a7SUPPRESS_blocker_${n}_${tk}_${maxCost}_${maxPower}\u00a7`;
    }
  );

  for (const [token, name] of Object.entries(KEYWORD_MAP)) {
    if (processed.includes(token)) out.keywords.push(name);
  }

  const blocks = _splitIntoBlocks(processed);
  for (const block of blocks) {
    const parsed = _parseBlock(block, out.unparsedSegments);
    if (parsed) out.effects.push(parsed);
  }
  return out;
}

// Walk every [bracketed] token; cut blocks between consecutive timing
// markers. The "preamble" of a block is everything between the previous
// timing marker (or start of string) and this marker — that's where
// pre-marker modifiers like "[DON!! x1]" live (e.g. Noble Shlawger's
// "[Blocker] [DON!! x1] [On Block] …"). The "body" is text after this
// marker up to the next timing marker.
function _splitIntoBlocks(text) {
  const tokens = [];
  const re = /\[[^\]]+\]/g;
  let m;
  while ((m = re.exec(text)) !== null) tokens.push({ raw: m[0], pos: m.index });

  // Index of contiguous-modifier-preamble start for a given timing token.
  // Walks backward over non-timing bracketed tokens; stops at either a
  // timing marker or non-whitespace between tokens.
  const preambleStartFor = (idx) => {
    let start = tokens[idx].pos;
    for (let j = idx - 1; j >= 0; j--) {
      const prev = tokens[j];
      if (TIMING_MAP[prev.raw]) break;
      const between = text.substring(prev.pos + prev.raw.length, start);
      if (!/^\s*$/.test(between)) break;
      start = prev.pos;
    }
    return start;
  };

  // Collect timing token indices first so we know where the NEXT block
  // starts (and therefore where the CURRENT block's body ends).
  const timingIdx = [];
  for (let i = 0; i < tokens.length; i++) {
    if (TIMING_MAP[tokens[i].raw]) timingIdx.push(i);
  }

  const blocks = [];
  for (let ti = 0; ti < timingIdx.length; ti++) {
    const i = timingIdx[ti];
    const t = tokens[i];
    const preambleStart = preambleStartFor(i);
    // Body ends at the next block's PREAMBLE start, not its timing
    // marker. Otherwise modifier brackets sitting between two timings
    // (e.g. Yasopp's "[On Play] …. [DON!! x1] [When Attacking] …")
    // leak into the preceding block's body and get picked up as a
    // spurious condition on the wrong block.
    let endPos = text.length;
    if (ti + 1 < timingIdx.length) {
      endPos = preambleStartFor(timingIdx[ti + 1]);
    }
    blocks.push({
      token:    t.raw,
      preamble: text.substring(preambleStart, t.pos),
      body:     text.substring(t.pos + t.raw.length, endPos),
    });
  }
  return blocks;
}

function _parseBlock(block, unparsed) {
  const timing = TIMING_MAP[block.token];
  if (!timing) return null;
  let body = (block.preamble + ' ' + block.body).trim();

  const conditions = [];

  // [DON!! xN] — either preamble or inline (Jesse the Jester has it in
  // the body as "[DON!! x1] [Your Turn] …").
  const donAttached = body.match(/\[DON!!\s*x(\d+)\]/);
  if (donAttached) {
    conditions.push({ type: 'donAttached', value: parseInt(donAttached[1]) });
    body = body.replace(donAttached[0], '').trim();
  }

  // [Once Per Turn] keyword OR natural-language "Once per turn,?/:" prefix.
  if (/\[Once Per Turn\]/i.test(body)) {
    conditions.push({ type: 'oncePerTurn' });
    body = body.replace(/\[Once Per Turn\]/i, '').trim();
  }
  const oprNat = body.match(/^Once per turn[,:]\s*/i);
  if (oprNat) {
    conditions.push({ type: 'oncePerTurn' });
    body = body.substring(oprNat[0].length).trim();
  }

  for (const [token, scope] of Object.entries(PASSIVE_SCOPE_MAP)) {
    if (body.includes(token)) {
      conditions.push({ type: 'scope', value: scope });
      body = body.replace(token, '').trim();
    }
  }

  // "If your Leader has the {X} type," condition (consumed). Skipped
  // when the body contains "Choose one:" — in a Choose-One block the
  // leaderType lives on a specific branch, not the whole block, and
  // will be captured by the branch parser.
  if (!/Choose one\s*:/i.test(body)) {
    const leaderType = body.match(/If your Leader has the \{([^}]+)\}\s*type,?/i);
    if (leaderType) {
      conditions.push({ type: 'leaderType', value: leaderType[1] });
      body = body.replace(leaderType[0], '').trim();
    }
  }

  // "If you have N or more DON!! cards" / "if you have N or less Life cards".
  const donCountMin = body.match(/[Ii]f you have (\d+) or more DON!!\s*cards?/);
  if (donCountMin) {
    conditions.push({ type: 'donCountMin', value: parseInt(donCountMin[1]) });
    body = body.replace(donCountMin[0], '').trim();
  }
  const lifeCountMax = body.match(/[Ii]f you have (\d+) or less Life cards?/);
  if (lifeCountMax) {
    conditions.push({ type: 'lifeCountMax', value: parseInt(lifeCountMax[1]) });
    body = body.replace(lifeCountMax[0], '').trim();
  }

  // Strip leftover stray [Keyword] tokens (they're already captured at
  // the top level in parseAbility.keywords).
  body = body.replace(/\[[^\]]+\]/g, ' ').replace(/\s+/g, ' ').trim();

  const costs = [];

  // "DON!! -N:" return-DON cost.
  const donRet = body.match(/^DON!!\s*-(\d+)\s*:\s*/);
  if (donRet) {
    costs.push({ type: 'returnDon', count: parseInt(donRet[1]) });
    body = body.substring(donRet[0].length).trim();
  }

  // "You may (trash|discard) N [Character|Event] card(s) [with a power
  // of M or more] from your hand[ and this character]:"
  // Stronger OP09-089 adds an "and this character" suffix that pushes
  // a second trashSelf cost onto the stack.
  const trash = body.match(/^You may (?:trash|discard) (one|\d+) (Character |Event )?cards? (?:with a power of (\d+) or more )?from your hand(?:\s+and this character)?\s*:\s*/i);
  if (trash) {
    const n = trash[1].toLowerCase() === 'one' ? 1 : parseInt(trash[1]);
    const c = { type: 'trashFromHand', count: n };
    if (trash[2]) c.filterType = trash[2].trim().toUpperCase();
    if (trash[3]) c.filterPowerMin = parseInt(trash[3]);
    // Synchronous costs must be ordered BEFORE window-opening costs
    // so they run on the same agentPayCosts pass — after the async
    // cost opens its window, resume skips the cost agent entirely.
    if (/and this character/i.test(trash[0])) costs.push({ type: 'trashSelf' });
    costs.push(c);
    body = body.substring(trash[0].length).trim();
  }

  // "You may rest N of your DON!! [and this Character]:"
  const restDon = body.match(/^You may rest (\d+) of your DON!!(?:\s*and this Character)?\s*:\s*/i);
  if (restDon) {
    costs.push({ type: 'restDon', count: parseInt(restDon[1]) });
    if (/and this Character/i.test(restDon[0])) costs.push({ type: 'restSelf' });
    body = body.substring(restDon[0].length).trim();
  }

  // Phase 6 — "You may rest this (Character|Stage):" — self-rest cost.
  // For Activate: Main abilities this is the canonical cost; the game
  // engine auto-rests the source card as part of ACTIVATE_MAIN, so the
  // agent treats an already-rested card as "cost paid trivially".
  const restSelf = body.match(/^You may rest this (Character|Stage|character|stage)\s*:\s*/i);
  if (restSelf) {
    costs.push({ type: 'restSelf' });
    body = body.substring(restSelf[0].length).trim();
  }

  // Phase 8 — "You may trash this (Character|Stage):" — self-trash cost
  // (Kuzan OP10-082). Moves source card from field to trash.
  const trashSelf = body.match(/^You may trash this (Character|Stage|character|stage)\s*:\s*/i);
  if (trashSelf) {
    costs.push({ type: 'trashSelf' });
    body = body.substring(trashSelf[0].length).trim();
  }

  // Placeholders set by parseAbility pre-processing already collapsed an
  // "up to N" phrase; treat their presence as implying optional.
  const optional = /\b(?:you may|up to)\b|\u00a7SUPPRESS_/i.test(body);
  const effects  = _parseEffectList(body, unparsed);
  const withTarget = effects.find(e => e.max != null);
  const maxTargets = withTarget ? withTarget.max : null;
  return { timing, conditions, costs, effects, optional, maxTargets };
}

function _parseEffectList(body, unparsed) {
  if (!body) return [];

  // Phase 5 Priority 8 (3/3) — "Choose one:" branching. Split on the
  // bullet (•) character; each branch may carry its own
  // "If your Leader has the {X} type," condition. Branches return a
  // single chooseOne effect; branch sub-effects are parsed recursively.
  const chooseM = body.match(/^\s*Choose one\s*:?\s*(.+)$/i);
  if (chooseM && /\u2022/.test(chooseM[1])) {
    const branches = chooseM[1].split(/\u2022/).map(s => s.trim()).filter(Boolean).map(bt => {
      const conditions = [];
      let bBody = bt;
      const lt = bBody.match(/^If your Leader has the \{([^}]+)\}\s*type,?\s*/i);
      if (lt) {
        conditions.push({ type: 'leaderType', value: lt[1] });
        bBody = bBody.substring(lt[0].length);
      }
      const effects = _parseEffectList(bBody, unparsed);
      return { conditions, effects, text: bt };
    });
    return [{ type: 'chooseOne', branches }];
  }

  // Protect "K.O." from the period-based splitter — its internal periods
  // look exactly like sentence boundaries otherwise. Swap to a placeholder
  // before splitting, restore after.
  const KO_PLACEHOLDER = '\u0001KO\u0001';
  const protectedBody = body.replace(/K\.O\./g, KO_PLACEHOLDER);
  const segments = protectedBody
    .split(/\.\s+Then,?\s*|,\s+then,?\s+|\.\s+|\s+Then,?\s+/i)
    .map(s => s.replace(/\.$/, '').trim())
    .map(s => s.replace(new RegExp(KO_PLACEHOLDER, 'g'), 'K.O.'))
    .filter(Boolean);

  // Placement for scry is often split across two segments — "Look at N …"
  // in one and "place the rest at the bottom" in the next. Pre-scan the
  // full body so we can attach placement to the scry effect regardless
  // of segmentation.
  const bodyPlacement =
      /put the rest of the cards? (?:in)?to your trash/i.test(body) ? 'trash'
    : /place the rest at the bottom/i.test(body) ? 'bottom'
    : /top or bottom/i.test(body) ? 'either'
    : 'top';

  const out = [];
  for (const seg of segments) {
    const eff = _parseEffectSegment(seg, unparsed, bodyPlacement);
    if (eff) out.push(eff);
  }
  return out;
}

function _parseEffectSegment(seg, unparsed, bodyPlacement) {
  if (!seg) return null;
  // Scry placement continuations are consumed via bodyPlacement — skip
  // silently so they don't show up as unparsed noise.
  if (/^\s*[Pp]lace the rest/.test(seg)) return null;
  if (/^\s*[Pp]ut the rest of the cards? (?:in)?to your trash/i.test(seg)) return null;

  let m, condM;

  // Phase 8 — conditional effect wrappers must run BEFORE any effect
  // matcher that could match the inner clause (e.g. koTarget matches
  // the inner "K.O. it" / "K.O. up to 1 …" in a conditional trailer).
  //   "if you have a character with N power or more, <effect>"   (Mole Gun)
  //   "if that Character has (a )cost of N or less, K.O. it"     (Black Hole)
  if ((condM = seg.match(/^[,\s]*if you have a character with (\d+) power or more,\s*(.+)$/i))) {
    const inner = _parseEffectSegment(condM[2], unparsed, bodyPlacement);
    if (inner) {
      return { type: 'conditionalEffect',
        condition: { type: 'ownCharacterPowerMin', value: parseInt(condM[1]) },
        effect: inner };
    }
  }
  if ((condM = seg.match(/^[,\s]*if that Character has (?:a )?cost of (\d+) or less,\s*K\.O\. it/i))) {
    return { type: 'conditionalEffect',
      condition: { type: 'lastTargetMaxCost', value: parseInt(condM[1]) },
      effect: { type: 'koLastTarget' } };
  }

  // Phase 8 — mandatory "Trash N cards from your hand" as an EFFECT
  // (not a cost), e.g. Caribou OP11-083. Distinct from the "You may
  // trash N cards from your hand:" cost form handled in _parseBlock.
  if ((m = seg.match(/^[Tt]rash (\d+) cards? from your hand/))) {
    return { type: 'trashFromHandEffect', count: parseInt(m[1]) };
  }

  // Phase 8 — "Play this card" as a [Trigger] effect (Monk Matt
  // ST04-010). When a life card with this trigger is revealed, the
  // card moves from hand to field as a free play.
  if (/^[Pp]lay this card$/i.test(seg)) {
    return { type: 'playSelf' };
  }

  if ((m = seg.match(/^(?:[Dd]raw) (one|\d+) cards?/))) {
    const n = m[1].toLowerCase() === 'one' ? 1 : parseInt(m[1]);
    return { type: 'drawCards', count: n };
  }

  // Phase 7 — "Add up to N Active DON!! from your DON!! deck" (God Thread
  // and similar): the "Active" adjective precedes DON!! rather than a
  // trailing "set it as active" — unique enough to check before the
  // general matchers.
  if ((m = seg.match(/[Aa]dd (?:up to )?(\d+) Active DON!!/))) {
    return { type: 'addDon', count: parseInt(m[1]), state: 'active' };
  }

  // Phase 8 — "set up to N of them as active" after a DON!! clause
  // (Rosinante OP10-072): un-rest up to N rested DON!! cards. Distinct
  // from addDon (which pulls from deck) — this only un-rests existing.
  if ((m = seg.match(/^[,\s]*set up to (\d+) of them as active/i))) {
    return { type: 'setOwnDonActive', count: parseInt(m[1]) };
  }

  // Phase 8 — "Set up to N of your {X} type Characters with a cost of M
  // or more as active" (Katakuri OP11-067): un-rest N of your own
  // Characters matching the filter. The "cost of M or more" is a
  // minCost, mirroring the maxCost shape used elsewhere.
  if ((m = seg.match(/[Ss]et up to (\d+) of your \{([^}]+)\}\s*type Characters?(?:\s+with\s+(?:a\s+)?cost of (\d+) or more)?\s+as active/i))) {
    const filter = { affiliation: m[2] };
    if (m[3]) filter.minCost = parseInt(m[3]);
    return { type: 'setCharacterActive', max: parseInt(m[1]), filter };
  }
  if ((m = seg.match(/[Aa]dd (?:up to )?(\d+) (?:Active )?DON!!.*?(?:set it as active|active)/))) {
    return { type: 'addDon', count: parseInt(m[1]), state: 'active' };
  }
  if ((m = seg.match(/[Aa]dd (?:up to )?(\d+) DON!!.*?rest/))) {
    return { type: 'addDon', count: parseInt(m[1]), state: 'rested' };
  }
  if ((m = seg.match(/[Aa]dd (?:up to )?(\d+) DON!! card/))) {
    return { type: 'addDon', count: parseInt(m[1]), state: 'rested' };
  }

  if (/K\.O\. all Characters other than this Character/i.test(seg)) {
    return { type: 'aoeKO', excludeSelf: true };
  }

  if ((m = seg.match(/K\.O\. (?:up to )?(one|\d+).*?cost of (\d+) or less/i))) {
    const n = m[1].toLowerCase() === 'one' ? 1 : parseInt(m[1]);
    return { type: 'koTarget', max: n, filter: { maxCost: parseInt(m[2]), opponent: true } };
  }
  if ((m = seg.match(/K\.O\. (?:up to )?(one|\d+).*?(\d+)\s*power or (?:less|lower)/i))) {
    const n = m[1].toLowerCase() === 'one' ? 1 : parseInt(m[1]);
    return { type: 'koTarget', max: n, filter: { maxPower: parseInt(m[2]), opponent: true } };
  }
  // Phase 5 Priority 3 — alternate word order: "power of N or less"
  // (Lucky Roux: "Characters with an original power of 6000 or less").
  if ((m = seg.match(/K\.O\. (?:up to )?(one|\d+).*?power of (\d+) or (?:less|lower)/i))) {
    const n = m[1].toLowerCase() === 'one' ? 1 : parseInt(m[1]);
    return { type: 'koTarget', max: n, filter: { maxPower: parseInt(m[2]), opponent: true } };
  }
  if ((m = seg.match(/K\.O\. (?:up to )?(one|\d+) of your opponent'?s? Character/i))) {
    const n = m[1].toLowerCase() === 'one' ? 1 : parseInt(m[1]);
    return { type: 'koTarget', max: n, filter: { opponent: true } };
  }

  if ((m = seg.match(/[Rr]eturn (?:up to )?(\d+)(?: of your opponent'?s?)? Character.*?cost of (\d+) or less.*?(?:owner'?s? )?hand/i))) {
    return { type: 'bounceTarget', max: parseInt(m[1]), filter: { maxCost: parseInt(m[2]), opponent: /your opponent/i.test(seg) } };
  }
  if ((m = seg.match(/[Rr]eturn (?:up to )?(\d+)(?: of your opponent'?s?)? Character.*?(\d+)\s*power or less.*?(?:owner'?s? )?hand/i))) {
    return { type: 'bounceTarget', max: parseInt(m[1]), filter: { maxPower: parseInt(m[2]), opponent: /your opponent/i.test(seg) } };
  }
  if ((m = seg.match(/[Rr]eturn (?:up to )?(\d+) Character to (?:its )?owner'?s? hand/i))) {
    return { type: 'bounceTarget', max: parseInt(m[1]), filter: {} };
  }

  if ((m = seg.match(/[Rr]est (?:up to )?(\d+) of your opponent'?s? Character/i))) {
    const costM = seg.match(/cost of (\d+) or less/i);
    const filter = { opponent: true };
    if (costM) filter.maxCost = parseInt(costM[1]);
    return { type: 'restTarget', max: parseInt(m[1]), filter };
  }

  if ((m = seg.match(/[Pp]lace (?:up to )?(\d+) Character.*?cost of (\d+) or less.*?bottom of.*?deck/i))) {
    return { type: 'placeAtBottom', max: parseInt(m[1]), filter: { maxCost: parseInt(m[2]) } };
  }

  // Phase 6/7 — scry matcher. Accepts both phrasings:
  //   "Look at N cards from the top of your deck"      (existing)
  //   "Look at the top N cards of your deck"            (Sugar / Uta / Come on!!)
  // Reveal variants: "reveal up to N", "reveal up to one", "reveal and add one".
  if ((m = seg.match(/[Ll]ook at(?: the top)?\s*(\d+)\s*cards?(?: from the top)?/i))) {
    const scry = { type: 'scry', count: parseInt(m[1]), placement: bodyPlacement };
    const revealM  = seg.match(/reveal(?:\s+(?:up to|and add))?\s+(one|\d+)/i);
    const filterM  = seg.match(/\{([^}]+)\}\s*type\s*(Character|Event|Stage)?/i);
    // Match either the raw "[Name]" form or the pre-processed
    // placeholder §EXCLUDE_Name-with-|-for-spaces§.
    const excludeM = seg.match(/other than \[([^\]]+)\]/i)
                  || seg.match(/other than \u00a7EXCLUDE_([^\u00a7]+)\u00a7/);
    if (/reveal/i.test(seg)) {
      const rCount = revealM ? (revealM[1].toLowerCase() === 'one' ? 1 : parseInt(revealM[1])) : 1;
      scry.reveal = { count: rCount, filter: {} };
      if (filterM) {
        scry.reveal.filter.affiliation = filterM[1];
        if (filterM[2]) scry.reveal.filter.type = filterM[2].toUpperCase();
      }
      if (excludeM) scry.reveal.filter.excludeName = excludeM[1].replace(/\|/g, ' ');
    }
    return scry;
  }

  if ((m = seg.match(/[Tt]rash (?:up to )?(\d+) of your opponent'?s? Life cards?/i))) {
    return { type: 'trashOpponentLife', count: parseInt(m[1]), triggerActivates: false };
  }

  // Phase 5 Priority 6 — "Add [up to] N card(s) from the top of your
  // deck to (the top of )?your Life cards?". Baby 5 (OP14-072) is the
  // canonical case — a self-heal effect after KO.
  if ((m = seg.match(/[Aa]dd (?:up to )?(\d+) cards? from the top of your deck to (?:the top of )?your Life cards?/i))) {
    return { type: 'addLife', count: parseInt(m[1]) };
  }

  // addFromTrash — "Add up to N [type] [card(s)] from your trash to your hand".
  // "card(s)" is optional because some ability texts omit it ("add up to 1
  // Event from your trash to your hand").
  if ((m = seg.match(/[Aa]dd (?:up to )?(\d+) (Event|Character)?\s*(?:cards?\s+)?from your trash to your hand/i))) {
    const e = { type: 'addFromTrash', max: parseInt(m[1]) };
    if (m[2]) e.filter = { type: m[2].toUpperCase() };
    return e;
  }

  if ((m = seg.match(/gains?\s*\+(\d+)\s*power\s+for every (\d+)\s*Events?\s+in your trash/i))) {
    return { type: 'scaledPowerBuff', per: parseInt(m[2]), amount: parseInt(m[1]), source: 'eventsInTrash' };
  }

  if ((m = seg.match(/(?:[Gg]ains?|[Hh]as|[Gg]ets?)\s*\+(\d+)(?:\s*power)?\s+(until (?:the )?end of (?:your )?opponent'?s? next (?:turn|end phase)|during this turn|during this battle|for this turn|for this battle)/i))) {
    const amount = parseInt(m[1]);
    const when = m[2].toLowerCase();
    const duration = when.includes('opponent') ? 'opponentNextTurn'
                   : when.includes('battle')   ? 'thisBattle'
                                                : 'thisTurn';
    const lead = seg.substring(0, m.index).toLowerCase();
    const target = /this character|this leader/.test(lead) ? 'self'
                 : (/your leader/.test(lead) && !/character/.test(lead)) ? 'leader'
                 : 'leaderOrCharacter';
    return { type: 'powerBuff', target, value: amount, duration };
  }

  // Phase 8 — "(Afterwards,) one of your opponent's leader or character
  // gets -N during this turn" (Kamakura Jussoushi). The existing
  // powerDebuff matchers key off "give -N" or "-N000 power" phrasings;
  // this one handles "gets -N" with optional "power" word.
  if ((m = seg.match(/(?:[Aa]fterwards?,?\s*)?(?:one of )?your opponent'?s?\s+(leaders? or characters?|leader|character)\s+(?:gets?|gains?|has)\s*-(\d+)(?:\s*power)?\s+(until .*?next turn|during this turn|during this battle|for this turn|for this battle)/i))) {
    const kind = (m[1].toLowerCase().includes(' or ')) ? 'opponentLeaderOrCharacter'
               : m[1].toLowerCase().includes('character') ? 'opponentCharacter'
               : 'opponentLeader';
    return { type: 'powerDebuff', target: kind, value: parseInt(m[2]) };
  }

  // Phase 8 — "Give your leader or one of your characters up to N rested
  // DON!!" (Edward Newgate ST15-002). Opens a target picker for the
  // player's own leader/characters, then attaches N rested DON!! to it.
  if ((m = seg.match(/[Gg]ive your leader or one of your characters up to (one|\d+)\s+rested DON!!/i))) {
    const n = m[1].toLowerCase() === 'one' ? 1 : parseInt(m[1]);
    return { type: 'giveDon', count: n, state: 'rested' };
  }

  // Track-P partial — costDebuff (Stronger OP09-089):
  //   "give up to one of your opponents characters -N cost for the turn"
  if ((m = seg.match(/[Gg]ive (?:up to )?(one|\d+) of your opponent'?s?\s+characters?\s+-(\d+)\s+cost for (?:the|this) turn/i))) {
    const n = m[1].toLowerCase() === 'one' ? 1 : parseInt(m[1]);
    return { type: 'costDebuff', max: n, amount: parseInt(m[2]), duration: 'thisTurn' };
  }

  // Phase-5 Priority 1 — "Give [up to N of] your Leader/Character cards
  // +M power (for|during)? this (battle|turn)". Covers NoroNoro Beam
  // Sword, Bad Manners Kick Course, and similar buff events where the
  // effect phrases the buff as imperative "Give …" rather than passive
  // "X gains …". target is the leader/character pool the player picks
  // from — the effect agent will need an interactive target picker.
  // Target-shape helper: the alternation may capture "leader", "leaders",
  // "character", "characters", "leader or character", or "leaders or
  // characters". A plain substring test for "leader or character" fails
  // on the plural form (e.g. "leaders or characters" — note `s` before
  // the space). Use the word "or" as the signal for the composite target.
  const targetKind = (label) => {
    const l = label.toLowerCase();
    if (/\bor\b/.test(l))       return 'leaderOrCharacter';
    if (/character/.test(l))    return 'character';
    return 'leader';
  };
  if ((m = seg.match(/[Gg]ive\s+(?:up to\s+(one|\d+)\s+of\s+)?your\s+(leaders? or characters?|leader|character)\s+(?:cards?\s+)?\+(\d+)\s*power\s+(?:for\s+|during\s+)?this\s+(battle|turn)/i))) {
    const max = m[1] ? (m[1].toLowerCase() === 'one' ? 1 : parseInt(m[1])) : 1;
    return { type: 'powerBuff', target: targetKind(m[2]),
             value: parseInt(m[3]),
             duration: m[4].toLowerCase() === 'battle' ? 'thisBattle' : 'thisTurn',
             max };
  }
  // Phase-5 Priority 1 — "Give [up to N of] your opponent's
  // Leader/Character -M power …". Debuff form of the above. "cards"
  // is optional — many ability texts omit it.
  if ((m = seg.match(/[Gg]ive\s+(?:up to\s+(one|\d+)\s+of\s+)?your\s+opponent'?s?\s+(leaders? or characters?|leader|character)\s+(?:cards?\s+)?-(\d+)\s*power\s+(?:for\s+|during\s+)?this\s+(battle|turn)/i))) {
    const max = m[1] ? (m[1].toLowerCase() === 'one' ? 1 : parseInt(m[1])) : 1;
    const kind = targetKind(m[2]);
    const target = kind === 'leaderOrCharacter' ? 'opponentLeaderOrCharacter'
                 : kind === 'character' ? 'opponentCharacter' : 'opponentLeader';
    return { type: 'powerDebuff', target, value: parseInt(m[3]),
             duration: m[4].toLowerCase() === 'battle' ? 'thisBattle' : 'thisTurn',
             max };
  }
  // Phase-5 Priority 1 — "[Up to one of] your opponent's characters
  // gets -M power …". Subject-first "gets" rather than imperative
  // "Give" (Yasopp [DON!! x1] [When Attacking]).
  if ((m = seg.match(/(?:[Uu]p\s+to\s+(one|\d+)\s+of\s+)?your\s+opponent'?s?\s+(leaders? or characters?|leaders?|characters?)\s+(?:gets?|gains?)\s+-(\d+)\s*power\s+(?:for\s+|during\s+)?this\s+(turn|battle)/i))) {
    const max = m[1] ? (m[1].toLowerCase() === 'one' ? 1 : parseInt(m[1])) : 1;
    const kind = targetKind(m[2]);
    const target = kind === 'leaderOrCharacter' ? 'opponentLeaderOrCharacter'
                 : kind === 'character' ? 'opponentCharacter' : 'opponentLeader';
    return { type: 'powerDebuff', target, value: parseInt(m[3]),
             duration: m[4].toLowerCase() === 'battle' ? 'thisBattle' : 'thisTurn',
             max };
  }

  if ((m = seg.match(/[Pp]lay (?:up to )?(\d+).*?cost of (\d+) or less.*?hand/i))) {
    const filter = { maxCost: parseInt(m[2]) };
    const affM  = seg.match(/\{([^}]+)\}\s*type/i);
    const nameM = seg.match(/\[([^\]]+)\]\s*card/i)
              || seg.match(/\u00a7NAME_([^\u00a7]+)\u00a7\s*card/);
    const typeM = seg.match(/\b(Character|Event|Stage)\s+card/i);
    if (affM)  filter.affiliation = affM[1];
    if (nameM) filter.name = nameM[1].replace(/\|/g, ' ');
    if (typeM) filter.type = typeM[1].toUpperCase();
    return { type: 'playFromHand', max: parseInt(m[1]), filter, free: true };
  }

  if ((m = seg.match(/[Gg]ive.*?opponent.*?-(\d+000)\s*power/i))) {
    return { type: 'powerDebuff', value: parseInt(m[1]), target: 'opponentCharacter' };
  }

  // Phase 5 Priority 5 — meta-reference placeholder. Set by parseAbility
  // pre-processing. Encodes the referenced timing so the effect agent
  // can re-run the target block when fired.
  if ((m = seg.match(/\u00a7ACTIVATE_(\w+)\u00a7/))) {
    return { type: 'activateOwnEffect', timing: m[1] };
  }

  // Phase 5 Priority 8 — attack-prevention suppression placeholder.
  // Set by parseAbility pre-processing for Sarra-style compounds.
  if ((m = seg.match(/\u00a7SUPPRESS_attack_(\d+)_(\w+)_(\d*)_(\w+)\u00a7/))) {
    const filter = m[3] ? { maxCost: parseInt(m[3]) } : {};
    return { type: 'suppressTarget', kind: 'attack',
             max: parseInt(m[1]), targetKind: m[2], filter, duration: m[4] };
  }
  // Phase 7 — keyword grant placeholder. Set by parseAbility pre-processing.
  if ((m = seg.match(/\u00a7GRANT_([a-z0-9-]+)_([a-zA-Z]+)\u00a7/))) {
    return { type: 'grantKeyword', keyword: m[1].replace(/-/g, ' '), duration: m[2] };
  }

  // Track-P partial — suppressOnPlay placeholder. Teach OP09-081. The
  // duration is read from a surrounding "Until the end of your
  // opponent's next turn" phrase in the same segment.
  if (/\u00a7SUPPRESS_ONPLAY_OPPONENT\u00a7/.test(seg)) {
    const duration = /[Uu]ntil the end of your opponent'?s?\s*next turn/.test(seg)
      ? 'opponentNextTurn' : 'thisTurn';
    return { type: 'suppressOnPlay', side: 'opponent', duration };
  }

  // Track-P partial — redirectAttack placeholder. Doflamingo OP14-060.
  if ((m = seg.match(/\u00a7REDIRECT_([^\u00a7]+)\u00a7/))) {
    return { type: 'redirectAttack',
      filter: { affiliation: m[1].replace(/-/g, ' ') } };
  }

  // Track-P partial — selfRevive placeholder. Marco OP03-013 only.
  if ((m = seg.match(/\u00a7REVIVE_(\d+)_(Character|Event)_(rested|active)\u00a7/))) {
    return { type: 'selfRevive',
      costCount: parseInt(m[1]),
      costType: m[2].toUpperCase(),
      reviveState: m[3] };
  }

  // Phase 7 — playFromTrash placeholder. Fields, in order:
  //   max, affiliation (dash-joined), type, maxCost, excludeName, rested-flag
  if ((m = seg.match(/\u00a7PFT_(\d+)_([^_§]+)_([^_§]*)_([^_§]*)_([^_§]*)_([01])\u00a7/))) {
    const filter = { affiliation: m[2].replace(/-/g, ' ') };
    if (m[3]) filter.type = m[3].toUpperCase();
    if (m[4]) filter.maxCost = parseInt(m[4]);
    if (m[5]) filter.excludeName = m[5].replace(/-/g, ' ');
    return { type: 'playFromTrash', max: parseInt(m[1]), filter, rested: m[6] === '1' };
  }

  // Phase 5 Priority 8 — blocker-ability suppression placeholder.
  // Set by parseAbility pre-processing for Limejuice-style "cannot
  // activate [Blocker]" lines.
  if ((m = seg.match(/\u00a7SUPPRESS_blocker_(\d+)_(\w+)_(\d*)_(\d*)\u00a7/))) {
    const filter = {};
    if (m[3]) filter.maxCost = parseInt(m[3]);
    if (m[4]) filter.maxPower = parseInt(m[4]);
    return { type: 'suppressTarget', kind: 'blockerAbility',
             max: parseInt(m[1]), targetKind: m[2], filter, duration: 'thisTurn' };
  }

  // Phase 5 Priority 8 — effect suppression. Two sentence shapes:
  //   "[Nn]egate|[Nn]ullify the effect(s) of up to N of your opponent's
  //     (leader|character|leader or character) [cards] [during this turn]"
  //   "up to one of your opponent's (leader|character|…) effects are negated
  //     [until end of …|during this turn]"
  // Both emit suppressTarget with kind='effects' and a duration.
  if ((m = seg.match(/(?:[Nn]egate|[Nn]ullify) the effects? of (?:up to (one|\d+) of )?your opponent'?s? (leaders? or characters?|leaders?|characters?)(?: cards?)?(?:.*?during this (turn|battle))?(?:.*?until .*? (?:turn|end phase))?/i))) {
    const max = m[1] ? (m[1].toLowerCase() === 'one' ? 1 : parseInt(m[1])) : 1;
    const label = m[2].toLowerCase();
    const targetKind = /\bor\b/.test(label) ? 'leaderOrCharacter'
                     : /character/.test(label) ? 'character'
                     : 'leader';
    const duration = /until .*? (?:next )?(?:turn|end phase)/i.test(seg) ? 'opponentNextTurn' : 'thisTurn';
    return { type: 'suppressTarget', kind: 'effects', max, targetKind, duration };
  }
  if ((m = seg.match(/(?:up to (one|\d+) of )?your opponent'?s? (leaders? or characters?|leaders?|characters?)(?: cards?)? effects?\s+(?:are|is)?\s*negated/i))) {
    const max = m[1] ? (m[1].toLowerCase() === 'one' ? 1 : parseInt(m[1])) : 1;
    const label = m[2].toLowerCase();
    const targetKind = /\bor\b/.test(label) ? 'leaderOrCharacter'
                     : /character/.test(label) ? 'character'
                     : 'leader';
    const duration = /until .*? (?:next )?(?:turn|end phase)/i.test(seg) ? 'opponentNextTurn' : 'thisTurn';
    return { type: 'suppressTarget', kind: 'effects', max, targetKind, duration };
  }

  unparsed.push(seg);
  return null;
}

// ── Cache builder + startup coverage report ──
function _buildParsedEffectsCache() {
  let full = 0, partial = 0, empty = 0;
  const gaps = [];
  let passiveCards = 0, passiveEntries = 0;
  for (const card of CARD_DB) {
    const parsed = parseAbility(card.ability || '');
    PARSED_EFFECTS.set(card.id, parsed);
    const passives = parsePassive(card.ability || '');
    if (passives.length > 0) {
      PASSIVE_EFFECTS.set(card.id, passives);
      passiveCards++; passiveEntries += passives.length;
    }
    if (!card.ability) { empty++; continue; }
    if (parsed.unparsedSegments.length === 0) full++;
    else { partial++; gaps.push({ id: card.id, name: card.name, unparsed: parsed.unparsedSegments }); }
  }
  console.log(`[PARSE_ABILITY] ${CARD_DB.length} cards cached — ${full} full, ${partial} partial, ${empty} no-ability`);
  console.log(`[PARSE_PASSIVE] ${passiveCards} cards carry ${passiveEntries} passive entries.`);
  if (gaps.length > 0) {
    console.log(`[PARSE_ABILITY] Coverage gaps (${gaps.length}):`);
    for (const g of gaps) console.log(`  ${g.id} ${g.name}: ${g.unparsed.map(s => JSON.stringify(s)).join(' | ')}`);
  }
  // Phase-1 sanity dump for the user's 10 spec cards. Routers are only
  // as good as their regex coverage; this prints the structured output
  // for visual inspection against the spec.
  const specIds = ['ST03-001','ST04-001','OP01-077','OP01-079','OP01-087','OP01-094','OP01-100','OP01-101','ST03-003','ST03-014','ST04-015'];
  console.log('[PARSE_ABILITY] Spec-card dump:');
  for (const id of specIds) {
    const row = CARD_DB.find(c => c.id === id);
    if (!row) continue;
    console.log(`  ${id} ${row.name}: ${JSON.stringify(PARSED_EFFECTS.get(id))}`);
  }
}
_buildParsedEffectsCache();

// ═════════════════════════════════════════════════════════════════════════
// PHASE 3 — Multi-agent effect pipeline (per-card opt-in via useNewPipeline
// on the CARD_DB entry). Noble Shlawger is the first card routed through
// this pipeline; every other card still flows through parseAndApply
// untouched. Agents are small, named functions so future phases can unit-
// test them in isolation and swap one out without touching the others.

// AGENT 2 — TIMING: does this parsed block fire on the given timing tag?
function agentCheckTiming(block, timing) { return block.timing === timing; }

// AGENT 3 — CONDITIONS: evaluate a list of { type, value } gates. Returns
// { ok: true } or { ok: false, reason: string }. Conditions unknown in this
// phase short-circuit true (non-fatal — the sequencer still advances).
function agentCheckConditions(conditions, ctx) {
  for (const c of (conditions || [])) {
    switch (c.type) {
      case 'donAttached':
        if ((ctx.card.attachedDon || 0) < c.value) {
          return { ok: false, reason: `needs ${c.value} attached DON (have ${ctx.card.attachedDon || 0})` };
        }
        break;
      case 'leaderType': {
        const aff = ((ctx.player.leader && ctx.player.leader.affiliation) || '').toLowerCase();
        if (!aff.includes(c.value.toLowerCase())) {
          return { ok: false, reason: `leader affiliation not {${c.value}}` };
        }
        break;
      }
      case 'donCountMin': {
        const total = (ctx.player.donActive || 0) + (ctx.player.donRested || 0) + (ctx.player.donDeck || 0);
        if (total < c.value) return { ok: false, reason: `needs ${c.value} DON (have ${total})` };
        break;
      }
      case 'lifeCountMax':
        if ((ctx.player.life || []).length > c.value) {
          return { ok: false, reason: `needs ≤${c.value} life (have ${ctx.player.life.length})` };
        }
        break;
      case 'oncePerTurn':
      case 'scope':
        // TODO(phase-4): once-per-turn tracking, passive scope filters.
        break;
      default:
        console.log('[AGENT-CONDITION] Unknown condition type:', c.type);
    }
  }
  return { ok: true };
}

// AGENT 4 — COSTS: resolve a list of costs. Phase-4 Batch 2 supports
// trashFromHand and returnDon — both open an interactive window and
// hand off to the sequencer via `resume` (set to effectIndex:0 of the
// current block, with costsPaid:true).
//
// Returns:
//   { status: 'paid' }            — all costs paid synchronously
//   { status: 'window-open' }     — player input required (window set)
//   { status: 'unaffordable' }    — can't pay; block aborts
//   { status: 'unsupported' }     — cost type not yet implemented
function agentPayCosts(costs, ctx, resume) {
  for (const c of (costs || [])) {
    switch (c.type) {
      case 'trashFromHand': {
        const opened = openTrashFromHand(ctx.game, ctx.playerId, {
          count: c.count,
          optional: true,  // "You may" prefix — player can skip; skip = block aborts
          filterType: c.filterType || null,
          filterPowerMin: c.filterPowerMin || null,
          sourceCardName: ctx.card.name,
          pipelineResume: resume || null,
        });
        if (!opened) return { status: 'unaffordable' };
        return { status: 'window-open' };
      }
      case 'returnDon': {
        // openDonReturn signature keeps its legacy `timing` param (used by
        // parseAndApply callers). We pass the resume timing string there
        // so the window also works in legacy flow if ever inspected.
        const opened = openDonReturn(ctx.game, ctx.playerId, ctx.card, c.count,
          resume ? resume.timing : null,
          { pipelineResume: resume || null });
        if (!opened) return { status: 'unaffordable' };
        return { status: 'window-open' };
      }
      case 'restSelf': {
        // Synchronous cost: if the engine already rested the card (the
        // typical ACTIVATE_MAIN path rests before running the pipeline)
        // the cost is met for free; otherwise rest the source now.
        if (!ctx.card.rested) ctx.card.rested = true;
        break;  // continue loop to any subsequent costs
      }
      case 'trashSelf': {
        // Synchronous cost: move source from field to trash. ctx.card
        // reference stays valid (same object, now in trash).
        const f = ctx.player.field;
        const idx = f.findIndex(c => c.uid === ctx.card.uid);
        if (idx !== -1) {
          f.splice(idx, 1);
          ctx.player.trash.push(ctx.card);
          log(ctx.game, `${ctx.card.name}: trashed as cost.`);
        }
        break;
      }
      default:
        console.log('[AGENT-COST] Not yet supported in new pipeline:', c.type, `(card ${ctx.card.name})`);
        return { status: 'unsupported' };
    }
  }
  return { status: 'paid' };
}

// AGENT 5 — EFFECT: dispatch one effect object. Grows one case at a time
// as cards are migrated to the new pipeline; 'unsupported' for everything
// else so a test flipping useNewPipeline on an un-migrated card surfaces
// immediately.
//
// The third argument, `resume`, is the continuation to attach to any
// window this effect opens. The sequencer populates it before each call;
// window openers stash it on the window object so the action handler
// can call resumePipeline() after the player responds.
function agentApplyEffect(effect, ctx, resume) {
  switch (effect.type) {
    case 'placeAtBottom': {
      const opened = openPlaceAtBottomWindow(ctx.game, ctx.playerId, {
        sourceCardName: ctx.card.name,
        sourceCardUid:  ctx.card.uid,
        filter:         effect.filter || {},
        max:            effect.max || 1,
        optional:       effect.optional !== false,
        pipelineResume: resume || null,
      });
      return opened ? { status: 'window-open' } : { status: 'no-targets' };
    }
    // Phase-4 Batch 1 — synchronous effect. No window, no resume needed.
    case 'addDon': {
      const count = effect.count || 1;
      const rested = effect.state !== 'active';
      addDonFromDeck(ctx.player, count, rested, ctx.game, ctx.card.name);
      return { status: 'applied' };
    }
    // Phase-4 Batch 1 — opens addFromTrashWindow. Chain resume via
    // pipelineResume on the window.
    case 'addFromTrash': {
      const filter = effect.filter || {};
      const opened = openAddFromTrash(ctx.game, ctx.playerId, {
        count: effect.max || 1,
        filterType: filter.type || null,
        optional: effect.optional !== false,
        sourceCardName: ctx.card.name,
        pipelineResume: resume || null,
      });
      return opened ? { status: 'window-open' } : { status: 'no-targets' };
    }
    // Phase-4 Batch 1 — koTarget via existing openKoTargetWindow. Chain
    // resume carries through the window so Blessed Thy Men's addDon
    // fires after the KO resolves.
    case 'koTarget': {
      const filter = effect.filter || {};
      const matches = (c) => {
        if (filter.maxCost != null && (c.cost || 0) > filter.maxCost) return false;
        if (filter.maxPower != null && ((c.power || 0) + (c.attachedDon || 0) * 1000) > filter.maxPower) return false;
        return true;
      };
      const filterKind  = filter.maxCost != null ? 'cost'
                        : filter.maxPower != null ? 'power' : 'any';
      const filterValue = filter.maxCost ?? filter.maxPower ?? '';
      const opened = openKoTargetWindow(ctx.game, ctx.playerId, {
        filter: matches,
        sourceCardName: ctx.card.name,
        count: effect.max || 1,
        optional: effect.optional !== false,
        filterKind, filterValue,
        pipelineResume: resume || null,
      });
      return opened ? { status: 'window-open' } : { status: 'no-targets' };
    }
    // Phase-4 Batch 2 — AOE K.O. ("K.O. all Characters other than this
    // Character"). Synchronous: trashes every opponent CHARACTER except
    // the source, firing each victim's [On K.O.] via triggerOnKO.
    case 'aoeKO': {
      const oppId = Object.keys(ctx.game.players).find(id => id !== ctx.playerId);
      const opp = ctx.game.players[oppId];
      const victims = (opp.field || []).filter(c =>
        c.type === 'CHARACTER' && c.uid !== ctx.card.uid);
      for (const target of victims) {
        // Track-P Phase 5 — skip protected cards.
        if (isRemovalProtected(target, ctx.playerId, ctx.game, 'ko')) {
          log(ctx.game, `${target.name}: immune to K.O. from opponent effects.`);
          continue;
        }
        // Track-P Phase 6 — offer self-save first.
        if (tryAutoSelfSave(target, ctx.playerId, ctx.game, ctx.card.name)) continue;
        opp.field = opp.field.filter(c => c.uid !== target.uid);
        opp.trash.push(target);
        dropTempEffectsFor(ctx.game, target.uid);
        log(ctx.game, `\uD83D\uDC80 ${target.name} K.O.'d by ${ctx.card.name}!`);
        triggerOnKO(ctx.game, oppId, target, ctx.playerId);
      }
      return { status: 'applied' };
    }
    // Phase-4 Batch 2 — bounce target picker. Scope is derived from the
    // parsed filter.opponent flag: true → opponent field only (Ball the
    // Berserk), false/undefined → either field (default TCG Character
    // targeting).
    case 'bounceTarget': {
      const filter = effect.filter || {};
      const scope = filter.opponent ? 'opponent' : 'any';
      const filterKind  = filter.maxCost != null ? 'cost'
                        : filter.maxPower != null ? 'power' : 'any';
      const filterValue = filter.maxCost ?? filter.maxPower ?? '';
      // Optional comes from the block-level flag the sequencer set on
      // the effect. Default: true when unset. For Ball the Berserk post
      // text change, the block has "up to" stripped → optional=false.
      const optional = ctx._blockOptional != null ? ctx._blockOptional
                     : (effect.optional !== false);
      const opened = openBounceTarget(ctx.game, ctx.playerId, {
        filterKind, filterValue,
        optional,
        scope,
        sourceCardName: ctx.card.name,
        pipelineResume: resume || null,
      });
      return opened ? { status: 'window-open' } : { status: 'no-targets' };
    }
    // Phase-4 Batch 3 — sync draw. drawCards(p, n, game, name) already
    // handles empty-deck short-circuits + logging.
    case 'drawCards': {
      drawCards(ctx.player, effect.count || 1, ctx.game, ctx.card.name);
      return { status: 'applied' };
    }
    // Phase-4 Batch 3 — rest opponent character. Per the user's
    // BUG-5/6 spec, when no active opponent character exists the WHOLE
    // activation is blocked (not a silent skip). The handler returns
    // 'abort-block' in that case so the sequencer stops instead of
    // running any follow-up effects (Anna's draw must NOT fire if rest
    // can't resolve).
    case 'restTarget': {
      const filter = effect.filter || {};
      const opened = openRestTargetWindow(ctx.game, ctx.playerId, {
        sourceCardName: ctx.card.name,
        optional: ctx._blockOptional != null ? ctx._blockOptional : (effect.optional !== false),
        costThreshold: filter.maxCost != null ? filter.maxCost : null,
        pipelineResume: resume || null,
      });
      return opened
        ? { status: 'window-open' }
        : { status: 'abort-block', reason: 'no active opponent characters to rest' };
    }
    // Phase 5 Priority 6 — move top N cards of player's deck to the top
    // of their life stack. Symmetric opposite of trashOpponentLife.
    case 'addLife': {
      const want = Math.min(effect.count || 1, ctx.player.deck.length);
      for (let i = 0; i < want; i++) {
        const c = ctx.player.deck.shift();
        if (!c) break;
        ctx.player.life.push(c);  // life[.length-1] = top, matches pop() semantics in RESOLVE_ATTACK
        log(ctx.game, `${ctx.card.name}: added a card to life (${ctx.player.life.length} total).`);
      }
      return { status: 'applied' };
    }

    // Phase-4 Batch 3 — trash N life cards from opponent, bypassing
    // Trigger. Constable Jack leader's flagship effect.
    case 'trashOpponentLife': {
      const oppId = Object.keys(ctx.game.players).find(id => id !== ctx.playerId);
      const opp = ctx.game.players[oppId];
      const want = Math.min(effect.count || 1, opp.life.length);
      for (let i = 0; i < want; i++) {
        const lifeCard = opp.life.pop();
        if (!lifeCard) break;
        opp.trash.push(lifeCard);
        log(ctx.game, `${ctx.card.name}: trashed opponent's life card ${lifeCard.name}. ${opp.life.length} life remaining.`);
      }
      return { status: 'applied' };
    }
    // Phase-5 Priority-1 — powerBuff. target values produced by
    // parseAbility: 'self' (apply to the source card), 'leader' /
    // 'character' / 'leaderOrCharacter' (interactive pick from own side).
    case 'powerBuff': {
      if (effect.target === 'self') {
        applyTempPower(ctx.game, ctx.card.uid, effect.value, effect.duration, ctx.card.name);
        return { status: 'applied' };
      }
      const opened = openPowerBuffTarget(ctx.game, ctx.playerId, {
        side: 'self',
        targetKind: effect.target || 'leaderOrCharacter',
        optional: ctx._blockOptional != null ? ctx._blockOptional : (effect.optional !== false),
        sourceCardName: ctx.card.name,
        amount: effect.value,
        duration: effect.duration,
        pipelineResume: resume || null,
      });
      return opened ? { status: 'window-open' } : { status: 'no-targets' };
    }
    // Phase-5 Priority-1 — powerDebuff. target is 'opponentLeader' /
    // 'opponentCharacter' / 'opponentLeaderOrCharacter'. amount is
    // stored positive on the effect; we negate it before applyTempPower.
    case 'powerDebuff': {
      const t = effect.target || 'opponentCharacter';
      const kind = t === 'opponentLeaderOrCharacter' ? 'leaderOrCharacter'
                 : t === 'opponentLeader' ? 'leader'
                 : 'character';
      const opened = openPowerBuffTarget(ctx.game, ctx.playerId, {
        side: 'opponent',
        targetKind: kind,
        optional: ctx._blockOptional != null ? ctx._blockOptional : (effect.optional !== false),
        sourceCardName: ctx.card.name,
        amount: -Math.abs(effect.value),
        duration: effect.duration,
        pipelineResume: resume || null,
      });
      return opened ? { status: 'window-open' } : { status: 'no-targets' };
    }
    // Phase-5 Priority-2 — playFromHand. Delegates to the existing
    // openPlayFromHand opener (which builds the candidate list from the
    // player's hand and opens playFromHandWindow). filter fields come
    // straight from the parsed effect shape.
    case 'playFromHand': {
      const filter = effect.filter || {};
      const opened = openPlayFromHand(ctx.game, ctx.playerId, {
        costThreshold: filter.maxCost != null ? filter.maxCost : 99,
        typeName: filter.affiliation || null,
        nameMatch: filter.name || null,
        sourceCardName: ctx.card.name,
        pipelineResume: resume || null,
      });
      return opened ? { status: 'window-open' } : { status: 'no-targets' };
    }

    // Phase 5 Priority 8 — suppression target (negate / attack-prevent /
    // blocker-ability-prevent). Opens the shared suppression window
    // which on resolution pushes a { kind, expiresAtTurn } entry onto
    // the chosen target's suppressions array.
    case 'suppressTarget': {
      const opened = openSuppressionTarget(ctx.game, ctx.playerId, {
        side: 'opponent',
        targetKind: effect.targetKind || 'leaderOrCharacter',
        kind: effect.kind || 'effects',
        duration: effect.duration || 'thisTurn',
        optional: ctx._blockOptional != null ? ctx._blockOptional : (effect.optional !== false),
        sourceCardName: ctx.card.name,
        filter: effect.filter || {},
        pipelineResume: resume || null,
      });
      return opened ? { status: 'window-open' } : { status: 'no-targets' };
    }

    // Phase 5 Priority 8 (3/3) — "Choose one:" branching. Opens the
    // chooseOneWindow with one entry per branch; availability is
    // pre-computed from each branch's own conditions (e.g. Doflamingo's
    // first branch gates on leader type). Player picks a branch; the
    // CHOOSE_ONE_SELECTED handler runs that branch's effects inline
    // with the outer pipelineResume threaded through the last effect.
    case 'chooseOne': {
      const branches = (effect.branches || []).map((b, i) => {
        const cond = agentCheckConditions(b.conditions || [], ctx);
        return {
          index: i,
          available: cond.ok,
          conditions: b.conditions || [],
          effects: b.effects || [],
          text: b.text || '',
        };
      });
      if (!branches.some(b => b.available)) {
        log(ctx.game, `${ctx.card.name}: no eligible branches for Choose One.`);
        return { status: 'no-targets' };
      }
      ctx.game.chooseOneWindow = {
        playerId: ctx.playerId,
        sourceCardName: ctx.card.name,
        sourceCardUid: ctx.card.uid,
        sourceCardId: ctx.card.id,
        branches,
        pipelineResume: resume || null,
      };
      log(ctx.game, `${ctx.card.name}: choose one branch (${branches.filter(b => b.available).length} available).`);
      return { status: 'window-open' };
    }

    // Phase 5 Priority 5 — meta-reference. "Activate this card's [X]
    // effect" runs the target timing's block effects on this card.
    // Snow Merchant is the canonical case: [Trigger] delegates to the
    // [Counter] block. We check the target block's conditions (but not
    // its costs — meta-refs typically skip the cost, "activate this
    // card's [X] effect" being a rules shortcut rather than a full
    // re-play). If the target has multiple effects only the first one's
    // window-open propagates; this covers every known card today.
    case 'activateOwnEffect': {
      const parsed = PARSED_EFFECTS.get(ctx.card.id);
      if (!parsed) return { status: 'applied' };
      const target = (parsed.effects || []).find(b => b.timing === effect.timing);
      if (!target) return { status: 'applied' };
      const cond = agentCheckConditions(target.conditions, ctx);
      if (!cond.ok) {
        console.log(`[AGENT-TRACE] ${ctx.card.name}: meta-ref target block condition failed: ${cond.reason}`);
        return { status: 'applied' };
      }
      // Thread target block's optional signal into ctx so downstream
      // pickers pick up the right skippability.
      const savedOptional = ctx._blockOptional;
      ctx._blockOptional = target.optional;
      try {
        for (const e of (target.effects || [])) {
          const res = agentApplyEffect(e, ctx, resume);
          if (res.status === 'window-open') return res;
          if (res.status === 'unsupported') return res;
          if (res.status === 'abort-block') return res;
        }
      } finally {
        ctx._blockOptional = savedOptional;
      }
      return { status: 'applied' };
    }

    // Phase-4 Batch 3 — scry ("Look at N cards from the top…"). Builds
    // the scryWindow directly from the parsed effect shape so the
    // client's existing SCRY_RESOLVE UI flow is reused as-is. Chain
    // resume threads through for any card that adds extra steps after
    // the placement.
    // Track-P partial — suppressOnPlay (Teach OP09-081 active):
    // pushes a timed suppression onto game._onPlaySuppressions so any
    // future onPlay fire-site check returns true for the target player.
    case 'suppressOnPlay': {
      if (!Array.isArray(ctx.game._onPlaySuppressions)) ctx.game._onPlaySuppressions = [];
      const oppId = Object.keys(ctx.game.players).find(id => id !== ctx.playerId);
      const targetPid = effect.side === 'opponent' ? oppId : ctx.playerId;
      const expiresAtTurn = effect.duration === 'opponentNextTurn'
        ? (ctx.game.turn + 1) : ctx.game.turn;
      ctx.game._onPlaySuppressions.push({ targetPlayerId: targetPid, expiresAtTurn });
      log(ctx.game, `${ctx.card.name}: opponent [On Play] abilities suppressed until turn ${expiresAtTurn}.`);
      return { status: 'applied' };
    }

    // Track-P partial — redirectAttack (Doflamingo OP14-060 leader):
    // opens a picker over the defender's own leader + filtered own
    // characters. On resolution, mutates battleState.targetUid to the
    // picked uid. Requires a live battleState.
    case 'redirectAttack': {
      if (!ctx.game.battleState || !ctx.game.battleState.targetUid) {
        return { status: 'applied' };  // nothing to redirect
      }
      const candidates = [];
      if (ctx.player.leader) candidates.push(ctx.player.leader);
      const filter = effect.filter || {};
      for (const c of (ctx.player.field || [])) {
        if (c.type !== 'CHARACTER') continue;
        if (filter.affiliation) {
          const aff = c.affiliation || '';
          if (!aff.toLowerCase().includes(filter.affiliation.toLowerCase())) continue;
        }
        candidates.push(c);
      }
      if (candidates.length === 0) return { status: 'no-targets' };
      ctx.game.attackRedirectWindow = {
        playerId: ctx.playerId,
        candidateUids: candidates.map(c => c.uid),
        sourceCardName: ctx.card.name,
        pipelineResume: resume || null,
      };
      log(ctx.game, `${ctx.card.name}: choose a redirect target (${candidates.length} option(s)).`);
      return { status: 'window-open' };
    }

    // Track-P partial — costDebuff (Stronger OP09-089): open an
    // opponent-character picker reusing powerBuffTargetWindow, then
    // have the resolver write into tempCostEffects when the window
    // is flagged mode='cost'.
    case 'costDebuff': {
      const opened = openPowerBuffTarget(ctx.game, ctx.playerId, {
        side: 'opponent', targetKind: 'character',
        optional: true,
        sourceCardName: ctx.card.name,
        amount: -Math.abs(effect.amount || 0),
        duration: effect.duration || 'thisTurn',
        pipelineResume: resume || null,
      });
      if (opened) ctx.game.powerBuffTargetWindow.mode = 'cost';
      return opened ? { status: 'window-open' } : { status: 'no-targets' };
    }

    // Track-P partial — Marco-style self-revive: pay an optional
    // trashFromHand cost, then move the source (currently in trash
    // from its [On K.O.]) back to the field. Uses the existing
    // trashFromHandWindow machinery with a _selfRevive marker so the
    // cost resolver can finalise the move.
    case 'selfRevive': {
      const opened = openTrashFromHand(ctx.game, ctx.playerId, {
        count: effect.costCount || 1,
        optional: true,
        filterType: effect.costType || null,
        sourceCardName: ctx.card.name,
        pipelineResume: resume || null,
      });
      if (!opened) return { status: 'applied' };
      // Stash revive details on the window so TRASH_FROM_HAND_RESOLVE
      // can move the source card after the cost is paid.
      ctx.game.trashFromHandWindow._selfRevive = {
        cardUid: ctx.card.uid,
        reviveState: effect.reviveState || 'rested',
        sourceName: ctx.card.name,
      };
      return { status: 'window-open' };
    }

    // Phase 8 — playSelf: move source card from hand to field as a
    // free play (Monk Matt's [Trigger] "Play this card"). When the
    // trigger is activated from a life reveal the card is in hand,
    // having been moved there by the life-reveal path.
    case 'playSelf': {
      const hidx = ctx.player.hand.findIndex(c => c.uid === ctx.card.uid);
      if (hidx === -1) {
        log(ctx.game, `${ctx.card.name}: not in hand — playSelf skipped.`);
        return { status: 'applied' };
      }
      const picked = ctx.player.hand.splice(hidx, 1)[0];
      picked.rested = false;
      picked.attachedDon = 0;
      picked.usedThisTurn = false;
      picked.playedThisTurn = true;
      ctx.player.field.push(picked);
      log(ctx.game, `${ctx.card.name}: played from life trigger for free.`);
      return { status: 'applied' };
    }

    // Phase 8 — giveDon: attach N DON!! cards to an own target. Takes
    // from donDeck. TODO: proper picker UI for the target; for now
    // auto-attaches to the source card (good enough for Newgate, the
    // only card using this today — a Newgate self-play typically
    // wants the boost on itself).
    case 'giveDon': {
      const want = effect.count || 1;
      const avail = Math.min(want, ctx.player.donDeck || 0);
      if (avail <= 0) {
        log(ctx.game, `${ctx.card.name}: no DON!! in deck — giveDon skipped.`);
        return { status: 'applied' };
      }
      ctx.player.donDeck -= avail;
      ctx.card.attachedDon = (ctx.card.attachedDon || 0) + avail;
      log(ctx.game, `${ctx.card.name}: attached ${avail} rested DON!! to self.`);
      return { status: 'applied' };
    }

    // Phase 8 — mandatory "Trash N cards from your hand" as an effect
    // (Caribou OP11-083). Opens trashFromHandWindow with optional=false
    // so the player must pick exactly N cards.
    case 'trashFromHandEffect': {
      const count = effect.count || 1;
      const opened = openTrashFromHand(ctx.game, ctx.playerId, {
        count, optional: false,
        sourceCardName: ctx.card.name,
        pipelineResume: resume || null,
      });
      return opened ? { status: 'window-open' } : { status: 'no-targets' };
    }

    // Phase 8 — conditional effect wrapper. Evaluates `effect.condition`
    // against the game state and runs `effect.effect` only if met.
    //   ownCharacterPowerMin — at least one own Character whose effective
    //     power (base + attached DON × 1000) meets the threshold.
    //   lastTargetMaxCost — the most-recently-picked target (stored on
    //     game._lastPickedTargetUid by the suppression window resolver)
    //     has cost ≤ the threshold.
    case 'conditionalEffect': {
      const cond = effect.condition || {};
      let met = false;
      if (cond.type === 'ownCharacterPowerMin') {
        const powerOf = (c) => (c.power || 0) + (c.attachedDon || 0) * 1000;
        met = (ctx.player.field || []).some(c => c.type === 'CHARACTER' && powerOf(c) >= cond.value);
      } else if (cond.type === 'lastTargetMaxCost') {
        const uid = ctx.game._lastPickedTargetUid;
        if (uid) {
          for (const pid of Object.keys(ctx.game.players)) {
            const pl = ctx.game.players[pid];
            const cand = (pl.field || []).find(c => c.uid === uid)
                       || (pl.leader && pl.leader.uid === uid ? pl.leader : null);
            if (cand && (cand.cost || 0) <= cond.value) { met = true; break; }
          }
        }
      }
      if (!met) {
        log(ctx.game, `${ctx.card.name}: conditional follow-up skipped (condition unmet).`);
        return { status: 'applied' };
      }
      return agentApplyEffect(effect.effect, ctx, resume);
    }

    // Phase 8 — K.O. the card referenced by game._lastPickedTargetUid
    // (Black Hole's "K.O. it" after the suppress pick).
    case 'koLastTarget': {
      const uid = ctx.game._lastPickedTargetUid;
      if (!uid) return { status: 'applied' };
      for (const pid of Object.keys(ctx.game.players)) {
        const pl = ctx.game.players[pid];
        const idx = (pl.field || []).findIndex(c => c.uid === uid);
        if (idx !== -1) {
          const target = pl.field[idx];
          // Track-P Phases 5/6 — protection + self-save gates.
          if (isRemovalProtected(target, ctx.playerId, ctx.game, 'ko')) {
            log(ctx.game, `${target.name}: immune to K.O. (follow-up).`);
            break;
          }
          if (tryAutoSelfSave(target, ctx.playerId, ctx.game, ctx.card.name)) break;
          const koed = pl.field.splice(idx, 1)[0];
          pl.trash.push(koed);
          log(ctx.game, `${ctx.card.name}: K.O.'d ${koed.name} (follow-up).`);
          triggerOnKO(ctx.game, pid, koed, ctx.playerId);
          break;
        }
      }
      return { status: 'applied' };
    }

    // Phase 8 — un-rest up to N rested DON!! cards in place. Synchronous;
    // doesn't touch the deck. Used by Rosinante's end-of-turn refresh.
    case 'setOwnDonActive': {
      const count = Math.min(effect.count || 0, ctx.player.donRested || 0);
      if (count <= 0) return { status: 'applied' };
      ctx.player.donRested -= count;
      ctx.player.donActive = (ctx.player.donActive || 0) + count;
      log(ctx.game, `${ctx.card.name}: set ${count} DON!! as active.`);
      return { status: 'applied' };
    }

    // Phase 8 — un-rest up to N of your own Characters matching the
    // filter (Katakuri OP11-067). For count=1 we open a restTarget-style
    // picker scoped to the owner's own field. Auto-resolves synchronously
    // when there is at most one eligible candidate.
    case 'setCharacterActive': {
      const filter = effect.filter || {};
      const restedEligible = (ctx.player.field || []).filter(c => {
        if (c.type !== 'CHARACTER') return false;
        if (!c.rested) return false;
        if (filter.minCost != null && (c.cost || 0) < filter.minCost) return false;
        if (filter.affiliation) {
          const aff = c.affiliation || '';
          if (!aff.toLowerCase().includes(filter.affiliation.toLowerCase())) return false;
        }
        return true;
      });
      if (restedEligible.length === 0) {
        log(ctx.game, `${ctx.card.name}: no eligible rested Characters to set active.`);
        return { status: 'applied' };
      }
      // Auto-pick up to max: simplest semantics — un-rest the first N
      // matching characters. Katakuri's end-of-turn use-case doesn't
      // warrant a picker UI; if future cards need selection we can
      // wrap this in a window.
      const n = Math.min(effect.max || 1, restedEligible.length);
      for (let i = 0; i < n; i++) restedEligible[i].rested = false;
      log(ctx.game, `${ctx.card.name}: set ${n} Character(s) as active.`);
      return { status: 'applied' };
    }

    // Phase 7 — play a Character card from trash (Kuzan ST27-003). Opens
    // playFromTrashWindow; resolver moves the picked card onto the
    // field and fires its onPlay pipeline (same as playFromHand).
    case 'playFromTrash': {
      const opened = openPlayFromTrash(ctx.game, ctx.playerId, {
        filter: effect.filter || {},
        rested: effect.rested === true,
        max: effect.max || 1,
        optional: effect.optional !== false,
        sourceCardName: ctx.card.name,
        pipelineResume: resume || null,
      });
      return opened ? { status: 'window-open' } : { status: 'no-targets' };
    }

    // Phase 7 — keyword grant. Pushes a { keyword, expiresAtTurn } entry
    // onto ctx.card.tempKeywords; hasRush / other keyword checks read
    // this list. doEnd prunes expired entries.
    case 'grantKeyword': {
      const expiresAtTurn = effect.duration === 'opponentNextTurn'
        ? (ctx.game.turn + 1) : ctx.game.turn;
      if (!Array.isArray(ctx.card.tempKeywords)) ctx.card.tempKeywords = [];
      ctx.card.tempKeywords.push({ keyword: effect.keyword, expiresAtTurn });
      log(ctx.game, `${ctx.card.name}: gains [${effect.keyword}] until turn ${expiresAtTurn}.`);
      return { status: 'applied' };
    }

    case 'scry': {
      const p = ctx.player;
      const lookCount = Math.min(effect.count || 0, p.deck.length);
      if (lookCount <= 0) {
        log(ctx.game, `${ctx.card.name}: deck empty, scry skipped.`);
        return { status: 'applied' };
      }
      const reveal = effect.reveal || {};
      const rFilter = reveal.filter || {};
      ctx.game.scryWindow = {
        playerId:       ctx.playerId,
        cards:          p.deck.splice(0, lookCount),
        keepCount:      reveal.count || 0,
        keepFilter:     rFilter.affiliation || null,
        keepCardType:   rFilter.type || null,
        keepExcludeName: rFilter.excludeName || null,
        cardName:       ctx.card.name,
        placement:      effect.placement || 'top',
        pipelineResume: resume || null,
      };
      log(ctx.game, `${ctx.card.name}: looking at top ${lookCount} cards…`);
      return { status: 'window-open' };
    }
    default:
      console.log('[AGENT-EFFECT] Effect type not yet in new pipeline:', effect.type, `(card ${ctx.card.name})`);
      return { status: 'unsupported' };
  }
}

// AGENT 6 — SEQUENCER. Supports mid-chain resume via opts.blockIndex /
// opts.effectIndex. When resuming mid-block (effectIndex > 0), we skip
// condition/cost re-evaluation for that block — those ran on the first
// pass. New blocks always re-run conditions/costs.
//
// When an effect opens a window, `resume` encodes the NEXT effect's
// position so resumePipeline picks up exactly where we left off.
function runPipeline(timing, game, playerId, card, opts = {}) {
  const parsed = PARSED_EFFECTS.get(card.id);
  if (!parsed) {
    console.log(`[AGENT-TRACE] ${card.name}: no parsed entry`);
    return { status: 'no-parsed-data' };
  }
  const player = game.players[playerId];
  const ctx = { game, playerId, card, player };
  const resumeBI = opts.blockIndex ?? 0;
  const resumeEI = opts.effectIndex ?? 0;
  const costsPaid = opts.costsPaid === true;
  if (!opts.isResume) console.log(`[AGENT-TRACE] ${card.name} pipeline firing for timing=${timing}`);
  else console.log(`[AGENT-TRACE] ${card.name} pipeline resuming at block=${resumeBI} effect=${resumeEI} costsPaid=${costsPaid}`);
  for (let bi = resumeBI; bi < parsed.effects.length; bi++) {
    const block = parsed.effects[bi];
    if (!agentCheckTiming(block, timing)) continue;
    // Skip condition/cost gates when we're resuming into this same block
    // mid-chain (effectIndex > 0) OR right after paying the cost
    // (costsPaid=true, effectIndex===0). New blocks always re-run gates.
    const skipGates = (bi === resumeBI && (resumeEI > 0 || costsPaid));
    if (!skipGates) {
      const cond = agentCheckConditions(block.conditions, ctx);
      if (!cond.ok) {
        console.log(`[AGENT-TRACE] ${card.name} ${timing} condition failed: ${cond.reason}`);
        continue;
      }
      // Cost agent gets a resume pointing at this block's first effect
      // with costsPaid:true, so the window resolver can jump straight
      // to effects on player input.
      const costResume = { timing, cardUid: card.uid, blockIndex: bi, effectIndex: 0, costsPaid: true };
      const paid = agentPayCosts(block.costs, ctx, costResume);
      if (paid.status !== 'paid') return paid;
    }
    // Thread block-level metadata into ctx so individual effect handlers
    // (bounceTarget / restTarget) can read their optionality from the
    // parsed "you may / up to" signal at the block boundary rather than
    // inferring it per effect.
    ctx._blockOptional = block.optional;
    const startEI = (bi === resumeBI ? resumeEI : 0);
    for (let ei = startEI; ei < (block.effects || []).length; ei++) {
      // Build the resume continuation BEFORE calling the effect agent so
      // the window opener can stash it. effectIndex + 1 points at the
      // next effect (or past-the-end, which a resume will treat as a
      // block boundary and advance to bi+1).
      const resume = { timing, cardUid: card.uid, blockIndex: bi, effectIndex: ei + 1 };
      const res = agentApplyEffect(block.effects[ei], ctx, resume);
      if (res.status === 'window-open') return res;
      if (res.status === 'unsupported') return res;
      // 'abort-block' — an effect signaled that the entire block should
      // stop (e.g. Anna of Brittany's restTarget when no opponent
      // character is active, per the "block activation entirely" spec).
      // Distinct from 'no-targets' which is a silent no-op that allows
      // subsequent effects to continue (Blessed Thy Men's koTarget →
      // addDon chain).
      if (res.status === 'abort-block') return res;
    }
  }
  return { status: 'done' };
}

// Resume the pipeline after a window resolves. Looks up the source card
// in leader/field/trash (event cards live in trash after play; onKO
// sources are in trash after KO).
function resumePipeline(game, playerId, resume) {
  const owner = game.players[playerId];
  if (!owner) return;
  const src = (owner.leader && owner.leader.uid === resume.cardUid) ? owner.leader
           : (owner.field || []).find(c => c.uid === resume.cardUid)
           || (owner.trash || []).find(c => c.uid === resume.cardUid);
  if (!src) {
    console.log('[AGENT-TRACE] resumePipeline — source card not found by uid', resume.cardUid);
    return;
  }
  return runPipeline(resume.timing, game, playerId, src, {
    blockIndex: resume.blockIndex,
    effectIndex: resume.effectIndex,
    costsPaid: resume.costsPaid === true,
    isResume: true,
  });
}

// Phase-5 Priority-8 — opens a target picker for a suppression effect.
// The chosen target gets a {kind, expiresAtTurn} entry pushed onto its
// `suppressions` array. Enforcement checks read these entries at every
// fire site (see isEffectsSuppressed / isAttackSuppressed /
// isBlockerAbilitySuppressed).
function openSuppressionTarget(game, playerId, opts) {
  const me  = game.players[playerId];
  const oppId = Object.keys(game.players).find(id => id !== playerId);
  const opp = game.players[oppId];
  const { side = 'opponent', targetKind = 'leaderOrCharacter',
          kind = 'effects', duration = 'thisTurn',
          optional = true, sourceCardName = '',
          filter = {}, pipelineResume = null } = opts || {};
  const pool = side === 'opponent' ? opp : me;
  let candidates = [];
  if (targetKind === 'leader' || targetKind === 'leaderOrCharacter') {
    if (pool.leader) candidates.push(pool.leader);
  }
  if (targetKind === 'character' || targetKind === 'leaderOrCharacter') {
    candidates.push(...(pool.field || []).filter(c => c.type === 'CHARACTER'));
  }
  // Apply cost/power filter (Limejuice: "power 4000 or less").
  candidates = candidates.filter(c => {
    if (filter.maxCost != null && (c.cost || 0) > filter.maxCost) return false;
    if (filter.maxPower != null && ((c.power || 0) + (c.attachedDon || 0) * 1000) > filter.maxPower) return false;
    return true;
  });
  if (candidates.length === 0) {
    log(game, `${sourceCardName}: no valid suppression targets (kind=${kind}).`);
    return false;
  }
  game.suppressionTargetWindow = {
    playerId,
    candidateUids: candidates.map(c => c.uid),
    optional, sourceCardName, kind, duration, side, targetKind,
    pipelineResume,
  };
  log(game, `${sourceCardName}: choose a target to suppress (${kind}, ${candidates.length} option(s)).`);
  return true;
}

// Phase-5 Priority-1 UI-agent surface — opens an interactive target
// picker for powerBuff / powerDebuff effects. `side` is 'self' or
// 'opponent'; `targetKind` is 'leader' | 'character' | 'leaderOrCharacter'.
// `amount` is signed (positive = buff, negative = debuff). On pick, the
// action handler applies a temp power effect to the chosen uid.
function openPowerBuffTarget(game, playerId, opts) {
  const me  = game.players[playerId];
  const oppId = Object.keys(game.players).find(id => id !== playerId);
  const opp = game.players[oppId];
  const { targetKind = 'leaderOrCharacter', side = 'self', optional = true,
          sourceCardName = '', amount = 0, duration = 'thisTurn',
          pipelineResume = null } = opts || {};
  const pool = side === 'opponent' ? opp : me;
  const candidates = [];
  if (targetKind === 'leader' || targetKind === 'leaderOrCharacter') {
    if (pool.leader) candidates.push(pool.leader);
  }
  if (targetKind === 'character' || targetKind === 'leaderOrCharacter') {
    candidates.push(...(pool.field || []).filter(c => c.type === 'CHARACTER'));
  }
  if (candidates.length === 0) {
    log(game, `${sourceCardName}: no valid ${side === 'opponent' ? 'opponent' : 'own'} ${targetKind} targets for power buff.`);
    return false;
  }
  game.powerBuffTargetWindow = {
    playerId,
    candidateUids: candidates.map(c => c.uid),
    optional, sourceCardName,
    amount, duration, side, targetKind,
    pipelineResume,
  };
  const sign = amount >= 0 ? '+' : '';
  log(game, `${sourceCardName}: choose a ${side === 'opponent' ? "opponent's " : ''}target for ${sign}${amount} power (${candidates.length} option(s)).`);
  return true;
}

// UI AGENT surface — opens the SELECT_BOTTOM_DECK_TARGET window on the
// game state so both clients receive it through the normal GAME_STATE
// broadcast. Candidates are CHARACTER cards on EITHER field that pass
// the filter (maxCost etc.) — target 'any' per the current parsed
// effect shape.
function openPlaceAtBottomWindow(game, playerId, opts) {
  const opp = game.players[Object.keys(game.players).find(id => id !== playerId)];
  const me  = game.players[playerId];
  const { filter = {}, optional = true, sourceCardName = '', sourceCardUid = null,
          max = 1, pipelineResume = null } = opts || {};
  const matches = (c) => {
    if (c.type !== 'CHARACTER') return false;
    if (filter.maxCost != null && (c.cost || 0) > filter.maxCost) return false;
    return true;
  };
  // Track-P Phase 5 — opponent-side anyRemoval protection filters out
  // Kuzan-style protected cards; Burgess (koOnly) is NOT protected here.
  const candidates = [...me.field.filter(matches),
    ...opp.field.filter(c => matches(c) && !isRemovalProtected(c, playerId, game, 'placeBottom'))];
  if (candidates.length === 0) {
    log(game, `${sourceCardName}: no valid targets to place at bottom of deck.`);
    return false;
  }
  game.placeAtBottomWindow = {
    playerId,
    candidateUids: candidates.map(c => c.uid),
    max, optional,
    sourceCardName, sourceCardUid,
    filter,
    pipelineResume,
  };
  log(game, `${sourceCardName}: choose a Character to place at the bottom of its owner's deck (${candidates.length} option(s)).`);
  return true;
}

// Guard so `require('./server')` from a test doesn't start the HTTP server
// or bind a port. The production entry point still runs `node server.js`
// which leaves require.main === module true.
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => console.log(`Boohawk TCG server running on port ${PORT}`));
}

// Test surface — exported only for the node --test harness. Everything
// here is already defined earlier in this file.
module.exports = {
  // Parser + cache
  parseAbility, PARSED_EFFECTS,
  parsePassive, PASSIVE_EFFECTS,
  // Phase-3/4 pipeline surface
  runPipeline, resumePipeline, triggerOnKO,
  // Phase-5 P8 suppression helpers
  isEffectsSuppressed, isAttackSuppressed, isBlockerAbilitySuppressed,
  isOnPlaySuppressed, isRemovalProtected,
  // Catalog
  CARD_DB, PRESET_DECKS,
  // Deck + game construction
  buildCustomDeck, buildDeckByName, createPlayerState, createGame,
  // Action + phase helpers
  handleAction, doRefresh, doDraw, doEnd, nextPhase,
  // Keyword detectors
  hasBlocker, hasRush, hasDoubleAttack, hasBanish,
  effectivePowerOf, effectiveCostOf, handPlayCostFor,
  counterValueOf,
  // Broadcast plumbing (tests replace clients.get(id).send with a spy)
  rooms, clients, send, broadcast, sendState,
};
