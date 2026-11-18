// ============== Arranque ==============
(function arrancar() {
  const s = ls.get('userSession', null);
  if (s && s.tok && s.boot && Date.now() - s.t < 7 * 24 * 3600 * 1000) entrar(s.tok, s.boot);      // pinta de inmediato con lo guardado
  // Confirma la sesión real con Supabase (y trae el rol actualizado).
  gsCall('getBoot', []).then((r) => {
    if (r.success) {
      if ($auth.get().tok) { patchBoot(r.boot); aplicarLook(r.boot.look); } else entrar(r.tok, r.boot, r.pre);
    } else if (r.code === 'NOADMIN') {
      sb.auth.signOut(); if ($auth.get().tok) salir(true, true); toast(r.message, 'warn');
    } else if ($auth.get().tok && r.code === 'AUTH') salir(true);
  }).catch(() => {});
  sb.auth.onAuthStateChange((ev, ses) => {
    // Enlace de "Olvidé mi contraseña": entra y pide la contraseña nueva.
    if (ev === 'PASSWORD_RECOVERY') {
      gsCall('getBoot', []).then((r) => {
        if (r.success) entrar(r.tok, Object.assign({}, r.boot, { me: Object.assign({}, r.boot.me, { debe: 1 }) }), r.pre);
        else toast(r.message, 'warn');
      });
    }
    // Al renovarse el token, el kernel guarda el nuevo.
    if (ev === 'TOKEN_REFRESHED' && ses && $auth.get().tok) { const a = $auth.get(); $auth.set({ tok: ses.access_token, boot: a.boot }); }
    if (ev === 'SIGNED_OUT' && $auth.get().tok) salir(true, true);
  });
  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
