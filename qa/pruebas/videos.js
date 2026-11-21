// R29 · Galería de videos contra el proyecto real: RLS por rol, validaciones de la base, RPC del inicio,
// versión de datos, datos demo y la Edge Function "youtube" (resuelve canales @usuario).
const { pedir, rpc, tokens } = require('../lib/supa');
const { conectar } = require('../lib/db');

const MARCA = 'QA-VID';
const azar = () => Math.random().toString(36).slice(2, 8).padEnd(6, 'x');

module.exports = async function (ctx) {
  const T = await tokens();
  const db = await conectar();
  const ok2 = (s) => s >= 200 && s < 300;
  const bloqueado = (r) => r.status === 401 || r.status === 403 || (ok2(r.status) && Array.isArray(r.json) && r.json.length === 0);
  const limpiar = () => db.query('delete from public.videos where titulo like $1', [MARCA + '%']);
  const ins = (tok, body) => pedir('POST', '/rest/v1/videos', { token: tok, body, headers: { Prefer: 'return=representation' } });
  const vid = (titulo, o) => Object.assign({ tipo: 'video', ref: 'QAv' + azar() + 'zz', titulo: MARCA + ' ' + titulo }, o || {});
  try {
    await limpiar();
    // --- Estructura ---
    const t = (await db.query("select relrowsecurity rls from pg_class where oid = 'public.videos'::regclass")).rows[0];
    ctx.ok('R29', 'La tabla videos existe y tiene RLS activado', t && t.rls);

    // --- Administrador y editor escriben ---
    const v0 = await db.query('select public.version_datos() v');
    const a = await ins(T.admin, [vid('Activo', { activo: true, orden: 100001 }), vid('Oculto', { activo: false, orden: 100002 })]);
    ctx.ok('R29', 'El administrador agrega videos', a.status === 201 && a.json.length === 2, 'HTTP ' + a.status + (a.status !== 201 ? ' ' + JSON.stringify(a.json) : ''));
    if (a.status !== 201) return;
    const [activo, oculto] = a.json;
    const v1 = await db.query('select public.version_datos() v');
    ctx.ok('R29', 'Agregar un video sube la versión de datos (la caché del sitio se entera)', v0.rows[0].v !== v1.rows[0].v, v0.rows[0].v + ' → ' + v1.rows[0].v);
    const e1 = await ins(T.editor, vid('Editor', { orden: 100003 }));
    ctx.ok('R29', 'El editor también agrega videos', e1.status === 201, 'HTTP ' + e1.status);
    const e2 = await pedir('PATCH', '/rest/v1/videos?id=eq.' + activo.id, { token: T.editor, body: { titulo: MARCA + ' Activo editado' }, headers: { Prefer: 'return=representation' } });
    ctx.ok('R29', 'El editor edita videos', ok2(e2.status) && e2.json.length === 1, 'HTTP ' + e2.status);
    if (e1.status === 201) {
      const e3 = await pedir('DELETE', '/rest/v1/videos?id=eq.' + e1.json[0].id, { token: T.editor, headers: { Prefer: 'return=representation' } });
      ctx.ok('R29', 'El editor quita videos', ok2(e3.status) && e3.json.length === 1, 'HTTP ' + e3.status);
    }

    // --- Visitante ---
    const vis = await pedir('GET', '/rest/v1/videos?select=titulo,activo&titulo=like.' + encodeURIComponent(MARCA + '*'));
    const tit = (vis.json || []).map((x) => x.titulo);
    ctx.ok('R29', 'Visitante: ve el video activo y NO el oculto', tit.indexOf(MARCA + ' Activo editado') >= 0 && tit.indexOf(MARCA + ' Oculto') < 0, tit.join(', '));
    const w1 = await ins(null, vid('Intruso'));
    const w2 = await pedir('PATCH', '/rest/v1/videos?id=eq.' + activo.id, { body: { ref: 'dQw4w9WgXcQ' }, headers: { Prefer: 'return=representation' } });
    const w3 = await pedir('DELETE', '/rest/v1/videos?id=eq.' + activo.id, { headers: { Prefer: 'return=representation' } });
    ctx.ok('R29', 'Visitante: no puede agregar, cambiar ni quitar videos', bloqueado(w1) && bloqueado(w2) && bloqueado(w3), [w1.status, w2.status, w3.status].join('/'));
    const n1 = await ins(T.noadmin, vid('NoAdmin'));
    const n2 = await pedir('PATCH', '/rest/v1/videos?id=eq.' + activo.id, { token: T.noadmin, body: { titulo: 'x' }, headers: { Prefer: 'return=representation' } });
    ctx.ok('R29', 'Usuario sin rol: no puede agregar ni cambiar videos', bloqueado(n1) && bloqueado(n2), n1.status + '/' + n2.status);
    const sigue = (await db.query('select ref from public.videos where id=$1', [activo.id])).rows[0];
    ctx.ok('R29', 'El video sigue intacto tras los intentos', sigue && sigue.ref === activo.ref);

    // --- Validaciones de la base (aunque alguien salte el panel) ---
    const malos = [
      ['ID de video inválido', { ref: 'corto' }],
      ['ID con comillas', { ref: "aaaaaaaaaa'" }],
      ['canal sin UC', { tipo: 'canal', ref: 'XX' + 'a'.repeat(22) }],
      ['tipo desconocido', { tipo: 'vimeo', ref: '12345678901' }],
      ['miniatura javascript:', { miniatura: 'javascript:alert(1)' }],
      ['miniatura de otro dominio', { miniatura: 'https://evil.com/x.jpg' }],
      ['enlace http', { enlace: 'http://www.youtube.com/watch?v=dQw4w9WgXcQ' }],
      ['título vacío', { titulo: '   ' }]
    ];
    for (const [n, o] of malos) {
      const r = await ins(T.admin, vid('malo', o));
      ctx.ok('R29', 'La base rechaza: ' + n, r.status === 400, 'HTTP ' + r.status);
    }
    const dup = await ins(T.admin, vid('Duplicado', { ref: activo.ref }));
    ctx.ok('R29', 'La base rechaza el mismo video dos veces', dup.status === 409, 'HTTP ' + dup.status);

    // --- RPC del inicio: una sola llamada trae los videos activos, en orden y solo con lo necesario ---
    const ini = await pedir('GET', '/rest/v1/rpc/pagina_inicio?apikey=' + encodeURIComponent(require('../lib/supa').KEY));
    const vids = (ini.json && ini.json.videos) || [];
    ctx.ok('R29', 'pagina_inicio() trae los videos en la misma llamada', ok2(ini.status) && Array.isArray(vids) && vids.length >= 1, vids.length + ' videos');
    ctx.ok('R29', 'pagina_inicio(): incluye el activo y no el oculto', vids.some((v) => v.id === activo.id) && !vids.some((v) => v.id === oculto.id));
    const ord = (await db.query('select id from public.videos where activo order by orden, created_at')).rows.map((r) => r.id);
    ctx.ok('R29', 'pagina_inicio(): respeta el orden del panel', JSON.stringify(vids.map((v) => v.id)) === JSON.stringify(ord.slice(0, 200)));
    const campos = vids[0] ? Object.keys(vids[0]).sort().join(',') : '';
    ctx.ok('R29', 'pagina_inicio(): por video solo id, tipo, ref, título y miniatura', campos === 'id,miniatura,ref,tipo,titulo', campos);
    const res = await rpc('panel_resumen', {}, T.admin);
    ctx.ok('R29', 'panel_resumen() cuenta los videos visibles', ok2(res.status) && res.json && res.json.videos === ord.length, res.json && res.json.videos);

    // --- Datos demo: borrar_demo quita solo los videos demo (dentro de una transacción que se revierte) ---
    const admin = (await db.query("select user_id from public.admins where rol = 'admin' limit 1")).rows[0];
    await db.query('begin');
    try {
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.user_id, role: 'authenticated' })]);
      await db.query('set local role authenticated');
      const antes = (await db.query('select count(*) filter (where demo)::int d, count(*) filter (where not demo)::int r from public.videos')).rows[0];
      const b = (await db.query('select public.borrar_demo() j')).rows[0].j;
      const desp = (await db.query('select count(*) filter (where demo)::int d, count(*) filter (where not demo)::int r from public.videos')).rows[0];
      ctx.ok('R27', 'Borrar demo quita los videos demo y deja los reales', desp.d === 0 && desp.r === antes.r && b.videos === antes.d, JSON.stringify({ antes, desp, borrados: b.videos }));
      const c = (await db.query('select public.cargar_demo() j')).rows[0].j;
      const otra = (await db.query('select public.cargar_demo() j')).rows[0].j;
      ctx.ok('R27', 'Cargar demo vuelve a poner los 4 videos de ejemplo, sin duplicar', c.videos === 4 && otra.videos === 0, c.videos + ' y luego ' + otra.videos);
    } finally {
      await db.query('rollback');
    }

    // --- Edge Function "youtube" ---
    const f1 = await pedir('POST', '/functions/v1/youtube', { body: { ruta: '@YouTube' } });
    ctx.ok('R29', 'Función youtube: sin sesión responde 401', f1.status === 401, 'HTTP ' + f1.status);
    const f2 = await pedir('POST', '/functions/v1/youtube', { token: T.noadmin, body: { ruta: '@YouTube' } });
    ctx.ok('R29', 'Función youtube: usuario sin rol recibe 403', f2.status === 403, 'HTTP ' + f2.status);
    const f3 = await pedir('POST', '/functions/v1/youtube', { token: T.editor, body: { ruta: 'https://evil.com/x' } });
    const f4 = await pedir('POST', '/functions/v1/youtube', { token: T.editor, body: { ruta: '@a/../../admin' } });
    ctx.ok('R29', 'Función youtube: rutas que no son de un canal se rechazan (no se puede usar para pedir otras URL)', f3.status === 400 && f4.status === 400, f3.status + '/' + f4.status);
    const f6 = await pedir('POST', '/functions/v1/youtube', { token: T.editor, body: { ruta: '@CúcutaNoExiste-qa-zz' } });
    ctx.ok('R29', 'Función youtube: acepta @usuario con tildes (YouTube los permite)', f6.status === 404 || f6.status === 200, 'HTTP ' + f6.status + ' ' + ((f6.json || {}).error || ''));
    const f5 = await pedir('POST', '/functions/v1/youtube', { token: T.editor, body: { ruta: '@YouTube' } });
    ctx.ok('R29', 'Función youtube: resuelve un @usuario real a su ID de canal', f5.status === 200 && /^UC[A-Za-z0-9_-]{22}$/.test((f5.json || {}).canal || ''), 'HTTP ' + f5.status + ' ' + ((f5.json || {}).canal || (f5.json || {}).error || ''));
  } finally {
    await limpiar();
    await db.end();
  }
};
