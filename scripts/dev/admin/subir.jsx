// Las fotos se comprimen en el navegador ANTES de subir: se corrige la orientación (EXIF) y se generan
// versiones WebP livianas (JPG si el navegador no soporta WebP). En la base de datos solo va la ruta.
//   foto:  grande 1200 px (≤ 150 KB) + mini 400 px (≤ 30 KB)
//   logo:  una sola versión de 200 px (≤ 30 KB)
const FOTOS = {
  maxBytes: 10 * 1024 * 1024,
  tipos: ['image/jpeg', 'image/png', 'image/webp'],
  versiones: {
    foto: [{ k: 'grande', lado: 1200, kb: 150 }, { k: 'mini', lado: 400, kb: 30 }],
    logo: [{ k: 'logo', lado: 200, kb: 30 }]
  }
};
const _webp = { v: null };
function soportaWebp() {
  if (_webp.v === null) {
    try { const c = document.createElement('canvas'); c.width = c.height = 2; _webp.v = c.toDataURL('image/webp').indexOf('data:image/webp') === 0; } catch (e) { _webp.v = false; }
  }
  return _webp.v;
}
function validarFoto(file) {
  if (!file) return 'No se recibió ningún archivo.';
  const ext = String((/\.([a-z0-9]+)$/i.exec(file.name || '') || [])[1] || '').toLowerCase();
  const tipoOk = FOTOS.tipos.indexOf(file.type) >= 0 || (!file.type && ['jpg', 'jpeg', 'png', 'webp'].indexOf(ext) >= 0);
  if (!tipoOk) return 'Formato no permitido (' + (ext || file.type || 'desconocido').toUpperCase() + '). Usa una foto JPG, PNG o WebP.';
  if (file.size > FOTOS.maxBytes) return 'La foto pesa ' + pesoTxt(file.size) + '. El máximo es 10 MB.';
  return '';
}
// Orientación EXIF de un JPG (1 = normal). Solo se usa si el navegador no la corrige solo.
async function orientacionExif(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer(), v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return 1;
    let o = 2;
    while (o + 4 < v.byteLength) {
      const marca = v.getUint16(o), largo = v.getUint16(o + 2);
      if (marca === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = v.getUint16(t) === 0x4949, n = v.getUint16(t + v.getUint32(t + 4, le), le);
        for (let i = 0; i < n; i++) {
          const e = t + v.getUint32(t + 4, le) + 2 + i * 12;
          if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le) || 1;
        }
        return 1;
      }
      if ((marca & 0xFF00) !== 0xFF00) break;
      o += 2 + largo;
    }
  } catch (e) { /* sin EXIF */ }
  return 1;
}
async function decodificar(file) {
  // createImageBitmap con imageOrientation "from-image" ya aplica la rotación del EXIF.
  if (window.createImageBitmap) {
    try { const b = await createImageBitmap(file, { imageOrientation: 'from-image' }); return { src: b, w: b.width, h: b.height, orient: 1 }; } catch (e) { /* plan B */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('El archivo no es una imagen válida.')); i.src = url; });
    const auto = window.CSS && CSS.supports && CSS.supports('image-orientation', 'from-image');
    const orient = auto ? 1 : await orientacionExif(file);
    const gira = orient >= 5 && orient <= 8;
    return { src: img, w: gira ? img.naturalHeight : img.naturalWidth, h: gira ? img.naturalWidth : img.naturalHeight, orient };
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
function dibujar(im, w, h, tipo) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (tipo === 'image/jpeg') { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); }
  const o = im.orient || 1;
  if (o > 1) {
    const T = { 2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h], 5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, w, 0], 7: [0, -1, -1, 0, w, h], 8: [0, -1, 1, 0, 0, h] }[o];
    if (T) g.setTransform(T[0], T[1], T[2], T[3], T[4], T[5]);
  }
  const gira = o >= 5 && o <= 8;
  g.imageSmoothingQuality = 'high';
  g.drawImage(im.src, 0, 0, gira ? h : w, gira ? w : h);
  return c;
}
const aBlob = (c, tipo, q) => new Promise((ok) => c.toBlob((b) => ok(b), tipo, q));
// Reduce calidad y, si hace falta, tamaño, hasta quedar bajo el peso meta.
async function comprimir(im, lado, kb) {
  const tipo = soportaWebp() ? 'image/webp' : 'image/jpeg';
  let escala = Math.min(1, lado / Math.max(im.w, im.h));
  for (let intento = 0; intento < 10; intento++) {
    const w = Math.max(1, Math.round(im.w * escala)), h = Math.max(1, Math.round(im.h * escala));
    const c = dibujar(im, w, h, tipo);
    for (const q of [0.82, 0.72, 0.62, 0.52, 0.42]) {
      const b = await aBlob(c, tipo, q);
      if (b && b.size <= kb * 1024) return { blob: b, tipo, w, h, q };
    }
    escala *= 0.85;
  }
  throw new Error('No se pudo comprimir la imagen.');
}
// Procesa sin subir (lo usan las pruebas automáticas).
async function procesarFoto(file, clase) {
  const err = validarFoto(file);
  if (err) throw new Error(err);
  const im = await decodificar(file);
  const out = {};
  for (const v of FOTOS.versiones[clase === 'logo' ? 'logo' : 'foto']) out[v.k] = await comprimir(im, v.lado, v.kb);
  if (im.src && im.src.close) im.src.close();
  return out;
}
const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
async function subirBlob(blob, tipo, carpeta, sufijo) {
  const ruta = (carpeta || 'negocios') + '/' + new Date().getFullYear() + '/' + uuid() + '-' + sufijo + (tipo === 'image/webp' ? '.webp' : '.jpg');
  const { error } = await sb.storage.from(BUCKET).upload(ruta, blob, { cacheControl: '31536000', contentType: tipo, upsert: false });
  if (error) throw error;
  return ruta;
}
window.fgFotos = { validarFoto, procesarFoto, orientacionExif, soportaWebp, FOTOS };

// Zona para subir: clic, arrastrar y soltar, o pegar con Ctrl+V.
//   clase "foto": value = { grande, mini } (rutas) · clase "logo": value = ruta
//   onSubida(rutas): avisa qué se subió, para borrarlo si el formulario se cancela.
const _sub = { n: 0, activo: null };
function Subir({ clase, value, onChange, carpeta, disabled, onSubida }) {
  const esLogo = clase === 'logo';
  const [local, setLocal] = useState(''), [sub, setSub] = useState(false), [sobre, setSobre] = useState(false);
  const inp = useRef(null), yo = useRef({}), fn = useRef(null);
  const tomar = async (file) => {
    if (!file || disabled || sub) return;
    const err = validarFoto(file);
    if (err) return toast(err, 'warn');
    setSub(true); _sub.n++;
    try {
      const p = await procesarFoto(file, esLogo ? 'logo' : 'foto');
      const prev = esLogo ? p.logo : p.mini;
      setLocal(URL.createObjectURL(prev.blob));                       // se ve al instante
      let res, peso;
      if (esLogo) {
        res = await subirBlob(p.logo.blob, p.logo.tipo, carpeta, 'logo');
        peso = p.logo.blob.size;
        if (onSubida) onSubida([res]);
      } else {
        const g = await subirBlob(p.grande.blob, p.grande.tipo, carpeta, 'g');
        const m = await subirBlob(p.mini.blob, p.mini.tipo, carpeta, 'm');
        res = { grande: g, mini: m };
        peso = p.grande.blob.size + p.mini.blob.size;
        if (onSubida) onSubida([g, m]);
      }
      onChange(res);
      toast('Foto lista (' + pesoTxt(peso) + ')', 'ok');
    } catch (e) {
      setLocal('');
      const m = fallo(e);
      if (m.code === 'AUTH') salir(true); else alerta('No se pudo subir la foto', m.message);
    } finally { _sub.n--; setSub(false); }
  };
  fn.current = tomar;
  useEffect(() => {
    const pegar = (e) => {
      if (_sub.activo !== yo.current) return;
      const it = Array.from((e.clipboardData || {}).items || []).filter((x) => x.kind === 'file')[0];
      if (it) { e.preventDefault(); fn.current(it.getAsFile()); }
    };
    document.addEventListener('paste', pegar); _sub.activo = yo.current;
    return () => { document.removeEventListener('paste', pegar); if (_sub.activo === yo.current) _sub.activo = null; };
  }, []);
  const ruta = esLogo ? value : (value && (value.mini || value.grande));
  const src = local || urlPublica(ruta), hay = !!src;
  const aqui = () => { _sub.activo = yo.current; };
  return (
    <div className={cx('up', 'up-img', esLogo && 'up-logo', sobre && 'over')} tabIndex={0} role="button" aria-label={esLogo ? 'Subir logo' : 'Subir foto'}
      onClick={() => { if (!disabled) inp.current.click(); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.current.click(); } }}
      onMouseEnter={aqui} onFocus={aqui} onDragOver={(e) => { e.preventDefault(); setSobre(true); }} onDragLeave={() => setSobre(false)}
      onDrop={(e) => { e.preventDefault(); setSobre(false); tomar(e.dataTransfer.files[0]); }}>
      <input ref={inp} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; tomar(f); }} />
      {hay ? <img src={src} alt="" /> : null}
      {!hay ? <div className="up-txt"><Ic n="fa-image" /><b>{esLogo ? 'Subir logo' : 'Subir foto'}</b><small>JPG, PNG o WebP · máx. 10 MB</small></div> : null}
      {sub ? <div className="up-bar"></div> : null}
      {hay && !disabled && !sub ? <button type="button" className="up-x" aria-label="Quitar" title="Quitar" onClick={(e) => { e.stopPropagation(); setLocal(''); onChange(esLogo ? '' : { grande: '', mini: '' }); }}><Ic n="fa-xmark" /></button> : null}
    </div>
  );
}
// Lleva la cuenta de lo subido en un formulario: si se cancela, se borra; si se guarda, se borra lo que quedó sin usar.
function useSubidas(inicial) {
  const lista = useRef(inicial || []);
  return {
    lista,
    agregar: (rutas) => { lista.current = lista.current.concat(rutas); },
    limpiar: (enUso) => {
      const sobran = lista.current.filter((r) => (enUso || []).indexOf(r) < 0);
      lista.current = [];
      if (sobran.length) gsCall('borrarArchivos', [sobran]).catch(() => {});
    }
  };
}
