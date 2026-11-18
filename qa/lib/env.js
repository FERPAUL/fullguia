// Lee ../../.env sin dependencias externas. Nunca imprime valores.
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');

function cargarEnv() {
  const archivo = path.join(RAIZ, '.env');
  const env = {};
  if (fs.existsSync(archivo)) {
    for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
      const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return Object.assign(env, process.env);
}

module.exports = { cargarEnv, RAIZ };
