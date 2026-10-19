// =============================================================
// Voice commands for the dashboard — free, no API keys.
// Uses the browser's built-in SpeechRecognition (Chrome, Edge,
// Safari) to listen and speechSynthesis to answer out loud.
//
// Loaded by topbar.js on every page. Adds a mic button to the top
// bar (or a floating one on pages without it, like finance).
//
// Commands (English or Spanish):
//   "open finances" / "abre finanzas"       → finance.html
//   "open gym" / "abre el gym"              → gym.html (also health, caffeine, water, home)
//   "show my watchlist" / "muestra mi watchlist"
//   "show my holdings"
//   "what's my net worth" / "cuánto es mi patrimonio"
//   "add 2.5 kg to bench" / "añade 2,5 kilos a press banca"  (also "remove 5 kg from squat")
//   "help" / "ayuda"
//   "speak spanish" / "habla en inglés"     → switch language
//
// Page-specific commands are sent as a `dash-voice` event; the page
// (gym.html, finance.html) handles it and sets detail.reply. If the
// current page doesn't handle it, the command is saved, we navigate
// to the right page, and it runs there on load.
// =============================================================
(function () {
  'use strict';
  if (window.__dashVoice) return;
  window.__dashVoice = true;
  try { if (window.self !== window.top) return; } catch (e) { return; }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const LANG_KEY = 'dash_voice_lang';
  const PENDING_KEY = 'dash_voice_pending';
  const PENDING_MAX_AGE = 30 * 1000;

  function getLang() {
    try { return localStorage.getItem(LANG_KEY) || 'en-US'; } catch (e) { return 'en-US'; }
  }
  function setLang(l) { try { localStorage.setItem(LANG_KEY, l); } catch (e) {} }
  const isEs = () => getLang().indexOf('es') === 0;
  const t = (en, es) => (isEs() ? es : en);

  // ---------------- UI ----------------
  const css = `
.dv-mic {
  display: inline-flex; align-items: center; justify-content: center;
  width: 44px; height: 42px; flex-shrink: 0;
  border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.04);
  border-radius: 12px; color: rgba(255,255,255,0.85); cursor: pointer;
  -webkit-tap-highlight-color: transparent; transition: background 0.15s, border-color 0.15s;
}
.dv-mic:hover { background: rgba(255,255,255,0.08); }
.dv-mic svg { width: 19px; height: 19px; }
.dv-mic.listening {
  color: #0a0a0b; background: #6ee7b7; border-color: #6ee7b7;
  animation: dv-pulse 1.3s ease-in-out infinite;
}
@keyframes dv-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(110,231,183,0.55); }
  50% { box-shadow: 0 0 0 7px rgba(110,231,183,0); }
}
.dv-mic.floating {
  position: fixed; z-index: 60; right: 14px; top: max(14px, env(safe-area-inset-top));
  background: rgba(17,17,19,0.92); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
@media (max-width: 480px) { .topbar .dv-mic { width: 40px; height: 38px; } }
.dv-toast {
  position: fixed; z-index: 61; left: 50%; top: max(64px, calc(env(safe-area-inset-top) + 56px));
  transform: translate(-50%, -8px); opacity: 0; pointer-events: none;
  width: min(92vw, 420px); box-sizing: border-box;
  padding: 12px 14px; border-radius: 14px;
  background: rgba(17,17,19,0.96); border: 1px solid rgba(255,255,255,0.12);
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
  color: #fafafa; transition: opacity 0.2s, transform 0.2s;
}
.dv-toast.show { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
.dv-toast-label {
  font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 9.5px; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.45);
}
.dv-toast-heard { font-size: 13px; color: rgba(255,255,255,0.6); margin-top: 4px; font-style: italic; }
.dv-toast-reply { font-size: 14px; margin-top: 6px; line-height: 1.4; }
.dv-toast-reply:empty, .dv-toast-heard:empty { display: none; }
.dv-flash { animation: dv-flash 1.6s ease-out; }
@keyframes dv-flash { 0% { box-shadow: 0 0 0 2px rgba(110,231,183,0.8); } 100% { box-shadow: 0 0 0 2px rgba(110,231,183,0); } }
`;
  const MIC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="21"/></svg>';

  let micBtn, toast, toastTimer;
  function mountUI() {
    if (document.getElementById('dvMic')) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    micBtn = document.createElement('button');
    micBtn.type = 'button';
    micBtn.id = 'dvMic';
    micBtn.className = 'dv-mic';
    micBtn.setAttribute('aria-label', 'Voice command');
    micBtn.title = 'Voice command — try "open gym" or "help"';
    micBtn.innerHTML = MIC_SVG;
    const bar = document.getElementById('topbar');
    if (bar) bar.insertBefore(micBtn, bar.firstChild);
    else { micBtn.classList.add('floating'); document.body.appendChild(micBtn); }
    micBtn.addEventListener('click', toggleListening);

    toast = document.createElement('div');
    toast.className = 'dv-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.innerHTML = '<div class="dv-toast-label"></div><div class="dv-toast-heard"></div><div class="dv-toast-reply"></div>';
    document.body.appendChild(toast);
  }
  function showToast(label, heard, reply, holdMs) {
    if (!toast) return;
    toast.querySelector('.dv-toast-label').textContent = label || '';
    toast.querySelector('.dv-toast-heard').textContent = heard ? '“' + heard + '”' : '';
    toast.querySelector('.dv-toast-reply').textContent = reply || '';
    toast.classList.add('show');
    clearTimeout(toastTimer);
    if (holdMs) toastTimer = setTimeout(() => toast.classList.remove('show'), holdMs);
  }

  // ---------------- Speech out ----------------
  function speak(text, onDone) {
    let finished = false;
    const done = () => { if (!finished) { finished = true; if (onDone) onDone(); } };
    if (!text || !window.speechSynthesis) { done(); return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = getLang();
      const voices = speechSynthesis.getVoices() || [];
      const v = voices.find(x => x.lang === u.lang) || voices.find(x => x.lang && x.lang.slice(0, 2) === u.lang.slice(0, 2));
      if (v) u.voice = v;
      u.rate = 1.05;
      u.onend = done; u.onerror = done;
      speechSynthesis.speak(u);
      // Safety net: some browsers never fire onend.
      setTimeout(done, Math.min(6000, 900 + text.length * 70));
    } catch (e) { done(); }
  }
  function answer(heard, reply, then) {
    showToast(t('Voice', 'Voz'), heard, reply, 6000);
    speak(reply, then);
  }

  // ---------------- Parsing ----------------
  const NUM_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, twenty: 20,
    uno: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, diez: 10, veinte: 20,
  };
  function parseAmount(s) {
    s = String(s || '').toLowerCase().trim()
      .replace(/\b(and a half|y medio)\b/, '.5').replace(/\bpoint\b|\bpunto\b|\bcoma\b/g, '.')
      .replace(/\s*\.\s*/g, '.');
    s = s.replace(/[a-záéíóú]+/g, w => (w in NUM_WORDS ? String(NUM_WORDS[w]) : w));
    const m = s.replace(',', '.').match(/\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }

  const PAGES = [
    { re: /\b(financ\w*|finanzas?|money|dinero|net ?worth|patrimonio)\b/, url: 'finance.html', en: 'finances', es: 'finanzas' },
    { re: /\b(gym|gim\w*|fitness|workout|entreno|entrenamiento)\b/, url: 'gym.html', en: 'the gym', es: 'el gym' },
    { re: /\b(water|agua)\b/, url: 'health.html#water', en: 'water', es: 'el agua' },
    { re: /\b(health|salud|supplements?|suplementos?)\b/, url: 'health.html', en: 'health', es: 'salud' },
    { re: /\b(caffeine|cafe[ií]na|coffee|caf[eé])\b/, url: 'caffeine.html', en: 'caffeine', es: 'cafeína' },
    { re: /\b(home|main|dashboard|inicio|principal)\b/, url: 'index.html', en: 'home', es: 'inicio' },
  ];

  // Returns a command object, or null if not understood.
  function parse(raw) {
    const s = String(raw || '').toLowerCase().replace(/[¿?¡!.]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!s) return null;

    if (/\b(help|what can (i|you) (say|do)|commands|ayuda|qué puedo decir|comandos)\b/.test(s)) return { action: 'help' };
    if (/\b(spanish|español|espanol)\b/.test(s) && /\b(speak|switch|talk|habla|cambia|en)\b/.test(s)) return { action: 'lang', lang: 'es-ES' };
    if (/\b(english|inglés|ingles)\b/.test(s) && /\b(speak|switch|talk|habla|cambia|en)\b/.test(s)) return { action: 'lang', lang: 'en-US' };

    // "add 2.5 kg to bench", "remove 5 kilos from squat", "añade 2,5 kilos a press banca"
    let m = s.match(/^(?:please |por favor )?(add|plus|put|increase|bump|añade|añadir|agrega|agregar|suma|sumar|sube|subir|pon|remove|minus|subtract|take off|decrease|drop|quita|quitar|resta|restar|baja|bajar)\s+(.+?)\s*(kg|kgs|kilo|kilos|kilogramos?|kilograms?)?\s+(?:to|on|onto|for|from|off|in|a|al|en|del|de|para)\s+(?:the |my |el |la |mi )?(.+)$/);
    if (m) {
      const amt = parseAmount(m[2]);
      if (!isNaN(amt) && amt > 0 && amt <= 100) {
        const neg = /^(remove|minus|subtract|take off|decrease|drop|quita|quitar|resta|restar|baja|bajar)$/.test(m[1]);
        return { action: 'gym-add-weight', page: 'gym.html', amount: neg ? -amt : amt, exercise: m[4].trim() };
      }
    }

    if (/\b(watch ?list|trading)\b/.test(s)) return { action: 'finance-show', section: 'watchlist', page: 'finance.html' };
    if (/\b(holdings?|portfolio|portafolio|cartera|my stocks|mis acciones)\b/.test(s)) return { action: 'finance-show', section: 'holdings', page: 'finance.html' };
    if (/\b(net ?worth|patrimonio|how much (do i have|money)|cu[aá]nto (dinero )?tengo)\b/.test(s) && !/^(open|go|abre|ve|ir)\b/.test(s)) {
      return { action: 'finance-networth', page: 'finance.html' };
    }

    // "open X", "go to X", "abre X", "show X" — or just the page name.
    const nav = s.replace(/^(open|go to|go|show( me)?|take me to|abre|abrir|ve a|ir a|ll[eé]vame a|muestra|ens[eé]ñame)\s+/, '')
      .replace(/^(the|my|el|la|mi|mis)\s+/, '');
    for (const p of PAGES) if (p.re.test(nav)) return { action: 'open', url: p.url, name: t(p.en, p.es) };
    return null;
  }

  // ---------------- Running commands ----------------
  function samePage(url) {
    const want = url.split('#')[0].toLowerCase();
    const path = (location.pathname || '').toLowerCase();
    if (want === 'index.html') return path === '/' || path.endsWith('/index.html') || path.endsWith('/index');
    return path.endsWith('/' + want) || path.endsWith('/' + want.replace('.html', ''));
  }
  function go(url, heard, reply) {
    answer(heard, reply, () => { location.href = url; });
  }

  // Ask the current page to handle it. Resolves to the reply text, or
  // null if no listener on this page took it.
  function dispatchToPage(cmd, heard) {
    const detail = Object.assign({}, cmd, { heard, lang: getLang(), handled: false, reply: '' });
    window.dispatchEvent(new CustomEvent('dash-voice', { detail }));
    if (!detail.handled) return Promise.resolve(null);
    return Promise.resolve(detail.replyPromise || detail.reply);
  }

  async function run(cmd, heard) {
    if (!cmd) {
      answer(heard, t('Sorry, I didn’t get that. Say “help” to hear what I can do.', 'Perdona, no te he entendido. Di “ayuda” para ver qué puedo hacer.'));
      return;
    }
    if (cmd.action === 'help') {
      answer(heard, t(
        'Try: open finances, open gym, show my watchlist, what’s my net worth, or add 2.5 kilos to bench.',
        'Prueba: abre finanzas, abre el gym, muestra mi watchlist, cuál es mi patrimonio, o añade 2,5 kilos a press banca.'));
      return;
    }
    if (cmd.action === 'lang') {
      setLang(cmd.lang);
      answer(heard, t('Okay, I’ll listen in English.', 'Vale, ahora te escucho en español.'));
      return;
    }
    if (cmd.action === 'open') {
      if (samePage(cmd.url) && !cmd.url.includes('#')) { answer(heard, t('You’re already on ' + cmd.name + '.', 'Ya estás en ' + cmd.name + '.')); return; }
      go(cmd.url, heard, t('Opening ' + cmd.name + '.', 'Abriendo ' + cmd.name + '.'));
      return;
    }
    // Page-specific: try here first, otherwise hand off to the right page.
    const reply = await dispatchToPage(cmd, heard);
    if (reply != null) { answer(heard, reply); return; }
    if (cmd.page && !samePage(cmd.page)) {
      try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ cmd, heard, at: Date.now() })); } catch (e) {}
      const where = cmd.page === 'gym.html' ? t('the gym', 'el gym') : t('finances', 'finanzas');
      go(cmd.page, heard, t('Opening ' + where + '.', 'Abriendo ' + where + '.'));
      return;
    }
    answer(heard, t('I can’t do that on this page.', 'No puedo hacer eso en esta página.'));
  }

  // A command handed over from another page: run it once this page's
  // scripts have registered their listeners.
  function runPending() {
    let p = null;
    try { p = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); sessionStorage.removeItem(PENDING_KEY); } catch (e) {}
    if (!p || !p.cmd || Date.now() - p.at > PENDING_MAX_AGE || !samePage(p.cmd.page || '')) return;
    let tries = 0;
    (function attempt() {
      dispatchToPage(p.cmd, p.heard).then(reply => {
        if (reply != null) answer(p.heard, reply);
        else if (++tries < 10) setTimeout(attempt, 300);
      });
    })();
  }

  // ---------------- Listening ----------------
  let rec = null, listening = false;
  function toggleListening() {
    if (listening) { try { rec.stop(); } catch (e) {} return; }
    if (!SR) {
      answer('', t('Voice commands need Chrome, Edge or Safari.', 'Los comandos de voz necesitan Chrome, Edge o Safari.'));
      return;
    }
    // Unlock speech output on this tap (some browsers need a gesture).
    try { speechSynthesis.cancel(); speechSynthesis.getVoices(); } catch (e) {}
    rec = new SR();
    rec.lang = getLang();
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.continuous = false;
    let finalText = '', alternatives = [];
    rec.onstart = () => {
      listening = true; micBtn.classList.add('listening');
      showToast(t('Listening…', 'Escuchando…'), '', t('Say “help” for ideas.', 'Di “ayuda” para ver ideas.'));
    };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          finalText += r[0].transcript;
          alternatives = Array.from(r).map(a => a.transcript);
        } else interim += r[0].transcript;
      }
      showToast(t('Listening…', 'Escuchando…'), (finalText || interim).trim(), '');
    };
    rec.onerror = (e) => {
      listening = false; micBtn.classList.remove('listening');
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        answer('', t('Microphone access is blocked. Allow it in your browser’s site settings.', 'El micrófono está bloqueado. Permítelo en los ajustes del sitio del navegador.'));
      } else if (e.error === 'no-speech') {
        showToast(t('Voice', 'Voz'), '', t('I didn’t hear anything.', 'No he oído nada.'), 2500);
      } else if (e.error !== 'aborted') {
        showToast(t('Voice', 'Voz'), '', t('Voice error: ', 'Error de voz: ') + e.error, 3500);
      }
    };
    rec.onend = () => {
      listening = false; micBtn.classList.remove('listening');
      const heard = finalText.trim();
      if (!heard) { if (toast && /Listening|Escuchando/.test(toast.textContent)) toast.classList.remove('show'); return; }
      // Use the first alternative that parses into a command.
      const tries = [heard].concat(alternatives.filter(a => a.trim() !== heard));
      let cmd = null;
      for (const a of tries) { cmd = parse(a); if (cmd) break; }
      run(cmd, heard);
    };
    try { rec.start(); } catch (e) { /* already started */ }
  }

  // Exposed for testing in the console: dashVoice.run("open gym")
  window.dashVoice = { parse, run: (text) => run(parse(text), text), speak };

  function boot() {
    mountUI();
    runPending();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
