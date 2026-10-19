// ============================================================
// Shared Finnhub helpers for the /api routes. Server-side only:
// FINNHUB_API_KEY is read here and sent as a request header, so it
// never appears in a URL, a response, or the browser.
// ============================================================
const BASE = 'https://finnhub.io/api/v1';
export const SYMBOL_RE = /^[A-Z0-9.\-:]{1,30}$/;
export const MAX_SYMBOLS = 25;

export function finnhubKey() {
  return process.env.FINNHUB_API_KEY || '';
}

export function parseList(v) {
  return Array.from(new Set(String(v || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)));
}

// Crypto rows store a coin (BTC); Finnhub prices it as a Binance USDT pair.
// A full Finnhub symbol (anything with ":") is used as-is.
export function finnhubSymbol(type, sym) {
  return type === 'crypto' && sym.indexOf(':') === -1 ? 'BINANCE:' + sym + 'USDT' : sym;
}

async function get(path, params, key) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(BASE + path + (qs ? '?' + qs : ''), { headers: { 'X-Finnhub-Token': key } });
  if (r.status === 429) throw Object.assign(new Error('rate limited'), { status: 429 });
  if (!r.ok) throw Object.assign(new Error('finnhub ' + r.status), { status: r.status });
  return r.json();
}

export async function quote(type, sym, key) {
  const q = await get('/quote', { symbol: finnhubSymbol(type, sym) }, key);
  // Finnhub answers unknown symbols with all-zero fields.
  if (!q || typeof q.c !== 'number' || q.c <= 0) return null;
  return { price: q.c, changePct: typeof q.dp === 'number' ? q.dp : null, t: q.t ? q.t * 1000 : Date.now() };
}

// { "stock:AAPL": {price, changePct, t}, ... } plus the keys that failed.
export async function quotes(stocks, crypto, key) {
  const all = stocks.map(s => ['stock', s]).concat(crypto.map(s => ['crypto', s]));
  const out = {}, missing = [];
  let rateLimited = false;
  await Promise.all(all.map(async ([type, sym]) => {
    try {
      const q = await quote(type, sym, key);
      if (q) out[type + ':' + sym] = q; else missing.push(type + ':' + sym);
    } catch (e) {
      if (e.status === 429) rateLimited = true;
      missing.push(type + ':' + sym);
    }
  }));
  return { quotes: out, missing, rateLimited };
}

// ------------------------------------------------------------
// DIGEST — "what matters today" for a set of holdings, max 5 items.
// Priority: earnings in the next 2 days → big price moves → earnings
// later this week → the strongest news headline per holding.
// ------------------------------------------------------------
const DAY = 86400000;
const ymd = d => d.toISOString().slice(0, 10);

const BIG_MOVE = { stock: 4, crypto: 6 }; // |day change %| that counts as news
const NEWS_MAX_AGE_MS = 36 * 3600 * 1000;
const NEWS_MIN_SCORE = 3;

// Headline keywords that usually move a price, with rough weights.
const KEYWORDS = [
  [/\b(earnings|quarterly results|q[1-4] results)\b/i, 3],
  [/\b(guidance|outlook|forecast)\b/i, 3],
  [/\b(beats?|miss(es|ed)?|tops estimates|falls short)\b/i, 3],
  [/\b(upgrades?|downgrades?|price target)\b/i, 2],
  [/\b(acquir\w*|acquisition|merger|takeover|buyout|deal to buy)\b/i, 4],
  [/\b(lawsuit|sued|probe|investigation|antitrust|sec\b|doj\b|fine[sd]?)\b/i, 3],
  [/\b(fda|approval|recall|halt(ed)?)\b/i, 3],
  [/\b(layoffs?|job cuts|ceo|resigns?|steps down)\b/i, 3],
  [/\b(dividend|buyback|repurchase|stock split)\b/i, 2],
  [/\b(plunges?|soars?|surges?|tumbles?|sinks?|skyrockets?|crash(es)?|record high|all-time high)\b/i, 2],
  [/\b(etf|halving|hack(ed)?|exploit|ban|regulat\w*)\b/i, 2],
];
const OPINION = /\?\s*$|\b(is it a buy|should you|better buy|buy (now|today|right now)|stocks? to (buy|watch|own)|what investors should know|valuation getting|motley fool|here'?s why|reasons? to)\b/i;
const TOP_SOURCES = /reuters|bloomberg|cnbc|wsj|wall street journal|financial times|marketwatch|barron|yahoo|coindesk|the block/i;

const COIN_NAMES = {
  BTC: 'bitcoin', ETH: 'ethereum|ether', SOL: 'solana', XRP: 'xrp|ripple', ADA: 'cardano',
  DOGE: 'dogecoin', BNB: 'bnb|binance coin', AVAX: 'avalanche', DOT: 'polkadot', LINK: 'chainlink',
  MATIC: 'polygon', LTC: 'litecoin', TRX: 'tron', TON: 'toncoin',
};

// Finnhub tags articles to tickers loosely (an IBM story under MSFT),
// so a headline only counts if it names the company or its ticker.
const ALIASES = { GOOGL: ['google'], GOOG: ['google'], META: ['facebook', 'instagram'], BRK: ['berkshire'] };
const NAME_SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|holdings?|group|class [a-z]|n\.?v|s\.?a|ag|se)\b\.?/gi;
const nameCache = new Map(); // survives between invocations on a warm function
async function companyMatcher(sym, key) {
  if (!nameCache.has(sym)) {
    let name = '';
    try { const p = await get('/stock/profile2', { symbol: sym }, key); name = (p && p.name) || ''; } catch (e) {}
    nameCache.set(sym, name);
  }
  const clean = nameCache.get(sym).replace(NAME_SUFFIX, ' ').replace(/[^\w\s&'-]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = [sym.replace(/[.\-].*$/, '')];
  if (clean) { words.push(clean); if (clean.split(' ')[0].length >= 4) words.push(clean.split(' ')[0]); }
  (ALIASES[sym] || []).forEach(a => words.push(a));
  const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b(' + Array.from(new Set(words)).map(esc).join('|') + ')\\b', 'i');
}

function scoreHeadline(n, now) {
  const text = (n.headline || '') + ' ' + (n.summary || '');
  let s = 0;
  for (const [re, w] of KEYWORDS) if (re.test(text)) s += w;
  if (TOP_SOURCES.test(n.source || '')) s += 1;
  // Opinion / advice pieces aren't news: "Is it a buy?", "3 stocks to watch".
  if (OPINION.test(n.headline || '')) s -= 4;
  const ageH = (now - (n.datetime || 0) * 1000) / 3600000;
  if (ageH < 12) s += 1;
  return s;
}

function whenLabel(dateStr, hour, today) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const diff = Math.round((d - new Date(ymd(today) + 'T12:00:00Z')) / DAY);
  const day = diff === 0 ? 'today' : diff === 1 ? 'tomorrow'
    : d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const h = hour === 'bmo' ? 'before open' : hour === 'amc' ? 'after close' : '';
  return { day, h, diff };
}

/**
 * holdings: [{ type: 'stock'|'crypto', sym }]
 * quoteMap: result.quotes from quotes() (optional, used for big moves)
 * Returns { items: [...max 5], generatedAt }.
 */
export async function buildDigest(holdings, quoteMap, key, now = Date.now()) {
  const today = new Date(now);
  const stocks = Array.from(new Set(holdings.filter(h => h.type === 'stock').map(h => h.sym)));
  const crypto = Array.from(new Set(holdings.filter(h => h.type === 'crypto').map(h => h.sym)));
  const candidates = [];

  // Earnings this week (one calendar call covers every holding).
  if (stocks.length) {
    try {
      const cal = await get('/calendar/earnings', { from: ymd(today), to: ymd(new Date(now + 7 * DAY)) }, key);
      const held = new Set(stocks);
      for (const e of (cal && cal.earningsCalendar) || []) {
        if (!held.has(e.symbol)) continue;
        const w = whenLabel(e.date, e.hour, today);
        if (w.diff < 0) continue;
        const est = typeof e.epsEstimate === 'number' ? ' · EPS est. ' + e.epsEstimate.toFixed(2) : '';
        candidates.push({
          kind: 'earnings', sym: e.symbol, rank: w.diff <= 1 ? 100 - w.diff : 60 - w.diff,
          title: e.symbol + ' reports earnings ' + w.day + (w.h ? ' (' + w.h + ')' : '') + est,
          date: e.date,
        });
      }
    } catch (e) { /* calendar is optional */ }
  }

  // Big daily moves.
  for (const [k, q] of Object.entries(quoteMap || {})) {
    const [type, sym] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    if (!q || typeof q.changePct !== 'number') continue;
    if (Math.abs(q.changePct) >= BIG_MOVE[type]) {
      candidates.push({
        kind: 'move', sym, rank: 80 + Math.min(Math.abs(q.changePct), 15),
        title: sym + (q.changePct >= 0 ? ' up ' : ' down ') + Math.abs(q.changePct).toFixed(1) + '% today',
        changePct: q.changePct,
      });
    }
  }

  // Company news, last ~36h, best-scoring headline per stock.
  const from = ymd(new Date(now - 2 * DAY)), to = ymd(today);
  await Promise.all(stocks.map(async sym => {
    try {
      const [news, about] = await Promise.all([get('/company-news', { symbol: sym, from, to }, key), companyMatcher(sym, key)]);
      const best = (Array.isArray(news) ? news : [])
        .filter(n => n.headline && now - n.datetime * 1000 <= NEWS_MAX_AGE_MS && about.test(n.headline))
        .map(n => ({ n, s: scoreHeadline(n, now) }))
        .filter(x => x.s >= NEWS_MIN_SCORE)
        .sort((a, b) => b.s - a.s || b.n.datetime - a.n.datetime)[0];
      if (best) candidates.push(newsItem(sym, best.n, best.s));
    } catch (e) { /* skip this symbol */ }
  }));

  // Crypto news is one general feed; keep headlines that name a held coin.
  if (crypto.length) {
    try {
      const news = await get('/news', { category: 'crypto' }, key);
      for (const sym of crypto) {
        const base = sym.indexOf(':') === -1 ? sym : sym.split(':')[1].replace(/USDT?$|-USD$/, '');
        const re = new RegExp('\\b(' + base + (COIN_NAMES[base] ? '|' + COIN_NAMES[base] : '') + ')\\b', 'i');
        const best = (Array.isArray(news) ? news : [])
          .filter(n => n.headline && now - n.datetime * 1000 <= NEWS_MAX_AGE_MS && re.test(n.headline + ' ' + (n.summary || '')))
          .map(n => ({ n, s: scoreHeadline(n, now) }))
          .filter(x => x.s >= NEWS_MIN_SCORE)
          .sort((a, b) => b.s - a.s || b.n.datetime - a.n.datetime)[0];
        if (best) candidates.push(newsItem(sym, best.n, best.s));
      }
    } catch (e) { /* skip crypto news */ }
  }

  // Rank, de-duplicate near-identical headlines, cap at 5.
  const seen = new Set();
  const items = candidates
    .sort((a, b) => b.rank - a.rank)
    .filter(c => {
      const k = c.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').slice(0, 60);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    })
    .slice(0, 5)
    .map(({ rank, ...rest }) => rest);
  return { items, generatedAt: now };
}

function newsItem(sym, n, score) {
  return {
    kind: 'news', sym, rank: 40 + score,
    title: String(n.headline).slice(0, 160),
    source: n.source || '', url: /^https?:\/\//.test(n.url || '') ? n.url : '',
    datetime: n.datetime * 1000,
  };
}
