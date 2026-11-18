/* FullGuia · configuración pública.
   Estos valores son PÚBLICOS por diseño (la publishable key solo permite lo que dejan las reglas RLS).
   NUNCA pongas aquí la service_role / secret key.
   Al migrar al proyecto del cliente: cambia SUPABASE_URL y SUPABASE_KEY (ver MIGRACION.md). */
window.FG_CONFIG = {
  SUPABASE_URL: 'https://biajiyiyjtqocqrabrnu.supabase.co',
  SUPABASE_KEY: 'sb_publishable_xUtCsG0r8RkpOY_VRQDVLA_tRY2rfDJ',
  BUCKET: 'negocios',

  // WhatsApp de FullGuia para "Publica tu negocio" (Colombia: 57 + celular de 10 dígitos).
  // Vacío = los botones llevan a la sección de planes del inicio.
  WHATSAPP_FULLGUIA: '',
  MENSAJE_PUBLICAR: 'Hola, quiero publicar mi negocio en FullGuia.com',

  POR_PAGINA: 20
};
