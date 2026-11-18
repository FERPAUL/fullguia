// Crea (o actualiza la contraseña de) un usuario del panel con la API oficial de administración
// de Supabase Auth y le asigna un rol en public.admins. NO inserta en auth.users a mano.
//
// La llave secreta se pide en tiempo de ejecución a la Management API con SUPABASE_ACCESS_TOKEN
// y vive solo en memoria: nunca se escribe en un archivo.
//
// Uso: node scripts/crear-usuario.js correo@dominio.com <admin|editor> [contraseña] [nombre]
//      Si no se da contraseña, se genera una fuerte y se muestra UNA vez.
const crypto = require('crypto');
const { cargarEnv } = require('../qa/lib/env');
const { conectar } = require('../qa/lib/db');

async function llaveSecreta(env) {
  const ref = env.SUPABASE_PROJECT_REF;
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, {
    headers: { Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN },
  });
  if (!r.ok) throw new Error('Management API respondió ' + r.status);
  const llaves = await r.json();
  const k = llaves.find((x) => x.type === 'secret' && x.api_key) ||
            llaves.find((x) => x.name === 'service_role' && x.api_key);
  if (!k) throw new Error('No se encontró la llave secreta del proyecto');
  return k.api_key;
}

function generarClave() {
  const base = crypto.randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
  return 'Fg-' + base.slice(0, 12) + '-' + crypto.randomInt(10, 99);
}

async function crearUsuario({ email, rol, password, nombre }) {
  const env = cargarEnv();
  const secreta = await llaveSecreta(env);
  const auth = (ruta, metodo, cuerpo) =>
    fetch(env.SUPABASE_URL + '/auth/v1/admin' + ruta, {
      method: metodo,
      headers: { apikey: secreta, Authorization: 'Bearer ' + secreta, 'Content-Type': 'application/json' },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    }).then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) }));

  const c = await conectar();
  try {
    const ya = await c.query('select id from auth.users where lower(email) = $1', [email]);
    let id;
    if (ya.rowCount) {
      id = ya.rows[0].id;
      const r = await auth('/users/' + id, 'PUT', { password, email_confirm: true });
      if (!r.ok) throw new Error('No se pudo actualizar: ' + JSON.stringify(r.json));
    } else {
      const r = await auth('/users', 'POST', { email, password, email_confirm: true, user_metadata: { nombre } });
      if (!r.ok) throw new Error('No se pudo crear: ' + JSON.stringify(r.json));
      id = r.json.id;
    }
    if (rol === 'ninguno') {
      await c.query('delete from public.admins where user_id = $1', [id]);
    } else {
      await c.query(
        `insert into public.admins (user_id, rol, email, nombre) values ($1, $2, $3, $4)
         on conflict (user_id) do update set rol = excluded.rol, email = excluded.email,
           nombre = coalesce(excluded.nombre, public.admins.nombre)`,
        [id, rol, email, nombre || null]);
    }
    return id;
  } finally {
    await c.end();
  }
}

module.exports = { crearUsuario, generarClave, llaveSecreta };

if (require.main === module) {
  (async () => {
    const [email0, rol = 'editor', pass, nombre] = process.argv.slice(2);
    const email = (email0 || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !['admin', 'editor', 'ninguno'].includes(rol)) {
      console.error('Uso: node scripts/crear-usuario.js correo <admin|editor|ninguno> [contraseña] [nombre]');
      process.exit(2);
    }
    const password = pass || generarClave();
    await crearUsuario({ email, rol, password, nombre });
    console.log('Usuario listo:', email, '· rol:', rol);
    if (!pass) console.log('Contraseña (anótala, no se guarda):', password);
  })().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
}
