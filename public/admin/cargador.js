// Cargador del panel: descarga app.jsx, lo traduce una vez con Babel y guarda el resultado en el navegador.
(function () {
  fetch('app.jsx', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function (TEXTO) {
    // Cargador: traduce el JSX de arriba a JavaScript una sola vez y guarda el resultado en el navegador.
    // Babel (unos 3 MB) solo se descarga la primera vez o cuando el código cambia.
    (function () {
      var BABEL = 'https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js';
      var src = TEXTO, h = 2166136261;
      for (var i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 16777619); }
      var key = 'jsx_' + (h >>> 0).toString(36) + '_' + src.length, code = null;
      function fallo(e) {
        var el = document.getElementById('root'), d = document.createElement('div'), b = document.createElement('b'), t = document.createElement('span');
        b.textContent = 'No se pudo iniciar el panel'; t.textContent = 'Revisa tu conexión y recarga la página.';
        d.className = 'boot-splash'; d.appendChild(b); d.appendChild(t); el.textContent = ''; el.appendChild(d);
        if (window.console) console.error(e);
      }
      function correr(c) { try { new Function(c)(); } catch (e) { try { localStorage.removeItem(key); } catch (x) {} fallo(e); } }
      try { code = localStorage.getItem(key); } catch (e) {}
      if (code) return correr(code);
      var s = document.createElement('script');
      s.src = BABEL;
      s.onload = function () {
        try { code = Babel.transform(src, { presets: ['react'], sourceType: 'script', compact: true }).code; } catch (e) { return fallo(e); }
        try {
          for (var j = localStorage.length - 1; j >= 0; j--) { var k = localStorage.key(j); if (k && k.indexOf('jsx_') === 0) localStorage.removeItem(k); }
          localStorage.setItem(key, code);
        } catch (e) {}
        correr(code);
      };
      s.onerror = fallo;
      document.head.appendChild(s);
    })();
    
    })
    .catch(function (e) { var el = document.getElementById('root'); el.textContent = ''; var d = document.createElement('div'); d.className = 'boot-splash'; d.textContent = 'No se pudo iniciar el panel. Revisa tu conexión y recarga la página.'; el.appendChild(d); if (window.console) console.error(e); });
})();
