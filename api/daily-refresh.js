// ============================================================
// GET /api/daily-refresh — run once a day by Vercel Cron (vercel.json).
//
// Reads the finance state from Supabase (app_state, key "finance"),
// re-prices every live holding (rows with sym + qty in nw:stocks /
// nw:crypto), appends one net-worth history point, builds the
// "what matters today" digest, and writes it all back. The pages
// mirror every "nw:" key, so open dashboards pick it up live and
// closed ones see it next time they load.
//
// Protected by CRON_SECRET: Vercel Cron sends
// "Authorization: Bearer <CRON_SECRET>"; anything else gets 401.
// ============================================================
import { finnhubKey, quotes, buildDigest, MAX_SYMBOLS } from '../lib/finnhub.js';
import { getState, putState } from '../lib/supabase.js';

const HISTORY_MAX = 500;
const LIVE_CATS = { 'nw:stocks': 'stock', 'nw:crypto': 'crypto' };
const VALUE_CATS = ['nw:bank', 'nw:stocks', 'nw:crypto', 'nw:other'];

async function usdPerChf() {
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/CHF');
    const d = await r.json();
    return d && d.rates && d.rates.USD > 0 ? d.rates.USD : null;
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET is not set' });
  if ((req.headers && req.headers.authorization) !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const key = finnhubKey();
  if (!key) return res.status(503).json({ error: 'FINNHUB_API_KEY is not set' });

  let row;
  try { row = await getState('finance'); }
  catch (e) { return res.status(502).json({ error: e.message }); }
  if (!row || !row.data) return res.status(200).json({ ok: true, skipped: 'no finance data yet' });
  const data = row.data;

  // Collect live holdings.
  const holdings = [];
  for (const [cat, type] of Object.entries(LIVE_CATS)) {
    for (const it of Array.isArray(data[cat]) ? data[cat] : []) {
      if (it && it.sym && Number(it.qty) > 0) holdings.push({ type, sym: String(it.sym).toUpperCase() });
    }
  }
  const uniq = (type) => Array.from(new Set(holdings.filter(h => h.type === type).map(h => h.sym)));
  const stocks = uniq('stock').slice(0, MAX_SYMBOLS);
  const crypto = uniq('crypto').slice(0, Math.max(0, MAX_SYMBOLS - stocks.length));
  if (!stocks.length && !crypto.length) return res.status(200).json({ ok: true, skipped: 'no live holdings' });

  const [q, fx] = await Promise.all([quotes(stocks, crypto, key), usdPerChf()]);

  // Re-price holdings (amounts are stored in CHF, like every other row).
  let priced = 0;
  for (const [cat, type] of Object.entries(LIVE_CATS)) {
    for (const it of Array.isArray(data[cat]) ? data[cat] : []) {
      if (!it || !it.sym) continue;
      const qt = q.quotes[type + ':' + String(it.sym).toUpperCase()];
      if (!qt) continue;
      it.px = qt.price; it.chg = qt.changePct; it.at = qt.t;
      if (fx) it.amount = (Number(it.qty) || 0) * qt.price / fx;
      priced++;
    }
  }

  // One history point per run (flagged p:1 like the page's price points).
  if (fx && priced) {
    let grand = 0;
    for (const cat of VALUE_CATS) for (const it of Array.isArray(data[cat]) ? data[cat] : []) grand += Number(it && it.amount) || 0;
    const hist = Array.isArray(data['nw:history']) ? data['nw:history'] : [];
    const last = hist[hist.length - 1];
    if (!last || Math.abs((last.v || 0) - grand) >= 0.005) {
      hist.push({ t: Date.now(), v: grand, p: 1 });
      if (hist.length > HISTORY_MAX) hist.splice(0, hist.length - HISTORY_MAX);
      data['nw:history'] = hist;
    }
  }

  const digest = await buildDigest(stocks.map(sym => ({ type: 'stock', sym })).concat(crypto.map(sym => ({ type: 'crypto', sym }))), q.quotes, key);
  data['nw:daily'] = { updatedAt: Date.now(), quotes: q.quotes, missing: q.missing, digest: digest.items };

  try { await putState('finance', data); }
  catch (e) { return res.status(502).json({ error: e.message }); }
  return res.status(200).json({ ok: true, holdings: stocks.length + crypto.length, priced, fx: !!fx, digestItems: digest.items.length });
}
