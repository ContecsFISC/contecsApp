// =============================================
// CONTECS — Sistema de Roles y Permisos
// =============================================

export const ROLES = {
  ceo:            { label: "CEO / Desarrollador",    color: "#1a1a2e" },
  junta:          { label: "Junta Directiva",        color: "#6C3483" },
  junta_principal: { label: "Junta Directiva_A",     color: "#1a1a2e" },
  coordinador:    { label: "Coordinador",            color: "#6C3483" },
  finanzas:       { label: "Líder de Finanzas",      color: "#6C3483" },
  logistica:      { label: "Líder de Logística",     color: "#6C3483" },
  ventas:         { label: "Líder de Ventas",        color: "#1A5276" },
  secretario:     { label: "Secretario",             color: "#1A5276" },
  actividades:    { label: "Líder de Actividades",   color: "#1E8449" },
  patrocinios:    { label: "Líder de Patrocinios",   color: "#1E8449" },
  investigacion:  { label: "Líder de Investigación", color: "#1E8449" },
  voluntariado:   { label: "Líder de Voluntariado",  color: "#1E8449" },
  giras:          { label: "Líder de Giras",         color: "#1E8449" },
  comunicaciones: { label: "Líder de Comunicaciones",color: "#B7950B" },
  staff_contecs:  { label: "Staff CONTECS",          color: "#00722e" },
  miembro:        { label: "Miembro General",        color: "#717D7E" },
};

// Permisos por módulo
// Cada permiso lista los roles que tienen acceso
export const PERMISOS = {

  ver_bitacora:      ["junta_principal","finanzas","ceo"],
  ver_inventario:    ["junta_principal", "junta", "ventas","ceo","logistica"],

  registrar_ventas:  ["junta_principal","junta","logistica", "ventas","ceo"],
  registrar_compras: ["junta_principal", "junta", "finanzas", "ventas","ceo","logistica"],

  // Acceso al botón "Ventas" del dashboard para TODOS los roles, EXCEPTO
  // Staff CONTECS (su función es congreso/escaneo, no ventas ni finanzas).
  // Quien tenga "registrar_ventas" entra a ventas2.html; el resto va a ventaRapida.html.
  acceso_venta_rapida: Object.keys(ROLES).filter(r => r !== "staff_contecs"),

  ver_fondos:        ["junta_principal", "finanzas","ceo"],
  editar_fondos:     ["junta_principal", "finanzas","ceo"],
  
  ver_reportes:      ["junta_principal","finanzas","ceo"],

  editar_catalogo:   ["junta_principal", "ventas","ceo","logistica"],
  ver_precios:       ["junta_principal","finanzas","ventas","ceo"],
  aprobar_gastos:    ["junta_principal","ceo"],
  exportar_datos:    ["junta_principal","ceo"],
  gestionar_usuarios:   ["junta_principal","ceo"],
  gestionar_inscripciones: ["ceo", "staff_contecs"],
  gestionar_voluntarios:   ["junta_principal","voluntariado","ceo"],
  gestionar_actividades:   ["junta_principal","actividades","ceo"],
  gestionar_ventas:        ["junta_principal","junta","ventas","ceo"],
  gestionar_giras:         ["junta_principal","giras","ceo"],
  ver_participantes:       ["ceo", "junta_principal", "junta", "coordinador", "staff_contecs"],
  aprobar_pagos:           ["ceo", "junta_principal", "junta", "finanzas", "secretario", "staff_contecs"],
  // Estadísticas del CONGRESO (asistencia, checkpoints, participantes) —
  // separado de "ver_reportes" (Finanzas) a propósito, para que Staff CONTECS
  // pueda ver estadísticas del evento sin tener acceso a reportes financieros.
  ver_estadisticas_congreso: ["ceo", "junta_principal", "finanzas", "staff_contecs"],
  ver_calendario:         ["ceo", "junta_principal", "junta", "coordinador","finanzas","logistica","ventas","secretario","actividades", "patrocinios","investigacion","voluntariado","giras", "comunicaciones","miembro","staff_contecs"],
  gestionar_secretaria:    ["ceo", "secretario"],
};

// Función para verificar si un rol tiene un permiso
export function tienePermiso(rol, permiso) {
  if (!rol || !permiso) return false;
  if (rol === "ceo") return true; // CEO tiene acceso a todo sin excepción
  return (PERMISOS[permiso] || []).includes(rol);
}

// Función para obtener todos los permisos de un rol
export function permisosDeRol(rol) {
  return Object.keys(PERMISOS).filter(p => tienePermiso(rol, p));
}

// Función para obtener info del rol
export function infoRol(rol) {
  return ROLES[rol] || { label: rol, color: "#717D7E" };
}
