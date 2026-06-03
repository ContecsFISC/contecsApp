// =============================================
// CONTECS — Sistema de Roles y Permisos
// =============================================
// Niveles de autoridad:
// 6 = CEO / Desarrollador (bypass total)
// 5 = Junta Directiva / Coordinadores
// 4 = Líderes principales
// 3 = Líderes de área
// 2 = Colaboradores
// 1 = Miembro general

export const ROLES = {
  ceo:              { label: "CEO / Desarrollador",      nivel: 6, color: "#1a1a2e" },
  junta_principal:  { label: "Junta Directiva A",        nivel: 6, color: "#1a1a2e" },
  junta:            { label: "Junta Directiva",          nivel: 5, color: "#6C3483" },
  coordinador:      { label: "Coordinador",              nivel: 5, color: "#6C3483" },
  finanzas:         { label: "Líder de Finanzas",        nivel: 5, color: "#6C3483" },
  logistica:        { label: "Líder de Logística",       nivel: 5, color: "#6C3483" },
  secretario:       { label: "Secretario",               nivel: 4, color: "#1A5276" },
  ventas:           { label: "Líder de Ventas",          nivel: 4, color: "#1A5276" },
  ventas_colab:     { label: "Colaborador de Ventas",    nivel: 2, color: "#717D7E" },
  actividades:      { label: "Líder de Actividades",     nivel: 3, color: "#1E8449" },
  actividades_colab:{ label: "Colaborador Actividades",  nivel: 2, color: "#717D7E" },
  patrocinios:      { label: "Líder de Patrocinios",     nivel: 3, color: "#1E8449" },
  investigacion:    { label: "Líder de Investigación",   nivel: 3, color: "#1E8449" },
  voluntariado:     { label: "Líder de Voluntariado",    nivel: 3, color: "#1E8449" },
  voluntariado_colab:{ label: "Colaborador Voluntariado",nivel: 2, color: "#717D7E" },
  giras:            { label: "Líder de Giras",           nivel: 3, color: "#1E8449" },
  comunicaciones:   { label: "Líder de Comunicaciones",  nivel: 2, color: "#B7950B" },
  miembro:          { label: "Miembro General",          nivel: 1, color: "#717D7E" },
};

// ──────────────────────────────────────────────────────────────────────────────
// PERMISOS
// Cada clave lista los roles que tienen ese permiso.
// CEO siempre tiene acceso total (ver tienePermiso).
// ──────────────────────────────────────────────────────────────────────────────
export const PERMISOS = {

  // ── BITÁCORA, INVENTARIO ─────────────────────────────────────────────────
  ver_bitacora:             ["junta_principal", "finanzas", "ceo"],
  ver_inventario:           ["junta_principal", "junta", "ventas", "ceo"],

  // ── VENTAS Y COMPRAS ─────────────────────────────────────────────────────
  registrar_ventas:         ["junta_principal", "junta", "logistica", "ventas", "ceo"],
  registrar_compras:        ["junta_principal", "junta", "finanzas", "ventas", "ceo"],

  // ── FONDOS ───────────────────────────────────────────────────────────────
  ver_fondos:               ["junta_principal", "finanzas", "ceo"],
  editar_fondos:            ["junta_principal", "finanzas", "ceo"],

  // ── REPORTES / CATÁLOGO ──────────────────────────────────────────────────
  ver_reportes:             ["junta_principal", "finanzas", "ceo"],
  editar_catalogo:          ["junta_principal", "ventas", "ceo"],
  ver_precios:              ["junta_principal", "finanzas", "ventas", "ceo"],
  aprobar_gastos:           ["junta_principal", "ceo"],
  exportar_datos:           ["junta_principal", "ceo"],

  // ── USUARIOS ─────────────────────────────────────────────────────────────
  gestionar_usuarios:       ["junta_principal", "ceo"],

  // ── INSCRIPCIONES (módulo legacy) ────────────────────────────────────────
  gestionar_inscripciones:  ["ceo"],

  // ── VOLUNTARIOS ──────────────────────────────────────────────────────────
  gestionar_voluntarios:    ["junta_principal", "voluntariado", "ceo"],

  // ────────────────────────────────────────────────────────────────────────
  // MÓDULO PARTICIPANTES (nuevo)
  // ────────────────────────────────────────────────────────────────────────

  // Ver la lista completa de participantes registrados
  ver_participantes: [
    "junta_principal", "junta", "coordinador",
    "finanzas", "ventas", "ventas_colab",
    "actividades", "secretario", "ceo",
  ],

  // Registrar/crear un participante manualmente desde el panel
  registrar_participante: [
    "junta_principal", "junta", "coordinador",
    "ventas", "ventas_colab",
    "actividades", "actividades_colab", "ceo",
  ],

  // Editar datos de un participante existente
  editar_participante: [
    "junta_principal", "junta", "coordinador",
    "ventas", "secretario", "ceo",
  ],

  // Ver detalle del pago de un participante (monto, comprobante)
  ver_pagos_participante: [
    "junta_principal", "junta", "coordinador",
    "finanzas", "ventas", "ceo",
  ],

  // Aprobar o rechazar comprobantes de pago
  aprobar_pagos: [
    "junta_principal", "junta", "coordinador",
    "finanzas", "ceo",
  ],

  // Validar QR en puerta del evento
  validar_qr: [
    "junta_principal", "junta", "coordinador",
    "ventas", "ventas_colab",
    "voluntariado", "voluntariado_colab",
    "actividades_colab", "ceo",
  ],

  // Exportar listado de participantes
  exportar_participantes: [
    "junta_principal", "junta", "coordinador",
    "finanzas", "ventas", "secretario", "ceo",
  ],
};

// ──────────────────────────────────────────────────────────────────────────────
// FUNCIONES
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Verifica si un rol tiene un permiso determinado.
 * CEO siempre retorna true.
 */
export function tienePermiso(rol, permiso) {
  if (!rol || !permiso) return false;
  if (rol === "ceo" || rol === "junta_principal") return true;
  return (PERMISOS[permiso] || []).includes(rol);
}

/**
 * Retorna todos los permisos que tiene un rol.
 */
export function permisosDeRol(rol) {
  return Object.keys(PERMISOS).filter(p => tienePermiso(rol, p));
}

/**
 * Retorna info visual del rol (label, nivel, color).
 */
export function infoRol(rol) {
  return ROLES[rol] || { label: rol || "Sin rol", nivel: 0, color: "#717D7E" };
}
