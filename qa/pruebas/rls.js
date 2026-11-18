// Seguridad real contra el proyecto: visitante (anon), usuario sin rol, editor y administrador.
const { pedir, rpc, tokens, env } = require('../lib/supa');
const { conectar } = require('../lib/db');

const MARCA = 'QA-RLS';

module.exports = async function (ctx) {
  const T = await tokens();
  const db = await conectar();
  const ok2 = (s) => s >= 200 && s < 300;
  const cat = (await db.query("select id from public.categorias where slug='hoteles'")).rows[0].id;
  const limpiar = async () => {
    await db.query("delete from public.negocios where nombre like $1", [MARCA + '%']);
    await db.query("delete from public.categorias where nombre like $1", [MARCA + '%']);
  };
  try {
    await limpiar();
    // Datos de prueba creados como ADMIN por la API (como lo haría el panel)
    const neg = (n) => ({ nombre: MARCA + ' ' + n, categoria_id: cat, ciudad: 'Cúcuta' });
    const ins = async (tok, tabla, body) => pedir('POST', '/rest/v1/' + tabla, { token: tok, body, headers: { Prefer: 'return=representation' } });
    const a = await ins(T.admin, 'negocios', [Object.assign(neg('Activo'), { activo: true }), Object.assign(neg('Pausado'), { activo: false })]);
    ctx.ok('R3', 'El administrador crea negocios', a.status === 201 && a.json.length === 2, 'HTTP ' + a.status + (a.status !== 201 ? ' ' + JSON.stringify(a.json) : ''));
    if (a.status !== 201) return;
    const ids = a.json.map((x) => x.id);
    const oVieja = await ins(T.admin, 'ofertas', { negocio_id: ids[0], titulo: MARCA + ' vencida', descuento: '-10%', vigente_hasta: '2020-01-01' });
    ctx.ok('R3', 'El administrador crea ofertas', oVieja.status === 201, 'HTTP ' + oVieja.status);
    const cOculta = await ins(T.admin, 'categorias', { nombre: MARCA + ' oculta', activa: false });
    ctx.ok('R3', 'El administrador crea categorías', cOculta.status === 201, 'HTTP ' + cOculta.status);

    // --- R2: visitante ---
    const vis = await pedir('GET', '/rest/v1/negocios?select=nombre,activo&nombre=like.' + encodeURIComponent(MARCA + '*'));
    const nombres = (vis.json || []).map((x) => x.nombre);
    ctx.ok('R2', 'Visitante: ve el negocio activo', nombres.indexOf(MARCA + ' Activo') >= 0, nombres.join(', '));
    ctx.ok('R2', 'Visitante: NO ve el negocio pausado', nombres.indexOf(MARCA + ' Pausado') < 0);
    const todosAct = await pedir('GET', '/rest/v1/negocios?select=activo&activo=eq.false');
    ctx.ok('R2', 'Visitante: ninguna fila inactiva es legible', ok2(todosAct.status) && todosAct.json.length === 0);
    const ofs = await pedir('GET', '/rest/v1/ofertas?select=titulo&titulo=like.' + encodeURIComponent(MARCA + '*'));
    ctx.ok('R2', 'Visitante: NO ve ofertas vencidas', ok2(ofs.status) && ofs.json.length === 0);
    const cats = await pedir('GET', '/rest/v1/categorias?select=nombre&activa=eq.false');
    ctx.ok('R2', 'Visitante: NO ve categorías ocultas', ok2(cats.status) && cats.json.length === 0);
    const w1 = await pedir('POST', '/rest/v1/negocios', { body: neg('Intruso') });
    const w2 = await pedir('PATCH', '/rest/v1/negocios?id=eq.' + ids[0], { body: { nombre: 'hackeado' }, headers: { Prefer: 'return=representation' } });
    const w3 = await pedir('DELETE', '/rest/v1/negocios?id=eq.' + ids[0], { headers: { Prefer: 'return=representation' } });
    const w4 = await pedir('POST', '/rest/v1/categorias', { body: { nombre: MARCA + ' intrusa' } });
    const w5 = await pedir('PATCH', '/rest/v1/meta?id=eq.1', { body: { version: 1 } });
    const w6 = await pedir('POST', '/rest/v1/admins', { body: { user_id: '00000000-0000-0000-0000-000000000000' } });
    const bloqueado = (r) => r.status === 401 || r.status === 403 || (ok2(r.status) && Array.isArray(r.json) && r.json.length === 0);
    ctx.ok('R2', 'Visitante: no puede crear negocios', bloqueado(w1), 'HTTP ' + w1.status);
    ctx.ok('R2', 'Visitante: no puede editar negocios', bloqueado(w2), 'HTTP ' + w2.status);
    ctx.ok('R2', 'Visitante: no puede borrar negocios', bloqueado(w3), 'HTTP ' + w3.status);
    ctx.ok('R2', 'Visitante: no puede crear categorías', bloqueado(w4), 'HTTP ' + w4.status);
    ctx.ok('R2', 'Visitante: no puede tocar la versión de datos ni la tabla de admins', bloqueado(w5) && bloqueado(w6), w5.status + '/' + w6.status);
    const sigue = (await db.query('select nombre from public.negocios where id=$1', [ids[0]])).rows[0];
    ctx.ok('R2', 'El negocio sigue intacto tras los intentos del visitante', sigue && sigue.nombre === MARCA + ' Activo');
    const adm = await pedir('GET', '/rest/v1/admins?select=user_id');
    ctx.ok('R2', 'Visitante: no puede listar administradores', bloqueado(adm) || (ok2(adm.status) && adm.json.length === 0), 'HTTP ' + adm.status);
    const res = await rpc('panel_resumen', {});
    ctx.ok('R2', 'Visitante: no puede ejecutar el resumen del panel', res.status === 401 || res.status === 403 || res.status === 404, 'HTTP ' + res.status);
    const dem = await rpc('borrar_demo', {});
    ctx.ok('R2', 'Visitante: no puede borrar datos demo', dem.status >= 400, 'HTTP ' + dem.status);
    const signup = await pedir('POST', '/auth/v1/signup', { body: { email: 'intruso-' + Date.now() + '@fullguia.test', password: 'Intruso12345' } });
    ctx.ok('R2', 'Registro público desactivado (nadie se crea cuenta solo)', signup.status >= 400, 'HTTP ' + signup.status);

    // --- R3: usuario autenticado SIN rol ---
    const n1 = await ins(T.noadmin, 'negocios', neg('NoAdmin'));
    ctx.ok('R3', 'Usuario sin rol: no puede crear negocios', n1.status === 401 || n1.status === 403, 'HTTP ' + n1.status);
    const n2 = await pedir('PATCH', '/rest/v1/negocios?id=eq.' + ids[0], { token: T.noadmin, body: { nombre: 'x' }, headers: { Prefer: 'return=representation' } });
    ctx.ok('R3', 'Usuario sin rol: no puede editar negocios', bloqueado(n2), 'HTTP ' + n2.status);
    const n3 = await pedir('GET', '/rest/v1/negocios?select=id&activo=eq.false', { token: T.noadmin });
    ctx.ok('R3', 'Usuario sin rol: no ve negocios pausados', ok2(n3.status) && n3.json.length === 0);
    const n4 = await rpc('panel_resumen', {}, T.noadmin);
    ctx.ok('R16', 'Usuario sin rol: el resumen del panel no le devuelve datos', ok2(n4.status) && n4.json === null, JSON.stringify(n4.json));
    const n5 = await pedir('GET', '/rest/v1/admins?select=user_id', { token: T.noadmin });
    ctx.ok('R16', 'Usuario sin rol: no aparece como admin (el panel le niega la entrada)', ok2(n5.status) && n5.json.length === 0);

    // --- R26: editor ---
    const e1 = await ins(T.editor, 'negocios', neg('Editor'));
    ctx.ok('R26', 'Editor: puede crear negocios', e1.status === 201, 'HTTP ' + e1.status);
    const e2 = await ins(T.editor, 'categorias', { nombre: MARCA + ' editor' });
    ctx.ok('R26', 'Editor: NO puede crear categorías', e2.status === 401 || e2.status === 403, 'HTTP ' + e2.status);
    const e3 = await pedir('PATCH', '/rest/v1/categorias?id=eq.' + cat, { token: T.editor, body: { orden: 999 }, headers: { Prefer: 'return=representation' } });
    ctx.ok('R26', 'Editor: NO puede editar categorías', bloqueado(e3), 'HTTP ' + e3.status);
    const e4 = await rpc('cargar_demo', {}, T.editor);
    const e5 = await rpc('borrar_demo', {}, T.editor);
    ctx.ok('R26', 'Editor: NO puede cargar ni borrar datos demo', e4.status >= 400 && e5.status >= 400, e4.status + '/' + e5.status);
    const e6 = await pedir('POST', '/functions/v1/usuarios', { token: T.editor, body: { accion: 'listar' } });
    ctx.ok('R26', 'Editor: la función de usuarios le responde 403', e6.status === 403, 'HTTP ' + e6.status);
    const e7 = await pedir('POST', '/functions/v1/usuarios', { token: T.editor, body: { accion: 'crear', email: 'x@fullguia.test', password: 'Clave12345x', rol: 'admin' } });
    ctx.ok('R26', 'Editor: no puede crearse usuarios administradores', e7.status === 403, 'HTTP ' + e7.status);
    const e8 = await pedir('GET', '/rest/v1/admins?select=user_id,rol', { token: T.editor });
    ctx.ok('R26', 'Editor: solo ve su propia fila de admins', ok2(e8.status) && e8.json.length === 1 && e8.json[0].rol === 'editor', JSON.stringify(e8.json));
    const e9 = await pedir('POST', '/functions/v1/usuarios', { body: { accion: 'listar' } });
    ctx.ok('R26', 'Visitante: la función de usuarios lo rechaza', e9.status === 401 || e9.status === 403, 'HTTP ' + e9.status);

    // --- R26: admin gestiona usuarios (crea, cambia rol, cambia clave, elimina) ---
    const correo = 'qa-temporal-' + Date.now() + '@fullguia.test';
    const u1 = await pedir('POST', '/functions/v1/usuarios', { token: T.admin, body: { accion: 'crear', email: correo, password: 'Temporal12345', rol: 'editor', nombre: 'QA temporal' } });
    ctx.ok('R26', 'Admin: crea un usuario editor desde la función', u1.status === 200 && u1.json.usuario, 'HTTP ' + u1.status);
    const uid = u1.json && u1.json.usuario && u1.json.usuario.user_id;
    if (uid) {
      const u2 = await pedir('POST', '/functions/v1/usuarios', { token: T.admin, body: { accion: 'rol', user_id: uid, rol: 'admin' } });
      const u3 = await pedir('POST', '/functions/v1/usuarios', { token: T.admin, body: { accion: 'clave', user_id: uid, password: 'Cambiada12345' } });
      const login = await pedir('POST', '/auth/v1/token?grant_type=password', { body: { email: correo, password: 'Cambiada12345' } });
      ctx.ok('R26', 'Admin: cambia el rol y la contraseña; el usuario entra con la nueva', u2.status === 200 && u3.status === 200 && login.status === 200, [u2.status, u3.status, login.status].join('/'));
      const u4 = await pedir('POST', '/functions/v1/usuarios', { token: T.admin, body: { accion: 'clave', user_id: uid, password: 'corta' } });
      ctx.ok('R26', 'Contraseñas débiles se rechazan', u4.status === 400, 'HTTP ' + u4.status);
      const u5 = await pedir('POST', '/functions/v1/usuarios', { token: T.admin, body: { accion: 'quitar', user_id: uid } });
      const quedo = (await db.query('select count(*)::int n from auth.users where id=$1', [uid])).rows[0].n;
      ctx.ok('R26', 'Admin: elimina el usuario (y su rol)', u5.status === 200 && quedo === 0, 'HTTP ' + u5.status);
    }
    const yo = JSON.parse(Buffer.from(T.admin.split('.')[1], 'base64url').toString()).sub;
    const u6 = await pedir('POST', '/functions/v1/usuarios', { token: T.admin, body: { accion: 'quitar', user_id: yo } });
    ctx.ok('R26', 'Un administrador no puede eliminarse a sí mismo', u6.status === 400, 'HTTP ' + u6.status);

    // --- R4: Storage ---
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const ruta = 'qa/' + Date.now() + '-rls.png';
    const subir = (tok) => pedir('POST', '/storage/v1/object/negocios/' + ruta, { token: tok, body: new Uint8Array(png), headers: { 'Content-Type': 'image/png' } });
    const s1 = await subir(null);
    ctx.ok('R4', 'Storage: el visitante no puede subir archivos', s1.status >= 400, 'HTTP ' + s1.status);
    const s2 = await subir(T.noadmin);
    ctx.ok('R4', 'Storage: un usuario sin rol no puede subir', s2.status >= 400, 'HTTP ' + s2.status);
    const s3 = await subir(T.admin);
    ctx.ok('R4', 'Storage: el administrador sube', s3.status === 200, 'HTTP ' + s3.status);
    const pub = await fetch(env.SUPABASE_URL + '/storage/v1/object/public/negocios/' + ruta);
    ctx.ok('R4', 'Storage: cualquiera ve el archivo por su URL pública', pub.status === 200, 'HTTP ' + pub.status);
    const lista = await pedir('POST', '/storage/v1/object/list/negocios', { body: { prefix: 'qa', limit: 10 } });
    ctx.ok('R4', 'Storage: el visitante no puede listar el contenido del bucket', lista.status >= 400 || (Array.isArray(lista.json) && lista.json.length === 0), 'HTTP ' + lista.status);
    const gif = await pedir('POST', '/storage/v1/object/negocios/qa/' + Date.now() + '.gif', { token: T.admin, body: new Uint8Array(png), headers: { 'Content-Type': 'image/gif' } });
    ctx.ok('R4', 'Storage: el bucket solo acepta WebP, JPG o PNG', gif.status >= 400, 'HTTP ' + gif.status);
    const s4 = await pedir('DELETE', '/storage/v1/object/negocios/' + ruta, { token: T.noadmin });
    const aun = await fetch(env.SUPABASE_URL + '/storage/v1/object/public/negocios/' + ruta);
    ctx.ok('R4', 'Storage: un usuario sin rol no puede borrar', aun.status === 200, 'HTTP ' + s4.status);
    const s5 = await pedir('DELETE', '/storage/v1/object/negocios', { token: T.admin, body: { prefixes: [ruta] } });
    const ya = await fetch(env.SUPABASE_URL + '/storage/v1/object/public/negocios/' + ruta + '?x=' + Date.now());
    ctx.ok('R4', 'Storage: el administrador borra', s5.status === 200 && ya.status >= 400, s5.status + '/' + ya.status);
  } finally {
    await limpiar();
    await db.end();
  }
};
