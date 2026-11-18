// R6: advisors de seguridad y rendimiento de Supabase (Management API) + `supabase db lint`.
// Criterio: 0 ERROR y 0 WARN. Única excepción aceptada y documentada: la protección contra contraseñas
// filtradas (HaveIBeenPwned), que Supabase solo permite en el plan Pro; se verifica que el plan lo impide.
const path = require('path');
const { spawnSync } = require('child_process');
const { mgmt, env } = require('../lib/supa');

module.exports = async function (ctx) {
  const aceptados = {};
  const hibp = await mgmt('/config/auth', 'PATCH', { password_hibp_enabled: true });
  if (hibp.status >= 400 && /entitlement_required|Pro Plans/.test(JSON.stringify(hibp.json))) {
    aceptados.auth_leaked_password_protection = 'requiere plan Pro (en el plan gratis Supabase no lo permite)';
  }
  const auth = await mgmt('/config/auth');
  ctx.ok('R6', 'Auth: registro público cerrado y contraseñas de al menos 10 caracteres', auth.json.disable_signup === true && auth.json.password_min_length >= 10,
    'disable_signup=' + auth.json.disable_signup + ' · min=' + auth.json.password_min_length);

  for (const tipo of ['security', 'performance']) {
    const r = await mgmt('/advisors/' + tipo);
    ctx.ok('R6', 'Advisors de ' + (tipo === 'security' ? 'seguridad' : 'rendimiento') + ' responden', r.status === 200, 'HTTP ' + r.status);
    const lints = (r.json && r.json.lints) || [];
    const errores = lints.filter((l) => l.level === 'ERROR');
    const avisos = lints.filter((l) => l.level === 'WARN' && !aceptados[l.name]);
    const info = lints.filter((l) => l.level === 'INFO');
    ctx.ok('R6', (tipo === 'security' ? 'Seguridad' : 'Rendimiento') + ': 0 avisos críticos (ERROR)', !errores.length, errores.map((l) => l.name + ': ' + (l.detail || '')).join(' | '));
    ctx.ok('R6', (tipo === 'security' ? 'Seguridad' : 'Rendimiento') + ': 0 advertencias (WARN) sin justificar', !avisos.length, avisos.map((l) => l.name + ': ' + (l.detail || '').slice(0, 120)).join(' | '));
    lints.filter((l) => l.level === 'WARN' && aceptados[l.name]).forEach((l) => ctx.info('Aceptado: ' + l.name + ' — ' + aceptados[l.name]));
    if (info.length) ctx.info('Informativos: ' + info.map((l) => l.name + ' ' + ((/`([^`\\]+)\\?`/.exec(l.detail || '') || [])[1] || '')).join(', '));
  }

  // supabase db lint (plpgsql_check) sobre la base enlazada
  const r = spawnSync('npx', ['-y', 'supabase@latest', 'db', 'lint', '--linked', '--level', 'warning', '-s', 'public,privado'], {
    cwd: ctx.RAIZ, shell: true, encoding: 'utf8', timeout: 240000,
    env: Object.assign({}, process.env, { SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD: env.SUPABASE_DB_PASSWORD })
  });
  const salida = ((r.stdout || '') + (r.stderr || '')).trim();
  const limpio = r.status === 0 && /No schema errors found|^\s*\[\s*\]\s*$/m.test(salida);
  ctx.ok('R6', 'supabase db lint: sin errores ni advertencias en public y privado', limpio, limpio ? '' : salida.split('\n').slice(-6).join(' | ').slice(0, 400));
};
