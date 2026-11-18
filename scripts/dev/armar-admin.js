// Arma el panel /admin a partir del kernel r-script (solo lectura) reemplazando la capa de datos.
// Genera: public/admin/index.html, public/admin/admin.css, public/admin/app.jsx, public/admin/cargador.js
// Uso (una vez; después app.jsx es la fuente): node scripts/dev/armar-admin.js
const fs = require('fs');
const path = require('path');

const KERNEL = path.join(process.env.USERPROFILE || process.env.HOME, '.claude', 'skills', 'r-script', 'kernel');
const PIEZAS = path.join(__dirname, 'admin');
const SALIDA = path.join(__dirname, '..', '..', 'public', 'admin');
const leer = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const pieza = (f) => leer(path.join(PIEZAS, f)).trimEnd() + '\n';

const js = leer(path.join(KERNEL, 'JavaScript.html'));
const ini = js.indexOf('<script type="text/x-jsx" id="app-src">') + '<script type="text/x-jsx" id="app-src">'.length;
const fin = js.indexOf('</script>', ini);
let src = js.slice(ini, fin).replace(/^\n/, '');

function cambiarEntre(desde, hasta, nuevo) {
  const a = src.indexOf(desde);
  const b = hasta === null ? src.length : src.indexOf(hasta, a + desde.length);
  if (a < 0 || b < 0) throw new Error('Marcador no encontrado: ' + desde + ' … ' + hasta);
  src = src.slice(0, a) + nuevo + src.slice(b);
}
function cambiar(viejo, nuevo) {
  if (src.indexOf(viejo) < 0) throw new Error('Texto no encontrado: ' + viejo.slice(0, 80));
  src = src.replace(viejo, nuevo);
}

// Encabezado
cambiar('/* KERNEL R-SCRIPT — interfaz.', '/* PANEL FULLGUIA — interfaz del kernel r-script con la capa de datos en Supabase.\n   KERNEL R-SCRIPT — interfaz.');

// Formato colombiano
cambiar("toLocaleString('es-PE'", "toLocaleString('es-CO'");
cambiar("const fmtMoney = (n) => (((($auth.get().boot || {}).cfg || {}).moneda) || '') + ' ' + fmtNum(n, 2);", "const fmtMoney = (n) => '$ ' + fmtNum(n, 0);");

// 1. Capa de datos
cambiarEntre('// ============== Servidor ==============', '// Las lecturas pedidas en los mismos 10 ms', pieza('servidor.jsx') + '\n');

// 2. Subir archivos (Storage + compresión WebP)
const utilesArchivo = [
  "const extDe = (nombre) => String((/\\.([a-z0-9]+)$/i.exec(nombre || '') || [])[1] || '').toLowerCase();",
  "const pesoTxt = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');"
].join('\n');
cambiarEntre('// ============== Subir archivos ==============', '// ============== Tabla ==============',
  '// ============== Subir archivos ==============\n' + utilesArchivo + '\n' + pieza('subir.jsx') + '\n');

// 3. Ingreso con Supabase Auth
cambiarEntre('// ============== Ingreso ==============', '// Primer ingreso:', pieza('login.jsx'));
src = src.split('Mínimo 8 caracteres, con letras y números.').join('Mínimo 10 caracteres, con letras y números.');
cambiar('<Field label="Correo" hint="Sirve para recuperar tu contraseña." wide><Inp type="email" value={email} onChange={setEmail} maxLength={120} /></Field>',
  '<Field label="Correo" hint="Con él ingresas y recuperas tu contraseña." wide><Inp type="email" value={email} onChange={setEmail} maxLength={120} disabled /></Field>');

// 4. Pantallas: se conserva Apariencia del kernel; el resto son las de FullGuia
const a0 = src.indexOf('function Apariencia(');
const a1 = src.indexOf('function Configuracion(', a0);
let apariencia = src.slice(a0, a1);
apariencia = apariencia.replace('Los colores se aplican a todos los usuarios. Solo el administrador puede cambiarlos.', 'Los colores del panel se guardan en este navegador.');
cambiarEntre('// ============== Pantallas del kernel ==============', '// @COMPONENTES',
  '// ============== Pantallas ==============\n' + apariencia + '\n' + pieza('pantallas.jsx') + '\n');
cambiarEntre('const VIEWS = {', '\n};\n',
  'const VIEWS = {\n  inicio: Inicio, negocios: Negocios, ofertas: Ofertas, categorias: Categorias, importar: Importar, usuarios: Usuarios, configuracion: Configuracion,\n  // @VISTAS — pantallas nuevas aquí');
cambiar('{boot.me.debe ? <CambiarClave obligado />', '{boot.me.debe ? <NuevaClave />');

// 5. Arranque con la sesión de Supabase
cambiarEntre('// ============== Arranque ==============', null, pieza('arranque.jsx'));

// Reglas del kernel: nada de secuencias que rompan el HTML
['</script', '<?', '?>'].forEach((s) => { if (src.indexOf(s) >= 0) throw new Error('Secuencia prohibida en el JSX: ' + s); });

fs.mkdirSync(SALIDA, { recursive: true });
fs.writeFileSync(path.join(SALIDA, 'app.jsx'), src);

// CSS
let css = leer(path.join(KERNEL, 'CSS.html')).replace(/^<style>\n?/, '').replace(/<\/style>\s*$/, '');
css = css.replace('/* @ESTILOS — los estilos propios del cliente van aquí */', pieza('estilos.css'));
fs.writeFileSync(path.join(SALIDA, 'admin.css'), css);

// Cargador (igual al del kernel, pero lee app.jsx desde el servidor)
const kLoader = js.slice(js.indexOf('<script>', fin) + 8, js.lastIndexOf('</script>'));
let cargador = kLoader
  .replace("var src = document.getElementById('app-src').textContent, h = 2166136261;", 'var src = TEXTO, h = 2166136261;');
if (cargador.indexOf('var src = TEXTO') < 0) throw new Error('No se pudo adaptar el cargador');
cargador = '// Cargador del panel: descarga app.jsx, lo traduce una vez con Babel y guarda el resultado en el navegador.\n' +
  '(function () {\n' +
  "  fetch('app.jsx', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })\n" +
  '    .then(function (TEXTO) {' + cargador.replace(/^\n/, '').split('\n').map((l) => '    ' + l).join('\n') + '\n    })\n' +
  "    .catch(function (e) { var el = document.getElementById('root'); el.textContent = ''; var d = document.createElement('div'); d.className = 'boot-splash'; d.textContent = 'No se pudo iniciar el panel. Revisa tu conexión y recarga la página.'; el.appendChild(d); if (window.console) console.error(e); });\n" +
  '})();\n';
fs.writeFileSync(path.join(SALIDA, 'cargador.js'), cargador);

// index.html
const kIndex = leer(path.join(KERNEL, 'index.html'));
const prepintado = kIndex.slice(kIndex.indexOf('  <script>\n    // Pre-pintado'), kIndex.indexOf('</script>', kIndex.indexOf('// Pre-pintado')) + 9)
  .replace("var d = document.documentElement, l = (window.__BOOT__ || {}).look || {}, v = l.vars || {};",
    "var d = document.documentElement, g = JSON.parse(localStorage.getItem('fg_look') || 'null'), l = g || (window.__BOOT__ || {}).look || {}, v = l.vars || {};");
const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Panel FullGuia</title>
  <link rel="icon" href="../favicon.svg" type="image/svg+xml">
  <script>window.__BOOT__ = { app: 'FullGuia', empresa: 'FullGuia.com', look: {} };</script>
${prepintado}
  <link rel="preconnect" href="https://biajiyiyjtqocqrabrnu.supabase.co" crossorigin>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>
  <script src="../js/config.js"></script>
  <link rel="stylesheet" href="admin.css">
</head>
<body>
  <div id="root">
    <div class="boot-splash"><div class="boot-dot"></div><span>Cargando…</span></div>
  </div>
  <script src="cargador.js"></script>
</body>
</html>
`;
fs.writeFileSync(path.join(SALIDA, 'index.html'), html);
console.log('Panel armado en', SALIDA, '· app.jsx', src.length, 'caracteres');
