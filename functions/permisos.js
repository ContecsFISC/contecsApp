"use strict";

// Permisos individuales en las Cloud Functions. El rol sigue siendo la base
// (cada función conserva su set ROLES_*), pero el CEO puede darle o quitarle
// un permiso suelto a una persona desde Usuarios; queda en
// usuarios/{uid}.permisosExtra = { permiso: { modo: "otorgar"|"quitar", vence } }.
// Misma regla que tienePermiso() en js/core/permisos.js y que
// permite()/otorgado() en firebase_rules/firestore.rules: si cambia aquí,
// cambia allá (test/permisos.test.mjs compara este archivo con el del panel).

// Roles internos que admiten ajustes. "sin_rol" desactiva la cuenta aunque
// conserve ajustes; "posper" (patrocinador) y "ceo" quedan fuera.
const ROLES_CON_AJUSTES = new Set([
  "junta_principal", "junta", "coordinador", "finanzas", "logistica",
  "ventas", "secretario", "actividades", "patrocinios", "investigacion",
  "voluntariado", "giras", "comunicaciones", "staff_contecs", "miembro",
]);

// Sub-permisos: sin ajuste propio siguen al permiso de su módulo (con sus
// ajustes). Copia exacta de SUBPERMISOS en js/core/permisos.js
// (test/permisos.test.mjs lo compara). Aquí solo se consultan los de lectura
// QR y avisos de gira, pero se copia entero para no tener que elegir.
const SUBPERMISOS = {
  lectura_qr: "gestionar_inscripciones",
  evento_editar: "gestionar_inscripciones",
  evento_participantes: "gestionar_inscripciones",
  evento_asistencia: "gestionar_inscripciones",
  evento_documentos: "gestionar_inscripciones",
  evento_salones: "gestionar_inscripciones",
  fondos_exportar: "ver_fondos",
  ventas_exportar: "gestionar_ventas",
  bitacora_ventas: "ver_bitacora",
  bitacora_compras: "ver_bitacora",
  bitacora_fondos: "ver_bitacora",
  bitacora_inventario: "ver_bitacora",
  bitacora_mermas: "ver_bitacora",
  catalogo_categorias: "editar_catalogo",
  catalogo_productos: "editar_catalogo",
  voluntarios_lectura_qr: "gestionar_voluntarios",
  voluntarios_asignar: "gestionar_voluntarios",
  voluntarios_importar: "gestionar_voluntarios",
  voluntarios_registro: "gestionar_voluntarios",
  voluntarios_asistencias: "gestionar_voluntarios",
  voluntarios_exportar: "gestionar_voluntarios",
  actividades_formularios: "gestionar_actividades",
  giras_lectura_qr: "gestionar_giras",
  giras_notificar: "gestionar_giras",
  giras_eliminar: "gestionar_giras",
};

function venceEnMs(vence) {
  if (vence == null) return null;
  if (typeof vence === "number") return vence;
  if (typeof vence.toMillis === "function") return vence.toMillis();
  if (vence instanceof Date) return vence.getTime();
  if (typeof vence.seconds === "number") return vence.seconds * 1000;
  return null;
}

// "otorgar", "quitar" o null (sin ajuste o ya vencido).
function ajusteDePermiso(usuario, permiso, ahora = Date.now()) {
  if (!usuario || !ROLES_CON_AJUSTES.has(usuario.rol)) return null;
  const ajuste = usuario.permisosExtra?.[permiso];
  if (ajuste?.modo === "quitar") return "quitar";
  if (ajuste?.modo === "otorgar") {
    const vence = venceEnMs(ajuste.vence);
    return vence == null || ahora < vence ? "otorgar" : null;
  }
  return null;
}

// `usuario` es el documento usuarios/{uid}; `rolesBase` el set ROLES_* que
// la función usaba antes de los ajustes (para un sub-permiso, el de su
// módulo).
function usuarioPuede(usuario, permiso, rolesBase, ahora = Date.now()) {
  const ajuste = ajusteDePermiso(usuario, permiso, ahora);
  if (ajuste === "otorgar") return true;
  if (ajuste === "quitar") return false;
  if (SUBPERMISOS[permiso]) {
    return usuarioPuede(usuario, SUBPERMISOS[permiso], rolesBase, ahora);
  }
  return !!usuario && rolesBase.has(usuario.rol);
}

module.exports = {
  ROLES_CON_AJUSTES,
  SUBPERMISOS,
  ajusteDePermiso,
  usuarioPuede,
  venceEnMs,
};
