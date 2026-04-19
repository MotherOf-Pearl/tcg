// Shared boot script for index / game / deck-editor: random background
// image + lobby music with cross-page continuity. One <script> tag per page.
(function () {
  // ─── Background image (pick once per session, persists across nav) ───
  const REPO = 'https://raw.githubusercontent.com/MotherOf-Pearl/tcg/main/backgrounds/';
  const BACKGROUNDS = [
    REPO + 'toad-x-gob-2.png',
    REPO + 'bg3.png',
    REPO + 'bg4.png',
    REPO + 'bg6.png',
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

  const TARGET_VOL  = 0.3;
  const FADE_OUT_MS = 300;
  const FADE_IN_MS  = 500;

  const audio = new Audio(trackUrl);
  audio.loop    = true;
  audio.volume  = 0;          // start silent — fade up after playback begins
  audio.preload = 'auto';
  audio.muted   = isMuted();

  // Linear volume fade using rAF — runs disjoint from the playback engine, so
  // it never pauses or seeks the audio. `done` callback fires after the final
  // tick (used by the nav interceptor to defer navigation until the fade is
  // perceptually complete).
  const fadeAudio = (targetVol, durationMs, done) => {
    const startVol = audio.volume;
    const delta = Math.max(0, Math.min(1, targetVol)) - startVol;
    if (Math.abs(delta) < 0.001 || durationMs <= 0) {
      audio.volume = Math.max(0, Math.min(1, targetVol));
      if (done) done();
      return;
    }
    const startTime = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / durationMs);
      audio.volume = Math.max(0, Math.min(1, startVol + delta * t));
      if (t < 1) requestAnimationFrame(tick);
      else if (done) done();
    };
    requestAnimationFrame(tick);
  };

  // Fade in on the FIRST successful playback. `playing` fires every time the
  // audio (re)starts; { once: true } restricts us to the initial start, so a
  // pause/resume from mute toggling later won't trigger another fade.
  audio.addEventListener('playing', () => {
    fadeAudio(TARGET_VOL, FADE_IN_MS);
  }, { once: true });

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
    // Top-right corner on every page. On game.html the Back to Main button sits
    // at the top of the right column — we shift it down so the music button
    // never overlaps it. The shift uses a CSS rule rather than a JS layout hack
    // so a future redesign can override it cleanly.
    btn.style.cssText = [
      'position:fixed', 'top:8px', 'right:8px',
      'z-index:99999',
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

    // On game.html, push the right-column content down so the fixed music
    // button (top:8px, 40px tall) never overlaps Back to Main.
    if (isGamePage) {
      const style = document.createElement('style');
      style.id = 'musicBtnGameSpacer';
      style.textContent = '.gb-right-col .gb-right-top { margin-top: 52px !important; }';
      document.head.appendChild(style);
    }
  };

  if (document.body) setup();
  else document.addEventListener('DOMContentLoaded', setup, { once: true });

  // ─── Smooth cross-page navigation ────────────────────────────────────────
  // The browser destroys this page's <audio> element on unload, so the new
  // page has to recreate it from scratch — there's an unavoidable gap. What
  // we CAN do is make sure the saved position reflects the click moment (not
  // the last 1s tick of the position-save interval) and give the click-sound
  // 100ms to start before the page tears down.
  //
  // For this path to fire, nav controls must be either <a href="..."> or
  // <button data-href="...">. onclick="location.href=..." bypasses this and
  // navigates synchronously, before sessionStorage can flush.
  const saveMusicPosition = () => {
    try {
      sessionStorage.setItem('trackPosition', String(audio.currentTime || 0));
      sessionStorage.setItem('currentTrack', trackUrl);
    } catch (_) {}
  };
  const interceptNav = () => {
    document.addEventListener('click', (e) => {
      // Respect new-tab / new-window modifier clicks — don't hijack those.
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const link = e.target.closest('a[href], button[data-href]');
      if (!link) return;
      const href = link.getAttribute('data-href') || link.getAttribute('href');
      if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return;
      if (link.target === '_blank') return;
      e.preventDefault();
      saveMusicPosition();
      // Fade music out, THEN navigate. The fade doesn't touch the Audio
      // element's transport — volume only — so the position saved above
      // stays accurate (the audio keeps playing through the fade, just
      // silently tapering). The matching fade-in on the next page's Audio
      // element turns the transition into an intentional handoff rather
      // than a jump cut.
      fadeAudio(0, FADE_OUT_MS, () => { window.location.href = href; });
    }, true);
  };
  // Belt-and-suspenders: also save on pagehide / beforeunload so manual nav
  // (typed URL, back button, refresh) doesn't lose more than 1s of position.
  window.addEventListener('pagehide',     saveMusicPosition);
  window.addEventListener('beforeunload', saveMusicPosition);
  if (document.body) interceptNav();
  else document.addEventListener('DOMContentLoaded', interceptNav, { once: true });

  // ─── Universal button click sound (excludes card / non-button clicks) ───
  // Web Audio API path: the click runs on its own AudioContext, completely
  // disjoint from the HTMLAudioElement powering the music above. The decoded
  // PCM buffer is cached after the first fetch so subsequent clicks just spin
  // up a tiny BufferSource — no fetch, no decode, no Audio element churn, and
  // critically nothing that can pause / reset the music element.
  const CLICK_URL = 'https://raw.githubusercontent.com/MotherOf-Pearl/tcg/main/audio/clicking1.wav';
  const AC = window.AudioContext || window.webkitAudioContext;
  const audioCtx = AC ? new AC() : null;
  let clickBufferPromise = null;

  const loadClickBuffer = () => {
    if (!audioCtx) return Promise.reject(new Error('No AudioContext'));
    if (clickBufferPromise) return clickBufferPromise;
    clickBufferPromise = fetch(CLICK_URL)
      .then(r => r.arrayBuffer())
      .then(buf => audioCtx.decodeAudioData(buf))
      .catch(err => { clickBufferPromise = null; throw err; }); // allow retry
    return clickBufferPromise;
  };

  const playClickSound = async () => {
    if (!audioCtx) return;
    // Browsers often start the AudioContext suspended until a user gesture —
    // the click handler IS that gesture, so resume() is safe + cheap if already running.
    if (audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch (_) {}
    }
    const buffer = await loadClickBuffer();
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(audioCtx.destination);
    src.start(0);
  };

  // Kick off the buffer fetch eagerly (after DOM ready so we don't block paint)
  // — every subsequent click just plays from cache.
  const wireClick = () => {
    loadClickBuffer().catch(() => {});
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.closest || !t.closest('button')) return;
      playClickSound().catch(() => {});
    }, true);
  };
  if (document.body) wireClick();
  else document.addEventListener('DOMContentLoaded', wireClick, { once: true });
})();
