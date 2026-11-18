// Ayudas para hablar con Supabase por REST desde las pruebas (como lo haría un navegador).
const { cargarEnv } = require('./env');

const env = cargarEnv();
const URL_SB = env.SUPABASE_URL;
const KEY = env.SUPABASE_PUBLISHABLE_KEY;

async function pedir(metodo, ruta, o) {
  o = o || {};
  const h = Object.assign({ apikey: KEY, 'Content-Type': 'application/json' }, o.headers || {});
  if (o.token) h.Authorization = 'Bearer ' + o.token;
  const t0 = performance.now();
  const r = await fetch(URL_SB + ruta, { method: metodo, headers: h, body: o.body === undefined ? undefined : (typeof o.body === 'string' || o.body instanceof Uint8Array ? o.body : JSON.stringify(o.body)) });
  const ms = performance.now() - t0;
  const txt = await r.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch (e) { json = txt; }
  return { status: r.status, json, ms, headers: r.headers };
}

const rpc = (fn, body, token) => pedir('POST', '/rest/v1/rpc/' + fn, { body: body || {}, token });

const _tokens = {};
async function token(email, clave) {
  if (_tokens[email]) return _tokens[email];
  const r = await pedir('POST', '/auth/v1/token?grant_type=password', { body: { email, password: clave } });
  if (r.status !== 200) throw new Error('No se pudo iniciar sesión con ' + email + ': ' + JSON.stringify(r.json));
  _tokens[email] = r.json.access_token;
  return _tokens[email];
}
const tokens = async () => ({
  admin: await token(env.QA_ADMIN_EMAIL, env.QA_ADMIN_PASSWORD),
  editor: await token(env.QA_EDITOR_EMAIL, env.QA_EDITOR_PASSWORD),
  noadmin: await token(env.QA_NOADMIN_EMAIL, env.QA_NOADMIN_PASSWORD),
});

async function mgmt(ruta, metodo, body) {
  const r = await fetch('https://api.supabase.com/v1/projects/' + env.SUPABASE_PROJECT_REF + ruta, {
    method: metodo || 'GET',
    headers: { Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch (e) { json = txt; }
  return { status: r.status, json };
}

// Lista recursiva del bucket (necesita token de admin).
async function listarBucket(tok, prefijo) {
  const out = [];
  const r = await pedir('POST', '/storage/v1/object/list/negocios', { token: tok, body: { prefix: prefijo || '', limit: 1000, offset: 0 } });
  if (r.status !== 200) throw new Error('No se pudo listar el bucket: ' + r.status + ' ' + JSON.stringify(r.json));
  for (const o of r.json || []) {
    const ruta = (prefijo ? prefijo + '/' : '') + o.name;
    if (o.id === null) out.push(...await listarBucket(tok, ruta)); else out.push(ruta);
  }
  return out;
}

module.exports = { env, URL_SB, KEY, pedir, rpc, token, tokens, mgmt, listarBucket };
