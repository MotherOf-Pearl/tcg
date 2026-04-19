// Background lobby music — shared by index / game / deck-editor.
// Picks a random track per page load, loops it at 30% volume, and
// renders a small fixed mute toggle in the top-right of every page.
// Mute preference is persisted in localStorage so it survives navigation.
(function () {
  const REPO = 'https://raw.githubusercontent.com/MotherOf-Pearl/tcg/main/audio/music/';
  const TRACKS = [
    REPO + 'a-chance-meeting.mp3',
    REPO + 'a-winters-tale.mp3',
    REPO + 'around-the-fire.mp3',
  ];
  if (TRACKS.length === 0) return;

  const url = TRACKS[Math.floor(Math.random() * TRACKS.length)];
  const audio = new Audio(url);
  audio.loop    = true;
  audio.volume  = 0.3;
  audio.preload = 'auto';

  const isMuted = () => {
    try { return localStorage.getItem('musicMuted') === '1'; }
    catch (_) { return false; }
  };
  const setMuted = (m) => {
    try { localStorage.setItem('musicMuted', m ? '1' : '0'); } catch (_) {}
  };

  audio.muted = isMuted();

  const tryPlay = () => {
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => { /* autoplay blocked until first user interaction */ });
    }
  };

  // Browsers block autoplay until the user interacts. Try once now, then
  // retry on the first click/keydown so the music kicks in after the user
  // touches anything on the page.
  const setup = () => {
    tryPlay();
    const kick = () => {
      tryPlay();
      window.removeEventListener('click',   kick, true);
      window.removeEventListener('keydown', kick, true);
      window.removeEventListener('touchstart', kick, true);
    };
    window.addEventListener('click',      kick, true);
    window.addEventListener('keydown',    kick, true);
    window.addEventListener('touchstart', kick, true);

    // Mute toggle button
    const btn = document.createElement('button');
    btn.id = 'musicToggleBtn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle background music');
    btn.style.cssText = [
      'position:fixed', 'top:10px', 'right:10px',
      'width:40px', 'height:40px',
      'border-radius:50%',
      'border:1px solid rgba(180,140,50,.55)',
      'background:rgba(20,12,4,.78)',
      'color:#f0d896',
      'font-size:20px', 'line-height:1',
      'display:flex', 'align-items:center', 'justify-content:center',
      'cursor:pointer',
      'z-index:99999',
      'box-shadow:0 2px 8px rgba(0,0,0,.45)',
      'transition:transform .12s, background .12s',
      'user-select:none',
    ].join(';');
    const refresh = () => { btn.textContent = audio.muted ? '🔇' : '🎵'; };
    refresh();
    btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(40,24,8,.92)');
    btn.addEventListener('mouseleave', () => btn.style.background = 'rgba(20,12,4,.78)');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.muted = !audio.muted;
      setMuted(audio.muted);
      refresh();
      // Clicking the button counts as the autoplay-unlocking interaction too.
      tryPlay();
    });
    document.body.appendChild(btn);
  };

  if (document.body) setup();
  else document.addEventListener('DOMContentLoaded', setup, { once: true });
})();
