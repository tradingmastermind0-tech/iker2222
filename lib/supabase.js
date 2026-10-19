// ============================================================
// Minimal server-side access to the public.app_state table (the
// same one the pages sync through), using SUPABASE_URL and
// SUPABASE_ANON_KEY from the Vercel env vars.
// ============================================================
function cfg() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_ANON_KEY || '';
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY are not set');
  return { url: url.replace(/\/$/, ''), key };
}
function headers(key, extra) {
  return Object.assign({ apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, extra || {});
}

export async function getState(appKey) {
  const { url, key } = cfg();
  const r = await fetch(url + '/rest/v1/app_state?select=data,updated_at&key=eq.' + encodeURIComponent(appKey), { headers: headers(key) });
  if (!r.ok) throw new Error('supabase read ' + r.status);
  const rows = await r.json();
  return rows && rows[0] ? rows[0] : null;
}

export async function putState(appKey, data) {
  const { url, key } = cfg();
  const r = await fetch(url + '/rest/v1/app_state?on_conflict=key', {
    method: 'POST',
    headers: headers(key, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ key: appKey, data, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error('supabase write ' + r.status);
}
