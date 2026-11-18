// Convierte en administrador del panel a un usuario YA registrado en Supabase Auth.
// No crea ni modifica auth.users: solo busca el id por correo e inserta en public.admins.
// Uso:  node scripts/hacer-admin.js correo@dominio.com        (agrega)
//       node scripts/hacer-admin.js correo@dominio.com --quitar (quita)
// Requiere en .env: SUPABASE_DB_HOST, SUPABASE_DB_USER, SUPABASE_DB_PASSWORD.
const { conectar } = require('../qa/lib/db');

(async () => {
  const correo = (process.argv[2] || '').trim().toLowerCase();
  const quitar = process.argv.includes('--quitar');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
    console.error('Uso: node scripts/hacer-admin.js correo@dominio.com [--quitar]');
    process.exit(2);
  }
  const c = await conectar();
  try {
    const u = await c.query('select id, email_confirmed_at from auth.users where lower(email) = $1', [correo]);
    if (!u.rowCount) {
      console.error('No existe un usuario con ese correo. Primero debe registrarse en Supabase Auth.');
      process.exit(1);
    }
    const id = u.rows[0].id;
    if (quitar) {
      await c.query('delete from public.admins where user_id = $1', [id]);
      console.log('Quitado de admins:', correo);
    } else {
      await c.query('insert into public.admins (user_id) values ($1) on conflict do nothing', [id]);
      console.log('Admin listo:', correo, u.rows[0].email_confirmed_at ? '(correo confirmado)' : '(OJO: correo sin confirmar)');
    }
  } finally {
    await c.end();
  }
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
