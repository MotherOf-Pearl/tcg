// Shared randomized background for index / game / deck-editor.
// One pick per browser session (sessionStorage) so navigating between
// pages keeps a consistent backdrop until the tab is closed.
(function () {
  const REPO = 'https://raw.githubusercontent.com/MotherOf-Pearl/tcg/main/backgrounds/';
  const BACKGROUNDS = [
    REPO + 'bg1.png',
    // Add more entries as new backgrounds land in /backgrounds/
  ];
  if (BACKGROUNDS.length === 0) return;

  let url;
  try {
    url = sessionStorage.getItem('boohaw_bg');
  } catch (e) { /* sessionStorage unavailable — fall through to fresh pick */ }
  if (!url || BACKGROUNDS.indexOf(url) === -1) {
    url = BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)];
    try { sessionStorage.setItem('boohaw_bg', url); } catch (e) {}
  }

  const apply = () => {
    document.body.style.backgroundImage    = `url('${url}')`;
    document.body.style.backgroundSize     = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundRepeat   = 'no-repeat';
    document.body.classList.add('has-random-bg');
  };
  if (document.body) apply();
  else document.addEventListener('DOMContentLoaded', apply, { once: true });
})();
