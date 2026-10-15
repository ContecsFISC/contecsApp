// ═══════════════════════════════════════════════════════════════
// CONTECS — Secciones del panel (fuente unica)
//
// Antes vivia solo en panel/dashboard.html. Ahora la usan el dashboard y el
// navbar de TODAS las paginas del panel. Las rutas son relativas a /panel/.
// Quien ve cada modulo lo decide `permiso` con el mismo tienePermiso() de
// siempre; "salvoSi": el acceso directo sobra si ya se ve el modulo completo.
// ═══════════════════════════════════════════════════════════════

export const CATEGORIAS = [
  {
    id: "congreso", label: "Congreso",
    modulos: [
      { label: "Participantes",       href: "modulos/congreso/modulos_participantes.html",    permiso: "ver_participantes" },
      { label: "Gestión de Evento",   href: "modulos/congreso/inscripciones.html",            permiso: "gestionar_inscripciones", admin: true },
      { label: "Estadísticas",        href: "modulos/congreso/reportes_estadisticaCont.html", permiso: "ver_estadisticas_congreso" },
      { label: "Credenciales",        href: "modulos/congreso/credenciales.html",             permiso: "gestionar_credenciales", admin: true },
    ],
  },
  {
    // Lo ven todos los roles internos; quién configura salones o libera
    // asientos lo decide la página con los permisos de siempre. Lectura
    // QR va aquí para encontrarla rápido el día del evento (Gestión de
    // Evento también la abre con "Leer QR").
    id: "mapa", label: "Mapa del evento",
    modulos: [
      { label: "Mapa interactivo 3D", href: "modulos/congreso/mapa.html", permiso: "ver_mapa" },
      { label: "Lectura QR",          href: "modulos/congreso/lecturaQR.html", permiso: "lectura_qr" },
    ],
  },
  {
    // Patrocinador: fuera de Gestión de Eventos, solo POSPER y CEO.
    id: "posper", label: "POSPER",
    modulos: [
      { label: "Lector POSPER",  href: "modulos/congreso/posper.html",        permiso: "acceso_posper" },
      { label: "Randomizer",     href: "modulos/congreso/randomizer.html",    permiso: "acceso_posper" },
      { label: "Sorteo en vivo", href: "modulos/congreso/randomizerint.html", permiso: "acceso_posper" },
      { label: "QR POSPER",      href: "modulos/congreso/qrPosper.html",      permiso: "qr_posper" },
    ],
  },
  {
    id: "finanzas", label: "Finanzas",
    modulos: [
      { label: "Fondos",     href: "modulos/finanzas/fondos.html",    permiso: "ver_fondos", admin: true },
      { label: "Ventas",
        href: "modulos/finanzas/ventaRapida.html",
        permiso: "acceso_venta_rapida" },
      { label: "Compras",    href: "modulos/finanzas/compras2.html",  permiso: "registrar_compras", admin: true },
      { label: "Reportes",   href: "modulos/finanzas/reportes.html",  permiso: "ver_reportes" },
      { label: "Bitácora",   href: "modulos/finanzas/bitacora.html",  permiso: "ver_bitacora" },
    ],
  },
  {
    id: "logistica", label: "Logística",
    modulos: [
      { label: "Inventario", href: "modulos/logistica/inventario.html", permiso: "ver_inventario" },
      { label: "Catálogo",   href: "modulos/logistica/catalogo.html",   permiso: "editar_catalogo", admin: true },
    ],
  },
  {
    id: "voluntariado", label: "Voluntariado",
    modulos: [
      { label: "Voluntarios",  href: "modulos/voluntariado/voluntarios.html",  permiso: "gestionar_voluntarios", admin: true },
      { label: "QR de voluntarios", href: "modulos/voluntariado/lecturaQRVoluntarios.html", permiso: "voluntarios_lectura_qr", salvoSi: "gestionar_voluntarios" },
      { label: "Actividades",  href: "modulos/voluntariado/actividades.html",  permiso: "gestionar_actividades", admin: true },
      { label: "Giras",        href: "modulos/voluntariado/giras.html",        permiso: "gestionar_giras", admin: true },
      { label: "QR de giras",  href: "modulos/voluntariado/lecturaQRGiras.html", permiso: "giras_lectura_qr", salvoSi: "gestionar_giras" },
      { label: "Calendario",   href: "modulos/voluntariado/calendario.html",   permiso: "ver_calendario", admin: true },
    ],
  },
  {
    id: "admin", label: "Administración",
    modulos: [
      { label: "Usuarios",    href: "modulos/admin/usuarios.html",    permiso: "gestionar_usuarios", admin: true },
      { label: "Exportar",    href: "modulos/admin/exportar.html",    permiso: "exportar_datos", admin: true },
      { label: "Secretaria",  href: "modulos/admin/secretaria.html",  permiso: "gestionar_secretaria", admin: true },
    ],
  },
];

/** Categorias visibles para el usuario, con rutas resueltas por `resolver`. */
export function categoriasPara(usuario, tienePermiso, resolver = href => href) {
  const rol = usuario.rol || "sin_rol";
  const puede = p => tienePermiso(rol, p, usuario.permisosExtra, usuario.ajustesRol);
  return CATEGORIAS
    .map(cat => ({ ...cat, modulos: cat.modulos.filter(m => puede(m.permiso) && !(m.salvoSi && puede(m.salvoSi))) }))
    .filter(cat => cat.modulos.length > 0)
    .map(cat => ({
      id: cat.id,
      label: cat.label,
      modulos: cat.modulos.map(m => ({ label: m.label, href: resolver(m.href), admin: !!m.admin })),
    }));
}
