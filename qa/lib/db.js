// Conexión directa a Postgres (pooler de sesión) con la contraseña del .env.
const { Client } = require('pg');
const { cargarEnv } = require('./env');

async function conectar() {
  const env = cargarEnv();
  for (const k of ['SUPABASE_DB_HOST', 'SUPABASE_DB_USER', 'SUPABASE_DB_PASSWORD']) {
    if (!env[k]) throw new Error('Falta ' + k + ' en .env');
  }
  const c = new Client({
    host: env.SUPABASE_DB_HOST,
    port: 5432,
    user: env.SUPABASE_DB_USER,
    password: env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60000,
  });
  await c.connect();
  return c;
}

module.exports = { conectar };
