// =============================================================
// Shared helpers for the Life Overview pages (school, skills,
// goals) and the home tiles. Exposes window.Life.
// Dates are local calendar days ("YYYY-MM-DD"); weeks start Monday.
// =============================================================
(function () {
  'use strict';
  const DAY = 86400000;

  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function uid(prefix) { return (prefix || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseDay(k) { const p = String(k).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  // Whole days from today to `k` (negative = overdue).
  function daysUntil(k) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((parseDay(k) - t) / DAY);
  }
  function weekStart(d) {
    d = new Date(d || new Date()); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    return d;
  }
  function weekKey(d) { return dayKey(weekStart(d)); }           // Monday's date
  function monthKey(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function inThisWeek(k) { const s = weekStart(); const d = parseDay(k); return d >= s && d < new Date(s.getTime() + 7 * DAY); }

  // "today", "tomorrow", "in 5d", "2d overdue" + a severity class.
  function countdown(k) {
    const n = daysUntil(k);
    const label = n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 1 ? 'in ' + n + 'd' : (-n) + 'd overdue';
    const cls = n <= 2 ? 'urgent' : n <= 7 ? 'soon' : '';
    return { n, label, cls };
  }
  function fmtDay(k) {
    return parseDay(k).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function fmtMin(m) {
    m = Math.round(m || 0);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60), r = m % 60;
    return r ? h + 'h ' + r + 'm' : h + 'h';
  }

  // Sync one storage key through the shared app_state table (sync.js).
  function sync(appKey, keys, onChange) {
    function go() {
      if (window.initCloudSync) window.initCloudSync({ appKey, syncedKeys: keys, onApplied: onChange });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
    else go();
  }

  window.Life = { load, save, uid, esc, dayKey, parseDay, daysUntil, weekStart, weekKey, monthKey, inThisWeek, countdown, fmtDay, fmtMin, sync, DAY };
})();
