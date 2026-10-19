// ============================================================
// GET /api/quotes?stocks=AAPL,MSFT&crypto=BTC,ETH
// Live prices from Finnhub, fetched server-side so FINNHUB_API_KEY
// (Vercel env var) never reaches the browser.
//
// Response:
//   { quotes: { "stock:AAPL": { price, changePct, t }, "crypto:BTC": {...} },
//     missing: ["stock:XYZ"] }
// Prices are in USD (US stocks; crypto is quoted against USDT).
// Crypto symbols map to Binance pairs: BTC → BINANCE:BTCUSDT. Pass a
// full Finnhub symbol (with ":") to override, e.g. COINBASE:BTC-USD.
// ============================================================
const MAX_SYMBOLS = 25;
const SYMBOL_RE = /^[A-Z0-9.\-:]{1,30}$/;

function parseList(v) {
  return String(v || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
}

async function fetchQuote(symbol, key) {
  const r = await fetch('https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(symbol), {
    headers: { 'X-Finnhub-Token': key },
  });
  if (r.status === 429) throw Object.assign(new Error('rate limited'), { status: 429 });
  if (!r.ok) throw Object.assign(new Error('finnhub ' + r.status), { status: r.status });
  const q = await r.json();
  // Finnhub answers unknown symbols with all-zero fields.
  if (!q || typeof q.c !== 'number' || q.c <= 0) return null;
  return { price: q.c, changePct: typeof q.dp === 'number' ? q.dp : null, t: q.t ? q.t * 1000 : Date.now() };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  const key = process.env.FINNHUB_API_KEY;
  if (!key) return res.status(503).json({ error: 'FINNHUB_API_KEY is not set on this deployment' });

  const stocks = parseList(req.query && req.query.stocks);
  const crypto = parseList(req.query && req.query.crypto);
  const all = stocks.map(s => ['stock', s]).concat(crypto.map(s => ['crypto', s]));
  if (!all.length) return res.status(400).json({ error: 'pass ?stocks= and/or ?crypto=' });
  if (all.length > MAX_SYMBOLS) return res.status(400).json({ error: 'too many symbols (max ' + MAX_SYMBOLS + ')' });
  const bad = all.find(([, s]) => !SYMBOL_RE.test(s));
  if (bad) return res.status(400).json({ error: 'invalid symbol: ' + bad[1] });

  const quotes = {};
  const missing = [];
  let rateLimited = false;
  await Promise.all(all.map(async ([type, sym]) => {
    const finnhubSym = type === 'crypto' && sym.indexOf(':') === -1 ? 'BINANCE:' + sym + 'USDT' : sym;
    try {
      const q = await fetchQuote(finnhubSym, key);
      if (q) quotes[type + ':' + sym] = q;
      else missing.push(type + ':' + sym);
    } catch (e) {
      if (e.status === 429) rateLimited = true;
      missing.push(type + ':' + sym);
    }
  }));

  if (rateLimited && !Object.keys(quotes).length) {
    return res.status(429).json({ error: 'Finnhub rate limit hit, try again in a minute' });
  }
  // Let Vercel's CDN reuse a response for 30s so several open tabs or
  // devices don't each spend Finnhub's free-tier quota (60 calls/min).
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
  return res.status(200).json({ quotes, missing });
}
