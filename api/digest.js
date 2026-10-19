// ============================================================
// GET /api/digest?stocks=AAPL,NVDA&crypto=BTC
// "What matters today" for the given holdings: earnings this week,
// big daily moves and the strongest headline per holding — max 5
// items. Built from Finnhub server-side (key stays on the server).
//
// Response: { items: [{ kind, sym, title, source?, url?, ... }], generatedAt }
// ============================================================
import { finnhubKey, parseList, quotes, buildDigest, SYMBOL_RE, MAX_SYMBOLS } from '../lib/finnhub.js';

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

  const q = await quotes(stocks, crypto, key);
  const holdings = stocks.map(sym => ({ type: 'stock', sym })).concat(crypto.map(sym => ({ type: 'crypto', sym })));
  const digest = await buildDigest(holdings, q.quotes, key);

  // News moves slowly; a 15-minute CDN cache keeps Finnhub calls low.
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=1800');
  return res.status(200).json(digest);
}
