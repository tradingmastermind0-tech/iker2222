// ============================================================
// GET /api/watchlist?symbols=OANDA:WTICO_USD,OANDA:EUR_USD
// Live price + daily change for trading-watchlist symbols (no
// quantities), plus today's high-impact USD / oil events from
// Finnhub's economic calendar when the plan allows it. Server-side
// so FINNHUB_API_KEY never reaches the browser.
//
// Response:
//   { quotes: { "OANDA:EUR_USD": { price, changePct, t } },
//     unsupported: [{ symbol, reason: "no access on this plan" | "no data" | ... }],
//     calendar: { available: true, events: [...] } | { available: false, reason } }
// ============================================================
import { finnhubKey } from '../lib/finnhub.js';

const BASE = 'https://finnhub.io/api/v1';
const WATCH_RE = /^[A-Z0-9.\-:_]{1,40}$/;
const MAX = 12;
// Oil-moving releases, matched on the event name (any impact level).
const OIL_EVENT = /crude|oil|eia|opec|gasoline|distillate|baker hughes|rig count/i;

async function finnhub(path, params, key) {
  const r = await fetch(BASE + path + '?' + new URLSearchParams(params), { headers: { 'X-Finnhub-Token': key } });
  let body = null;
  try { body = await r.json(); } catch (e) {}
  return { status: r.status, body };
}

function reasonFor(status) {
  if (status === 401 || status === 403) return 'no access on this plan';
  if (status === 429) return 'rate limited';
  return 'error ' + status;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  const key = finnhubKey();
  if (!key) return res.status(503).json({ error: 'FINNHUB_API_KEY is not set on this deployment' });

  const symbols = Array.from(new Set(String((req.query && req.query.symbols) || '')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean)));
  if (!symbols.length) return res.status(400).json({ error: 'pass ?symbols=' });
  if (symbols.length > MAX) return res.status(400).json({ error: 'too many symbols (max ' + MAX + ')' });
  const bad = symbols.find(s => !WATCH_RE.test(s));
  if (bad) return res.status(400).json({ error: 'invalid symbol: ' + bad });

  const quotes = {};
  const unsupported = [];
  await Promise.all(symbols.map(async symbol => {
    try {
      const { status, body } = await finnhub('/quote', { symbol }, key);
      if (status !== 200) return unsupported.push({ symbol, reason: reasonFor(status) });
      // Finnhub answers symbols it can't price with all-zero fields.
      if (!body || typeof body.c !== 'number' || body.c <= 0) return unsupported.push({ symbol, reason: 'no data' });
      quotes[symbol] = { price: body.c, changePct: typeof body.dp === 'number' ? body.dp : null, t: body.t ? body.t * 1000 : Date.now() };
    } catch (e) {
      unsupported.push({ symbol, reason: 'request failed' });
    }
  }));

  // Economic calendar: today's high-impact US events + oil releases.
  let calendar;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { status, body } = await finnhub('/calendar/economic', { from: today, to: today }, key);
    if (status !== 200) {
      calendar = { available: false, reason: reasonFor(status) };
    } else {
      const all = (body && body.economicCalendar) || [];
      const events = all
        .filter(e => e && ((e.country === 'US' && String(e.impact).toLowerCase() === 'high') || OIL_EVENT.test(e.event || '')))
        .map(e => ({ time: e.time, country: e.country, event: e.event, impact: e.impact, actual: e.actual, estimate: e.estimate, prev: e.prev, unit: e.unit }))
        .sort((a, b) => String(a.time).localeCompare(String(b.time)))
        .slice(0, 8);
      calendar = { available: true, events };
    }
  } catch (e) {
    calendar = { available: false, reason: 'request failed' };
  }

  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
  return res.status(200).json({ quotes, unsupported, calendar });
}
