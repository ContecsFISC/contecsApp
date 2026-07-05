// =============================================
// CONTECS — Sistema de Roles y Permisos
// =============================================
// Niveles de autoridad:
// 5 = Máxima autoridad
// 4 = Autoridad alta
// 3 = Autoridad media
// 2 = Autoridad baja-media
// 1 = Mínima autoridad

export const ROLES = {
  ceo:            { label: "CEO / Desarrollador",    nivel: 6, color: "#1a1a2e" },
  junta:          { label: "Junta Directiva",        nivel: 5, color: "#6C3483" },
  junta_principal: { label: "Junta Directiva_A",    nivel: 6, color: "#1a1a2e" },
  coordinador:    { label: "Coordinador",            nivel: 5, color: "#6C3483" },
  finanzas:       { label: "Líder de Finanzas",      nivel: 5, color: "#6C3483" },
  logistica:      { label: "Líder de Logística",     nivel: 5, color: "#6C3483" },
  ventas:         { label: "Líder de Ventas",        nivel: 4, color: "#1A5276" },
  secretario:     { label: "Secretario",             nivel: 4, color: "#1A5276" },
  actividades:    { label: "Líder de Actividades",   nivel: 3, color: "#1E8449" },
  patrocinios:    { label: "Líder de Patrocinios",   nivel: 3, color: "#1E8449" },
  investigacion:  { label: "Líder de Investigación", nivel: 3, color: "#1E8449" },
  voluntariado:   { label: "Líder de Voluntariado",  nivel: 3, color: "#1E8449" },
  giras:          { label: "Líder de Giras",         nivel: 3, color: "#1E8449" },
  comunicaciones: { label: "Líder de Comunicaciones",nivel: 2, color: "#B7950B" },
  miembro:        { label: "Miembro General",        nivel: 1, color: "#717D7E" },
};

// Permisos por módulo
// Cada permiso lista los roles que tienen acceso
export const PERMISOS = {

  ver_bitacora:      ["junta_principal","finanzas","ceo"],
  ver_inventario:    ["junta_principal", "junta", "ventas","ceo","logistica"],

  registrar_ventas:  ["junta_principal","junta","logistica", "ventas","ceo"],
  registrar_compras: ["junta_principal", "junta", "finanzas", "ventas","ceo","logistica"],

  // Acceso al botón "Ventas" del dashboard para TODOS los roles.
  // Quien tenga "registrar_ventas" entra a ventas2.html; el resto va a ventaRapida.html.
  acceso_venta_rapida: Object.keys(ROLES),

  ver_fondos:        ["junta_principal", "finanzas","ceo"],
  editar_fondos:     ["junta_principal", "finanzas","ceo"],
  
  ver_reportes:      ["junta_principal","finanzas","ceo"],

  editar_catalogo:   ["junta_principal", "ventas","ceo","logistica"],
  ver_precios:       ["junta_principal","finanzas","ventas","ceo"],
  aprobar_gastos:    ["junta_principal","ceo"],
  exportar_datos:    ["junta_principal","ceo"],
  gestionar_usuarios:   ["junta_principal","ceo"],
  gestionar_inscripciones: ["ceo"],
  gestionar_voluntarios:   ["junta_principal","voluntariado","ceo"],
  gestionar_actividades:   ["junta_principal","actividades","ceo"],
  gestionar_ventas:        ["junta_principal","junta","ventas","ceo"],
  gestionar_giras:         ["junta_principal","giras","ceo"],
  ver_participantes:       ["ceo", "junta_principal", "junta"],
  aprobar_pagos:           ["ceo", "junta_principal", "junta", "finanzas", "secretario"],
  ver_calendario:         ["ceo", "junta_principal", "junta", "coordinador","finanzas","logistica","ventas","secretario","actividades", "patrocinios","investigacion","voluntariado","giras", "comunicaciones","miembro"],
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
  return ROLES[rol] || { label: rol, nivel: 0, color: "#717D7E" };
}
