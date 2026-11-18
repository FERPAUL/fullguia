// ============== Pantallas de FullGuia ==============
const TONOS_PLAN = { Destacado: 'ok', 'Por vencer': 'warn', Vencido: 'bad', Gratis: 'mute' };
const ICONOS_CAT = [
  { value: 'comidas', label: 'Comidas', fa: 'fa-mug-hot' }, { value: 'hoteles', label: 'Hoteles', fa: 'fa-bed' },
  { value: 'salud', label: 'Salud', fa: 'fa-heart-pulse' }, { value: 'vehiculos', label: 'Vehículos', fa: 'fa-truck' },
  { value: 'hogar', label: 'Hogar', fa: 'fa-house' }, { value: 'tecnologia', label: 'Tecnología', fa: 'fa-desktop' },
  { value: 'educacion', label: 'Educación', fa: 'fa-graduation-cap' }, { value: 'tienda', label: 'Tienda', fa: 'fa-bag-shopping' },
  { value: 'belleza', label: 'Belleza', fa: 'fa-scissors' }, { value: 'deporte', label: 'Deporte', fa: 'fa-person-running' },
  { value: 'servicios', label: 'Servicios', fa: 'fa-wrench' }, { value: 'turismo', label: 'Turismo', fa: 'fa-compass' },
  { value: 'mas', label: 'Otros', fa: 'fa-ellipsis' }
];
const COLORES_CAT = [
  { value: 'orange', label: 'Naranja', hex: '#FF6B00' }, { value: 'blue', label: 'Azul', hex: '#0077FF' }, { value: 'green', label: 'Verde', hex: '#00C853' },
  { value: 'purple', label: 'Morado', hex: '#9C27B0' }, { value: 'yellow', label: 'Amarillo', hex: '#FFB300' }, { value: 'cyan', label: 'Celeste', hex: '#00BCD4' },
  { value: 'red', label: 'Rojo', hex: '#E53935' }, { value: 'gray', label: 'Gris', hex: '#90A4AE' }
];
const TONOS_ETIQUETA = [{ value: 'azul', label: 'Azul' }, { value: 'amarillo', label: 'Amarillo' }, { value: 'morado', label: 'Morado' }, { value: 'verde', label: 'Verde' }];
const PRECIO_LABELS = ['Desde', 'Desde por noche', 'Desde por persona', 'Desde por mes'].map((v) => ({ value: v, label: v }));
const sitio = (ruta) => '../' + ruta;
const Miniatura = ({ ruta }) => (ruta ? <img className="thumb" src={urlPublica(ruta)} alt="" loading="lazy" /> : <span className="thumb thumb-ph"><Ic n="fa-image" /></span>);
const Area = ({ value, onChange, ...p }) => <textarea className="inp" value={value == null ? '' : value} onChange={(e) => onChange(e.target.value)} {...p}></textarea>;

// ---------- Inicio ----------
function Inicio() {
  const q = useRead('getInicio'), d = q.data || {}, r = d.resumen || {}, me = $auth.get().boot.me;
  return (
    <div className="stack">
      <div><h2 style={{ fontSize: 20 }}>Hola, {String(me.nombre).split(' ')[0]}</h2><p className="muted">Así va FullGuia hoy, {fmtFecha(r.hoy || hoyCO())}.</p></div>
      <Acciones>{can('negocios', 'a') ? <Btn kind="primary" icon="fa-plus" data-primary="1" onClick={() => ir('negocios', { nuevo: 1 })}>Nuevo negocio</Btn> : null}</Acciones>
      <Kpis items={d.kpis} loading={q.loading} />
      {q.error ? <div className="card"><Vacio icon="fa-plug-circle-xmark" titulo="No se pudo cargar" texto={q.error} /></div> : null}
      {r.proximos && r.proximos.length ? (
        <div className="card"><div className="card-h"><Ic n="fa-hourglass-half" />Destacados que vencen en los próximos 7 días<span className="grow"></span>
          <Btn sm onClick={() => ir('negocios', { tab: 'vencer' })}>Ver todos</Btn></div>
          <div className="card-b"><ul className="feed">{r.proximos.map((n) => <li key={n.id}><span className="muted num" style={{ flex: '0 0 100px' }}>{fmtFecha(n.destacado_hasta)}</span><b className="grow">{n.nombre}</b><Pill tone="warn">Por vencer</Pill></li>)}</ul>
            <p className="muted" style={{ marginTop: 8 }}>Al renovar el pago, abre el negocio y extiende la fecha "Destacado hasta".</p></div>
        </div>) : null}
      {me.esSuper && r.demo ? (
        <div className="card"><div className="card-b row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <Pill tone="info" icon="fa-flask">{r.demo} negocios demo</Pill>
          <span className="grow muted">Son datos de ejemplo para mostrar el sitio. Cuando cargues los negocios reales, bórralos desde Configuración.</span>
          <Btn sm icon="fa-gear" onClick={() => ir('configuracion')}>Ir a Configuración</Btn>
        </div></div>) : null}
      <div className="card"><div className="card-b row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <Btn icon="fa-globe" onClick={() => window.open(sitio('index.html'), '_blank', 'noopener')}>Ver sitio público</Btn>
        {can('importar', 'a') ? <Btn icon="fa-file-csv" onClick={() => ir('importar')}>Importar negocios desde CSV</Btn> : null}
        <Btn icon="fa-percent" onClick={() => ir('ofertas')}>Ofertas</Btn>
      </div></div>
    </div>
  );
}

// ---------- Negocios ----------
const NEG_VACIO = { nombre: '', categoria_id: '', etiqueta: '', etiqueta_tono: 'azul', ciudad: '', direccion: '', whatsapp: '', telefono: '', precio_desde: '',
  precio_label: 'Desde', amenidades: '', descripcion: '', rating: '', num_opiniones: '', plan: 'gratis', destacado_hasta: '', activo: 1, imagen: '', imagen_mini: '', logo: '' };

function NegocioModal({ row, borrador, cats, onClose, onFallo }) {
  const [d, setD] = useState(() => borrador || (row ? Object.assign({}, NEG_VACIO, row, {
    amenidades: (row.amenidades || []).join('\n'), precio_desde: row.precio_desde == null ? '' : row.precio_desde,
    rating: row.rating == null ? '' : row.rating, whatsapp: row.whatsapp || '', destacado_hasta: row.destacado_hasta || ''
  }) : Object.assign({}, NEG_VACIO)));
  const subidas = useSubidas(borrador && borrador._subidas);
  const set = (k) => (v) => setD((x) => Object.assign({}, x, { [k]: v }));
  const cerrar = () => { subidas.limpiar([]); onClose(); };
  const extender = (dias) => setD((x) => Object.assign({}, x, { plan: 'destacado', destacado_hasta: sumarDias(x.destacado_hasta && x.destacado_hasta > hoyCO() ? x.destacado_hasta : hoyCO(), dias) }));
  const save = () => {
    const err = validarNegocio(d);
    if (err) return toast(err, 'warn');
    if (!row && enCache('listNegocios', []).some((n) => norm(n.nombre) === norm(d.nombre) && norm(n.ciudad) === norm(d.ciudad))) {
      return toast('Ya existe un negocio con ese nombre en esa ciudad', 'warn');
    }
    const enUso = [d.imagen, d.imagen_mini, d.logo].filter(Boolean);
    subidas.limpiar(enUso);
    const cat = cats.find((c) => c.id === d.categoria_id) || {};
    const vista = Object.assign({}, d, {
      categoria: cat.nombre || '', amenidades: listaAmenidades(d.amenidades), whatsapp: normalizarWa(d.whatsapp) || '',
      estado: estadoPlan(d), activo: Number(d.activo) ? 1 : 0, demo: row ? row.demo : 0, destacado_hasta: d.destacado_hasta || null
    });
    onClose();
    optimista('saveNegocio', [d], {
      lecturas: [['listNegocios', []]], aplicar: row ? opt.cambio(row.id, vista) : opt.alta(vista),
      ok: row ? 'Negocio actualizado' : 'Negocio creado',
      alFallar: () => onFallo({ row, borrador: Object.assign({}, d, { _subidas: enUso }) })
    });
  };
  const wa = normalizarWa(d.whatsapp);
  return (
    <FormModal titulo={row ? 'Editar negocio' : 'Nuevo negocio'} icon="fa-store" size="lg" onClose={cerrar} onGuardar={save}>
      <Field label="Nombre" req><Inp value={d.nombre} onChange={set('nombre')} maxLength={120} autoFocus={!row} /></Field>
      <Field label="Categoría" req><Sel value={d.categoria_id} onChange={set('categoria_id')} options={cats.map((c) => ({ value: c.id, label: c.nombre }))} placeholder="Elegir categoría…" /></Field>
      <Field label="Ciudad"><Inp value={d.ciudad} onChange={set('ciudad')} maxLength={80} placeholder="Cúcuta" /></Field>
      <Field label="Dirección" wide><Inp value={d.direccion} onChange={set('direccion')} maxLength={200} /></Field>
      <Field label="WhatsApp" hint={d.whatsapp ? (wa ? 'Se guardará como +' + wa : 'Debe ser un celular de Colombia de 10 dígitos') : 'Celular de Colombia, ej. 300 123 4567'}>
        <Inp icon="fa-brands fa-whatsapp" value={d.whatsapp} onChange={set('whatsapp')} inputMode="tel" maxLength={20} /></Field>
      <Field label="Teléfono"><Inp icon="fa-phone" value={d.telefono} onChange={set('telefono')} inputMode="tel" maxLength={30} /></Field>
      <Field label="Etiqueta" hint="Ej. Hotel 4 Estrellas, Restaurante"><Inp value={d.etiqueta} onChange={set('etiqueta')} maxLength={60} /></Field>
      <Field label="Color de la etiqueta"><Seg value={d.etiqueta_tono} onChange={set('etiqueta_tono')} options={TONOS_ETIQUETA} /></Field>
      <Field label="Precio desde (COP)"><Inp value={d.precio_desde} onChange={set('precio_desde')} inputMode="numeric" maxLength={12} placeholder="90000" /></Field>
      <Field label="Texto del precio"><Sel value={d.precio_label} onChange={set('precio_label')} options={PRECIO_LABELS} /></Field>
      <Field label="Calificación (0 a 5)"><Inp value={d.rating} onChange={set('rating')} inputMode="decimal" maxLength={3} placeholder="4.5" /></Field>
      <Field label="N.º de opiniones"><Inp value={d.num_opiniones} onChange={set('num_opiniones')} inputMode="numeric" maxLength={6} /></Field>
      <Field label="Plan" wide>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <Seg value={d.plan} onChange={(v) => setD((x) => Object.assign({}, x, { plan: v, destacado_hasta: v === 'destacado' && !x.destacado_hasta ? sumarDias(hoyCO(), 30) : x.destacado_hasta }))}
            options={[{ value: 'gratis', label: 'Gratis' }, { value: 'destacado', label: 'Destacado' }]} />
          {d.plan === 'destacado' ? <React.Fragment>
            <span className="muted">hasta</span>
            <div style={{ width: 170 }}><Inp type="date" value={d.destacado_hasta} onChange={set('destacado_hasta')} aria-label="Destacado hasta" /></div>
            <Btn sm onClick={() => extender(30)}>+30 días</Btn><Btn sm onClick={() => extender(365)}>+1 año</Btn>
            <Pill tone={TONOS_PLAN[estadoPlan(d)]}>{estadoPlan(d)}</Pill>
          </React.Fragment> : null}
        </div>
      </Field>
      <Field label="Comodidades / servicios" hint="Una por línea. Puedes usar emojis: 📶 WiFi" wide><Area value={d.amenidades} onChange={set('amenidades')} rows={3} /></Field>
      <Field label="Descripción" wide><Area value={d.descripcion} onChange={set('descripcion')} rows={3} maxLength={4000} /></Field>
      <Field label="Foto principal" hint="Se guarda en 2 tamaños livianos (WebP)."><Subir clase="foto" value={{ grande: d.imagen, mini: d.imagen_mini }} carpeta="negocios" onSubida={subidas.agregar}
        onChange={(v) => setD((x) => Object.assign({}, x, { imagen: v.grande || '', imagen_mini: v.mini || '' }))} /></Field>
      <Field label="Logo" hint="Opcional. Se guarda a 200 px."><Subir clase="logo" value={d.logo} carpeta="logos" onSubida={subidas.agregar} onChange={set('logo')} /></Field>
      <Field label="Visible en el sitio"><Toggle value={d.activo} onChange={set('activo')} label={Number(d.activo) ? 'Publicado' : 'Pausado'} /></Field>
    </FormModal>
  );
}

function Negocios({ seed }) {
  const q = useRead('listNegocios'), rows = (q.data || {}).rows || [];
  const cats = (useRead('listCategorias').data || {}).rows || [];
  const [tab, setTab] = useState((seed && seed.tab) || 'todos'), [edit, setEdit] = useState(seed && seed.nuevo ? {} : null), [sel, setSel] = useState([]);
  const FILTROS = {
    todos: () => true, destacados: (r) => r.estado === 'Destacado' || r.estado === 'Por vencer', vencer: (r) => r.estado === 'Por vencer',
    vencidos: (r) => r.estado === 'Vencido', pausados: (r) => !r.activo, demo: (r) => r.demo
  };
  const cuenta = (k) => rows.filter(FILTROS[k]).length;
  const vista = useMemo(() => rows.filter(FILTROS[tab]), [rows, tab]);
  const borrar = async (r) => {
    if (!await confirmar('¿Eliminar ' + r.nombre + '?', 'Se borran también sus ofertas y fotos. No se puede deshacer.', { peligro: 1, ok: 'Sí, eliminar' })) return;
    optimista('deleteNegocio', [r.id], { lecturas: [['listNegocios', []]], aplicar: opt.baja([r.id]), ok: 'Negocio eliminado' });
  };
  const masivo = (cambios, texto) => {
    const ids = sel.slice();
    setSel([]);
    optimista('updateNegocios', [ids, cambios], {
      lecturas: [['listNegocios', []]], ok: texto,
      aplicar: (dd) => Object.assign({}, dd, { rows: (dd.rows || []).map((r) => (ids.indexOf(r.id) >= 0 ? Object.assign({}, r, cambios, { _pend: 1 }) : r)) })
    });
  };
  return (
    <div className="stack">
      <Acciones>{can('negocios', 'a') ? <Btn kind="primary" icon="fa-plus" data-primary="1" onClick={() => setEdit({})}>Nuevo negocio</Btn> : null}</Acciones>
      <Tabs value={tab} onChange={(v) => { setTab(v); setSel([]); }} items={[
        { value: 'todos', label: 'Todos', count: rows.length }, { value: 'destacados', label: 'Destacados', count: cuenta('destacados') },
        { value: 'vencer', label: 'Por vencer', count: cuenta('vencer') }, { value: 'vencidos', label: 'Vencidos', count: cuenta('vencidos') },
        { value: 'pausados', label: 'Pausados', count: cuenta('pausados') }, { value: 'demo', label: 'Demo', count: cuenta('demo') }]} />
      <Tabla nombre="negocios" titulo="Negocios" rows={vista} loading={q.loading} error={q.error}
        onRow={can('negocios', 'e') ? (r) => setEdit({ row: r }) : undefined}
        seleccion={can('negocios', 'e') ? sel : undefined} onSel={can('negocios', 'e') ? setSel : undefined}
        extra={sel.length ? <React.Fragment>
          <Btn sm icon="fa-eye" onClick={() => masivo({ activo: 1 }, 'Negocios publicados')}>Publicar</Btn>
          <Btn sm icon="fa-eye-slash" onClick={() => masivo({ activo: 0 }, 'Negocios pausados')}>Pausar</Btn>
        </React.Fragment> : null}
        vacio={<Vacio icon="fa-store" titulo="Aún no hay negocios" texto="Crea el primero o impórtalos desde un archivo CSV.">
          {can('negocios', 'a') ? <Btn kind="primary" icon="fa-plus" onClick={() => setEdit({})}>Nuevo negocio</Btn> : null}</Vacio>}
        cols={[
          { k: 'imagen_mini', label: 'Foto', t: 'img', render: (r) => <Miniatura ruta={r.imagen_mini || r.imagen} /> },
          { k: 'nombre', label: 'Negocio', render: (r) => <div><b>{r.nombre}</b>{r.demo ? <span style={{ marginLeft: 6 }}><Pill tone="info">demo</Pill></span> : null}<div className="muted">{r.etiqueta || ''}</div></div> },
          { k: 'categoria', label: 'Categoría' },
          { k: 'ciudad', label: 'Ciudad' },
          { k: 'estado', label: 'Plan', t: 'pill', tones: TONOS_PLAN },
          { k: 'destacado_hasta', label: 'Destacado hasta', t: 'date' },
          { k: 'activo', label: 'Publicado', t: 'flag' }
        ]}
        acciones={[
          { icon: 'fa-arrow-up-right-from-square', title: 'Ver en el sitio', onClick: (r) => window.open(sitio('negocio.html?slug=' + encodeURIComponent(r.slug)), '_blank', 'noopener'), show: (r) => !!r.slug && !!r.activo },
          { icon: 'fa-pen', title: 'Editar', onClick: (r) => setEdit({ row: r }), show: () => can('negocios', 'e') },
          { icon: 'fa-trash', title: 'Eliminar', tone: 'bad', onClick: borrar, show: () => can('negocios', 'd') }
        ]} />
      {edit ? <NegocioModal row={edit.row} borrador={edit.borrador} cats={cats} onClose={() => setEdit(null)} onFallo={setEdit} /> : null}
    </div>
  );
}

// ---------- Categorías ----------
function CategoriaModal({ row, onClose }) {
  const [d, setD] = useState(row ? Object.assign({}, row) : { nombre: '', slug: '', icono: 'mas', color: 'blue', orden: 100, activa: 1 });
  const set = (k) => (v) => setD((x) => Object.assign({}, x, { [k]: v }));
  const save = () => {
    if (String(d.nombre || '').trim().length < 2) return toast('Escribe el nombre de la categoría', 'warn');
    if (!row && enCache('listCategorias', []).some((c) => norm(c.nombre) === norm(d.nombre))) return toast('Ya existe una categoría con ese nombre', 'warn');
    onClose();
    optimista('saveCategoria', [d], {
      lecturas: [['listCategorias', []]], ok: row ? 'Categoría actualizada' : 'Categoría creada',
      aplicar: row ? opt.cambio(row.id, d) : opt.alta(Object.assign({ total: 0 }, d), true)
    });
  };
  const ico = ICONOS_CAT.find((i) => i.value === d.icono) || ICONOS_CAT[ICONOS_CAT.length - 1];
  const col = COLORES_CAT.find((c) => c.value === d.color) || COLORES_CAT[0];
  return (
    <FormModal titulo={row ? 'Editar categoría' : 'Nueva categoría'} icon="fa-tags" onClose={onClose} onGuardar={save}>
      <Field label="Nombre" req><Inp value={d.nombre} onChange={set('nombre')} maxLength={60} autoFocus={!row} /></Field>
      <Field label="Dirección web" hint={'Queda: categoria.html?cat=' + (d.slug || norm(d.nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || '…') + '. Déjalo vacío para crearla sola.'}>
        <Inp value={d.slug} onChange={set('slug')} maxLength={60} placeholder="automática" /></Field>
      <Field label="Ícono"><Sel value={d.icono} onChange={set('icono')} options={ICONOS_CAT} /></Field>
      <Field label="Color"><Sel value={d.color} onChange={set('color')} options={COLORES_CAT} /></Field>
      <Field label="Orden" hint="Las de menor número salen primero en el inicio."><Inp value={d.orden} onChange={set('orden')} inputMode="numeric" maxLength={4} /></Field>
      <Field label="Visible"><Toggle value={d.activa} onChange={set('activa')} label={Number(d.activa) ? 'Visible en el sitio' : 'Oculta'} /></Field>
      <div className="field wide"><span className="lbl">Vista previa</span>
        <div className="row" style={{ gap: 12 }}><span className="fg-cat-ic" style={{ background: col.hex }}><Ic n={ico.fa} /></span><b>{d.nombre || 'Categoría'}</b></div></div>
    </FormModal>
  );
}
function Categorias() {
  const q = useRead('listCategorias'), rows = (q.data || {}).rows || [];
  const [edit, setEdit] = useState(null);
  const borrar = async (r) => {
    if (!await confirmar('¿Eliminar la categoría ' + r.nombre + '?', '', { peligro: 1, ok: 'Sí, eliminar' })) return;
    optimista('deleteCategoria', [r.id], { lecturas: [['listCategorias', []]], aplicar: opt.baja([r.id]), ok: 'Categoría eliminada' });
  };
  const COL = Object.fromEntries(COLORES_CAT.map((c) => [c.value, c.hex])), ICO = Object.fromEntries(ICONOS_CAT.map((i) => [i.value, i.fa]));
  return (
    <div className="stack">
      <Acciones>{can('categorias', 'a') ? <Btn kind="primary" icon="fa-plus" data-primary="1" onClick={() => setEdit({})}>Nueva categoría</Btn> : null}</Acciones>
      {!can('categorias', 'e') ? <p className="muted">Solo el administrador puede crear o cambiar categorías.</p> : null}
      <Tabla nombre="categorias" titulo="Categorías" rows={rows} loading={q.loading} error={q.error} onRow={can('categorias', 'e') ? (r) => setEdit({ row: r }) : undefined}
        cols={[
          { k: 'nombre', label: 'Categoría', render: (r) => <div className="row" style={{ gap: 10 }}><span className="fg-cat-ic" style={{ background: COL[r.color] || '#90A4AE' }}><Ic n={ICO[r.icono] || 'fa-ellipsis'} /></span><b>{r.nombre}</b></div> },
          { k: 'slug', label: 'Dirección web' },
          { k: 'total', label: 'Negocios', t: 'num' },
          { k: 'orden', label: 'Orden', t: 'num' },
          { k: 'activa', label: 'Visible', t: 'flag' }
        ]}
        acciones={[
          { icon: 'fa-arrow-up-right-from-square', title: 'Ver en el sitio', onClick: (r) => window.open(sitio('categoria.html?cat=' + encodeURIComponent(r.slug)), '_blank', 'noopener'), show: (r) => !!r.slug },
          { icon: 'fa-pen', title: 'Editar', onClick: (r) => setEdit({ row: r }), show: () => can('categorias', 'e') },
          { icon: 'fa-trash', title: 'Eliminar', tone: 'bad', onClick: borrar, show: (r) => can('categorias', 'd') && !r.total }
        ]} />
      {edit ? <CategoriaModal row={edit.row} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

// ---------- Ofertas ----------
function OfertaModal({ row, borrador, negocios, onClose, onFallo }) {
  const [d, setD] = useState(() => borrador || (row ? Object.assign({}, row, { vigente_hasta: row.vigente_hasta || '' })
    : { negocio_id: '', titulo: '', descuento: '', imagen: '', imagen_mini: '', vigente_hasta: sumarDias(hoyCO(), 30), activa: 1, orden: 100 }));
  const subidas = useSubidas(borrador && borrador._subidas);
  const set = (k) => (v) => setD((x) => Object.assign({}, x, { [k]: v }));
  const cerrar = () => { subidas.limpiar([]); onClose(); };
  const save = () => {
    if (!d.negocio_id) return toast('Elige el negocio', 'warn');
    if (String(d.titulo || '').trim().length < 2) return toast('Escribe el título de la oferta', 'warn');
    if (!String(d.descuento || '').trim()) return toast('Escribe el descuento, ej. -20% o 2x1', 'warn');
    const enUso = [d.imagen, d.imagen_mini].filter(Boolean);
    subidas.limpiar(enUso);
    const neg = negocios.find((n) => n.id === d.negocio_id) || {};
    const vista = Object.assign({}, d, { negocio: neg.nombre || '', activa: Number(d.activa) ? 1 : 0,
      vigente: Number(d.activa) && (!d.vigente_hasta || d.vigente_hasta >= hoyCO()) ? 'Vigente' : (Number(d.activa) ? 'Vencida' : 'Pausada') });
    onClose();
    optimista('saveOferta', [d], {
      lecturas: [['listOfertas', []]], aplicar: row ? opt.cambio(row.id, vista) : opt.alta(vista), ok: row ? 'Oferta actualizada' : 'Oferta creada',
      alFallar: () => onFallo({ row, borrador: Object.assign({}, d, { _subidas: enUso }) })
    });
  };
  return (
    <FormModal titulo={row ? 'Editar oferta' : 'Nueva oferta'} icon="fa-percent" onClose={cerrar} onGuardar={save}>
      <Field label="Negocio" req wide><Sel value={d.negocio_id} onChange={set('negocio_id')} options={negocios.map((n) => ({ value: n.id, label: n.nombre + (n.ciudad ? ' · ' + n.ciudad : '') }))} placeholder="Elegir negocio…" /></Field>
      <Field label="Título" req><Inp value={d.titulo} onChange={set('titulo')} maxLength={120} placeholder="Pizza familiar" /></Field>
      <Field label="Descuento" req hint="Lo que sale en la etiqueta amarilla."><Inp value={d.descuento} onChange={set('descuento')} maxLength={12} placeholder="-20%" /></Field>
      <Field label="Vigente hasta" hint="Vacío = sin fecha de fin."><Inp type="date" value={d.vigente_hasta} onChange={set('vigente_hasta')} /></Field>
      <Field label="Orden"><Inp value={d.orden} onChange={set('orden')} inputMode="numeric" maxLength={4} /></Field>
      <Field label="Foto"><Subir clase="foto" value={{ grande: d.imagen, mini: d.imagen_mini }} carpeta="ofertas" onSubida={subidas.agregar}
        onChange={(v) => setD((x) => Object.assign({}, x, { imagen: v.grande || '', imagen_mini: v.mini || '' }))} /></Field>
      <Field label="Activa"><Toggle value={d.activa} onChange={set('activa')} label={Number(d.activa) ? 'Activa' : 'Pausada'} /></Field>
    </FormModal>
  );
}
function Ofertas() {
  const q = useRead('listOfertas'), rows = (q.data || {}).rows || [];
  const negocios = (useRead('listNegocios').data || {}).rows || [];
  const [edit, setEdit] = useState(null);
  const borrar = async (r) => {
    if (!await confirmar('¿Eliminar la oferta ' + r.titulo + '?', '', { peligro: 1, ok: 'Sí, eliminar' })) return;
    optimista('deleteOferta', [r.id], { lecturas: [['listOfertas', []]], aplicar: opt.baja([r.id]), ok: 'Oferta eliminada' });
  };
  return (
    <div className="stack">
      <Acciones>{can('ofertas', 'a') ? <Btn kind="primary" icon="fa-plus" data-primary="1" onClick={() => setEdit({})}>Nueva oferta</Btn> : null}</Acciones>
      <Tabla nombre="ofertas" titulo="Ofertas" rows={rows} loading={q.loading} error={q.error} onRow={can('ofertas', 'e') ? (r) => setEdit({ row: r }) : undefined}
        vacio={<Vacio icon="fa-percent" titulo="Aún no hay ofertas" texto="Las ofertas vigentes salen en el inicio del sitio." />}
        cols={[
          { k: 'imagen_mini', label: 'Foto', t: 'img', render: (r) => <Miniatura ruta={r.imagen_mini || r.imagen} /> },
          { k: 'titulo', label: 'Oferta', render: (r) => <div><b>{r.descuento}</b> {r.titulo}{r.demo ? <span style={{ marginLeft: 6 }}><Pill tone="info">demo</Pill></span> : null}</div>, get: (r) => r.descuento + ' ' + r.titulo },
          { k: 'negocio', label: 'Negocio' },
          { k: 'vigente_hasta', label: 'Vigente hasta', t: 'date' },
          { k: 'vigente', label: 'Estado', t: 'pill', tones: { Vigente: 'ok', Vencida: 'bad', Pausada: 'mute' } }
        ]}
        acciones={[
          { icon: 'fa-pen', title: 'Editar', onClick: (r) => setEdit({ row: r }), show: () => can('ofertas', 'e') },
          { icon: 'fa-trash', title: 'Eliminar', tone: 'bad', onClick: borrar, show: () => can('ofertas', 'd') }
        ]} />
      {edit ? <OfertaModal row={edit.row} borrador={edit.borrador} negocios={negocios} onClose={() => setEdit(null)} onFallo={setEdit} /> : null}
    </div>
  );
}

// ---------- Importar CSV ----------
const COLS_CSV = ['nombre', 'categoria', 'etiqueta', 'ciudad', 'direccion', 'whatsapp', 'telefono', 'precio_desde', 'precio_label', 'amenidades',
  'descripcion', 'rating', 'num_opiniones', 'plan', 'destacado_hasta', 'activo', 'imagen_url'];
const fechaCSV = (s) => {
  const t = String(s || '').trim();
  if (!t) return '';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return 'x';
};
const siNo = (v) => { const t = norm(v).trim(); return t === '' ? 1 : (['si', 's', '1', 'true', 'activo', 'x', 'publicado'].indexOf(t) >= 0 ? 1 : 0); };

// Convierte el texto del CSV en filas validadas. Se exporta para las pruebas automáticas.
function analizarCSV(texto, cats, existentes) {
  const t = parseCSV(texto);
  if (!t.length) return { error: 'El archivo está vacío.', filas: [] };
  const cab = t[0].map((h) => norm(h).trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  if (cab.indexOf('nombre') < 0 || cab.indexOf('categoria') < 0) return { error: 'Faltan las columnas obligatorias "nombre" y "categoria". Descarga la plantilla.', filas: [] };
  const porCat = {};
  cats.forEach((c) => { porCat[norm(c.nombre)] = c; porCat[norm(c.slug)] = c; });
  const vistos = new Set((existentes || []).map((n) => norm(n.nombre) + '|' + norm(n.ciudad)));
  const filas = t.slice(1).map((celdas, i) => {
    const o = {};
    cab.forEach((k, j) => { o[k] = String(celdas[j] == null ? '' : celdas[j]).trim(); });
    const cat = porCat[norm(o.categoria)];
    const img = o.imagen_url || o.imagen || '';
    const datos = {
      nombre: o.nombre, categoria_id: cat ? cat.id : '', etiqueta: o.etiqueta, ciudad: o.ciudad, direccion: o.direccion, whatsapp: o.whatsapp,
      telefono: o.telefono, precio_desde: o.precio_desde, precio_label: o.precio_label || 'Desde', amenidades: o.amenidades,
      descripcion: o.descripcion, rating: o.rating, num_opiniones: o.num_opiniones, plan: norm(o.plan) === 'destacado' ? 'destacado' : 'gratis',
      destacado_hasta: fechaCSV(o.destacado_hasta), activo: siNo(o.activo), imagen: img, imagen_mini: img
    };
    let error = '';
    if (!cat) error = o.categoria ? 'La categoría "' + o.categoria + '" no existe.' : 'Falta la categoría.';
    else if (datos.destacado_hasta === 'x') error = 'La fecha "' + o.destacado_hasta + '" no es válida. Usa AAAA-MM-DD o DD/MM/AAAA.';
    else if (img && !/^https:\/\//i.test(img)) error = 'La imagen debe ser un enlace que empiece por https://';
    else if (norm(o.plan) && ['gratis', 'destacado'].indexOf(norm(o.plan)) < 0) error = 'El plan debe ser "gratis" o "destacado".';
    else error = validarNegocio(datos);
    const clave = norm(datos.nombre) + '|' + norm(datos.ciudad);
    if (!error && vistos.has(clave)) error = 'Ya existe un negocio con ese nombre en esa ciudad.';
    if (!error) vistos.add(clave);
    return { id: i + 2, fila: i + 2, nombre: datos.nombre, categoria: cat ? cat.nombre : o.categoria, ciudad: datos.ciudad, datos, error, estado: error ? 'Con error' : 'Lista' };
  });
  return { error: '', filas };
}
window.fgAnalizarCSV = analizarCSV;

function Importar() {
  const cats = (useRead('listCategorias').data || {}).rows || [];
  const negs = useRead('listNegocios');
  const [nombre, setNombre] = useState(''), [res, setRes] = useState(null), [fin, setFin] = useState(null), [ver, setVer] = useState('todas');
  const inp = useRef(null);
  const leer = async (file) => {
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name || '')) return toast('Usa un archivo .csv (en Excel: Guardar como → CSV UTF-8)', 'warn');
    if (file.size > 5 * 1024 * 1024) return toast('El archivo supera los 5 MB', 'warn');
    const texto = await file.text();
    const r = analizarCSV(texto, cats, (negs.data || {}).rows || []);
    if (r.error) return alerta('No se pudo leer el archivo', r.error);
    setNombre(file.name); setRes(r); setFin(null); setVer('todas');
  };
  const validas = res ? res.filas.filter((f) => !f.error) : [];
  const importar = async () => {
    if (!validas.length) return;
    if (!await confirmar('¿Importar ' + validas.length + ' negocios?', 'Las filas con error no se importan.')) return;
    const r = await lento('Importando ' + validas.length + ' negocios…', wr('importarNegocios', validas.map((f) => ({ fila: f.fila, datos: f.datos }))));
    if (!r.success) return alerta('No se pudo importar', r.message);
    setFin(r); setRes(null);
    toast(r.insertados + ' negocios importados', r.errores.length ? 'warn' : 'ok');
  };
  const plantilla = () => bajarCSV('plantilla-negocios', COLS_CSV, [
    ['Hotel Ejemplo', 'Hoteles', 'Hotel 3 Estrellas', 'Cúcuta', 'Av. 0 # 10-20', '3001234567', '', '120000', 'Desde por noche', '📶 WiFi|🍳 Desayuno', 'Descripción corta', '4.5', '20', 'gratis', '', 'si', ''],
    ['Pizzería Ejemplo', 'comidas', 'Restaurante', 'Los Patios', '', '3109876543', '', '', 'Desde', '🍕 Domicilios', '', '', '', 'destacado', '31/12/2026', 'si', 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=1200']
  ]);
  const vista = res ? res.filas.filter((f) => (ver === 'todas' ? true : ver === 'error' ? !!f.error : !f.error)) : [];
  return (
    <div className="stack">
      <div className="card"><div className="card-h"><Ic n="fa-file-csv" />Importar negocios desde un archivo CSV</div>
        <div className="card-b stack">
          <p className="muted">1. Descarga la plantilla y llénala en Excel (una fila por negocio). 2. Guárdala como <b>CSV UTF-8</b>. 3. Súbela aquí: verás qué filas están listas y cuáles tienen errores antes de importar.</p>
          <p className="muted">Columnas obligatorias: <b>nombre</b> y <b>categoria</b> (nombre o dirección web de una categoría existente). Las comodidades se separan con <b>|</b>. Si un negocio ya existe (mismo nombre y ciudad) se omite.</p>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <Btn icon="fa-download" onClick={plantilla}>Descargar plantilla</Btn>
            <Btn kind="primary" icon="fa-upload" data-primary="1" onClick={() => inp.current.click()} disabled={negs.loading}>Elegir archivo CSV</Btn>
            <input ref={inp} type="file" hidden accept=".csv,text/csv" onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; leer(f); }} />
            {nombre ? <span className="muted">{nombre}</span> : null}
          </div>
        </div>
      </div>
      {fin ? <div className="card"><div className="card-b stack">
        <div className="row" style={{ gap: 10 }}><Pill tone="ok" icon="fa-check">{fin.insertados} importados</Pill>{fin.errores.length ? <Pill tone="bad">{fin.errores.length} con error</Pill> : null}</div>
        {fin.errores.length ? <ul className="feed">{fin.errores.map((e, i) => <li key={i}><span className="muted" style={{ flex: '0 0 70px' }}>Fila {e.fila}</span><b>{e.nombre}</b><span className="grow">{e.error}</span></li>)}</ul> : null}
        <div><Btn icon="fa-store" onClick={() => ir('negocios')}>Ver negocios</Btn></div>
      </div></div> : null}
      {res ? <React.Fragment>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <Tabs value={ver} onChange={setVer} items={[{ value: 'todas', label: 'Todas', count: res.filas.length }, { value: 'ok', label: 'Listas', count: validas.length }, { value: 'error', label: 'Con error', count: res.filas.length - validas.length }]} />
          <span className="grow"></span>
          <Btn kind="success" icon="fa-file-import" disabled={!validas.length} onClick={importar}>Importar {validas.length} negocios</Btn>
        </div>
        <Tabla nombre="revision-importacion" titulo="Revisión de la importación" rows={vista} porPagina={30}
          cols={[{ k: 'fila', label: 'Fila', t: 'num' }, { k: 'nombre', label: 'Nombre' }, { k: 'categoria', label: 'Categoría' }, { k: 'ciudad', label: 'Ciudad' },
            { k: 'estado', label: 'Estado', t: 'pill', tones: { Lista: 'ok', 'Con error': 'bad' } }, { k: 'error', label: 'Detalle' }]} />
      </React.Fragment> : null}
    </div>
  );
}

// ---------- Usuarios (solo administrador) ----------
function UsuarioNuevo({ onClose }) {
  const [d, setD] = useState({ email: '', nombre: '', rol: 'editor', password: '' });
  const set = (k) => (v) => setD((x) => Object.assign({}, x, { [k]: v }));
  const save = () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.email).trim())) return toast('Escribe un correo válido', 'warn');
    if (enCache('listUsuarios', []).some((u) => norm(u.email) === norm(d.email))) return toast('Ese correo ya tiene usuario', 'warn');
    if (d.password && claveDebil(d.password)) return toast(claveDebil(d.password), 'warn');
    const clave = d.password || claveTemporal();
    const datos = { email: String(d.email).trim().toLowerCase(), nombre: d.nombre, rol: d.rol, password: clave };
    onClose();
    optimista('crearUsuario', [datos], {
      lecturas: [['listUsuarios', []]], aplicar: opt.alta({ email: datos.email, nombre: d.nombre, rol: d.rol, creado: '' }, true), ok: 'Creando usuario…',
      despues: () => alerta('Usuario creado: ' + datos.email, 'Entrégale esta contraseña. Puede cambiarla desde "Mi cuenta".', { tone: 'ok', codigo: clave })
    });
  };
  return (
    <FormModal titulo="Nuevo usuario" icon="fa-user-plus" onClose={onClose} onGuardar={save}>
      <Field label="Correo" req wide><Inp icon="fa-envelope" type="email" value={d.email} onChange={set('email')} maxLength={120} autoFocus /></Field>
      <Field label="Nombre"><Inp value={d.nombre} onChange={set('nombre')} maxLength={80} /></Field>
      <Field label="Rol" req><Seg value={d.rol} onChange={set('rol')} options={[{ value: 'editor', label: 'Editor' }, { value: 'admin', label: 'Administrador' }]} /></Field>
      <Field label="Contraseña" hint="Mínimo 10 caracteres con letras y números. Si la dejas vacía se genera una." wide><Clave value={d.password} onChange={set('password')} autoComplete="new-password" /></Field>
      <div className="field wide"><p className="muted"><b>Editor:</b> negocios, ofertas, fotos e importar CSV. <b>Administrador:</b> todo, incluidas categorías, usuarios y datos demo.</p></div>
    </FormModal>
  );
}
function Usuarios() {
  const q = useRead('listUsuarios'), rows = (q.data || {}).rows || [], me = $auth.get().boot.me;
  const [nuevo, setNuevo] = useState(false);
  const cambiarRol = async (r) => {
    const rol = r.rol === 'admin' ? 'editor' : 'admin';
    if (!await confirmar('¿Cambiar a ' + r.email + ' a ' + (rol === 'admin' ? 'Administrador' : 'Editor') + '?', '')) return;
    optimista('rolUsuario', [r.id, rol], { lecturas: [['listUsuarios', []]], aplicar: opt.cambio(r.id, { rol }), ok: 'Rol actualizado' });
  };
  const nuevaClave = async (r) => {
    if (!await confirmar('¿Generar una contraseña nueva para ' + r.email + '?', 'La actual dejará de servir.')) return;
    const clave = claveTemporal();
    const res = await guardar('claveUsuario', [r.id, clave], 'Contraseña cambiada');
    if (res) alerta('Contraseña nueva de ' + r.email, 'Entrégasela. Puede cambiarla desde "Mi cuenta".', { tone: 'ok', codigo: clave });
  };
  const quitar = async (r) => {
    if (!await confirmar('¿Eliminar el usuario ' + r.email + '?', 'Ya no podrá entrar al panel.', { peligro: 1, ok: 'Sí, eliminar' })) return;
    optimista('quitarUsuario', [r.id], { lecturas: [['listUsuarios', []]], aplicar: opt.baja([r.id]), ok: 'Usuario eliminado' });
  };
  return (
    <div className="stack">
      <Acciones><Btn kind="primary" icon="fa-user-plus" data-primary="1" onClick={() => setNuevo(true)}>Nuevo usuario</Btn></Acciones>
      <Tabla nombre="usuarios" titulo="Usuarios del panel" rows={rows} loading={q.loading} error={q.error}
        cols={[
          { k: 'email', label: 'Usuario', render: (r) => <div className="row"><div className="avatar">{iniciales(r.nombre || r.email)}</div><div><b>{r.nombre || r.email}</b><div className="muted">{r.email}</div></div></div>, get: (r) => (r.nombre || '') + ' ' + r.email },
          { k: 'rol', label: 'Rol', t: 'pill', get: (r) => (r.rol === 'admin' ? 'Administrador' : 'Editor'), tones: { Administrador: 'info', Editor: 'mute' } },
          { k: 'creado', label: 'Creado', t: 'date' }
        ]}
        acciones={[
          { icon: 'fa-user-shield', title: 'Cambiar rol', onClick: cambiarRol, show: (r) => r.id !== me.id },
          { icon: 'fa-key', title: 'Generar contraseña nueva', tone: 'warn', onClick: nuevaClave, show: (r) => r.id !== me.id },
          { icon: 'fa-trash', title: 'Eliminar', tone: 'bad', onClick: quitar, show: (r) => r.id !== me.id }
        ]} />
      {nuevo ? <UsuarioNuevo onClose={() => setNuevo(false)} /> : null}
    </div>
  );
}

// ---------- Configuración (solo administrador) ----------
function Configuracion() {
  const q = useRead('getInicio'), r = (q.data || {}).resumen || {}, boot = $auth.get().boot;
  const cargar = async () => {
    const res = await lento('Cargando datos demo…', wr('cargarDemo'));
    if (!res.success) return alerta('No se pudo', res.message);
    toast(res.agregados ? res.agregados + ' negocios demo agregados' : 'Los datos demo ya estaban cargados', 'ok');
  };
  const borrar = async () => {
    if (!await confirmar('¿Borrar todos los datos demo?', 'Se eliminan los ' + (r.demo || 0) + ' negocios marcados como demo, sus ofertas y sus fotos. Tus negocios reales no se tocan.', { peligro: 1, ok: 'Sí, borrar demo' })) return;
    const res = await lento('Borrando datos demo…', wr('borrarDemo'));
    if (!res.success) return alerta('No se pudo', res.message);
    toast(res.negocios + ' negocios y ' + res.ofertas + ' ofertas demo borrados', 'ok');
  };
  const wa = (window.FG_CONFIG || {}).WHATSAPP_FULLGUIA;
  return (
    <div className="stack">
      <div className="card"><div className="card-h"><Ic n="fa-flask" />Datos demo</div>
        <div className="card-b stack">
          <p className="muted">Sirven para mostrar el sitio funcionando antes de tener negocios reales. Están marcados como <b>demo</b> y se pueden borrar de una sola vez sin tocar los negocios reales.</p>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <Pill tone={r.demo ? 'info' : 'mute'}>{q.loading ? '…' : (r.demo || 0) + ' negocios demo'}</Pill>
            <span className="grow"></span>
            <Btn icon="fa-wand-magic-sparkles" onClick={cargar}>Cargar datos demo</Btn>
            <Btn kind="danger" icon="fa-trash" onClick={borrar} disabled={!r.demo}>Borrar datos demo</Btn>
          </div>
        </div>
      </div>
      <div className="card"><div className="card-h"><Ic n="fa-globe" />Sitio público</div>
        <div className="card-b stack">
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <Btn icon="fa-arrow-up-right-from-square" onClick={() => window.open(sitio('index.html'), '_blank', 'noopener')}>Abrir el sitio</Btn>
            <Pill tone={wa ? 'ok' : 'warn'} icon="fa-brands fa-whatsapp">{wa ? 'WhatsApp de FullGuia: +' + wa : 'WhatsApp de FullGuia sin configurar'}</Pill>
          </div>
          <p className="muted">El número para "Publica tu negocio" se configura en el archivo <b>js/config.js</b> (WHATSAPP_FULLGUIA).</p>
        </div>
      </div>
      <Apariencia look={boot.look} />
    </div>
  );
}
