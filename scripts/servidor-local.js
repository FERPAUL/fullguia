// Servidor local para probar el sitio igual que en GitHub Pages / Hostinger (sin dependencias).
// Uso: node scripts/servidor-local.js [puerto]   → http://localhost:5173/  y  http://localhost:5173/admin/
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const RAIZ = path.resolve(__dirname, '..', 'public');
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jsx': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

function iniciar(puerto) {
  const srv = http.createServer((req, res) => {
    let ruta;
    try { ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
    let archivo = path.normalize(path.join(RAIZ, ruta));
    if (!archivo.startsWith(RAIZ)) { res.writeHead(403); return res.end(); }          // nada fuera de public/
    fs.stat(archivo, (err, st) => {
      if (!err && st.isDirectory()) {
        if (!ruta.endsWith('/')) { res.writeHead(301, { Location: ruta + '/' }); return res.end(); }
        archivo = path.join(archivo, 'index.html');
      }
      fs.readFile(archivo, (e2, datos) => {
        if (e2) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
        const tipo = TIPOS[path.extname(archivo).toLowerCase()] || 'application/octet-stream';
        const cab = { 'Content-Type': tipo, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
        // Como GitHub Pages y Hostinger: los textos viajan comprimidos (gzip)
        if (/text|javascript|json|svg/.test(tipo) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
          cab['Content-Encoding'] = 'gzip';
          datos = zlib.gzipSync(datos);
        }
        res.writeHead(200, cab);
        res.end(datos);
      });
    });
  });
  return new Promise((ok) => srv.listen(puerto || 0, () => ok(srv)));
}

module.exports = { iniciar };

if (require.main === module) {
  const puerto = Number(process.argv[2] || process.env.PORT || 5173);
  iniciar(puerto).then(() => console.log('FullGuia local: http://localhost:' + puerto + '/  ·  panel: http://localhost:' + puerto + '/admin/'));
}
