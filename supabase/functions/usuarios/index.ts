// FullGuia · Edge Function "usuarios"
// Única función del proyecto. Existe porque crear/borrar usuarios de Auth exige la llave secreta
// (service role), que nunca puede estar en el navegador. Solo responde a usuarios con rol "admin".
//
// POST { accion: 'listar' }
// POST { accion: 'crear',  email, password, nombre?, rol: 'admin'|'editor' }
// POST { accion: 'rol',    user_id, rol }
// POST { accion: 'clave',  user_id, password }
// POST { accion: 'quitar', user_id }

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROLES = ['admin', 'editor'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function resp(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function claveValida(p: unknown) {
  return typeof p === 'string' && p.length >= 10 && /[a-zA-Z]/.test(p) && /[0-9]/.test(p);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resp(405, { error: 'Método no permitido' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const secreta = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const srv = createClient(url, secreta, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. ¿Quién llama? (token del usuario que inició sesión en el panel)
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return resp(401, { error: 'Falta iniciar sesión' });
  const { data: quien, error: eQuien } = await srv.auth.getUser(token);
  if (eQuien || !quien?.user) return resp(401, { error: 'Sesión no válida' });

  // 2. ¿Es admin?
  const { data: yo } = await srv.from('admins').select('rol').eq('user_id', quien.user.id).maybeSingle();
  if (!yo || yo.rol !== 'admin') return resp(403, { error: 'Solo un administrador puede gestionar usuarios' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return resp(400, { error: 'Cuerpo inválido' });
  }
  const accion = String(body.accion || '');

  const cuantosAdmins = async () => {
    const { count } = await srv.from('admins').select('user_id', { count: 'exact', head: true }).eq('rol', 'admin');
    return count || 0;
  };

  try {
    if (accion === 'listar') {
      const { data, error } = await srv.from('admins').select('user_id, email, nombre, rol, created_at')
        .order('created_at');
      if (error) throw error;
      return resp(200, { usuarios: data });
    }

    if (accion === 'crear') {
      const email = String(body.email || '').trim().toLowerCase();
      const rol = String(body.rol || 'editor');
      const nombre = String(body.nombre || '').trim().slice(0, 80) || null;
      if (!EMAIL.test(email)) return resp(400, { error: 'Correo no válido' });
      if (!ROLES.includes(rol)) return resp(400, { error: 'Rol no válido' });
      if (!claveValida(body.password)) {
        return resp(400, { error: 'La contraseña debe tener al menos 10 caracteres, con letras y números' });
      }
      const { data, error } = await srv.auth.admin.createUser({
        email, password: String(body.password), email_confirm: true, user_metadata: { nombre },
      });
      if (error) return resp(400, { error: error.message.includes('already') ? 'Ese correo ya existe' : error.message });
      const { error: e2 } = await srv.from('admins').insert({ user_id: data.user.id, email, nombre, rol });
      if (e2) {
        await srv.auth.admin.deleteUser(data.user.id);
        throw e2;
      }
      return resp(200, { usuario: { user_id: data.user.id, email, nombre, rol } });
    }

    const userId = String(body.user_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return resp(400, { error: 'Usuario no válido' });

    if (accion === 'rol') {
      const rol = String(body.rol || '');
      if (!ROLES.includes(rol)) return resp(400, { error: 'Rol no válido' });
      if (rol !== 'admin' && userId === quien.user.id && (await cuantosAdmins()) <= 1) {
        return resp(400, { error: 'Debe quedar al menos un administrador' });
      }
      const { error } = await srv.from('admins').update({ rol }).eq('user_id', userId);
      if (error) throw error;
      return resp(200, { ok: true });
    }

    if (accion === 'clave') {
      if (!claveValida(body.password)) {
        return resp(400, { error: 'La contraseña debe tener al menos 10 caracteres, con letras y números' });
      }
      const { error } = await srv.auth.admin.updateUserById(userId, { password: String(body.password) });
      if (error) throw error;
      return resp(200, { ok: true });
    }

    if (accion === 'quitar') {
      if (userId === quien.user.id) return resp(400, { error: 'No puedes eliminar tu propio usuario' });
      const { error } = await srv.auth.admin.deleteUser(userId); // admins se borra en cascada
      if (error) throw error;
      return resp(200, { ok: true });
    }

    return resp(400, { error: 'Acción desconocida' });
  } catch (e) {
    console.error(e);
    return resp(500, { error: 'Error interno' });
  }
});
