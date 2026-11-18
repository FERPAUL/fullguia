// ============== Servidor (Supabase) ==============
// FullGuia: esta es la capa que cambia respecto al kernel r-script. gsCall conserva su forma
// (responde { success, message, ... }) pero ahora habla con Supabase: tablas protegidas con RLS,
// funciones RPC, Storage y la Edge Function "usuarios". useRead, optimista, guardar y wr no cambian.
const ABIERTAS = new Set(['login', 'logout', 'pedirCodigo', 'getBoot', 'batch']);
const SIN_RED = 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
const CFG = window.FG_CONFIG || {};
const BUCKET = CFG.BUCKET || 'negocios';
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'fg_admin_auth' }
});

// Rutas de Storage → URL pública. Las URL https (datos demo) se usan tal cual.
const esRuta = (r) => !!r && typeof r === 'string' && !/^[a-z]+:/i.test(r);
const urlPublica = (r) => (!r ? '' : /^https:\/\//i.test(r) ? r : !esRuta(r) ? ''
  : CFG.SUPABASE_URL + '/storage/v1/object/public/' + BUCKET + '/' + String(r).replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/'));

// "Hoy" en Colombia (los destacados vencen a medianoche de Bogotá).
const hoyCO = () => { try { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }); } catch (e) { return hoy(); } };
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// WhatsApp Colombia: 57 + celular de 10 dígitos que empieza por 3. Acepta "300 123 4567" o "+57 300…".
function normalizarWa(v) {
  let d = String(v == null ? '' : v).replace(/\D+/g, '');
  if (!d) return '';
  if (/^3\d{9}$/.test(d)) d = '57' + d;
  return /^573\d{9}$/.test(d) ? d : null;            // null = no válido
}

// Errores de Postgres / Supabase → mensaje claro en español.
function errMsg(e) {
  const m = String((e && (e.message || e.msg || e.error_description || e.error)) || e || '');
  const c = e && e.code;
  if (/Failed to fetch|NetworkError|network|Load failed/i.test(m)) return SIN_RED;
  if (/JWT expired|invalid JWT|Auth session missing|refresh token/i.test(m) || c === 'PGRST301') return 'AUTH';
  if (c === '42501' || /row-level security|permission denied|Solo un administrador/i.test(m)) return 'No tienes permiso para hacer esto.';
  if (c === 'PGRST116') return 'No se encontró el registro o no tienes permiso para cambiarlo.';
  if (c === '23505') return 'Ya existe un registro con ese nombre.';
  if (c === '23503') return /categor/i.test(m) ? 'Esta categoría tiene negocios. Muévelos a otra categoría o bórralos primero.' : 'Hay datos relacionados que lo impiden.';
  if (c === '23514') {
    if (/whatsapp/i.test(m)) return 'El WhatsApp debe ser un celular de Colombia: 57 + 10 dígitos (ej. 573001234567).';
    if (/rating/i.test(m)) return 'La calificación debe estar entre 0 y 5.';
    return 'Algún dato no es válido.';
  }
  if (c === '22P02' || c === '22007' || c === '22008' || c === '22003') return 'Algún dato tiene un formato no válido.';
  if (/Payload too large|exceeded the maximum allowed size/i.test(m)) return 'El archivo es demasiado grande.';
  if (/mime type|not supported/i.test(m)) return 'Formato de archivo no permitido.';
  return m || 'Ocurrió un error';
}
const fallo = (e) => { const m = errMsg(e); return m === 'AUTH' ? { success: false, code: 'AUTH', message: 'Tu sesión terminó' } : { success: false, message: m }; };
const okR = (o) => Object.assign({ success: true }, o || {});

// PostgREST entrega máximo 1000 filas por pedido: se leen en tramos.
async function todas(tabla, campos, orden) {
  let out = [], desde = 0;
  for (;;) {
    let q = sb.from(tabla).select(campos).range(desde, desde + 999);
    (orden || []).forEach((o) => { q = q.order(o[0], { ascending: o[1] !== false }); });
    const { data, error } = await q;
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
    desde += 1000;
  }
  return out;
}
async function versionDatos() { const { data, error } = await sb.rpc('version_datos'); if (error) throw error; return data; }

// Edge Function "usuarios" (crear/borrar usuarios exige la llave secreta, que vive solo allá).
async function fnUsuarios(accion, datos) {
  const { data, error } = await sb.functions.invoke('usuarios', { body: Object.assign({ accion }, datos || {}) });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { /* sin cuerpo */ }
    throw new Error(msg);
  }
  return data;
}

async function borrarRutas(rutas) {
  const lista = Array.from(new Set((rutas || []).filter(esRuta)));
  if (!lista.length) return 0;
  const { error } = await sb.storage.from(BUCKET).remove(lista);
  if (error) { if (window.console) console.warn('No se pudieron borrar archivos', error.message); return 0; }
  return lista.length;
}

// ---------- Roles y pantallas del panel ----------
const ROLES_FG = [{ clave: 'admin', nombre: 'Administrador' }, { clave: 'editor', nombre: 'Editor' }];
const PAGINAS_FG = [
  { key: 'inicio', label: 'Inicio', icon: 'fa-house', group: 'General' },
  { key: 'negocios', label: 'Negocios', icon: 'fa-store', group: 'Directorio' },
  { key: 'ofertas', label: 'Ofertas', icon: 'fa-percent', group: 'Directorio' },
  { key: 'categorias', label: 'Categorías', icon: 'fa-tags', group: 'Directorio' },
  { key: 'importar', label: 'Importar CSV', icon: 'fa-file-csv', group: 'Herramientas' },
  { key: 'usuarios', label: 'Usuarios', icon: 'fa-users', group: 'Administración', solo: 'admin' },
  { key: 'configuracion', label: 'Configuración', icon: 'fa-gear', group: 'Administración', solo: 'admin' }
];
// El editor ve y edita negocios y ofertas; categorías solo las ve. La base de datos lo hace cumplir (RLS).
const PERMISOS_EDITOR = { inicio: 'v', negocios: 'vaed', ofertas: 'vaed', categorias: 'v', importar: 'va' };

async function armarBoot() {
  const { data: s } = await sb.auth.getSession();
  const user = s && s.session && s.session.user;
  if (!user) return { success: false, code: 'AUTH', message: 'Inicia sesión' };
  const { data: a, error } = await sb.from('admins').select('rol, nombre, email').eq('user_id', user.id).maybeSingle();
  if (error) return fallo(error);
  if (!a) return { success: false, code: 'NOADMIN', message: 'Tu usuario no tiene acceso al panel. Pídele acceso al administrador.' };
  const esSuper = a.rol === 'admin';
  const nombre = ((user.user_metadata || {}).nombre) || a.nombre || user.email;
  return okR({
    tok: s.session.access_token,
    pre: [],
    boot: {
      me: { id: user.id, usuario: user.email, nombre, email: user.email, rol: a.rol, rolNombre: esSuper ? 'Administrador' : 'Editor', esSuper, debe: 0 },
      perms: esSuper ? {} : PERMISOS_EDITOR,
      pages: PAGINAS_FG.filter((p) => !p.solo || p.solo === a.rol).map((p) => ({ key: p.key, label: p.label, icon: p.icon, group: p.group })),
      masters: {},
      cfg: { empresa: 'FullGuia.com', logo: '', moneda: '$' },
      look: ls.get('fg_look', null) || BOOT.look || {}
    }
  });
}

// ---------- Negocios ----------
const CAMPOS_NEG = 'id,nombre,slug,categoria_id,etiqueta,etiqueta_tono,ciudad,direccion,whatsapp,telefono,precio_desde,precio_label,amenidades,imagen,imagen_mini,logo,descripcion,rating,num_opiniones,plan,destacado_hasta,activo,demo,created_at,updated_at,categorias(nombre,slug)';
const EDITABLES_NEG = ['nombre', 'categoria_id', 'etiqueta', 'etiqueta_tono', 'ciudad', 'direccion', 'whatsapp', 'telefono', 'precio_desde', 'precio_label',
  'amenidades', 'imagen', 'imagen_mini', 'logo', 'descripcion', 'rating', 'num_opiniones', 'plan', 'destacado_hasta', 'activo'];

// Estado comercial del destacado, calculado con la fecha de Colombia.
function estadoPlan(n) {
  if (n.plan !== 'destacado') return 'Gratis';
  if (!n.destacado_hasta || n.destacado_hasta < hoyCO()) return 'Vencido';
  if (n.destacado_hasta <= sumarDias(hoyCO(), 7)) return 'Por vencer';
  return 'Destacado';
}
const filaNegocio = (n) => Object.assign({}, n, {
  categoria: (n.categorias || {}).nombre || '', categoria_slug: (n.categorias || {}).slug || '', categorias: undefined,
  estado: estadoPlan(n), activo: n.activo ? 1 : 0, demo: n.demo ? 1 : 0
});

const listaAmenidades = (v) => (Array.isArray(v) ? v : String(v || '').split(/\r?\n|\|/))
  .map((s) => String(s).trim()).filter(Boolean).slice(0, 20).map((s) => s.slice(0, 60));

// Validación compartida por el formulario, la importación y el guardado.
function validarNegocio(d) {
  const nombre = String(d.nombre || '').trim();
  if (nombre.length < 2) return 'Escribe el nombre del negocio (mínimo 2 letras).';
  if (nombre.length > 120) return 'El nombre es muy largo (máximo 120 caracteres).';
  if (!d.categoria_id) return 'Elige la categoría.';
  if (d.whatsapp && normalizarWa(d.whatsapp) === null) return 'El WhatsApp debe ser un celular de Colombia de 10 dígitos (ej. 300 123 4567).';
  if (d.precio_desde !== '' && d.precio_desde != null && !(Number(String(d.precio_desde).replace(/[.\s$]/g, '')) >= 0)) return 'El precio debe ser un número.';
  const r = d.rating === '' || d.rating == null ? 0 : Number(String(d.rating).replace(',', '.'));
  if (!(r >= 0 && r <= 5)) return 'La calificación debe estar entre 0 y 5.';
  if (d.num_opiniones !== '' && d.num_opiniones != null && !(Number(d.num_opiniones) >= 0)) return 'El número de opiniones no es válido.';
  if (d.plan === 'destacado' && !/^\d{4}-\d{2}-\d{2}$/.test(String(d.destacado_hasta || ''))) return 'Indica hasta qué fecha es destacado.';
  if (d.plan && ['gratis', 'destacado'].indexOf(d.plan) < 0) return 'El plan debe ser gratis o destacado.';
  if (String(d.descripcion || '').length > 4000) return 'La descripción es muy larga (máximo 4000 caracteres).';
  return '';
}
function limpiarNegocio(d) {
  const x = {};
  EDITABLES_NEG.forEach((k) => { if (d[k] !== undefined) x[k] = d[k]; });
  x.nombre = String(x.nombre || '').trim();
  ['etiqueta', 'ciudad', 'direccion', 'telefono', 'descripcion', 'imagen', 'imagen_mini', 'logo'].forEach((k) => {
    if (k in x) x[k] = String(x[k] == null ? '' : x[k]).trim() || null;
  });
  if ('whatsapp' in x) x.whatsapp = normalizarWa(x.whatsapp) || null;
  if ('precio_desde' in x) { const p = String(x.precio_desde == null ? '' : x.precio_desde).replace(/[.\s$]/g, ''); x.precio_desde = p === '' ? null : Math.round(Number(p)); }
  if ('precio_label' in x) x.precio_label = String(x.precio_label || '').trim() || 'Desde';
  if ('amenidades' in x) x.amenidades = listaAmenidades(x.amenidades);
  if ('rating' in x) x.rating = x.rating === '' || x.rating == null ? 0 : Math.round(Number(String(x.rating).replace(',', '.')) * 10) / 10;
  if ('num_opiniones' in x) x.num_opiniones = x.num_opiniones === '' || x.num_opiniones == null ? 0 : Math.round(Number(x.num_opiniones));
  if ('plan' in x) x.plan = x.plan === 'destacado' ? 'destacado' : 'gratis';
  if ('destacado_hasta' in x) x.destacado_hasta = /^\d{4}-\d{2}-\d{2}$/.test(String(x.destacado_hasta || '')) ? x.destacado_hasta : null;
  if ('activo' in x) x.activo = !!Number(x.activo);
  if ('etiqueta_tono' in x && ['azul', 'amarillo', 'morado', 'verde'].indexOf(x.etiqueta_tono) < 0) x.etiqueta_tono = 'azul';
  return x;
}
const esTemporal = (id) => !id || String(id).indexOf('_tmp_') === 0;

// ---------- Lecturas (useRead) ----------
const VERSIONADAS = new Set(['getInicio', 'listNegocios', 'listCategorias', 'listOfertas']);
const LECTURAS = {
  getInicio: async () => {
    const { data, error } = await sb.rpc('panel_resumen');
    if (error) throw error;
    const d = data || {};
    return okR({
      resumen: d,
      kpis: [
        { label: 'Negocios activos', value: d.activos || 0, icon: 'fa-store', tono: 'info' },
        { label: 'Destacados vigentes', value: d.destacados || 0, icon: 'fa-star', tono: 'ok' },
        { label: 'Destacados por vencer (7 días)', value: d.por_vencer || 0, icon: 'fa-hourglass-half', tono: d.por_vencer ? 'warn' : 'mute' },
        { label: 'Destacados vencidos', value: d.vencidos || 0, icon: 'fa-calendar-xmark', tono: d.vencidos ? 'bad' : 'mute' },
        { label: 'Ofertas vigentes', value: d.ofertas || 0, icon: 'fa-percent', tono: 'info' },
        { label: 'Categorías activas', value: d.categorias || 0, icon: 'fa-tags', tono: 'info' }
      ]
    });
  },
  listNegocios: async () => okR({ rows: (await todas('negocios', CAMPOS_NEG, [['nombre_orden']])).map(filaNegocio) }),
  listCategorias: async () => okR({
    rows: (await todas('categorias', 'id,nombre,slug,icono,color,orden,activa,updated_at,negocios(count)', [['orden'], ['nombre']]))
      .map((c) => Object.assign({}, c, { total: ((c.negocios || [])[0] || {}).count || 0, negocios: undefined, activa: c.activa ? 1 : 0 }))
  }),
  listOfertas: async () => okR({
    rows: (await todas('ofertas', 'id,negocio_id,titulo,descuento,imagen,imagen_mini,vigente_hasta,activa,orden,demo,updated_at,negocios(nombre,slug)', [['orden'], ['created_at', false]]))
      .map((o) => Object.assign({}, o, {
        negocio: (o.negocios || {}).nombre || '', negocios: undefined, activa: o.activa ? 1 : 0, demo: o.demo ? 1 : 0,
        vigente: o.activa && (!o.vigente_hasta || o.vigente_hasta >= hoyCO()) ? 'Vigente' : (o.activa ? 'Vencida' : 'Pausada')
      }))
  }),
  listUsuarios: async () => {
    const r = await fnUsuarios('listar');
    return okR({ rows: (r.usuarios || []).map((u) => ({ id: u.user_id, email: u.email || '', nombre: u.nombre || '', rol: u.rol, creado: u.created_at })), roles: ROLES_FG });
  }
};

// Las lecturas del mismo instante viajan juntas. Si la versión de datos no cambió, la copia guardada sigue vigente.
async function batch(lista) {
  let ver = '';
  try { if (lista.some((c) => VERSIONADAS.has(c[0]))) ver = await versionDatos(); } catch (e) { return fallo(e); }
  const r = await Promise.all(lista.map(async (c) => {
    const fn = c[0], args = c[1] || [], v = c[2] || '';
    if (!LECTURAS[fn]) return { success: false, message: 'Lectura no disponible: ' + fn };
    if (v && ver && v === ver && VERSIONADAS.has(fn)) return { success: true, same: 1 };
    try {
      const res = await LECTURAS[fn].apply(null, args);
      if (VERSIONADAS.has(fn)) res.v = ver;
      return res;
    } catch (e) { return fallo(e); }
  }));
  if (r.some((x) => x.code === 'AUTH')) return { success: false, code: 'AUTH', message: 'Tu sesión terminó' };
  return okR({ r });
}

// ---------- Escrituras ----------
const ESCRITURAS = {
  saveNegocio: async (d) => {
    const err = validarNegocio(d);
    if (err) return { success: false, message: err };
    const x = limpiarNegocio(d);
    if (!esTemporal(d.id)) {
      const ant = await sb.from('negocios').select('imagen,imagen_mini,logo').eq('id', d.id).maybeSingle();
      const { data, error } = await sb.from('negocios').update(x).eq('id', d.id).select(CAMPOS_NEG).single();
      if (error) throw error;
      // Las fotos reemplazadas se borran del Storage: no quedan archivos huérfanos.
      const vivas = [data.imagen, data.imagen_mini, data.logo];
      if (ant.data) await borrarRutas(['imagen', 'imagen_mini', 'logo'].map((k) => ant.data[k]).filter((r) => vivas.indexOf(r) < 0));
      return okR({ row: filaNegocio(data) });
    }
    const { data, error } = await sb.from('negocios').insert(x).select(CAMPOS_NEG).single();
    if (error) throw error;
    return okR({ row: filaNegocio(data) });
  },
  deleteNegocio: async (id) => {
    const { data: n } = await sb.from('negocios').select('imagen,imagen_mini,logo,ofertas(imagen,imagen_mini)').eq('id', id).maybeSingle();
    const { data, error } = await sb.from('negocios').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data || !data.length) return { success: false, message: 'No se encontró el negocio o no tienes permiso para borrarlo.' };
    if (n) await borrarRutas([n.imagen, n.imagen_mini, n.logo].concat(...(n.ofertas || []).map((o) => [o.imagen, o.imagen_mini])));
    return okR();
  },
  // Activar / pausar o cambiar el plan de varios a la vez.
  updateNegocios: async (ids, cambios) => {
    const x = limpiarNegocio(cambios);
    const { data, error } = await sb.from('negocios').update(x).in('id', ids).select('id');
    if (error) throw error;
    return okR({ n: (data || []).length });
  },
  importarNegocios: async (filas) => {
    let insertados = 0;
    const errores = [];
    for (let i = 0; i < filas.length; i += 500) {
      const tramo = filas.slice(i, i + 500);
      const { error } = await sb.from('negocios').insert(tramo.map((f) => limpiarNegocio(f.datos)));
      if (!error) { insertados += tramo.length; continue; }
      if (errMsg(error) === 'AUTH') throw error;
      // Si el tramo falla, se prueba fila por fila para decir exactamente cuál está mal.
      for (const f of tramo) {
        const r = await sb.from('negocios').insert(limpiarNegocio(f.datos));
        if (r.error) errores.push({ fila: f.fila, nombre: f.datos.nombre, error: errMsg(r.error) });
        else insertados++;
      }
    }
    return okR({ insertados, errores });
  },

  saveCategoria: async (d) => {
    const nombre = String(d.nombre || '').trim();
    if (nombre.length < 2 || nombre.length > 60) return { success: false, message: 'El nombre de la categoría debe tener entre 2 y 60 letras.' };
    const x = { nombre, icono: d.icono || 'mas', color: d.color || 'gray', orden: Math.round(Number(d.orden) || 100), activa: !!Number(d.activa) };
    if (d.slug !== undefined) x.slug = String(d.slug || '').trim();
    const q = esTemporal(d.id) ? sb.from('categorias').insert(x) : sb.from('categorias').update(x).eq('id', d.id);
    const { data, error } = await q.select('*').single();
    if (error) throw error;
    return okR({ row: data });
  },
  deleteCategoria: async (id) => {
    const { data, error } = await sb.from('categorias').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data || !data.length) return { success: false, message: 'No se pudo borrar: no tienes permiso.' };
    return okR();
  },

  saveOferta: async (d) => {
    const titulo = String(d.titulo || '').trim(), desc = String(d.descuento || '').trim();
    if (!d.negocio_id) return { success: false, message: 'Elige el negocio de la oferta.' };
    if (titulo.length < 2) return { success: false, message: 'Escribe el título de la oferta.' };
    if (!desc || desc.length > 12) return { success: false, message: 'Escribe el descuento (ej. -20% o 2x1), máximo 12 caracteres.' };
    const x = {
      negocio_id: d.negocio_id, titulo: titulo.slice(0, 120), descuento: desc, imagen: d.imagen || null, imagen_mini: d.imagen_mini || null,
      vigente_hasta: /^\d{4}-\d{2}-\d{2}$/.test(String(d.vigente_hasta || '')) ? d.vigente_hasta : null,
      activa: !!Number(d.activa), orden: Math.round(Number(d.orden) || 100)
    };
    if (!esTemporal(d.id)) {
      const ant = await sb.from('ofertas').select('imagen,imagen_mini').eq('id', d.id).maybeSingle();
      const { data, error } = await sb.from('ofertas').update(x).eq('id', d.id).select('*').single();
      if (error) throw error;
      if (ant.data) await borrarRutas([ant.data.imagen, ant.data.imagen_mini].filter((r) => r !== data.imagen && r !== data.imagen_mini));
      return okR({ row: data });
    }
    const { data, error } = await sb.from('ofertas').insert(x).select('*').single();
    if (error) throw error;
    return okR({ row: data });
  },
  deleteOferta: async (id) => {
    const { data: o } = await sb.from('ofertas').select('imagen,imagen_mini').eq('id', id).maybeSingle();
    const { data, error } = await sb.from('ofertas').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data || !data.length) return { success: false, message: 'No se encontró la oferta o no tienes permiso.' };
    if (o) await borrarRutas([o.imagen, o.imagen_mini]);
    return okR();
  },

  cargarDemo: async () => {
    const { data, error } = await sb.rpc('cargar_demo');
    if (error) throw error;
    return okR(data);
  },
  borrarDemo: async () => {
    const { data, error } = await sb.rpc('borrar_demo');
    if (error) throw error;
    const n = await borrarRutas((data || {}).rutas || []);
    return okR(Object.assign({}, data, { archivos: n }));
  },
  borrarArchivos: async (rutas) => okR({ n: await borrarRutas(rutas) }),

  crearUsuario: async (d) => okR(await fnUsuarios('crear', d)),
  rolUsuario: async (id, rol) => okR(await fnUsuarios('rol', { user_id: id, rol })),
  claveUsuario: async (id, password) => okR(await fnUsuarios('clave', { user_id: id, password })),
  quitarUsuario: async (id) => okR(await fnUsuarios('quitar', { user_id: id })),

  cambiarMiClave: async (actual, nueva) => {
    const me = ($auth.get().boot || {}).me || {};
    const e1 = claveDebil(nueva);
    if (e1) return { success: false, message: e1 };
    if (actual !== null) {
      const v = await sb.auth.signInWithPassword({ email: me.email, password: actual });
      if (v.error) return { success: false, message: 'La contraseña actual no es correcta.' };
    }
    const { error } = await sb.auth.updateUser({ password: nueva });
    if (error) throw error;
    const { data } = await sb.auth.getSession();
    return okR({ tok: data.session ? data.session.access_token : $auth.get().tok, message: 'Contraseña actualizada' });
  },
  guardarMiPerfil: async (p) => {
    const nombre = String(p.nombre || '').trim().slice(0, 80);
    if (nombre.length < 2) return { success: false, message: 'Escribe tu nombre.' };
    const { error } = await sb.auth.updateUser({ data: { nombre } });
    if (error) throw error;
    return okR({ nombre, email: (($auth.get().boot || {}).me || {}).email, message: 'Datos guardados' });
  },
  // Los colores del panel se recuerdan en este navegador.
  saveLook: async (l) => { ls.set('fg_look', l); return okR({ look: l, message: 'Colores guardados en este navegador' }); }
};

function claveDebil(p) {
  if (typeof p !== 'string' || p.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) return 'La contraseña debe tener letras y números.';
  return '';
}
function claveTemporal() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz', n = '23456789', b = new Uint32Array(12);
  (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(b) : b.forEach((x, i) => { b[i] = Math.floor(Math.random() * 1e9); });
  let s = 'Fg-';
  for (let i = 0; i < 8; i++) s += a[b[i] % a.length];
  for (let i = 8; i < 12; i++) s += n[b[i] % n.length];
  return s;
}

const SESION = {
  login: async (email, clave) => {
    const { error } = await sb.auth.signInWithPassword({ email: String(email || '').trim().toLowerCase(), password: clave });
    if (error) return { success: false, message: /Invalid login/i.test(error.message) ? 'Correo o contraseña incorrectos.' : errMsg(error) };
    const r = await armarBoot();
    if (!r.success) { await sb.auth.signOut(); return r; }
    return r;
  },
  logout: async () => { await sb.auth.signOut(); return okR(); },
  pedirCodigo: async (email) => {
    const destino = window.location.href.split('#')[0].split('?')[0];
    const { error } = await sb.auth.resetPasswordForEmail(String(email || '').trim().toLowerCase(), { redirectTo: destino });
    if (error && !/rate limit/i.test(error.message)) return fallo(error);
    if (error) return { success: false, message: 'Ya se enviaron varios correos. Espera unos minutos e intenta de nuevo.' };
    return okR({ message: 'Si el correo está registrado, te llegará un enlace para crear una contraseña nueva. Revisa también la carpeta de spam.' });
  },
  getBoot: armarBoot,
  batch
};

// Única puerta al servidor (misma firma que en el kernel).
const gsCall = (fn, args) => {
  const f = SESION[fn] || ESCRITURAS[fn];
  if (!f) return Promise.resolve({ success: false, message: 'Función no disponible: ' + fn });
  return Promise.resolve().then(() => f.apply(null, args || [])).catch(fallo).then((r) => {
    if (r && r.code === 'AUTH' && !ABIERTAS.has(fn)) salir(true);
    if (r && r.code === 'AUTH' && fn === 'batch') salir(true);
    return r || { success: false, message: 'El servidor no respondió' };
  });
};
