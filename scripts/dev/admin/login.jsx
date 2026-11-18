// ============== Ingreso ==============
// Supabase Auth: correo + contraseña. "Olvidé mi contraseña" envía un enlace al correo; al abrirlo,
// el panel pide la contraseña nueva (ver NuevaClave).
function Login() {
  const [paso, setPaso] = useState('login'), [u, setU] = useState(ls.get('rsLoginUser', '')), [p, setP] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [info, setInfo] = useState('');
  const run = async (fn, args) => {
    setBusy(true); setErr(''); setInfo('');
    try { const r = await gsCall(fn, args); if (!r.success) setErr(r.message); return r; }
    catch (e) { setErr('No se pudo conectar. Revisa tu conexión.'); return { success: false }; }
    finally { setBusy(false); }
  };
  const enviar = async (e) => {
    e.preventDefault(); if (busy) return;
    if (paso === 'login') { const r = await run('login', [u.trim(), p]); if (r.success) { ls.set('rsLoginUser', u.trim()); setP(''); entrar(r.tok, r.boot, r.pre); } }
    else { const r = await run('pedirCodigo', [u.trim()]); if (r.success) { setInfo(r.message); setPaso('login'); } }
  };
  const cambiar = (x) => { setPaso(x); setErr(''); setInfo(''); };
  return (
    <div className="login">
      <form className="login-card" onSubmit={enviar}>
        <img className="login-logo fg-logo" src="../favicon.svg" alt="" />
        <h1>{BOOT.empresa || BOOT.app}</h1>
        <p className="sub">{paso === 'login' ? 'Panel de administración' : 'Te enviaremos un enlace a tu correo'}</p>
        <div className="stack">
          <Field label="Correo"><Inp icon="fa-envelope" type="email" value={u} onChange={setU} autoComplete="username" autoFocus={!u} required maxLength={120} /></Field>
          {paso === 'login' ? <Field label="Contraseña"><Clave value={p} onChange={setP} autoComplete="current-password" required autoFocus={!!u} /></Field> : null}
          {err ? <div className="login-err" role="alert">{err}</div> : null}
          {info ? <div className="hint" role="status">{info}</div> : null}
          <Btn kind="primary" type="submit" disabled={busy} icon={busy ? 'fa-spinner fa-spin' : paso === 'login' ? 'fa-arrow-right-to-bracket' : 'fa-paper-plane'}>{paso === 'login' ? 'Ingresar' : 'Enviar enlace'}</Btn>
          <div style={{ textAlign: 'center' }}>
            {paso === 'login' ? <button type="button" className="btn-link" onClick={() => cambiar('pedir')}>Olvidé mi contraseña</button>
              : <button type="button" className="btn-link" onClick={() => cambiar('login')}>Volver al ingreso</button>}
          </div>
          <div style={{ textAlign: 'center' }}><a className="btn-link" href="../index.html">Ir al sitio público</a></div>
        </div>
      </form>
    </div>
  );
}
// Al volver desde el enlace de recuperación: crear contraseña nueva sin pedir la anterior.
function NuevaClave() {
  const [n, setN] = useState(''), [n2, setN2] = useState(''), [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    if (n !== n2) return toast('Las contraseñas no coinciden', 'warn');
    setBusy(true);
    const r = await guardar('cambiarMiClave', [null, n]);
    setBusy(false);
    if (r) { const s = $auth.get(); patchBoot({ me: Object.assign({}, s.boot.me, { debe: 0 }) }); }
  };
  return (
    <Modal titulo="Crea tu contraseña nueva" icon="fa-key" size="sm"
      pie={<React.Fragment><Btn onClick={() => salir()}>Salir</Btn><Btn kind="primary" icon={busy ? 'fa-spinner fa-spin' : 'fa-check'} disabled={busy} onClick={save}>Guardar</Btn></React.Fragment>}>
      <div className="stack">
        <Field label="Contraseña nueva" hint="Mínimo 10 caracteres, con letras y números."><Clave value={n} onChange={setN} autoComplete="new-password" /></Field>
        <Field label="Repite la contraseña nueva"><Clave value={n2} onChange={setN2} autoComplete="new-password" /></Field>
      </div>
    </Modal>
  );
}
