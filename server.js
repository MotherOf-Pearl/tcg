const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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
    const file = path.join(__dirname, page);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(file).pipe(res);
  } else if (pathname === '/card-back.png') {
    const file = path.join(__dirname, 'card-back.png');
    res.writeHead(200, { 'Content-Type': 'image/png' });
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
  { id:'ST03-001', name:'Anna of Brittany', type:'LEADER', color:'Blue', attribute:'Special',
    power:5000, life:5, cost:0, counter:0, image:IMG('ST03','ST03-001','png'),
    ability:"[Activate: Main] Once per turn, you may rest 1 of your Characters: Draw 1 card." },

  { id:'OP01-077', name:'FiFi Cat', type:'CHARACTER', color:'Blue', attribute:'Special',
    power:1000, cost:2, counter:1000, image:IMG('OP01','OP01-077','png'),
    ability:"[On Play] Look at 5 cards from the top of your deck and return them to the top or bottom of the deck in any order." },

  { id:'OP01-079', name:'George the Brave', type:'CHARACTER', color:'Blue', attribute:'Special',
    power:1000, cost:3, counter:1000, image:IMG('OP01','OP01-079','png'),
    ability:"[Blocker] [On K.O.] If your Leader has the {Duchess of Brittany} type, add up to 1 Event from your trash to your hand." },

  { id:'OP01-083', name:'Jesse the Jester', type:'CHARACTER', color:'Blue', attribute:'Special',
    power:3000, cost:2, counter:1000, image:IMG('OP01','OP01-083','png'),
    ability:"[DON!! x1] [Your Turn] If your Leader has the {Duchess of Brittany} type, this Character gains +1000 power for every 2 Events in your trash." },

  { id:'OP01-084', name:'Queen Victoria', type:'CHARACTER', color:'Blue', attribute:'Special',
    power:4000, cost:3, counter:2000, image:IMG('OP01','OP01-084','png'),
    ability:"[DON!! x1] [When Attacking] Look at 5 cards from the top of your deck; reveal up to 1 {Duchess of Brittany} type Event card and add it to your hand. Then, place the rest at the bottom of your deck in any order." },

  { id:'OP01-085', name:'Sarra the Wise', type:'CHARACTER', color:'Blue', attribute:'Special',
    power:3000, cost:2, counter:1000, image:IMG('OP01','OP01-085','png'),
    ability:"[On Play] If your Leader has the {Duchess of Brittany} type, select up to 1 of your opponent's Characters with a cost of 4 or less. The selected Character cannot attack until the end of your opponent's next turn." },

  { id:'ST03-003', name:'Noble Shlawger', type:'CHARACTER', color:'Blue', attribute:'Special',
    power:6000, cost:5, counter:0, image:IMG('ST03','ST03-003','png'),
    ability:"[Blocker] [DON!! x1] [On Block] Place up to 1 Character with a cost of 2 or less at the bottom of the owner's deck." },

  { id:'ST03-014', name:'Ball the Berserk', type:'CHARACTER', color:'Blue', attribute:'Special',
    power:4000, cost:4, counter:1000, image:IMG('ST03','ST03-014','png'),
    ability:"[On Play] Return up to 1 Character with a cost of 3 or less to the owner's hand." },

  { id:'OP01-067', name:'Constable Anna', type:'CHARACTER', color:'Blue', attribute:'Special',
    power:7000, cost:7, counter:1000, image:IMG('OP01','OP01-067','png'),
    ability:"[Banish] [DON!! x1] Give blue Events in your hand -1 cost." },

  { id:'ST03-015', name:'Cig Break', type:'EVENT', color:'Blue',
    power:0, cost:4, counter:0, image:IMG('ST03','ST03-015','png'),
    ability:"[Main] Return up to 1 Character with a cost of 7 or less to the owner's hand. [Trigger] Activate this card's [Main] effect." },

  { id:'ST03-016', name:'Siege of Londinium', type:'EVENT', color:'Blue',
    power:0, cost:2, counter:0, image:IMG('ST03','ST03-016','png'),
    ability:"[Counter] Return up to 1 Character with a cost of 3 or less to the owner's hand. [Trigger] Activate this card's [Counter] effect." },

  { id:'ST03-017', name:'Leave Me To My Studies', type:'EVENT', color:'Blue',
    power:0, cost:2, counter:0, image:IMG('ST03','ST03-017','png'),
    ability:"[Counter] Up to 1 of your Leader or Character cards gains +4000 power during this battle. Then, draw 1 card if you have 3 or less cards in your hand." },

  { id:'OP01-087', name:'Snow Merchant', type:'EVENT', color:'Blue',
    power:0, cost:2, counter:0, image:IMG('OP01','OP01-087','png'),
    ability:"[Counter] Play up to 1 {Duchess of Brittany} type Character card with a cost of 3 or less from your hand. [Trigger] Activate this card's [Counter] effect." },

  { id:'OP01-090', name:'Schola Montis Belli', type:'STAGE', color:'Blue', attribute:'',
    power:0, cost:1, counter:0, image:IMG('OP01','OP01-090','png'),
    ability:"[Main] Look at 5 cards from the top of your deck; reveal up to 1 {Duchess of Brittany} type card other than [Schola Montis Belli] and add it to your hand. Then, place the rest at the bottom of your deck in any order." },

  // ══════════════════════════════
  // KAIDO RAMP DECK (Purple)
  // ══════════════════════════════
  { id:'ST04-001', name:'Kaido', type:'LEADER', color:'Purple', attribute:'Strike',
    power:5000, life:5, cost:0, counter:0, image:IMG('ST04','ST04-001','png'),
    ability:"[Activate: Main] [Once Per Turn] You may trash 1 of your Characters: Add up to 1 DON!! card from your DON!! deck and rest it." },

  { id:'OP01-100', name:'Kurozumi Higurashi', type:'CHARACTER', color:'Purple', attribute:'Wisdom',
    power:0, cost:1, counter:2000, image:IMG('OP01','OP01-100','png'),
    ability:"[On Play] Add up to 1 DON!! from your DON!! deck and rest it." },

  { id:'ST04-010', name:"Who's Who", type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:3000, cost:3, counter:2000, image:IMG('ST04','ST04-010','png'),
    ability:"" },

  { id:'OP01-101', name:'Sasaki', type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:4000, cost:3, counter:1000, image:IMG('OP01','OP01-101','png'),
    ability:"" },

  { id:'ST04-008', name:'Jack', type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:6000, cost:5, counter:1000, image:IMG('ST04','ST04-008','png'),
    ability:"" },

  { id:'ST04-002', name:'Ulti', type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:2000, cost:2, counter:1000, image:IMG('ST04','ST04-002','png'),
    ability:"" },

  { id:'ST04-012', name:'Page One', type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:3000, cost:2, counter:1000, image:IMG('ST04','ST04-012','png'),
    ability:"" },

  { id:'ST04-005', name:'Queen', type:'CHARACTER', color:'Purple', attribute:'Wisdom',
    power:5000, cost:4, counter:1000, image:IMG('ST04','ST04-005','png'),
    ability:"" },

  { id:'ST04-004', name:'King', type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:6000, cost:5, counter:0, image:IMG('ST04','ST04-004','png'),
    ability:"[On Play] Add up to 1 DON!! card from your DON!! deck and rest it." },

  { id:'OP01-096', name:'King', type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:7000, cost:6, counter:0, image:IMG('OP01','OP01-096','png'),
    ability:"[DON!! x1] [When Attacking] K.O. up to 1 of your opponent's Characters with 2000 power or less." },

  { id:'ST04-003', name:'Kaido', type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:8000, cost:7, counter:0, image:IMG('ST04','ST04-003','png'),
    ability:"[On Play] Add up to 1 DON!! card from your DON!! deck and rest it." },

  { id:'OP01-094', name:'Kaido', type:'CHARACTER', color:'Purple', attribute:'Strike',
    power:12000, cost:10, counter:0, image:IMG('OP01','OP01-094','png'),
    ability:"[Rush] [On Play] K.O. up to 1 of your opponent's Characters." },

  { id:'ST04-016', name:'Blast Breath', type:'EVENT', color:'Purple',
    power:0, cost:1, counter:0, image:IMG('ST04','ST04-016','png'),
    ability:"[Counter] Up to 1 of your Leader or Character cards gains +4000 power during this battle." },

  { id:'OP01-117', name:"Sheep's Horn", type:'EVENT', color:'Purple',
    power:0, cost:4, counter:0, image:IMG('OP01','OP01-117','png'),
    ability:"[Counter] Up to 1 of your Leader or Character cards gains +6000 power during this battle." },

  { id:'OP01-119', name:'Thunder Bagua', type:'EVENT', color:'Purple',
    power:0, cost:1, counter:0, image:IMG('OP01','OP01-119','png'),
    ability:"[Counter] Up to 1 of your Leader or Character cards gains +4000 power during this battle." },

  { id:'ST04-015', name:'Brachio Bomber', type:'EVENT', color:'Purple',
    power:0, cost:4, counter:0, image:IMG('ST04','ST04-015','png'),
    ability:"[Counter] Up to 1 of your Leader or Character cards gains +6000 power during this battle." },

  { id:'ST04-017', name:'Onigashima', type:'STAGE', color:'Purple', attribute:'',
    power:0, cost:1, counter:0, image:IMG('ST04','ST04-017','png'),
    ability:"[Activate: Main] You may rest this Stage: If you have 8 or more DON!! cards on your field, give up to 1 of your Characters +1000 power during this turn." },
];

// ─── PRESET DECKS ───
const PRESET_DECKS = {
  'Doflamingo': {
    leaderId: 'OP14-060',
    cards: [
      {id:'OP10-065',count:4},{id:'OP14-067',count:4},{id:'ST18-001',count:3},
      {id:'OP10-076',count:2},{id:'OP14-072',count:4},{id:'OP14-063',count:2},
      {id:'OP14-061',count:4},{id:'OP14-074',count:4},{id:'OP10-072',count:4},
      {id:'OP14-068',count:2},{id:'OP10-071',count:4},{id:'OP11-067',count:1},
      {id:'OP14-069',count:4},{id:'OP13-076',count:4},{id:'OP10-078',count:1},
      {id:'OP07-076',count:4},{id:'OP14-078',count:2},{id:'OP10-079',count:1},
    ]
  },
  'Shanks': {
    leaderId: 'OP09-001',
    cards: [
      {id:'OP09-002',count:4},{id:'OP01-006',count:4},{id:'OP09-008',count:2},
      {id:'OP09-011',count:4},{id:'OP09-014',count:2},{id:'OP12-008',count:4},
      {id:'OP09-015',count:3},{id:'OP10-011',count:1},{id:'PRB02-003',count:1},
      {id:'OP03-013',count:2},{id:'OP09-013',count:2},{id:'ST15-005',count:1},
      {id:'ST23-001',count:3},{id:'PRB02-002',count:1},{id:'OP09-009',count:4},
      {id:'ST15-002',count:1},{id:'OP08-118',count:4},{id:'ST23-002',count:1},
      {id:'OP06-007',count:3},{id:'OP09-004',count:2},{id:'OP09-021',count:1},
      {id:'OP04-016',count:1},{id:'OP10-019',count:2},{id:'OP09-020',count:1},
      {id:'OP01-026',count:1},{id:'OP10-018',count:1},{id:'ST21-017',count:1},
    ]
  },
  'Blackbeard': {
    leaderId: 'OP09-081',
    cards: [
      {id:'OP05-086',count:4},{id:'OP09-095',count:4},{id:'OP11-083',count:4},
      {id:'OP09-089',count:3},{id:'OP09-088',count:4},{id:'OP09-086',count:4},
      {id:'PRB02-015',count:1},{id:'OP10-082',count:4},{id:'OP09-084',count:1},
      {id:'ST27-003',count:4},{id:'OP09-093',count:4},{id:'OP09-096',count:4},
      {id:'OP09-097',count:1},{id:'OP09-098',count:4},{id:'OP09-099',count:4},
    ]
  },
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
  'Kaido Ramp': {
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
  if (!leader) return buildCustomDeck('OP14-060', PRESET_DECKS['Doflamingo'].cards);
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
  const preset = PRESET_DECKS[name] || PRESET_DECKS['Doflamingo'];
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
    : buildDeckByName('Doflamingo');
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
    [p1id]: createPlayerState(p1deck?.leaderId || 'OP14-060', p1deck?.cards || PRESET_DECKS['Doflamingo'].cards),
    [p2id]: createPlayerState(p2deck?.leaderId || 'OP09-001', p2deck?.cards || PRESET_DECKS['Shanks'].cards),
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
    drewCard: false,
    drewDon: false,
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
  const p = game.players[game.activePlayer];
  while (p.hand.length > 8) { p.trash.push(p.hand.pop()); }
  const ids = Object.keys(game.players);
  game.activePlayer = ids.find(id => id !== game.activePlayer);
  game.turn++;
  game.phase = 'DRAW';
  log(game, `--- Turn ${game.turn} begins ---`);
  doRefresh(game);
  // Player must manually draw card then DON
  game.drewCard = false;
  game.drewDon = false;
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

  if (cw.defenderIsLeader) {
    if (finalAttack > finalDefend) {
      if (defender.life.length > 0) {
        const lifeCard = defender.life.pop();
        defender.hand.push(lifeCard);
        log(game, `\uD83D\uDCA5 Life card flipped! ${lifeCard.name} added to hand. ${defender.life.length} life remaining.`);
        if (defender.life.length === 0) {
          game.winner = cw.attackerId;
          log(game, `\uD83C\uDFC6 ${cw.attackerId.slice(0,6)} WINS! Opponent has no life cards!`);
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
        game.phase = 'DRAW';
        doRefresh(game);
        // Turn 1 first player skips card draw, goes straight to DON
        game.drewCard = true; // skip draw on turn 1
        game.drewDon = false;
        log(game, 'Both players ready! Turn 1 begins. Draw DON to start.');
      }
      break;
    }

    case 'DRAW_CARD': {
      if (!isActive || game.phase !== 'DRAW' || game.drewCard) return;
      if (p.deck.length > 0) {
        p.hand.push(p.deck.shift());
        log(game, `${playerId.slice(0,6)} draws a card.`);
      }
      game.drewCard = true;
      break;
    }

    case 'DRAW_DON': {
      if (!isActive || game.phase !== 'DRAW' || game.drewDon) return;
      const amount = game.turn <= 2 ? 1 : 2;
      const added = Math.min(amount, p.donDeck);
      p.donDeck -= added;
      p.donActive += added;
      log(game, `${playerId.slice(0,6)} adds ${added} DON!!`);
      game.drewDon = true;
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
      } else if (card.type === 'STAGE') {
        card.rested = false;
        p.field.push(card);
        log(game, `${playerId.slice(0,6)} plays stage ${card.name}.`);
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

      game.counterWindow = {
        attackerUid: attacker.uid, defenderUid: defender.uid,
        attackPower, defendPower, defenderIsLeader,
        attackerId: playerId, defenderId: oppId,
      };
      game.counterDone = { [playerId]: true, [oppId]: false };
      log(game, `\uD83C\uDCF4 ${oppId.slice(0,6)} may play counter cards!`);
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
  const ab = card.ability;
  if (ab.includes('[On Play]') && ab.includes('Draw 1 card')) {
    const p = game.players[playerId];
    if (p.deck.length > 0) { p.hand.push(p.deck.shift()); log(game, `${card.name}: drew a card.`); }
  }
  if (ab.includes('[On Play]') && ab.includes('Draw 2 cards')) {
    const p = game.players[playerId];
    for (let i = 0; i < 2 && p.deck.length > 0; i++) p.hand.push(p.deck.shift());
    log(game, `${card.name}: drew 2 cards.`);
  }
  if (ab.includes('[On Play]') && ab.includes('rest up to 1') && ab.includes('opponent')) {
    const target = opp.field[0];
    if (target) { target.rested = true; log(game, `${card.name}: ${target.name} is rested!`); }
  }
  if (ab.includes('[On Play]') && ab.includes('K.O.') && ab.includes('3000')) {
    const target = opp.field.find(c => (c.power+(c.attachedDon||0)*1000) <= 3000);
    if (target) {
      opp.field = opp.field.filter(c => c.uid !== target.uid);
      opp.trash.push(target);
      log(game, `${card.name}: K.O.'d ${target.name}!`);
    }
  }
  if (ab.includes('[On Play]') && ab.includes('K.O.') && (ab.includes('6000') || ab.includes('5000')) && !ab.includes('3000')) {
    const threshold = ab.includes('6000') ? 6000 : 5000;
    const target = opp.field.find(c => (c.power+(c.attachedDon||0)*1000) <= threshold);
    if (target) {
      opp.field = opp.field.filter(c => c.uid !== target.uid);
      opp.trash.push(target);
      log(game, `${card.name}: K.O.'d ${target.name}!`);
    }
  }
  if (ab.includes('[On Play]') && (ab.includes('discard') || ab.includes('opponent discards'))) {
    if (opp.hand.length > 0) { opp.trash.push(opp.hand.shift()); log(game, `${card.name}: opponent discards!`); }
  }
}

function applyEventEffect(game, playerId, card, opp) {
  const p = game.players[playerId];
  const ab = card.ability;
  // Main K.O. by power
  if (ab.includes('[Main]') && ab.includes('K.O.') && !ab.startsWith('[Counter]')) {
    const m = ab.match(/(\d+000) [Pp]ower or less/);
    const threshold = m ? parseInt(m[1]) : 5000;
    const target = opp.field.find(c => (c.power+(c.attachedDon||0)*1000) <= threshold);
    if (target) {
      opp.field = opp.field.filter(c => c.uid !== target.uid);
      opp.trash.push(target);
      log(game, `${card.name}: K.O.'d ${target.name}!`);
    }
  }
  // Main K.O. by cost
  if (ab.includes('[Main]') && ab.includes('K.O.') && ab.includes('cost of') && !ab.startsWith('[Counter]')) {
    const m = ab.match(/cost of (\d+) or less/);
    const threshold = m ? parseInt(m[1]) : 4;
    const target = opp.field.find(c => (c.cost||0) <= threshold);
    if (target) {
      opp.field = opp.field.filter(c => c.uid !== target.uid);
      opp.trash.push(target);
      log(game, `${card.name}: K.O.'d ${target.name}!`);
    }
  }
  // Main draw
  if (ab.includes('[Main]') && ab.includes('Draw') && !ab.includes('opponent')) {
    const n = ab.includes('Draw 2') ? 2 : 1;
    for (let i = 0; i < n && p.deck.length > 0; i++) p.hand.push(p.deck.shift());
    log(game, `${card.name}: drew ${n} card(s).`);
  }
  // Main: look at top N, add card to hand
  if (ab.includes('[Main]') && ab.includes('Look at') && !ab.includes('[Counter]')) {
    if (p.deck.length > 0) { p.hand.push(p.deck.shift()); log(game, `${card.name}: searched top of deck.`); }
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
