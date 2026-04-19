// Shared boot script for index / game / deck-editor: random background
// image + lobby music with cross-page continuity. One <script> tag per page.
(function () {
  // ─── Background image (pick once per session, persists across nav) ───
  const REPO = 'https://raw.githubusercontent.com/MotherOf-Pearl/tcg/main/backgrounds/';
  const BACKGROUNDS = [
    REPO + 'toad-gob.png',
    REPO + 'toad-x-gob-2.png',
    REPO + 'dead-sam.png',
    REPO + 'shlawg.png',
    REPO + 'pissed-shlawg.png',
  ];
  if (BACKGROUNDS.length > 0) {
    let bgUrl;
    try { bgUrl = sessionStorage.getItem('boohaw_bg'); } catch (_) {}
    if (!bgUrl || BACKGROUNDS.indexOf(bgUrl) === -1) {
      bgUrl = BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)];
      try { sessionStorage.setItem('boohaw_bg', bgUrl); } catch (_) {}
    }
    const applyBg = () => {
      // Image-only — each page's CSS owns size/position/repeat/color.
      document.body.style.backgroundImage = `url('${bgUrl}')`;
      document.body.classList.add('has-random-bg');
    };
    if (document.body) applyBg();
    else document.addEventListener('DOMContentLoaded', applyBg, { once: true });
  }

  // ─── Background music (one shared track that resumes across pages) ───
  const MUSIC_BASE = 'https://raw.githubusercontent.com/MotherOf-Pearl/tcg/main/audio/music/';
  const TRACKS = [
    MUSIC_BASE + 'a-chance-meeting.mp3',
    MUSIC_BASE + 'a-winters-tale.mp3',
    MUSIC_BASE + 'around-the-fire.mp3',
  ];
  if (TRACKS.length === 0) return;

  // Resume the same track + position the previous page was at, otherwise pick fresh.
  let trackUrl;
  try { trackUrl = sessionStorage.getItem('currentTrack'); } catch (_) {}
  if (!trackUrl || TRACKS.indexOf(trackUrl) === -1) {
    trackUrl = TRACKS[Math.floor(Math.random() * TRACKS.length)];
    try { sessionStorage.setItem('currentTrack', trackUrl); } catch (_) {}
  }
  let startPos = 0;
  try {
    const v = parseFloat(sessionStorage.getItem('trackPosition'));
    if (!isNaN(v) && v >= 0) startPos = v;
  } catch (_) {}

  const isMuted  = () => { try { return localStorage.getItem('musicMuted') === '1'; } catch (_) { return false; } };
  const setMuted = (m) => { try { localStorage.setItem('musicMuted', m ? '1' : '0'); } catch (_) {} };

  const audio = new Audio(trackUrl);
  audio.loop    = true;
  audio.volume  = 0.3;
  audio.preload = 'auto';
  audio.muted   = isMuted();

  const tryPlay = () => {
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay blocked until first interaction */ });
  };

  // Seek to the saved position once metadata is in, then play.
  audio.addEventListener('loadedmetadata', () => {
    if (startPos > 0 && startPos < (audio.duration || Infinity)) {
      try { audio.currentTime = startPos; } catch (_) {}
    }
    tryPlay();
  }, { once: true });

  // Persist playback position so the next page resumes there. 1s cadence is
  // imperceptible and cheap; only writes while actually playing.
  setInterval(() => {
    if (!audio.paused && !audio.ended) {
      try { sessionStorage.setItem('trackPosition', String(audio.currentTime)); } catch (_) {}
    }
  }, 1000);

  // Mute button + first-interaction autoplay unlock.
  const isGamePage = /\/game\.html/i.test(location.pathname);
  const setup = () => {
    // Catch the first user gesture and force a play() — most browsers require
    // this before any media starts. Bind on capture so we run before app code
    // can call stopPropagation.
    const kick = () => {
      tryPlay();
      window.removeEventListener('click',      kick, true);
      window.removeEventListener('keydown',    kick, true);
      window.removeEventListener('touchstart', kick, true);
    };
    window.addEventListener('click',      kick, true);
    window.addEventListener('keydown',    kick, true);
    window.addEventListener('touchstart', kick, true);

    const btn = document.createElement('button');
    btn.id = 'musicToggleBtn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle background music');
    // game.html: bottom-right (top-right is occupied by Back to Main button).
    // Other pages: top-right.
    const posTop    = isGamePage ? 'bottom:16px'  : 'top:10px';
    const posRight  = isGamePage ? 'right:16px'   : 'right:10px';
    const zIndex    = isGamePage ? 'z-index:1000' : 'z-index:99999';
    btn.style.cssText = [
      'position:fixed', posTop, posRight, zIndex,
      'width:40px', 'height:40px',
      'border-radius:50%',
      'border:1px solid rgba(180,140,50,.55)',
      'background:rgba(20,12,4,.78)',
      'color:#f0d896',
      'font-size:20px', 'line-height:1',
      'display:flex', 'align-items:center', 'justify-content:center',
      'cursor:pointer',
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
      tryPlay();
    });
    document.body.appendChild(btn);
  };

  if (document.body) setup();
  else document.addEventListener('DOMContentLoaded', setup, { once: true });

  // ─── Universal button click sound (excludes card / non-button clicks) ───
  // Event delegation so dynamically-rendered buttons (game.html re-renders
  // its right-panel buttons every frame) get the sound automatically.
  const clickSound = new Audio('https://raw.githubusercontent.com/MotherOf-Pearl/tcg/main/audio/clicking.wav');
  clickSound.volume = 0.6;
  const wireClick = () => {
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('button')) {
        try { clickSound.currentTime = 0; clickSound.play().catch(() => {}); } catch (_) {}
      }
    }, true);
  };
  if (document.body) wireClick();
  else document.addEventListener('DOMContentLoaded', wireClick, { once: true });
})();
