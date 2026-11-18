// Supabase en memoria para probar el panel en jsdom: auth, tablas con filtros básicos, rpc, storage y funciones.
// estado.pausa: promesa que retiene las escrituras (para ver el cambio optimista antes de que "responda").
// estado.fallar[tabla] = { code, message }: la próxima escritura en esa tabla falla.
function crearSupabaseFalso(estado) {
  let sesion = null;
  const oyentes = [];
  const id = () => 'id-' + Math.random().toString(36).slice(2, 10);
  const T = estado.tablas;
  estado.log = estado.log || [];

  const auth = {
    getSession: async () => ({ data: { session: sesion } }),
    signInWithPassword: async ({ email, password }) => {
      const u = estado.usuarios.find((x) => x.email === email && x.password === password);
      if (!u) return { data: null, error: { message: 'Invalid login credentials' } };
      sesion = { access_token: 'tok-' + u.id, user: { id: u.id, email: u.email, user_metadata: u.meta || {} } };
      return { data: { session: sesion }, error: null };
    },
    signOut: async () => { sesion = null; oyentes.forEach((f) => f('SIGNED_OUT', null)); return { error: null }; },
    onAuthStateChange: (f) => { oyentes.push(f); return { data: { subscription: { unsubscribe() {} } } }; },
    updateUser: async (d) => { estado.log.push(['updateUser', d]); return { data: {}, error: null }; },
    resetPasswordForEmail: async (email) => { estado.log.push(['reset', email]); return { error: null }; },
  };

  function adjuntar(tabla, fila, campos) {
    const f = Object.assign({}, fila);
    if (tabla === 'negocios' && /categorias\(/.test(campos)) { const c = T.categorias.find((x) => x.id === f.categoria_id) || {}; f.categorias = { nombre: c.nombre, slug: c.slug }; }
    if (tabla === 'negocios' && /ofertas\(/.test(campos)) f.ofertas = T.ofertas.filter((o) => o.negocio_id === f.id).map((o) => ({ imagen: o.imagen, imagen_mini: o.imagen_mini }));
    if (tabla === 'categorias' && /negocios\(count\)/.test(campos)) f.negocios = [{ count: T.negocios.filter((n) => n.categoria_id === f.id).length }];
    if (tabla === 'ofertas' && /negocios\(/.test(campos)) { const n = T.negocios.find((x) => x.id === f.negocio_id) || {}; f.negocios = { nombre: n.nombre, slug: n.slug }; }
    return f;
  }

  function from(tabla) {
    const q = { op: 'select', filtros: [], campos: '*', datos: null, uno: false, quizas: false, desde: 0, hasta: 1e9 };
    const api = {
      select(c) { if (q.op === 'select') q.campos = c || '*'; else q.devolver = c || '*'; return api; },
      insert(d) { q.op = 'insert'; q.datos = d; return api; },
      update(d) { q.op = 'update'; q.datos = d; return api; },
      delete() { q.op = 'delete'; return api; },
      eq(k, v) { q.filtros.push((r) => r[k] === v); return api; },
      in(k, vs) { q.filtros.push((r) => vs.indexOf(r[k]) >= 0); return api; },
      order() { return api; },
      range(a, b) { q.desde = a; q.hasta = b; return api; },
      single() { q.uno = true; return api; },
      maybeSingle() { q.quizas = true; return api; },
      then(ok, no) { return ejecutar().then(ok, no); },
    };
    async function ejecutar() {
      const lista = T[tabla] || (T[tabla] = []);
      if (q.op !== 'select') {
        if (estado.pausa) await estado.pausa;
        estado.log.push([q.op, tabla, q.datos]);
        const f = estado.fallar && estado.fallar[tabla];
        if (f) { delete estado.fallar[tabla]; return { data: null, error: f }; }
        const fs = estado.fallarSiempre && estado.fallarSiempre[tabla];
        if (fs) return { data: null, error: fs };
      }
      let filas;
      if (q.op === 'select') {
        if (tabla === 'admins') filas = lista.filter((r) => !sesion ? false : true);
        filas = (filas || lista).filter((r) => q.filtros.every((f) => f(r))).slice(q.desde, q.hasta + 1).map((r) => adjuntar(tabla, r, q.campos));
      } else if (q.op === 'insert') {
        const nuevas = (Array.isArray(q.datos) ? q.datos : [q.datos]).map((d) => Object.assign({ id: id(), slug: String(d.nombre || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'), demo: false }, d));
        nuevas.forEach((n) => lista.push(n));
        estado.version++;
        filas = nuevas.map((r) => adjuntar(tabla, r, q.devolver || ''));
      } else if (q.op === 'update') {
        filas = lista.filter((r) => q.filtros.every((f) => f(r)));
        filas.forEach((r) => Object.assign(r, q.datos));
        estado.version++;
        filas = filas.map((r) => adjuntar(tabla, r, q.devolver || ''));
      } else {
        filas = lista.filter((r) => q.filtros.every((f) => f(r)));
        T[tabla] = lista.filter((r) => filas.indexOf(r) < 0);
        estado.version++;
      }
      if (q.uno) return filas.length === 1 ? { data: filas[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      if (q.quizas) return { data: filas[0] || null, error: null };
      return { data: filas, error: null };
    }
    return api;
  }

  return {
    auth,
    from,
    rpc: async (fn) => {
      if (fn === 'version_datos') return { data: String(estado.version), error: null };
      const r = estado.rpc && estado.rpc[fn];
      if (!r) return { data: null, error: { message: 'rpc ' + fn } };
      return { data: typeof r === 'function' ? r() : r, error: null };
    },
    storage: { from: () => ({ upload: async (ruta) => { estado.log.push(['upload', ruta]); return { error: null }; }, remove: async (r) => { estado.log.push(['remove', r]); return { error: null }; } }) },
    functions: { invoke: async (nombre, o) => { estado.log.push(['fn', nombre, o.body]); return { data: estado.funciones ? estado.funciones(o.body) : {}, error: null }; } },
  };
}
module.exports = { crearSupabaseFalso };
