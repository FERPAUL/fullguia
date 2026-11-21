// FullGuia · Edge Function "youtube"
// Resuelve un enlace de canal (@usuario, /c/nombre, /user/nombre, /channel/UC…) a su ID (UC…), nombre y foto.
// Existe porque YouTube no permite leer esa página desde el navegador (CORS) y el embed de la
// transmisión en vivo de un canal necesita el ID. Solo responde a usuarios del panel (admin o editor).
//
// POST { ruta: '@usuario' | 'c/nombre' | 'user/nombre' | 'channel/UC…' }
//   → 200 { canal: 'UC…', titulo, miniatura }
//
// Seguridad: la URL que se consulta la arma esta función (siempre https://www.youtube.com/<ruta>)
// con una ruta validada por expresión regular: no se puede usar para pedir otras direcciones.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
// Los @usuario admiten letras con tilde, ñ, etc. Nunca '/', '?', '#', '%' ni espacios: la URL no se puede desviar.
const RUTA = /^(@[\p{L}\p{M}\p{N}._-]{3,30}|(c|user)\/[\p{L}\p{M}\p{N}._-]{1,100}|channel\/UC[A-Za-z0-9_-]{22})$/u;
const CANAL = /^UC[A-Za-z0-9_-]{22}$/;
const IMAGEN = /^https:\/\/(yt3\.ggpht\.com|yt3\.googleusercontent\.com|i[0-9]?\.ytimg\.com)\/[^\s"'<>\\]+$/;

function resp(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function entidades(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (m, n) => punto(Number(n), m)).replace(/&#x([0-9a-f]+);/gi, (m, n) => punto(parseInt(n, 16), m));
}

// Un número fuera de Unicode (entidad dañada) no rompe la función: se deja el texto tal cual.
function punto(n: number, original: string) {
  return Number.isInteger(n) && n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : original;
}

function meta(html: string, prop: string) {
  const m = new RegExp('<meta property="' + prop + '" content="([^"]*)"').exec(html);
  return m ? entidades(m[1]) : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resp(405, { error: 'Método no permitido' });

  // 1. ¿Es un usuario del panel?
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return resp(401, { error: 'Falta iniciar sesión' });
  const srv = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: quien, error: eQuien } = await srv.auth.getUser(token);
  if (eQuien || !quien?.user) return resp(401, { error: 'Sesión no válida' });
  const { data: yo } = await srv.from('admins').select('rol').eq('user_id', quien.user.id).maybeSingle();
  if (!yo) return resp(403, { error: 'Tu usuario no tiene acceso al panel' });

  // 2. Ruta del canal
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return resp(400, { error: 'Cuerpo inválido' }); }
  const ruta = String(body.ruta || '').trim();
  if (!RUTA.test(ruta)) return resp(400, { error: 'Enlace de canal no válido' });

  // 3. Página pública del canal (la cookie evita la pantalla de consentimiento de cookies)
  let html = '';
  try {
    const r = await fetch('https://www.youtube.com/' + encodeURI(ruta), {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (FullGuia panel)', 'Accept-Language': 'es-CO,es;q=0.9', Cookie: 'SOCS=CAI; CONSENT=YES+1' },
    });
    if (r.status === 404) return resp(404, { error: 'Ese canal no existe en YouTube' });
    if (!r.ok) return resp(502, { error: 'YouTube no respondió (' + r.status + '). Intenta de nuevo.' });
    html = await r.text();
  } catch {
    return resp(504, { error: 'YouTube tardó demasiado. Intenta de nuevo.' });
  }

  const canonico = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/.exec(html);
  const externo = /"externalId":"(UC[A-Za-z0-9_-]{22})"/.exec(html);
  const canal = (canonico && canonico[1]) || (externo && externo[1]) || '';
  if (!CANAL.test(canal)) return resp(422, { error: 'No se pudo leer el ID del canal. Pega el enlace de la transmisión o del video.' });
  const titulo = meta(html, 'og:title').slice(0, 120);
  const img = meta(html, 'og:image');
  return resp(200, { canal, titulo, miniatura: IMAGEN.test(img) && img.length <= 500 ? img : null });
});
