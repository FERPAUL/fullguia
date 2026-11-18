/* PANEL FULLGUIA — interfaz del kernel r-script con la capa de datos en Supabase.
   KERNEL R-SCRIPT — interfaz. React 18 sin paso de compilación: este bloque se traduce una vez
   y el resultado se guarda en el navegador (ver el cargador al final del archivo). */
const { useState, useEffect, useRef, useMemo, useSyncExternalStore, useDeferredValue } = React;
const BOOT = window.__BOOT__ || {};

// ============== Base ==============
// localStorage puede fallar (modo privado, cuota llena): nunca debe tumbar la app.
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const mkStore = (state) => {
  const subs = new Set();
  return {
    get: () => state,
    set: (p) => { state = typeof p === 'function' ? p(state) : p; subs.forEach((f) => f()); },
    sub: (f) => { subs.add(f); return () => subs.delete(f); }
  };
};
const useStore = (s) => useSyncExternalStore(s.sub, s.get);
const cx = (...a) => a.filter(Boolean).join(' ');
const BOM = String.fromCharCode(0xFEFF);        // marca que Excel necesita para leer bien los acentos

const $auth = mkStore({ tok: '', boot: null });
const $nav = mkStore({ page: '', seed: null });
const $busy = mkStore('');
const $loads = mkStore(0);
const $toasts = mkStore([]);
const $dlg = mkStore(null);
const $look = mkStore(BOOT.look || {});
const $nuevo = mkStore(!!BOOT.nuevo);       // true mientras la app no tiene ningún usuario

// ============== Formato ==============
const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
const iniciales = (s) => String(s || '?').trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
const fmtNum = (n, dec) => Number(n || 0).toLocaleString('es-CO', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 2 : dec });
const fmtMoney = (n) => '$ ' + fmtNum(n, 0);
const fmtFecha = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s || ''));
  if (!m) return String(s || '');
  return m[3] + '/' + m[2] + '/' + m[1] + (m[4] ? ' ' + m[4] + ':' + m[5] : '');
};
const hoy = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };

// CSV según RFC 4180: comillas dobles, comas y saltos de línea dentro de un campo.
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = String(text); if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',' || ch === ';') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}
// ============== Archivos descargables ==============
// Excel, PDF, Word y CSV se generan en el navegador: nada pasa por el servidor ni queda guardado en Drive.
function bajarBlob(blob, nombre) {
  const a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const nombreArchivo = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'archivo';
const textoCelda = (v, t) => (v == null ? '' : t === 'money' ? fmtNum(v, 2) : t === 'num' ? fmtNum(v) : t === 'date' ? fmtFecha(v) : String(v));
const xmlEsc = (v) => Array.from(String(v == null ? '' : v)).filter((c) => { const n = c.charCodeAt(0); return n >= 32 || n === 9 || n === 10 || n === 13; }).join('')
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function csvTexto(cabecera, filas) {
  // Un texto que empieza con = + - @ se abriría como fórmula en Excel: se neutraliza con un apóstrofo.
  const cel = (v) => { let t = String(v == null ? '' : v); if (typeof v !== 'number' && /^[=+\-@]/.test(t)) t = "'" + t; return /[",;\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  return [cabecera].concat(filas).map((r) => r.map(cel).join(',')).join('\r\n');
}
const bajarCSV = (nombre, cabecera, filas) => bajarBlob(new Blob([BOM + csvTexto(cabecera, filas)], { type: 'text/csv;charset=utf-8' }), nombre + '.csv');

// Un .xlsx es un zip con XML dentro. Este escritor lo arma sin librerías (zip sin compresión).
const _enc = new TextEncoder();
const _crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t.push(c >>> 0); } return t; })();
const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = _crcT[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipBytes(files) {
  const u16 = (n) => [n & 255, (n >>> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const partes = [], central = []; let off = 0;
  files.forEach((f) => {
    const nm = _enc.encode(f[0]), data = _enc.encode(f[1]), crc = crc32(data);
    const comun = u16(20).concat(u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(nm.length), u16(0));
    const cab = [0x50, 0x4b, 0x03, 0x04].concat(comun);
    partes.push(Uint8Array.from(cab), nm, data);
    central.push(Uint8Array.from([0x50, 0x4b, 0x01, 0x02].concat(u16(20), comun, u16(0), u16(0), u16(0), u32(0), u32(off))), nm);
    off += cab.length + nm.length + data.length;
  });
  let tc = 0; central.forEach((c) => { tc += c.length; });
  const fin = Uint8Array.from([0x50, 0x4b, 0x05, 0x06].concat(u16(0), u16(0), u16(files.length), u16(files.length), u32(tc), u32(off), u16(0)));
  const todo = partes.concat(central, [fin]), out = new Uint8Array(off + tc + fin.length); let p = 0;
  todo.forEach((x) => { out.set(x, p); p += x.length; });
  return out;
}
const colLetra = (i) => { let t = ''; i++; while (i > 0) { const m = (i - 1) % 26; t = String.fromCharCode(65 + m) + t; i = Math.floor((i - 1) / 26); } return t; };
function xlsxBytes(titulo, cabecera, filas, tipos, colorHex) {
  const NS = 'http://schemas.openxmlformats.org/', X = '<' + '?xml version="1.0" encoding="UTF-8" standalone="yes"?' + '>';
  const cel = (v, r, c, st) => {
    const ref = colLetra(c) + r;
    if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '" s="' + st + '"><v>' + v + '</v></c>';
    return '<c r="' + ref + '" s="' + st + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
  };
  const anchos = cabecera.map((h, c) => Math.min(60, Math.max(String(h).length, filas.slice(0, 500).reduce((m, r) => Math.max(m, String(r[c] == null ? '' : r[c]).length), 0)) + 3));
  const hoja = X + '<worksheet xmlns="' + NS + 'spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + '<cols>' + anchos.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols><sheetData>'
    + '<row r="1">' + cabecera.map((h, c) => cel(String(h), 1, c, 1)).join('') + '</row>'
    + filas.map((r, i) => '<row r="' + (i + 2) + '">' + r.map((v, c) => cel(v, i + 2, c, (tipos || [])[c] === 'money' ? 2 : 0)).join('') + '</row>').join('')
    + '</sheetData><autoFilter ref="A1:' + colLetra(cabecera.length - 1) + '1"/></worksheet>';
  const color = 'FF' + String(colorHex || '#001f3f').replace('#', '').toUpperCase();
  const estilos = X + '<styleSheet xmlns="' + NS + 'spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="' + color + '"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>';
  const nombreHoja = xmlEsc(String(titulo || 'Datos').replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 31)) || 'Datos';
  return zipBytes([
    ['[Content_Types].xml', X + '<Types xmlns="' + NS + 'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', X + '<Relationships xmlns="' + NS + 'package/2006/relationships"><Relationship Id="rId1" Type="' + NS + 'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', X + '<workbook xmlns="' + NS + 'spreadsheetml/2006/main" xmlns:r="' + NS + 'officeDocument/2006/relationships"><sheets><sheet name="' + nombreHoja + '" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', X + '<Relationships xmlns="' + NS + 'package/2006/relationships"><Relationship Id="rId1" Type="' + NS + 'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="' + NS + 'officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', estilos],
    ['xl/worksheets/sheet1.xml', hoja]
  ]);
}
// Word abre un HTML guardado como .doc: basta una tabla con estilos simples.
function docHtml(titulo, sub, cabecera, filas, colorHex) {
  const c = colorHex || '#001f3f';
  return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>' + xmlEsc(titulo) + '</title>'
    + '<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222}h1{font-size:16pt;color:' + c + ';margin:0 0 2pt}p.sub{color:#666;margin:0 0 10pt}table{border-collapse:collapse;width:100%}th{background:' + c + ';color:#fff;text-align:left}td,th{border:1px solid #999;padding:4pt 6pt;font-size:10pt}</style></head>'
    + '<body><h1>' + xmlEsc(titulo) + '</h1><p class="sub">' + xmlEsc(sub) + '</p><table><thead><tr>' + cabecera.map((h) => '<th>' + xmlEsc(h) + '</th>').join('') + '</tr></thead><tbody>'
    + filas.map((r) => '<tr>' + r.map((v) => '<td>' + xmlEsc(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table></body></html>';
}
// El generador de PDF (unos 400 KB) se descarga solo la primera vez que alguien pide un PDF.
const PDF_LIBS = ['https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js', 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js'];
const _libs = {};
const cargarJs = (url) => _libs[url] || (_libs[url] = new Promise((ok, no) => {
  const el = document.createElement('script');
  el.src = url; el.onload = () => ok();
  el.onerror = () => { delete _libs[url]; no(new Error('No se pudo cargar el generador de PDF. Revisa tu conexión e inténtalo de nuevo.')); };
  document.head.appendChild(el);
}));
async function pdfNuevo(horizontal) {
  if (!(window.jspdf && window.jspdf.jsPDF)) await cargarJs(PDF_LIBS[0]);
  if (!window.jspdf.jsPDF.API.autoTable) await cargarJs(PDF_LIBS[1]);
  return new window.jspdf.jsPDF({ orientation: horizontal ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
}
const colorTema = (v, d) => { const t = getComputedStyle(document.documentElement).getPropertyValue(v).trim(); return /^#[0-9a-f]{6}$/i.test(t) ? t : d; };
function pdfCabecera(doc, titulo, sub) {
  const cfg = (($auth.get().boot || {}).cfg) || {}, W = doc.internal.pageSize.getWidth(), prim = hexRgb(colorTema('--navy-primary', '#001f3f'));
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(prim[0], prim[1], prim[2]); doc.text(String(cfg.empresa || ''), 14, 16);
  doc.setFontSize(13); doc.text(String(titulo || ''), W - 14, 16, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110, 110, 110);
  doc.text([cfg.direccion, cfg.telefono].filter(Boolean).join(' · '), 14, 21.5);
  doc.text(String(sub || ''), W - 14, 21.5, { align: 'right' });
  doc.setDrawColor(prim[0], prim[1], prim[2]); doc.setLineWidth(0.6); doc.line(14, 25, W - 14, 25);
  return prim;
}
function pdfPie(doc) {
  const n = doc.internal.getNumberOfPages(), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140, 140, 140);
    doc.text('Generado el ' + fmtFecha(hoy()), 14, H - 8); doc.text('Página ' + i + ' de ' + n, W - 14, H - 8, { align: 'right' });
  }
}
const pdfColumnas = (tipos) => { const cs = {}; (tipos || []).forEach((t, i) => { if (t === 'num' || t === 'money') cs[i] = { halign: 'right' }; }); return cs; };
// PDF de un listado.
async function pdfTablaBytes(o) {
  const doc = await pdfNuevo(o.cabecera.length > 6), prim = pdfCabecera(doc, o.titulo, o.filas.length + ' registro' + (o.filas.length === 1 ? '' : 's'));
  doc.autoTable({ startY: 30, head: [o.cabecera], body: o.filas.map((r) => r.map((v, j) => textoCelda(v, (o.tipos || [])[j]))), margin: { left: 14, right: 14 },
    styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' }, headStyles: { fillColor: prim, textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [245, 247, 250] }, columnStyles: pdfColumnas(o.tipos) });
  pdfPie(doc);
  return doc.output('arraybuffer');
}
// PDF de un documento del negocio (comprobante, orden, recibo): datos en dos columnas, líneas y totales.
//   o = { titulo, estado, campos: [[etiqueta, valor]], cabecera, filas, tipos, totales: [[etiqueta, valor]], notas }
async function pdfDocBytes(o) {
  const doc = await pdfNuevo(false), prim = pdfCabecera(doc, o.titulo, o.estado || ''), W = doc.internal.pageSize.getWidth();
  let y = 33;
  (o.campos || []).forEach((c, i) => {
    const x = 14 + (i % 2) * ((W - 28) / 2);
    if (i && i % 2 === 0) y += 11;
    doc.setFontSize(7.5); doc.setTextColor(130, 130, 130); doc.text(String(c[0]).toUpperCase(), x, y);
    doc.setFontSize(10); doc.setTextColor(30, 30, 30); doc.text(String(c[1] == null ? '' : c[1]), x, y + 4.6);
  });
  doc.autoTable({ startY: y + 11, head: [o.cabecera], body: o.filas.map((r) => r.map((v, j) => textoCelda(v, (o.tipos || [])[j]))), margin: { left: 14, right: 14 },
    styles: { fontSize: 9, cellPadding: 2.4 }, headStyles: { fillColor: prim, textColor: 255, fontStyle: 'bold' }, columnStyles: pdfColumnas(o.tipos) });
  let fy = doc.lastAutoTable.finalY + 9;
  (o.totales || []).forEach((t, i) => {
    const ultimo = i === o.totales.length - 1;
    doc.setFont('helvetica', ultimo ? 'bold' : 'normal'); doc.setFontSize(ultimo ? 12 : 10); doc.setTextColor(30, 30, 30);
    doc.text(String(t[0]), W - 70, fy); doc.text(String(t[1]), W - 14, fy, { align: 'right' }); fy += 6.5;
  });
  if (o.notas) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 90, 90); doc.text(doc.splitTextToSize('Notas: ' + o.notas, W - 28), 14, fy + 6); }
  pdfPie(doc);
  return doc.output('arraybuffer');
}

// Panel de descarga: el usuario elige formato, ve qué va a bajar y confirma.
//   pedirDescarga({ nombre, titulo, cabecera, filas, tipos })                      → listado en los 4 formatos
//   pedirDescarga({ nombre, titulo, formatos: ['pdf'], previa: <JSX>, pdf: fn })   → documento con su propio PDF
const FORMATOS = {
  xlsx: { n: 'Excel', ext: 'xlsx', ic: 'fa-file-excel', c: '#107C41', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pdf: { n: 'PDF', ext: 'pdf', ic: 'fa-file-pdf', c: '#B30B00', mime: 'application/pdf' },
  doc: { n: 'Word', ext: 'doc', ic: 'fa-file-word', c: '#185ABD', mime: 'application/msword' },
  csv: { n: 'CSV', ext: 'csv', ic: 'fa-file-csv', c: '#217346', mime: 'text/csv;charset=utf-8' }
};
const $descarga = mkStore(null);
const pedirDescarga = (o) => $descarga.set(o);
async function generarArchivo(k, o) {
  const tipos = o.tipos || [], prim = colorTema('--navy-primary', '#001f3f');
  const texto = () => o.filas.map((r) => r.map((v, j) => textoCelda(v, tipos[j])));
  if (k === 'csv') return [BOM + csvTexto(o.cabecera, o.filas.map((r) => r.map((v, j) => (typeof v === 'number' ? v : textoCelda(v, tipos[j])))))];
  if (k === 'xlsx') return [xlsxBytes(o.titulo, o.cabecera, o.filas.map((r) => r.map((v, j) => (typeof v === 'number' ? v : textoCelda(v, tipos[j])))), tipos, prim)];
  if (k === 'doc') return [BOM + docHtml(o.titulo, ((($auth.get().boot || {}).cfg || {}).empresa || '') + ' · ' + fmtFecha(hoy()) + ' · ' + o.filas.length + ' registro(s)', o.cabecera, texto(), prim)];
  return [await (o.pdf ? o.pdf() : pdfTablaBytes(o))];
}
window.rsArchivos = { csvTexto, xlsxBytes, docHtml, pdfTablaBytes, pdfDocBytes, generarArchivo };

// ============== Avisos ==============
function toast(msg, tone) {
  const id = Date.now() + Math.random();
  $toasts.set((l) => l.concat({ id, msg: String(msg), tone: tone || 'info' }));
  setTimeout(() => $toasts.set((l) => l.filter((t) => t.id !== id)), 3400);
}
const confirmar = (titulo, texto, o) => new Promise((res) => $dlg.set(Object.assign({ tipo: 'confirm', titulo, texto, res }, o || {})));
const alerta = (titulo, texto, o) => new Promise((res) => $dlg.set(Object.assign({ tipo: 'alert', titulo, texto, res, tone: 'bad' }, o || {})));

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
  if ('nombre' in x) x.nombre = String(x.nombre || '').trim();
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
    const x = { nombre, icono: d.icono || 'mas', color: d.color || 'gray', orden: (d.orden === '' || d.orden == null || isNaN(Number(d.orden)) ? 100 : Math.round(Number(d.orden))), activa: !!Number(d.activa) };
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
      activa: !!Number(d.activa), orden: (d.orden === '' || d.orden == null || isNaN(Number(d.orden)) ? 100 : Math.round(Number(d.orden)))
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

// Las lecturas pedidas en los mismos 10 ms viajan juntas en una sola llamada (batch).
const _q = { list: [], t: 0 };
function flushReads() {
  const list = _q.list; _q.list = []; _q.t = 0;
  for (let i = 0; i < list.length; i += 12) {
    const part = list.slice(i, i + 12);
    gsCall('batch', [part.map((c) => [c.fn, c.args, c.v || ''])]).then((r) => {
      if (!r.success || !r.r) return part.forEach((c) => c.no(new Error(r.message || 'Error de lectura')));
      part.forEach((c, j) => c.ok(r.r[j] || { success: false, message: 'Sin respuesta' }));
    }).catch((e) => part.forEach((c) => c.no(e)));
  }
}
const readRaw = (fn, args, v) => new Promise((ok, no) => {
  _q.list.push({ fn, args, v, ok, no });
  if (!_q.t) _q.t = setTimeout(flushReads, 10);
});

// ============== Caché de lecturas (stale-while-revalidate) ==============
// Lo último que se vio se pinta al instante y se revalida detrás. Si el servidor responde {same:1},
// la copia sigue vigente y no se vuelve a pintar.
const _swr = { map: new Map(), subs: new Set(), flying: new Map(), active: new Map(), rev: 0, user: '', t: 0 };
const keyOf = (fn, args) => fn + '|' + JSON.stringify(args || []);
const swrPing = () => { _swr.rev++; _swr.subs.forEach((f) => f()); };
function swrSave() {
  clearTimeout(_swr.t);
  _swr.t = setTimeout(() => {
    if (!_swr.user) return;
    const out = []; _swr.map.forEach((c, k) => { if (c.d) out.push([k, c.d, c.v]); });
    const s = JSON.stringify(out);
    if (s.length < 300000) ls.set('swr3_' + _swr.user, out); else ls.del('swr3_' + _swr.user);
  }, 800);
}
function swrHydrate(user) {
  _swr.map.clear(); _swr.user = user;
  (ls.get('swr3_' + user, []) || []).forEach((e) => _swr.map.set(e[0], { d: e[1], v: e[2], ts: 0, err: '' }));
  swrPing();
}
function revalidar(fn, args, force) {
  const k = keyOf(fn, args), cur = _swr.map.get(k);
  if (_swr.flying.has(k)) return _swr.flying.get(k);
  if (!force && cur && cur.d && Date.now() - cur.ts < 2000) return Promise.resolve(cur.d);
  $loads.set((n) => n + 1);
  const pedir = (v) => readRaw(fn, args, v).then((r) => {
    if (r.same) { const c = _swr.map.get(k); if (!c || !c.d) return pedir(''); c.ts = Date.now(); c.err = ''; return c.d; }
    if (!r.success) throw new Error(r.message || 'Error');
    if (_cola.keys.get(k)) { const c = _swr.map.get(k); if (c && c.d) return c.d; }      // hay un cambio en camino: no pisarlo con datos viejos
    _swr.map.set(k, { d: r, v: r.v || '', ts: Date.now(), err: '' });
    swrSave();
    return r;
  });
  const p = pedir(cur && cur.d ? cur.v : '').catch((e) => {
    const c = _swr.map.get(k) || { d: null, v: '', ts: 0 };
    c.err = (e && e.message) || 'No se pudo cargar'; _swr.map.set(k, c);
    throw e;
  }).finally(() => { _swr.flying.delete(k); $loads.set((n) => Math.max(0, n - 1)); swrPing(); });
  _swr.flying.set(k, p);
  return p;
}
const revalidarActivas = (minAge) => _swr.active.forEach((a, k) => {
  const c = _swr.map.get(k);
  if (!minAge || !c || Date.now() - c.ts > minAge) revalidar(a.fn, a.args, true).catch(() => {});
});
// Lee del servidor con caché. Devuelve { data, loading, error, reload }.
function useRead(fn, ...args) {
  const k = fn ? keyOf(fn, args) : '';
  useSyncExternalStore((f) => { _swr.subs.add(f); return () => _swr.subs.delete(f); }, () => _swr.rev);
  useEffect(() => {
    if (!k) return undefined;
    const a = _swr.active.get(k) || { fn, args, n: 0 }; a.n++; _swr.active.set(k, a);
    revalidar(fn, args).catch(() => {});
    return () => { a.n--; if (a.n <= 0) _swr.active.delete(k); };
  }, [k]);
  const c = k ? _swr.map.get(k) : null;
  return { data: (c && c.d) || null, error: (c && !c.d && c.err) || '', loading: !!k && !(c && (c.d || c.err)), reload: () => revalidar(fn, args, true).catch(() => {}) };
}
// Otras pestañas del mismo navegador se enteran de escrituras y cierres de sesión.
const bc = (() => { try { return new BroadcastChannel('rs-app'); } catch (e) { return null; } })();
if (bc) bc.onmessage = (ev) => { if (ev.data === 'w') revalidarActivas(); if (ev.data === 'out') salir(true, true); };
document.addEventListener('visibilitychange', () => { if (!document.hidden && $auth.get().tok) revalidarActivas(30000); });
window.addEventListener('online', () => { if ($auth.get().tok) revalidarActivas(); });

// ============== Escrituras ==============
const despues = () => { revalidarActivas(); if (bc) bc.postMessage('w'); };
// Escritura que espera la respuesta. No bloquea la pantalla: el botón que la lanza muestra su propio estado.
async function wr(fn, ...args) {
  try { const r = await gsCall(fn, args); if (r.success) despues(); return r; }
  catch (e) { return { success: false, message: SIN_RED }; }
}
// Igual, con aviso incluido: devuelve la respuesta si salió bien y null si no.
async function guardar(fn, args, okMsg) {
  const r = await wr(fn, ...args);
  if (r.success) { toast(okMsg || r.message || 'Listo', 'ok'); return r; }
  if (r.code !== 'AUTH') await alerta('No se pudo completar', r.message);
  return null;
}
// Pantalla bloqueada con un texto: SOLO para lo que de verdad tarda (generar un archivo, importar, descargar).
async function lento(texto, promesa) { $busy.set(texto); try { return await promesa; } finally { $busy.set(''); } }

// Escritura optimista: el cambio se pinta al instante y viaja a la hoja por detrás. Es la forma normal de guardar.
//   optimista('masterSave', [clave, datos], { lecturas: [['masterList', [clave]]], aplicar: opt.alta(fila), ok: 'Guardado',
//                                             despues: (respuesta) => {}, alFallar: () => reabrir el formulario })
// Si el servidor rechaza o no hay conexión, la pantalla vuelve a como estaba y se avisa el motivo.
// Las escrituras salen en orden, una tras otra.
const _cola = { p: Promise.resolve(), keys: new Map() };
function optimista(fn, args, o) {
  const lect = (o.lecturas || []).map((l) => ({ fn: l[0], args: l[1] || [], k: keyOf(l[0], l[1] || []) }));
  const copia = lect.map((l) => _swr.map.get(l.k) || null);
  lect.forEach((l, i) => {
    const c = _swr.map.get(l.k), ap = Array.isArray(o.aplicar) ? o.aplicar[i] : o.aplicar;
    if (c && c.d && ap) _swr.map.set(l.k, Object.assign({}, c, { d: ap(c.d) }));
    _cola.keys.set(l.k, (_cola.keys.get(l.k) || 0) + 1);
  });
  swrPing(); swrSave();
  if (o.ok) toast(o.ok, 'ok');
  const soltar = () => lect.forEach((l) => { const n = (_cola.keys.get(l.k) || 1) - 1; if (n > 0) _cola.keys.set(l.k, n); else _cola.keys.delete(l.k); });
  const tarea = () => gsCall(fn, args);
  const p = _cola.p.then(tarea, tarea);
  _cola.p = p.catch(() => {});
  return p.then((r) => { if (!r || !r.success) throw r; return r; }).then((r) => {
    soltar();
    lect.forEach((l) => revalidar(l.fn, l.args, true).catch(() => {}));       // la fila temporal se cambia por la real
    despues();
    if (o.despues) o.despues(r);
    return r;
  }, (r) => {
    soltar();
    lect.forEach((l, i) => { if (copia[i]) _swr.map.set(l.k, copia[i]); });   // vuelve a como estaba
    swrPing(); swrSave();
    lect.forEach((l) => revalidar(l.fn, l.args, true).catch(() => {}));
    if (!(r && r.code === 'AUTH')) alerta('No se guardó', ((r && r.message && r.success === false) ? r.message : SIN_RED) + '\nEl cambio se revirtió.').then(() => { if (o.alFallar) o.alFallar(r); });
    return null;
  });
}
// Cambios listos para "aplicar" sobre una lectura con forma { rows: [...] }.
const tmpId = () => '_tmp_' + Date.now().toString(36) + Math.floor(Math.random() * 10000);
const opt = {
  alta: (fila, alFinal) => (d) => { const r = Object.assign({ id: tmpId() }, fila, { _pend: 1 }); return Object.assign({}, d, { rows: alFinal ? (d.rows || []).concat(r) : [r].concat(d.rows || []) }); },
  cambio: (id, cambios, clave) => (d) => Object.assign({}, d, { rows: (d.rows || []).map((r) => (r[clave || 'id'] === id ? Object.assign({}, r, cambios, { _pend: 1 }) : r)) }),
  baja: (ids, clave) => (d) => Object.assign({}, d, { rows: (d.rows || []).filter((r) => ids.indexOf(r[clave || 'id']) < 0) })
};

// ============== Sesión y permisos ==============
// pre: lecturas que el servidor entrega junto con el ingreso; con ellas todos los módulos abren ya con datos.
function entrar(tok, boot, pre) {
  ls.set('userSession', { tok, boot, t: Date.now() });
  swrHydrate(boot.me.usuario);
  (pre || []).forEach((e) => _swr.map.set(keyOf(e[0], e[1]), { d: e[2], v: e[2].v || '', ts: Date.now(), err: '' }));
  if (pre && pre.length) swrSave();
  aplicarLook(boot.look);
  $nuevo.set(false);
  $auth.set({ tok, boot });
  const p = ls.get('rsPage', '');
  $nav.set({ page: boot.pages.some((x) => x.key === p) ? p : ((boot.pages[0] || {}).key || ''), seed: null });
}
// Trae en una sola llamada lo que aún no está en caché (al volver con la sesión guardada).
const precargar = (keys) => (keys || []).forEach((k) => revalidar(k[0], k[1]).catch(() => {}));
function salir(expirada, silencioso) {
  const a = $auth.get(); if (!a.tok) return;
  if (!expirada) gsCall('logout', [a.tok]).catch(() => {});
  ls.del('userSession'); ls.del('swr3_' + a.boot.me.usuario);       // no dejar datos de un usuario al siguiente
  _swr.map.clear(); _swr.active.clear(); _swr.user = '';
  $auth.set({ tok: '', boot: null });
  if (!silencioso && bc) bc.postMessage('out');
  if (expirada) toast('Tu sesión terminó. Vuelve a ingresar.', 'info');
}
const patchBoot = (p) => { const a = $auth.get(); if (!a.boot) return; const boot = Object.assign({}, a.boot, p); $auth.set({ tok: a.tok, boot }); ls.set('userSession', { tok: a.tok, boot, t: Date.now() }); };
// Solo decide qué se muestra. El permiso real lo valida el servidor en cada llamada.
const can = (page, perm) => { const b = $auth.get().boot; return !!b && (b.me.esSuper || String(b.perms[page] || '').indexOf(perm || 'v') >= 0); };
const ir = (page, seed) => { $nav.set({ page, seed: seed || null }); ls.set('rsPage', page); };
window.rsGo = ir;
window.rsKit = { optimista, opt, wr, guardar, lento, pedirDescarga, ir };      // piezas públicas: las usan las pruebas automáticas

// ============== Temas ==============
// Una paleta son 6 colores; de ellos salen todas las variables CSS.
const THEMES = [
  { id: 'navy', name: 'Azul marino', primary: '#001f3f', secondary: '#003366', accent: '#0074D9', bg: '#f5f5f5', card: '#ffffff', on: '#ffffff' },
  { id: 'ocean', name: 'Océano', primary: '#0b3c5d', secondary: '#328cc1', accent: '#1d7fbf', bg: '#f3f7fa', card: '#ffffff', on: '#ffffff' },
  { id: 'forest', name: 'Bosque', primary: '#14342b', secondary: '#1f5c4a', accent: '#2e8b63', bg: '#f3f6f4', card: '#ffffff', on: '#ffffff' },
  { id: 'emerald', name: 'Esmeralda', primary: '#064e3b', secondary: '#047857', accent: '#059669', bg: '#f2f7f5', card: '#ffffff', on: '#ffffff' },
  { id: 'wine', name: 'Vino', primary: '#3b0d1e', secondary: '#6b1d36', accent: '#b0304f', bg: '#f8f4f5', card: '#ffffff', on: '#ffffff' },
  { id: 'sunset', name: 'Atardecer', primary: '#3d1c02', secondary: '#7a3b0c', accent: '#e06a0a', bg: '#faf6f2', card: '#ffffff', on: '#ffffff' },
  { id: 'violet', name: 'Violeta', primary: '#231942', secondary: '#3c2a6b', accent: '#6d4bd8', bg: '#f6f5fa', card: '#ffffff', on: '#ffffff' },
  { id: 'graphite', name: 'Grafito', primary: '#1c1f24', secondary: '#343a43', accent: '#4b5563', bg: '#f4f5f6', card: '#ffffff', on: '#ffffff' },
  { id: 'teal', name: 'Turquesa', primary: '#073b3a', secondary: '#0b6e6a', accent: '#0d9488', bg: '#f1f7f7', card: '#ffffff', on: '#ffffff' },
  { id: 'crimson', name: 'Carmesí', primary: '#2b0a0a', secondary: '#5c1414', accent: '#c62828', bg: '#f9f4f4', card: '#ffffff', on: '#ffffff' },
  { id: 'gold', name: 'Dorado', primary: '#2a2105', secondary: '#5a470c', accent: '#b8860b', bg: '#f9f7f1', card: '#ffffff', on: '#ffffff' },
  { id: 'sky', name: 'Cielo', primary: '#0c2d48', secondary: '#145da0', accent: '#2e8bc0', bg: '#f2f7fb', card: '#ffffff', on: '#ffffff' }
];
const hexRgb = (h) => { const n = parseInt(String(h).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const tono = (h, f) => '#' + hexRgb(h).map((c) => Math.max(0, Math.min(255, Math.round(c * f))).toString(16).padStart(2, '0')).join('');
const themeVars = (t) => ({
  '--navy-primary': t.primary, '--navy-dark': tono(t.primary, 0.66), '--navy-light': t.secondary, '--navy-accent': t.accent, '--navy-hover': tono(t.primary, 1.3),
  '--navy-primary-rgb': hexRgb(t.primary).join(', '), '--navy-accent-rgb': hexRgb(t.accent).join(', '), '--on-accent': t.on, '--bg-primary': t.bg, '--bg-card': t.card
});
function aplicarLook(l) {
  l = l || {};
  const d = document.documentElement;
  Object.keys(themeVars(THEMES[0])).forEach((k) => d.style.removeProperty(k));
  Object.keys(l.vars || {}).forEach((k) => d.style.setProperty(k, l.vars[k]));
  d.setAttribute('data-ui', l.ui || 'soft'); d.setAttribute('data-shape', l.shape || 'rounded'); d.setAttribute('data-sb', l.sb || 'navy');
  $look.set(l);
}
const modoOscuro = (on) => { document.documentElement.classList.toggle('dark-mode', !!on); ls.set('rs_mode', on ? 'dark' : 'light'); };

// ============== Componentes ==============
const Ic = ({ n, className }) => <i className={cx('fa-solid', n, className)} aria-hidden="true"></i>;
const Btn = ({ icon, children, kind, sm, className, ...p }) => (
  <button type="button" className={cx('btn', kind && 'btn-' + kind, sm && 'btn-sm', className)} {...p}>{icon ? <Ic n={icon} /> : null}{children ? <span>{children}</span> : null}</button>
);
const Pill = ({ tone, icon, children }) => <span className={cx('pill', tone && 't-' + tone)}>{icon ? <Ic n={icon} /> : null}{children}</span>;
const Sk = ({ w, h }) => <div className="sk" style={{ width: w || '100%', height: h || 14 }}></div>;
const Vacio = ({ icon, titulo, texto, children }) => (
  <div className="empty"><Ic n={icon || 'fa-inbox'} /><div style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{titulo || 'Sin registros'}</div>{texto ? <div>{texto}</div> : null}{children ? <div style={{ marginTop: 14 }}>{children}</div> : null}</div>
);
const Field = ({ label, req, hint, wide, children }) => (
  <label className={cx('field', wide && 'wide')}><span className="lbl">{label}{req ? <b className="req">*</b> : null}</span>{children}{hint ? <small className="hint">{hint}</small> : null}</label>
);
const Inp = ({ value, onChange, icon, ...p }) => {
  const el = <input className="inp" value={value == null ? '' : value} onChange={(e) => onChange(e.target.value)} {...p} />;
  return icon ? <div className="inp-ic"><Ic n={icon} />{el}</div> : el;
};
const Clave = ({ value, onChange, ...p }) => {
  const [ver, setVer] = useState(false);
  return (
    <div className="inp-ic"><Ic n="fa-lock" />
      <input className="inp" type={ver ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} style={{ paddingRight: 42 }} {...p} />
      <button type="button" className="eye" onClick={() => setVer(!ver)} aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}><Ic n={ver ? 'fa-eye-slash' : 'fa-eye'} /></button>
    </div>
  );
};
const Toggle = ({ value, onChange, label }) => (
  <label className="toggle"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked ? 1 : 0)} /><span className="tr"></span>{label ? <span>{label}</span> : null}</label>
);
const Seg = ({ value, onChange, options }) => (
  <div className="seg">{options.map((o) => <button type="button" key={o.value} className={cx(value === o.value && 'on')} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>
);
const Tabs = ({ value, onChange, items }) => (
  <div className="tabs">{items.map((t) => <button type="button" key={t.value} className={cx('tab', value === t.value && 'active')} onClick={() => onChange(t.value)}>{t.label}{t.count != null ? <span className="ct">{t.count}</span> : null}</button>)}</div>
);

// Lista desplegable con búsqueda. options: [{ value, label }]. Se dibuja fija para que un modal no la recorte.
function Sel({ value, onChange, options, placeholder, disabled, limpiar }) {
  const [open, setOpen] = useState(false), [q, setQ] = useState(''), [pos, setPos] = useState(null), [hi, setHi] = useState(0);
  const btn = useRef(null), pop = useRef(null);
  const sel = options.find((o) => String(o.value) === String(value));
  const list = useMemo(() => { const n = norm(q); return n ? options.filter((o) => norm(o.label).indexOf(n) >= 0) : options; }, [q, options]);
  const abrir = () => {
    if (disabled) return;
    const r = btn.current.getBoundingClientRect(), alto = 290, arriba = r.bottom + alto > window.innerHeight && r.top > alto;
    setPos({ left: r.left, width: Math.max(r.width, 200), top: arriba ? undefined : r.bottom + 4, bottom: arriba ? window.innerHeight - r.top + 4 : undefined });
    setQ(''); setHi(0); setOpen(true);
  };
  useEffect(() => {
    if (!open) return undefined;
    const fuera = (e) => { if (pop.current && !pop.current.contains(e.target) && !btn.current.contains(e.target)) setOpen(false); };
    const cerrar = (e) => { if (!pop.current || !pop.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', fuera); window.addEventListener('resize', cerrar); document.addEventListener('scroll', cerrar, true);
    return () => { document.removeEventListener('mousedown', fuera); window.removeEventListener('resize', cerrar); document.removeEventListener('scroll', cerrar, true); };
  }, [open]);
  const elegir = (o) => { onChange(o.value); setOpen(false); if (btn.current) btn.current.focus(); };
  const tecla = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(hi + 1, list.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(hi - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (list[hi]) elegir(list[hi]); }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
  };
  return (
    <React.Fragment>
      <button type="button" ref={btn} className="dd-btn" disabled={disabled} onClick={() => (open ? setOpen(false) : abrir())} aria-haspopup="listbox" aria-expanded={open}>
        <span className={cx('grow', !sel && 'ph')}>{sel ? sel.label : (placeholder || 'Elegir…')}</span>
        {limpiar && sel ? <span role="button" aria-label="Quitar" onClick={(e) => { e.stopPropagation(); onChange(''); }}><Ic n="fa-xmark" className="muted" /></span> : null}
        <Ic n="fa-chevron-down" className="muted" />
      </button>
      {open && pos ? ReactDOM.createPortal(
        <div className="dd-pop" ref={pop} style={pos}>
          {options.length > 7 ? <input className="inp" autoFocus placeholder="Buscar…" value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={tecla} /> : null}
          <div className="dd-list" role="listbox">
            {list.length ? list.slice(0, 200).map((o, i) => (
              <button type="button" key={o.value} role="option" aria-selected={sel === o} className={cx('dd-opt', i === hi && 'hi', sel === o && 'on')} onMouseEnter={() => setHi(i)} onClick={() => elegir(o)}>{o.label}</button>
            )) : <div className="dd-empty">Sin coincidencias</div>}
          </div>
        </div>, document.body) : null}
    </React.Fragment>
  );
}

// Ventana modal. Solo la de más arriba responde a Escape.
const _modales = [];
function Modal({ titulo, icon, size, onClose, children, pie }) {
  const id = useRef({});
  useEffect(() => {
    _modales.push(id.current);
    const h = (e) => { if (e.key === 'Escape' && _modales[_modales.length - 1] === id.current && onClose) onClose(); };
    document.addEventListener('keydown', h);
    return () => { document.removeEventListener('keydown', h); _modales.splice(_modales.indexOf(id.current), 1); };
  }, [onClose]);
  return ReactDOM.createPortal(
    <div className="ov" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div className={cx('modal', size)} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-h">{icon ? <Ic n={icon} /> : null}<span className="grow">{titulo}</span>{onClose ? <button type="button" className="act" onClick={onClose} aria-label="Cerrar"><Ic n="fa-xmark" /></button> : null}</div>
        <div className="modal-b">{children}</div>
        {pie ? <div className="modal-f">{pie}</div> : null}
      </div>
    </div>, document.body);
}
// Formulario dentro de un modal: Enter guarda, el botón se bloquea mientras se envía.
function FormModal({ titulo, icon, size, onClose, onGuardar, textoGuardar, children }) {
  const [busy, setBusy] = useState(false);
  const enviar = async (e) => { if (e) e.preventDefault(); if (busy) return; setBusy(true); try { await onGuardar(); } finally { setBusy(false); } };
  return (
    <Modal titulo={titulo} icon={icon} size={size} onClose={onClose}
      pie={<React.Fragment><Btn onClick={onClose}>Cancelar</Btn><Btn kind="primary" icon={busy ? 'fa-spinner fa-spin' : 'fa-check'} disabled={busy} onClick={enviar}>{textoGuardar || 'Guardar'}</Btn></React.Fragment>}>
      <form className="fgrid" onSubmit={enviar}><div className="fg">{children}</div><button type="submit" hidden></button></form>
    </Modal>
  );
}
function Dialogos() {
  const d = useStore($dlg);
  if (!d) return null;
  const cerrar = (v) => { $dlg.set(null); d.res(v); };
  const tone = d.tone || (d.peligro ? 'bad' : 'info');
  return (
    <Modal titulo={d.tipo === 'confirm' ? 'Confirmar' : 'Aviso'} size="sm" onClose={() => cerrar(false)}
      pie={d.tipo === 'confirm'
        ? <React.Fragment><Btn onClick={() => cerrar(false)}>Cancelar</Btn><Btn kind={d.peligro ? 'danger' : 'primary'} autoFocus onClick={() => cerrar(true)}>{d.ok || 'Sí, continuar'}</Btn></React.Fragment>
        : <Btn kind="primary" autoFocus onClick={() => cerrar(true)}>Entendido</Btn>}>
      <div className="dlg">
        <div className={cx('dlg-ic', 't-' + tone)}><Ic n={tone === 'bad' ? 'fa-triangle-exclamation' : tone === 'ok' ? 'fa-check' : 'fa-circle-question'} /></div>
        <h3>{d.titulo}</h3>{d.texto ? <p>{d.texto}</p> : null}{d.codigo ? <div className="code-box">{d.codigo}</div> : null}
      </div>
    </Modal>
  );
}
function Avisos() {
  const list = useStore($toasts), busy = useStore($busy);
  const ICO = { ok: 'fa-circle-check', bad: 'fa-circle-exclamation', info: 'fa-circle-info', warn: 'fa-triangle-exclamation' };
  return (
    <React.Fragment>
      <div className="toasts" aria-live="polite">{list.map((t) => <div key={t.id} className={cx('toast', 't-' + t.tone)}><Ic n={ICO[t.tone] || ICO.info} /><span>{t.msg}</span></div>)}</div>
      {busy ? <div className="busy" role="alert" aria-busy="true"><div className="busy-box"><div className="boot-dot"></div><span>{busy}</span></div></div> : null}
    </React.Fragment>
  );
}
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { window.__uiErrors = (window.__uiErrors || []).concat(String((err && err.stack) || err)); }
  render() {
    if (!this.state.err) return this.props.children;
    return <div className="card"><Vacio icon="fa-bug" titulo="Esta pantalla tuvo un problema" texto={String(this.state.err.message || this.state.err)}><Btn icon="fa-rotate" onClick={() => this.setState({ err: null })}>Reintentar</Btn></Vacio></div>;
  }
}
// Botones de la pantalla actual: cada vista los publica y aparecen en la cabecera.
function Acciones({ children }) {
  const [el, setEl] = useState(null);
  useEffect(() => { setEl(document.getElementById('page-actions')); }, []);
  return el ? ReactDOM.createPortal(children, el) : null;
}
const Kpis = ({ items, loading }) => (
  <div className="kpis">
    {loading ? [0, 1, 2, 3].map((i) => <div key={i} className="card kpi"><Sk w={46} h={46} /><div className="grow stack" style={{ gap: 8 }}><Sk w="50%" h={22} /><Sk w="80%" /></div></div>)
      : (items || []).map((k, i) => (
        <div key={i} className={cx('card kpi', 't-' + (k.tono || 'info'))}>
          <div className="kpi-ic"><Ic n={k.icon || 'fa-chart-simple'} /></div>
          <div className="grow"><div className="kpi-v num">{k.money ? fmtMoney(k.value) : (typeof k.value === 'number' ? fmtNum(k.value) : k.value)}</div><div className="kpi-l">{k.label}</div></div>
        </div>))}
  </div>
);

// ============== Subir archivos ==============
const extDe = (nombre) => String((/\.([a-z0-9]+)$/i.exec(nombre || '') || [])[1] || '').toLowerCase();
const pesoTxt = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
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
  const ext = extDe(file.name);
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
// Sube varias versiones a la vez. Si alguna falla, borra las que sí subieron (nunca quedan a medias).
async function subirVersiones(versiones, carpeta) {
  const r = await Promise.allSettled(versiones.map((v) => subirBlob(v.blob, v.tipo, carpeta, v.sufijo)));
  const ok = r.filter((x) => x.status === 'fulfilled').map((x) => x.value);
  const malo = r.find((x) => x.status === 'rejected');
  if (malo) { if (ok.length) gsCall('borrarArchivos', [ok]).catch(() => {}); throw malo.reason; }
  return ok;
}
//   seguimiento: el objeto de useSubidas del formulario (registra lo subido y lo que está en curso).
function Subir({ clase, value, onChange, carpeta, disabled, seguimiento }) {
  const esLogo = clase === 'logo';
  const [local, setLocal] = useState(''), [sub, setSub] = useState(false), [sobre, setSobre] = useState(false);
  const inp = useRef(null), yo = useRef({}), fn = useRef(null), montado = useRef(true);
  const vista = useRef('');
  const ponerVista = (u) => { if (vista.current) URL.revokeObjectURL(vista.current); vista.current = u; setLocal(u); };
  useEffect(() => () => { montado.current = false; if (vista.current) URL.revokeObjectURL(vista.current); }, []);
  const tomar = async (file) => {
    if (!file || disabled || sub) return;
    const err = validarFoto(file);
    if (err) return toast(err, 'warn');
    setSub(true); _sub.n++;
    if (seguimiento) seguimiento.empezar();
    try {
      const p = await procesarFoto(file, esLogo ? 'logo' : 'foto');
      if (!montado.current) return;                         // se cerró mientras comprimía: no se sube nada
      ponerVista(URL.createObjectURL((esLogo ? p.logo : p.mini).blob));   // se ve al instante
      const versiones = esLogo ? [Object.assign({ sufijo: 'logo' }, p.logo)]
        : [Object.assign({ sufijo: 'g' }, p.grande), Object.assign({ sufijo: 'm' }, p.mini)];
      const rutas = await subirVersiones(versiones, carpeta);
      const peso = versiones.reduce((s, v) => s + v.blob.size, 0);
      // Si el formulario se cerró mientras subía, nadie usará estas fotos: se borran (sin huérfanos).
      if (!montado.current) { gsCall('borrarArchivos', [rutas]).catch(() => {}); return; }
      if (seguimiento) seguimiento.agregar(rutas);
      onChange(esLogo ? rutas[0] : { grande: rutas[0], mini: rutas[1] });
      toast('Foto lista (' + pesoTxt(peso) + ')', 'ok');
    } catch (e) {
      if (montado.current) ponerVista('');
      const m = fallo(e);
      if (m.code === 'AUTH') salir(true); else alerta('No se pudo subir la foto', m.message);
    } finally {
      _sub.n--;
      if (seguimiento) seguimiento.terminar();
      if (montado.current) setSub(false);
    }
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
      {hay && !disabled && !sub ? <button type="button" className="up-x" aria-label="Quitar" title="Quitar" onClick={(e) => { e.stopPropagation(); ponerVista(''); onChange(esLogo ? '' : { grande: '', mini: '' }); }}><Ic n="fa-xmark" /></button> : null}
    </div>
  );
}
// Lleva la cuenta de las fotos NUEVAS de un formulario (nunca las que ya tenía el registro):
//   cancelar → se borran todas · guardar → se borran las que quedaron sin usar · subiendo() → hay subidas en curso.
// inicial: fotos nuevas de un intento de guardado que falló (el formulario se reabre con ellas).
function useSubidas(inicial) {
  const lista = useRef(inicial || []), enCurso = useRef(0);
  return {
    lista,
    empezar: () => { enCurso.current++; },
    terminar: () => { enCurso.current = Math.max(0, enCurso.current - 1); },
    subiendo: () => enCurso.current > 0,
    agregar: (rutas) => { lista.current = lista.current.concat(rutas); },
    // Fotos nuevas que el registro va a usar (para reabrir el formulario si el guardado falla).
    nuevasEnUso: (enUso) => lista.current.filter((r) => (enUso || []).indexOf(r) >= 0),
    limpiar: (enUso) => {
      const sobran = lista.current.filter((r) => (enUso || []).indexOf(r) < 0);
      lista.current = [];
      if (sobran.length) gsCall('borrarArchivos', [sobran]).catch(() => {});
    }
  };
}

// ============== Tabla ==============
// cols: [{ k, label, t: 'text'|'num'|'money'|'date'|'flag'|'pill'|'img', tones: {valor: tono}, render(row), get(row), align }]
// acciones: [{ icon, title, tone, onClick(row), show(row) }] · seleccion: lista de ids · onRow(row) abre el detalle
// Una fila con _pend (cambio en camino a la hoja) se muestra atenuada y no se puede abrir hasta que el servidor confirme.
const celdaTxt = (c, r) => {
  const v = c.get ? c.get(r) : r[c.k];
  if (c.t === 'img') return '';
  if (c.t === 'money') return fmtMoney(v);
  if (c.t === 'num') return fmtNum(v);
  if (c.t === 'date') return fmtFecha(v);
  if (c.t === 'flag') return Number(v) ? 'Sí' : 'No';
  return v == null ? '' : String(v);
};
function Tabla({ cols, rows, loading, error, rowKey, onRow, acciones, seleccion, onSel, vacio, nombre, titulo, extra, porPagina }) {
  const key = rowKey || 'id';
  const [q, setQ] = useState(''), [orden, setOrden] = useState({ k: '', dir: 1 }), [pag, setPag] = useState(0), [tam, setTam] = useState(porPagina || 15);
  const dq = useDeferredValue(q);
  const idx = useMemo(() => (rows || []).map((r) => ({ r, h: norm(cols.map((c) => celdaTxt(c, r)).join(' ')) })), [rows, cols]);
  const vista = useMemo(() => {
    const n = norm(dq).trim();
    let out = n ? idx.filter((x) => n.split(/\s+/).every((w) => x.h.indexOf(w) >= 0)) : idx.slice();
    const c = cols.find((x) => x.k === orden.k);
    if (c) {
      const val = (r) => { const v = c.get ? c.get(r) : r[c.k]; return (c.t === 'num' || c.t === 'money' || c.t === 'flag') ? Number(v) || 0 : norm(v); };
      out.sort((a, b) => { const x = val(a.r), y = val(b.r); return (x < y ? -1 : x > y ? 1 : 0) * orden.dir; });
    }
    return out.map((x) => x.r);
  }, [idx, dq, orden, cols]);
  const paginas = Math.max(1, Math.ceil(vista.length / tam)), p = Math.min(pag, paginas - 1), trozo = vista.slice(p * tam, p * tam + tam);
  const sel = seleccion || [], firmes = vista.filter((r) => !r._pend), todos = firmes.length > 0 && firmes.every((r) => sel.indexOf(r[key]) >= 0);
  const marcar = (id) => onSel(sel.indexOf(id) >= 0 ? sel.filter((x) => x !== id) : sel.concat(id));
  const descargar = () => {
    const ex = cols.filter((c) => c.t !== 'img');
    pedirDescarga({
      nombre: nombre || 'datos', titulo: titulo || (nombre ? nombre.charAt(0).toUpperCase() + nombre.slice(1) : 'Datos'),
      cabecera: ex.map((c) => c.label), tipos: ex.map((c) => (c.t === 'num' || c.t === 'money' || c.t === 'date') ? c.t : 'text'),
      filas: vista.map((r) => ex.map((c) => { const v = c.get ? c.get(r) : r[c.k]; return (c.t === 'num' || c.t === 'money') ? (Number(v) || 0) : c.t === 'date' ? v : celdaTxt(c, r); }))
    });
  };
  const celda = (c, r) => {
    if (c.render) return c.render(r);
    const v = c.get ? c.get(r) : r[c.k];
    if (c.t === 'img') return v ? <img className="thumb" src={v} alt="" loading="lazy" /> : <span className="thumb thumb-ph"><Ic n="fa-image" /></span>;
    if (c.t === 'pill') return v === '' || v == null ? '' : <Pill tone={(c.tones || {})[v] || 'mute'}>{String(v)}</Pill>;
    if (c.t === 'flag') return <Pill tone={Number(v) ? 'ok' : 'mute'}>{Number(v) ? 'Sí' : 'No'}</Pill>;
    return celdaTxt(c, r);
  };
  const al = (c) => c.align || ((c.t === 'num' || c.t === 'money') ? 'r' : '');
  return (
    <div className="card">
      <div className="tb-tools">
        <div className="tb-search"><Inp icon="fa-magnifying-glass" value={q} onChange={(v) => { setQ(v); setPag(0); }} placeholder="Buscar…" aria-label="Buscar en la tabla" /></div>
        <div className="grow"></div>
        {extra}
        <Btn sm icon="fa-download" onClick={descargar} disabled={!vista.length} title="Descargar en Excel, PDF, Word o CSV" data-descarga="1">Descargar</Btn>
      </div>
      {error ? <Vacio icon="fa-plug-circle-xmark" titulo="No se pudo cargar" texto={error} />
        : loading ? <div className="card-b stack">{[0, 1, 2, 3, 4, 5].map((i) => <Sk key={i} h={18} />)}</div>
        : !vista.length ? (vacio && !q ? vacio : <Vacio titulo={q ? 'Sin coincidencias' : 'Sin registros'} texto={q ? 'Prueba con otra búsqueda.' : ''} />)
        : (
          <div className="tb-scroll">
            <table className="tb">
              <thead><tr>
                {onSel ? <th className="chk"><input type="checkbox" checked={todos} aria-label="Seleccionar todo" onChange={() => onSel(todos ? [] : firmes.map((r) => r[key]))} /></th> : null}
                {cols.map((c) => (
                  <th key={c.k} className={cx('sort', al(c))} onClick={() => setOrden({ k: c.k, dir: orden.k === c.k ? -orden.dir : 1 })}>
                    {c.label}{orden.k === c.k ? <Ic n={orden.dir > 0 ? 'fa-arrow-up-short-wide' : 'fa-arrow-down-wide-short'} /> : null}
                  </th>))}
                {acciones ? <th className="acts"></th> : null}
              </tr></thead>
              <tbody>
                {trozo.map((r) => (
                  <tr key={r[key]} className={cx(onRow && !r._pend && 'click', r._pend && 'pend')} onClick={onRow && !r._pend ? () => onRow(r) : undefined}>
                    {onSel ? <td className="chk" onClick={(e) => e.stopPropagation()}><input type="checkbox" disabled={!!r._pend} checked={sel.indexOf(r[key]) >= 0} aria-label="Seleccionar fila" onChange={() => marcar(r[key])} /></td> : null}
                    {cols.map((c) => <td key={c.k} data-l={c.label} className={cx(al(c), (c.t === 'num' || c.t === 'money') && 'num')}>{celda(c, r)}</td>)}
                    {acciones ? <td className="acts" onClick={(e) => e.stopPropagation()}>
                      {r._pend ? <span className="act" title="Guardando…" aria-label="Guardando"><Ic n="fa-circle-notch fa-spin" /></span>
                        : acciones.filter((a) => !a.show || a.show(r)).map((a) => <button type="button" key={a.title} className={cx('act', a.tone && 't-' + a.tone)} title={a.title} aria-label={a.title} onClick={() => a.onClick(r)}><Ic n={a.icon} /></button>)}
                    </td> : null}
                  </tr>))}
              </tbody>
            </table>
          </div>)}
      <div className="tb-foot">
        <span>{vista.length} registro{vista.length === 1 ? '' : 's'}{sel.length ? ' · ' + sel.length + ' seleccionado' + (sel.length === 1 ? '' : 's') : ''}</span>
        <div className="tb-pag">
          <select className="inp" style={{ width: 'auto', minHeight: 34, padding: '4px 8px', fontSize: 13 }} value={tam} onChange={(e) => { setTam(Number(e.target.value)); setPag(0); }} aria-label="Filas por página">
            {[15, 30, 60, 120].map((n) => <option key={n} value={n}>{n} por página</option>)}
          </select>
          <button type="button" className="act" disabled={p <= 0} onClick={() => setPag(p - 1)} aria-label="Página anterior"><Ic n="fa-chevron-left" /></button>
          <span>{p + 1} / {paginas}</span>
          <button type="button" className="act" disabled={p >= paginas - 1} onClick={() => setPag(p + 1)} aria-label="Página siguiente"><Ic n="fa-chevron-right" /></button>
        </div>
      </div>
    </div>
  );
}
function PanelDescarga() {
  const o = useStore($descarga);
  const [f, setF] = useState('');
  useEffect(() => { if (o) setF((o.formatos || ['xlsx', 'pdf', 'doc', 'csv'])[0]); }, [o]);
  if (!o) return null;
  const lista = o.formatos || ['xlsx', 'pdf', 'doc', 'csv'], k = FORMATOS[f] && lista.indexOf(f) >= 0 ? f : lista[0], F = FORMATOS[k], filas = o.filas || [];
  const archivo = nombreArchivo(o.nombre) + '-' + hoy() + '.' + F.ext, cerrar = () => $descarga.set(null);
  const bajar = async () => {
    try {
      const partes = await lento('Generando ' + F.n + '…', generarArchivo(k, o));
      bajarBlob(new Blob(partes, { type: F.mime }), archivo);
      toast('Archivo descargado: ' + archivo, 'ok');
      cerrar();
    } catch (e) { alerta('No se pudo generar el archivo', (e && e.message) || 'Inténtalo de nuevo.'); }
  };
  return (
    <Modal titulo="Descargar" icon="fa-download" size="lg" onClose={cerrar}
      pie={<React.Fragment><span className="grow dl-q">¿Descargar este archivo?</span><Btn onClick={cerrar}>No, cancelar</Btn><Btn className="dl-go" style={{ background: F.c }} icon="fa-download" data-bajar="1" onClick={bajar}>Sí, descargar</Btn></React.Fragment>}>
      <div className="dl">
        <div className="dl-fmts" role="radiogroup" aria-label="Formato del archivo">
          {lista.map((x) => (
            <button type="button" key={x} role="radio" aria-checked={k === x} className={cx('dl-card', k === x && 'on')} style={{ '--fc': FORMATOS[x].c }} onClick={() => setF(x)}>
              <span className="dl-ic"><Ic n={FORMATOS[x].ic} /></span><b>{FORMATOS[x].n}</b><small>.{FORMATOS[x].ext}</small>
            </button>))}
        </div>
        <div className="dl-prev">
          <div className="dl-file" style={{ '--fc': F.c }}><Ic n={F.ic} /><div className="grow"><b>{archivo}</b><div className="muted">{o.titulo}{o.cabecera ? ' · ' + filas.length + ' registro' + (filas.length === 1 ? '' : 's') : ''}</div></div></div>
          {o.previa ? o.previa : (
            <div className="tb-scroll dl-tabla"><table className="tb">
              <thead><tr>{o.cabecera.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
              <tbody>{filas.slice(0, 8).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} data-l={o.cabecera[j]}>{textoCelda(v, (o.tipos || [])[j])}</td>)}</tr>)}</tbody>
            </table></div>)}
          {!o.previa && filas.length > 8 ? <div className="muted dl-mas">Vista previa de 8 de {filas.length} registros. El archivo los incluye todos.</div> : null}
        </div>
      </div>
    </Modal>
  );
}

// ============== Catálogo genérico ==============
// Dibuja la pantalla completa de un catálogo declarado en Code.gs con defMaster_: no requiere código propio.
const enCache = (fn, args) => (((_swr.map.get(keyOf(fn, args)) || {}).d || {}).rows) || [];
function CampoMaster({ f, value, txt, onChange, modulo }) {
  const opts = useRead(f.t === 'ref' ? 'masterOpts' : '', f.ref);
  if (f.t === 'flag') return <Field label={f.label}><Toggle value={value} onChange={onChange} label={Number(value) ? 'Sí' : 'No'} /></Field>;
  if (f.t === 'enum') return <Field label={f.label} req={f.req}><Sel value={value} onChange={onChange} options={(f.opts || []).map((o) => ({ value: o, label: o }))} limpiar={!f.req} /></Field>;
  if (f.t === 'ref') return <Field label={f.label} req={f.req}><Sel value={value} onChange={onChange} options={((opts.data || {}).rows || []).map((o) => ({ value: o.id, label: o.label }))} placeholder={opts.loading ? 'Cargando…' : 'Elegir…'} limpiar={!f.req} /></Field>;
  if (f.t === 'img') return <Field label={f.label} req={f.req}><Subir clase="img" value={value} onChange={onChange} modulo={modulo} /></Field>;
  if (f.t === 'file') return <Field label={f.label} req={f.req} wide><Subir clase="doc" value={value ? { id: value, nombre: txt || 'Archivo' } : ''} onChange={(v) => onChange(v ? v.id : '', v ? v.nombre : '')} modulo={modulo} /></Field>;
  if (f.t === 'text') return <Field label={f.label} req={f.req} wide><textarea className="inp" value={value == null ? '' : value} maxLength={f.max || 1000} onChange={(e) => onChange(e.target.value)}></textarea></Field>;
  const tipo = { num: 'number', int: 'number', money: 'number', date: 'date', email: 'email', tel: 'tel' }[f.t] || 'text';
  return <Field label={f.label} req={f.req}><Inp type={tipo} step={f.t === 'int' ? '1' : 'any'} inputMode={tipo === 'number' ? 'decimal' : undefined} maxLength={f.max || undefined} value={value} onChange={onChange} /></Field>;
}
function MasterModal({ mkey, meta, page, row, borrador, onClose, onFallo }) {
  const [d, setD] = useState(() => {
    if (borrador) return borrador;
    const o = {};
    meta.fields.forEach((f) => { o[f.k] = row ? row[f.k] : f.def; if (row && row[f.k + '_txt'] != null) o[f.k + '_txt'] = row[f.k + '_txt']; });
    return o;
  });
  const save = () => {
    if (_sub.n) return toast('Espera a que termine de subir el archivo', 'warn');
    const falta = meta.fields.find((f) => f.req && (d[f.k] == null || String(d[f.k]).trim() === ''));
    if (falta) return toast('Completa el campo ' + falta.label, 'warn');
    // Lo que el servidor rechazaría seguro se avisa aquí, antes de pintar nada.
    const dup = meta.fields.find((f) => f.unique && String(d[f.k] == null ? '' : d[f.k]).trim() !== '' && enCache('masterList', [mkey]).some((r) => (!row || r.id !== row.id) && norm(r[f.k]) === norm(d[f.k])));
    if (dup) return toast('Ya existe un registro con ' + dup.label + ' "' + d[dup.k] + '"', 'warn');
    const datos = { id: row ? row.id : 0 }, vista = Object.assign({}, d);
    meta.fields.forEach((f) => {
      datos[f.k] = d[f.k];
      if (f.t === 'ref') { const op = enCache('masterOpts', [f.ref]).find((x) => String(x.id) === String(d[f.k])); vista[f.k + '_txt'] = op ? op.label : ''; }
    });
    onClose();
    optimista('masterSave', [mkey, datos], {
      lecturas: [['masterList', [mkey]]], aplicar: row ? opt.cambio(row.id, vista) : opt.alta(vista), ok: row ? 'Cambios guardados' : 'Guardado',
      alFallar: () => onFallo({ row, borrador: d })                 // si el servidor rechaza, el formulario vuelve con lo escrito
    });
  };
  return (
    <FormModal titulo={(row ? 'Editar ' : 'Agregar ') + meta.singular.toLowerCase()} icon={row ? 'fa-pen' : 'fa-plus'} onClose={onClose} onGuardar={save}>
      {meta.fields.map((f) => <CampoMaster key={f.k} f={f} value={d[f.k]} txt={d[f.k + '_txt']} modulo={page}
        onChange={(v, nombre) => setD((x) => Object.assign({}, x, { [f.k]: v }, nombre !== undefined ? { [f.k + '_txt']: nombre } : null))} />)}
    </FormModal>
  );
}
function MasterView({ mkey, page }) {
  const meta = $auth.get().boot.masters[mkey], q = useRead('masterList', mkey);
  const [edit, setEdit] = useState(null), [sel, setSel] = useState([]), [imp, setImp] = useState(false);
  const file = useRef(null);
  const cols = useMemo(() => meta.fields.filter((f) => !f.oculto && f.t !== 'text').map((f) => ({
    k: f.k, label: f.label, t: f.t === 'int' ? 'num' : f.t === 'enum' ? 'pill' : f.t === 'file' ? 'text' : f.t, get: (f.t === 'ref' || f.t === 'file') ? (r) => r[f.k + '_txt'] : undefined
  })), [meta]);
  const importables = meta.fields.filter((f) => f.t !== 'img' && f.t !== 'file');
  const borrar = async (ids) => {
    if (!await confirmar('¿Eliminar ' + ids.length + ' registro' + (ids.length === 1 ? '' : 's') + '?', 'Esta acción no se puede deshacer desde la app.', { peligro: 1, ok: 'Sí, eliminar' })) return;
    setSel([]);
    optimista('masterDelete', [mkey, ids], { lecturas: [['masterList', [mkey]]], aplicar: opt.baja(ids), ok: ids.length === 1 ? 'Eliminado' : ids.length + ' eliminados',
      despues: (r) => { if (/en uso/.test(r.message || '')) toast(r.message, 'warn'); } });
  };
  const importar = (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      const filas = parseCSV(rd.result), cab = (filas.shift() || []).map(norm);
      const mapa = importables.map((fd) => cab.indexOf(norm(fd.label)));
      if (mapa.every((i) => i < 0)) return alerta('El archivo no coincide', 'La primera fila debe tener estos títulos: ' + importables.map((x) => x.label).join(', '));
      const data = filas.map((r) => { const o = {}; importables.forEach((fd, i) => { if (mapa[i] >= 0) o[fd.k] = r[mapa[i]]; }); return o; });
      setImp(false);
      const res = await lento('Importando ' + data.length + ' fila' + (data.length === 1 ? '' : 's') + '…', wr('masterImport', mkey, data));
      if (!res.success) { if (res.code !== 'AUTH') alerta('No se pudo importar', res.message); return; }
      toast(res.message, 'ok');
      if (res.errores && res.errores.length) alerta('Algunas filas no entraron', res.errores.slice(0, 12).join('\n'), { tone: 'info' });
    };
    rd.readAsText(f);
  };
  return (
    <div className="stack">
      <Acciones>
        {sel.length && can(page, 'd') ? <Btn kind="danger" icon="fa-trash" onClick={() => borrar(sel)}>Eliminar ({sel.length})</Btn> : null}
        {can(page, 'a') ? <Btn icon="fa-file-import" onClick={() => setImp(true)}>Importar</Btn> : null}
        {can(page, 'a') ? <Btn kind="primary" icon="fa-plus" data-primary="1" onClick={() => setEdit({})}>Nuevo</Btn> : null}
      </Acciones>
      <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={importar} />
      <Tabla cols={cols} rows={(q.data || {}).rows} loading={q.loading} error={q.error} nombre={mkey} titulo={($auth.get().boot.pages.find((x) => x.key === page) || {}).label}
        seleccion={sel} onSel={can(page, 'd') ? setSel : undefined} onRow={can(page, 'e') ? (r) => setEdit({ row: r }) : undefined}
        acciones={[
          { icon: 'fa-pen', title: 'Editar', onClick: (r) => setEdit({ row: r }), show: () => can(page, 'e') },
          { icon: 'fa-trash', title: 'Eliminar', tone: 'bad', onClick: (r) => borrar([r.id]), show: () => can(page, 'd') }
        ]}
        vacio={<Vacio icon="fa-folder-open" titulo={'Aún no hay registros'} texto="Crea el primero o importa un archivo CSV.">{can(page, 'a') ? <Btn kind="primary" icon="fa-plus" onClick={() => setEdit({})}>Nuevo</Btn> : null}</Vacio>} />
      {edit ? <MasterModal mkey={mkey} meta={meta} page={page} row={edit.row} borrador={edit.borrador} onClose={() => setEdit(null)} onFallo={setEdit} /> : null}
      {imp ? (
        <Modal titulo="Importar desde un archivo CSV" icon="fa-file-import" size="sm" onClose={() => setImp(false)}
          pie={<React.Fragment><Btn icon="fa-download" onClick={() => bajarCSV('plantilla-' + mkey, importables.map((f) => f.label), [])}>Bajar plantilla vacía</Btn><Btn kind="primary" icon="fa-folder-open" onClick={() => file.current.click()}>Elegir archivo</Btn></React.Fragment>}>
          <div className="stack" style={{ gap: 10 }}>
            <p>La primera fila del archivo debe tener estos títulos:</p>
            <p><b>{importables.map((f) => f.label).join(' · ')}</b></p>
            <p className="muted">La plantilla vacía trae solo esos títulos: llénala en Excel y guárdala como CSV.</p>
          </div>
        </Modal>) : null}
    </div>
  );
}

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
// Primer ingreso: la app aún no tiene usuarios. Quien la abre crea la cuenta del administrador y la confirma por correo.
function PrimerAdmin() {
  const [paso, setPaso] = useState(1), [d, setD] = useState({ nombre: '', usuario: '', email: '' }), [cod, setCod] = useState(''), [p, setP] = useState(''), [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [info, setInfo] = useState('');
  const set = (k) => (v) => setD((x) => Object.assign({}, x, { [k]: v }));
  const run = async (fn, args) => {
    setBusy(true); setErr(''); setInfo('');
    try { const r = await gsCall(fn, args); if (!r.success) setErr(r.message); return r; }
    catch (e) { setErr('No se pudo conectar. Revisa tu conexión.'); return { success: false }; }
    finally { setBusy(false); }
  };
  const enviar = async (e) => {
    e.preventDefault(); if (busy) return;
    if (paso === 1) { const r = await run('primerAdminPedir', [d]); if (r.success) { setInfo(r.message); setPaso(2); } return; }
    if (p !== p2) { setErr('Las contraseñas no coinciden'); return; }
    const r = await run('primerAdminCrear', [cod.trim(), p]);
    if (r.success) { ls.set('rsLoginUser', d.usuario.trim()); entrar(r.tok, r.boot, r.pre); }
  };
  return (
    <div className="login">
      <form className="login-card" onSubmit={enviar}>
        <div className="login-logo"><Ic n="fa-user-shield" /></div>
        <h1>Crea la cuenta del administrador</h1>
        <p className="sub">{paso === 1 ? 'Es la primera vez que se abre esta aplicación.' : 'Escribe el código que llegó a ' + d.email}</p>
        <div className="stack">
          {paso === 1 ? <Field label="Tu nombre"><Inp icon="fa-id-card" value={d.nombre} onChange={set('nombre')} maxLength={80} required autoFocus /></Field> : null}
          {paso === 1 ? <Field label="Usuario" hint="Con él vas a ingresar. Letras, números, punto o guion."><Inp icon="fa-user" value={d.usuario} onChange={set('usuario')} maxLength={40} autoCapitalize="none" required /></Field> : null}
          {paso === 1 ? <Field label="Tu correo" hint="Ahí te enviaremos un código para confirmar."><Inp icon="fa-envelope" type="email" value={d.email} onChange={set('email')} maxLength={120} required /></Field> : null}
          {paso === 2 ? <Field label="Código de 6 dígitos"><Inp icon="fa-key" value={cod} onChange={setCod} inputMode="numeric" maxLength={6} required autoFocus /></Field> : null}
          {paso === 2 ? <Field label="Contraseña" hint="Mínimo 10 caracteres, con letras y números."><Clave value={p} onChange={setP} autoComplete="new-password" required /></Field> : null}
          {paso === 2 ? <Field label="Repite la contraseña"><Clave value={p2} onChange={setP2} autoComplete="new-password" required /></Field> : null}
          {err ? <div className="login-err" role="alert">{err}</div> : null}
          {info ? <div className="hint" role="status">{info}</div> : null}
          <Btn kind="primary" type="submit" disabled={busy} icon={busy ? 'fa-spinner fa-spin' : paso === 1 ? 'fa-paper-plane' : 'fa-check'}>{paso === 1 ? 'Enviar código a mi correo' : 'Crear cuenta e ingresar'}</Btn>
          <div style={{ textAlign: 'center' }}>
            {paso === 2 ? <button type="button" className="btn-link" onClick={() => { setPaso(1); setErr(''); setInfo(''); }}>Cambiar mis datos o pedir otro código</button>
              : <button type="button" className="btn-link" onClick={() => $nuevo.set(false)}>Ya tengo una cuenta</button>}
          </div>
        </div>
      </form>
    </div>
  );
}
function CambiarClave({ obligado, onClose }) {
  const [a, setA] = useState(''), [n, setN] = useState(''), [n2, setN2] = useState(''), [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    if (n !== n2) return toast('Las contraseñas nuevas no coinciden', 'warn');
    setBusy(true);
    const r = await guardar('cambiarMiClave', [a, n]);
    setBusy(false);
    if (r) { const s = $auth.get(); const boot = Object.assign({}, s.boot, { me: Object.assign({}, s.boot.me, { debe: 0 }) }); $auth.set({ tok: r.tok, boot }); ls.set('userSession', { tok: r.tok, boot, t: Date.now() }); if (onClose) onClose(); }
  };
  return (
    <Modal titulo={obligado ? 'Crea tu contraseña' : 'Cambiar contraseña'} icon="fa-key" size="sm" onClose={obligado ? undefined : onClose}
      pie={<React.Fragment>{obligado ? <Btn onClick={() => salir()}>Salir</Btn> : <Btn onClick={onClose}>Cancelar</Btn>}<Btn kind="primary" icon={busy ? 'fa-spinner fa-spin' : 'fa-check'} disabled={busy} onClick={save}>Guardar</Btn></React.Fragment>}>
      <div className="stack">
        {obligado ? <p className="muted">Estás usando una contraseña temporal. Crea la tuya para continuar.</p> : null}
        <Field label={obligado ? 'Contraseña temporal' : 'Contraseña actual'}><Clave value={a} onChange={setA} autoComplete="current-password" /></Field>
        <Field label="Contraseña nueva" hint="Mínimo 10 caracteres, con letras y números."><Clave value={n} onChange={setN} autoComplete="new-password" /></Field>
        <Field label="Repite la contraseña nueva"><Clave value={n2} onChange={setN2} autoComplete="new-password" /></Field>
      </div>
    </Modal>
  );
}
function MiCuenta({ onClose }) {
  const me = $auth.get().boot.me;
  const [nombre, setNombre] = useState(me.nombre), [email, setEmail] = useState(me.email), [clave, setClave] = useState(false);
  const save = async () => { const r = await guardar('guardarMiPerfil', [{ nombre, email }]); if (r) { patchBoot({ me: Object.assign({}, me, { nombre: r.nombre, email: r.email }) }); onClose(); } };
  if (clave) return <CambiarClave onClose={onClose} />;
  return (
    <FormModal titulo="Mi cuenta" icon="fa-user" size="sm" onClose={onClose} onGuardar={save}>
      <Field label="Usuario" wide><Inp value={me.usuario} onChange={() => {}} disabled /></Field>
      <Field label="Nombre" req wide><Inp value={nombre} onChange={setNombre} maxLength={80} /></Field>
      <Field label="Correo" hint="Con él ingresas y recuperas tu contraseña." wide><Inp type="email" value={email} onChange={setEmail} maxLength={120} disabled /></Field>
      <div className="field wide"><Btn icon="fa-key" onClick={() => setClave(true)}>Cambiar contraseña</Btn></div>
    </FormModal>
  );
}

// ============== Pantallas ==============
function Apariencia({ look }) {
  const [l, setL] = useState(look);
  const prev = (x) => { const n = Object.assign({}, l, x); setL(n); aplicarLook(n); };          // vista previa en vivo
  useEffect(() => () => aplicarLook($auth.get().boot.look), []);                                   // al salir sin guardar, vuelve el tema real
  const save = async () => { const r = await guardar('saveLook', [l]); if (r) { patchBoot({ look: r.look }); setL(r.look); aplicarLook(r.look); } };
  return (
    <div className="card">
      <div className="card-h"><Ic n="fa-palette" />Colores de la app<span className="grow"></span><Btn kind="primary" sm icon="fa-check" onClick={save}>Guardar colores</Btn></div>
      <div className="card-b stack">
        <p className="muted">Los colores del panel se guardan en este navegador.</p>
        <div className="th-grid">{THEMES.map((t) => (
          <button type="button" key={t.id} className={cx('th-sw', l.theme === t.id && 'on')} onClick={() => prev({ theme: t.id, vars: themeVars(t) })}>
            <div className="bar"><span style={{ background: t.primary }}></span><span style={{ background: t.secondary }}></span><span style={{ background: t.accent }}></span><span style={{ background: t.bg }}></span></div>
            <b>{t.name}</b>
          </button>))}</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 18 }}>
          <Field label="Estilo"><Seg value={l.ui || 'soft'} onChange={(v) => prev({ ui: v })} options={[{ value: 'soft', label: 'Suave' }, { value: 'classic', label: 'Clásico' }]} /></Field>
          <Field label="Esquinas"><Seg value={l.shape || 'rounded'} onChange={(v) => prev({ shape: v })} options={[{ value: 'rounded', label: 'Redondeadas' }, { value: 'squared', label: 'Rectas' }]} /></Field>
          <Field label="Menú lateral"><Seg value={l.sb || 'navy'} onChange={(v) => prev({ sb: v })} options={[{ value: 'navy', label: 'Oscuro' }, { value: 'light', label: 'Claro' }, { value: 'theme', label: 'De color' }]} /></Field>
        </div>
      </div>
    </div>
  );
}

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
    if (subidas.subiendo()) return toast('Espera a que termine de subir la foto', 'warn');
    const err = validarNegocio(d);
    if (err) return toast(err, 'warn');
    if (!row && enCache('listNegocios', []).some((n) => norm(n.nombre) === norm(d.nombre) && norm(n.ciudad) === norm(d.ciudad))) {
      return toast('Ya existe un negocio con ese nombre en esa ciudad', 'warn');
    }
    const enUso = [d.imagen, d.imagen_mini, d.logo].filter(Boolean);
    const nuevas = subidas.nuevasEnUso(enUso);
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
      alFallar: () => onFallo({ row, borrador: Object.assign({}, d, { _subidas: nuevas }) })
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
      <Field label="Foto principal" hint="Se guarda en 2 tamaños livianos (WebP)."><Subir clase="foto" value={{ grande: d.imagen, mini: d.imagen_mini }} carpeta="negocios" seguimiento={subidas}
        onChange={(v) => setD((x) => Object.assign({}, x, { imagen: v.grande || '', imagen_mini: v.mini || '' }))} /></Field>
      <Field label="Logo" hint="Opcional. Se guarda a 200 px."><Subir clase="logo" value={d.logo} carpeta="logos" seguimiento={subidas} onChange={set('logo')} /></Field>
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
    if (subidas.subiendo()) return toast('Espera a que termine de subir la foto', 'warn');
    if (!d.negocio_id) return toast('Elige el negocio', 'warn');
    if (String(d.titulo || '').trim().length < 2) return toast('Escribe el título de la oferta', 'warn');
    if (!String(d.descuento || '').trim()) return toast('Escribe el descuento, ej. -20% o 2x1', 'warn');
    const enUso = [d.imagen, d.imagen_mini].filter(Boolean);
    const nuevas = subidas.nuevasEnUso(enUso);
    subidas.limpiar(enUso);
    const neg = negocios.find((n) => n.id === d.negocio_id) || {};
    const vista = Object.assign({}, d, { negocio: neg.nombre || '', activa: Number(d.activa) ? 1 : 0,
      vigente: Number(d.activa) && (!d.vigente_hasta || d.vigente_hasta >= hoyCO()) ? 'Vigente' : (Number(d.activa) ? 'Vencida' : 'Pausada') });
    onClose();
    optimista('saveOferta', [d], {
      lecturas: [['listOfertas', []]], aplicar: row ? opt.cambio(row.id, vista) : opt.alta(vista), ok: row ? 'Oferta actualizada' : 'Oferta creada',
      alFallar: () => onFallo({ row, borrador: Object.assign({}, d, { _subidas: nuevas }) })
    });
  };
  return (
    <FormModal titulo={row ? 'Editar oferta' : 'Nueva oferta'} icon="fa-percent" onClose={cerrar} onGuardar={save}>
      <Field label="Negocio" req wide><Sel value={d.negocio_id} onChange={set('negocio_id')} options={negocios.map((n) => ({ value: n.id, label: n.nombre + (n.ciudad ? ' · ' + n.ciudad : '') }))} placeholder="Elegir negocio…" /></Field>
      <Field label="Título" req><Inp value={d.titulo} onChange={set('titulo')} maxLength={120} placeholder="Pizza familiar" /></Field>
      <Field label="Descuento" req hint="Lo que sale en la etiqueta amarilla."><Inp value={d.descuento} onChange={set('descuento')} maxLength={12} placeholder="-20%" /></Field>
      <Field label="Vigente hasta" hint="Vacío = sin fecha de fin."><Inp type="date" value={d.vigente_hasta} onChange={set('vigente_hasta')} /></Field>
      <Field label="Orden"><Inp value={d.orden} onChange={set('orden')} inputMode="numeric" maxLength={4} /></Field>
      <Field label="Foto"><Subir clase="foto" value={{ grande: d.imagen, mini: d.imagen_mini }} carpeta="ofertas" seguimiento={subidas}
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

// @COMPONENTES — los componentes y pantallas propios del cliente van aquí

// Registro de pantallas: clave de página → componente. Los catálogos declarativos no necesitan entrada aquí.
const VIEWS = {
  inicio: Inicio, negocios: Negocios, ofertas: Ofertas, categorias: Categorias, importar: Importar, usuarios: Usuarios, configuracion: Configuracion,
  // @VISTAS — pantallas nuevas aquí
};

// ============== Estructura ==============
function Shell() {
  const { boot } = useStore($auth), nav = useStore($nav), loads = useStore($loads);
  const [mini, setMini] = useState(ls.get('sidebarCollapsed', false)), [open, setOpen] = useState(false), [menu, setMenu] = useState(false), [cuenta, setCuenta] = useState(false);
  const [dark, setDark] = useState(document.documentElement.classList.contains('dark-mode'));
  const page = boot.pages.find((p) => p.key === nav.page) || boot.pages[0];
  const grupos = useMemo(() => { const g = []; boot.pages.forEach((p) => { let x = g.find((y) => y.name === p.group); if (!x) { x = { name: p.group, items: [] }; g.push(x); } x.items.push(p); }); return g; }, [boot.pages]);
  const navegar = (k) => { ir(k); setOpen(false); };
  useEffect(() => {
    const h = (e) => { if (e.altKey && (e.key === 'n' || e.key === 'N')) { const b = document.querySelector('[data-primary]'); if (b) { e.preventDefault(); b.click(); } } };
    document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h);
  }, []);
  useEffect(() => { if (!menu) return undefined; const h = () => setMenu(false); const t = setTimeout(() => document.addEventListener('click', h), 0); return () => { clearTimeout(t); document.removeEventListener('click', h); }; }, [menu]);
  const View = page ? (page.master ? null : VIEWS[page.key]) : null;
  return (
    <div className={cx('app', mini && 'mini', open && 'open')}>
      {open ? <div className="sb-veil" onClick={() => setOpen(false)}></div> : null}
      <aside className="sb">
        <div className="sb-brand">{boot.cfg.logo ? <img className="sb-logo" src={boot.cfg.logo} alt="" /> : <div className="sb-logo">{iniciales(boot.cfg.empresa)}</div>}<span>{boot.cfg.empresa}</span></div>
        <nav className="sb-nav" aria-label="Menú principal">
          {grupos.map((g) => (
            <div key={g.name}><div className="sb-group">{g.name}</div>
              {g.items.map((p) => <button type="button" key={p.key} className={cx('sb-item', page && page.key === p.key && 'active')} title={p.label} onClick={() => navegar(p.key)}><Ic n={p.icon} /><span>{p.label}</span></button>)}
            </div>))}
        </nav>
        <div className="sb-foot only-desktop"><button type="button" className="sb-item" onClick={() => { setMini(!mini); ls.set('sidebarCollapsed', !mini); }} title="Contraer menú"><Ic n={mini ? 'fa-angles-right' : 'fa-angles-left'} /><span>Contraer</span></button></div>
      </aside>
      <div className="main">
        <header className="top">
          <button type="button" className="btn btn-icon only-mobile" onClick={() => setOpen(true)} aria-label="Abrir menú"><Ic n="fa-bars" /></button>
          <div className="grow"><div className="top-title">{page ? page.label : ''}</div><div className="top-crumb">{page ? page.group : ''}</div></div>
          <div className="top-acts" id="page-actions"></div>
          <button type="button" className="btn btn-icon" onClick={() => { modoOscuro(!dark); setDark(!dark); }} title={dark ? 'Modo claro' : 'Modo oscuro'} aria-label="Cambiar modo claro u oscuro"><Ic n={dark ? 'fa-sun' : 'fa-moon'} /></button>
          <button type="button" className="avatar" style={{ border: 0, cursor: 'pointer', background: boot.me.color || undefined }} onClick={() => setMenu(!menu)} aria-label="Mi cuenta">{iniciales(boot.me.nombre)}</button>
          {menu ? (
            <div className="menu">
              <div className="menu-h"><b>{boot.me.nombre}</b><div className="muted">{boot.me.rolNombre}</div></div>
              <button type="button" onClick={() => setCuenta(true)}><Ic n="fa-user" />Mi cuenta</button>
              <button type="button" onClick={() => salir()}><Ic n="fa-arrow-right-from-bracket" />Cerrar sesión</button>
            </div>) : null}
          {loads > 0 ? <div className="top-load"></div> : null}
        </header>
        <main className="page">
          <div className="page-in" key={page ? page.key : 'x'}>
            <ErrorBoundary key={page ? page.key : 'x'}>
              {!page ? <div className="card"><Vacio icon="fa-lock" titulo="Sin acceso" texto="Tu rol aún no tiene pantallas asignadas. Pide acceso al administrador." /></div>
                : page.master ? <MasterView mkey={page.master} page={page.key} />
                : View ? <View seed={nav.seed} />
                : <div className="card"><Vacio icon="fa-person-digging" titulo="Pantalla en construcción" /></div>}
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <nav className="bnav" aria-label="Accesos rápidos">
        {boot.pages.slice(0, 4).map((p) => <button type="button" key={p.key} className={cx(page && page.key === p.key && 'active')} onClick={() => navegar(p.key)}><Ic n={p.icon} /><span>{p.label}</span></button>)}
        <button type="button" onClick={() => setOpen(true)}><Ic n="fa-bars" /><span>Menú</span></button>
      </nav>
      {boot.me.debe ? <NuevaClave /> : cuenta ? <MiCuenta onClose={() => setCuenta(false)} /> : null}
    </div>
  );
}
function App() {
  const { tok, boot } = useStore($auth), nuevo = useStore($nuevo);
  return <React.Fragment>{tok && boot ? <Shell /> : nuevo ? <PrimerAdmin /> : <Login />}<PanelDescarga /><Dialogos /><Avisos /></React.Fragment>;
}

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
