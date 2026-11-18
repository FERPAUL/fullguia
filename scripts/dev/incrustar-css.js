// Herramienta de una sola vez: pasa css/fullguia.css a un bloque <style id="fg-estilos"> en cada página
// (evita una petición que bloquea el primer pintado). Desde aquí, el bloque se edita en las páginas
// y el QA comprueba que sea idéntico en las cuatro.
const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, '..', '..', 'public');
const css = fs.readFileSync(path.join(PUB, 'css', 'fullguia.css'), 'utf8').trim();
const bloque = '<style id="fg-estilos">\n' + css.split('\n').map((l) => '        ' + l).join('\n') + '\n    </style>';
for (const p of ['index.html', 'categoria.html', 'negocio.html', 'categorias.html']) {
  const f = path.join(PUB, p);
  let h = fs.readFileSync(f, 'utf8');
  const link = '<link rel="stylesheet" href="css/fullguia.css">';
  if (h.indexOf(link) < 0) throw new Error(p + ': no tiene el enlace a css/fullguia.css');
  h = h.replace(link, '<!-- Estilos de la parte dinámica (esqueletos, video, mensajes). No editar el diseño aquí. -->\n    ' + bloque);
  fs.writeFileSync(f, h);
}
fs.rmSync(path.join(PUB, 'css'), { recursive: true });
console.log('CSS incrustado en 4 páginas');
