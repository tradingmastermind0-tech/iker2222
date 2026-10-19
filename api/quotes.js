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
import { finnhubKey, parseList, quotes, SYMBOL_RE, MAX_SYMBOLS } from '../lib/finnhub.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  const key = finnhubKey();
  if (!key) return res.status(503).json({ error: 'FINNHUB_API_KEY is not set on this deployment' });

  const stocks = parseList(req.query && req.query.stocks);
  const crypto = parseList(req.query && req.query.crypto);
  const all = stocks.concat(crypto);
  if (!all.length) return res.status(400).json({ error: 'pass ?stocks= and/or ?crypto=' });
  if (all.length > MAX_SYMBOLS) return res.status(400).json({ error: 'too many symbols (max ' + MAX_SYMBOLS + ')' });
  const bad = all.find(s => !SYMBOL_RE.test(s));
  if (bad) return res.status(400).json({ error: 'invalid symbol: ' + bad });

  const r = await quotes(stocks, crypto, key);
  if (r.rateLimited && !Object.keys(r.quotes).length) {
    return res.status(429).json({ error: 'Finnhub rate limit hit, try again in a minute' });
  }
  // Let Vercel's CDN reuse a response for 30s so several open tabs or
  // devices don't each spend Finnhub's free-tier quota (60 calls/min).
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
  return res.status(200).json({ quotes: r.quotes, missing: r.missing });
}
