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
  // Patrocinador del congreso: solo ve su pestaña (POSPER, Randomizer y
  // Sorteo en vivo). Fuera de "acceso_posper" no tiene ningún permiso.
  posper:         { label: "POSPER · Patrocinador",  color: "#0b2f5c" },
};

// Roles externos: no reciben permisos "para todos" como Ventas.
const ROLES_EXTERNOS = ["staff_contecs", "posper"];

// Permisos por módulo
// Cada permiso lista los roles que tienen acceso
export const PERMISOS = {

  ver_bitacora:      ["junta_principal","finanzas","ceo"],
  ver_inventario:    ["junta_principal", "junta", "ventas","ceo","logistica"],

  registrar_ventas:  ["junta_principal","junta","logistica", "ventas","ceo"],
  registrar_compras: ["junta_principal", "junta", "finanzas", "ventas","ceo","logistica"],

  // Acceso al botón "Ventas" del dashboard para TODOS los roles, EXCEPTO
  // Staff CONTECS (su función es congreso/escaneo, no ventas ni finanzas) y
  // el patrocinador POSPER.
  // Quien tenga "registrar_ventas" entra a ventas2.html; el resto va a ventaRapida.html.
  acceso_venta_rapida: Object.keys(ROLES).filter(r => !ROLES_EXTERNOS.includes(r)),

  // Pestaña POSPER del dashboard: posper.html, randomizer.html y
  // randomizerint.html. Debe reflejar ROLES_POSPER en functions/operaciones-qr.js.
  acceso_posper: ["ceo", "posper"],
  // Mapa del evento: lo ven todos los roles internos (el patrocinador solo
  // ve su pestaña). Configurar salones y liberar asientos va con
  // "gestionar_inscripciones", como el resto de Gestión de Eventos.
  ver_mapa: Object.keys(ROLES).filter(r => r !== "posper"),
  // Debe reflejar ROLES_LIBERAR_ASIENTO en functions/operaciones-qr.js.
  liberar_asiento: ["ceo", "staff_contecs"],
  // Botón "Gestionar actividades" del Mapa (lleva a Gestión de Evento, que
  // además pide "gestionar_inscripciones"). Por ahora solo CEO.
  mapa_gestionar_actividades: ["ceo"],
  // Quitar un RFID asignado por error (botón "Liberar" del Randomizer).
  // Debe reflejar ROLES_LIBERAR_RFID en functions/operaciones-qr.js.
  liberar_rfid: ["ceo"],

  ver_fondos:        ["junta_principal", "finanzas","ceo"],
  editar_fondos:     ["junta_principal", "finanzas","ceo"],
  
  ver_reportes:      ["junta_principal","finanzas","ceo"],

  editar_catalogo:   ["junta_principal", "ventas","ceo","logistica"],
  ver_precios:       ["junta_principal","finanzas","ventas","ceo"],
  aprobar_gastos:    ["junta_principal","ceo"],
  exportar_datos:    ["junta_principal","ceo"],
  gestionar_usuarios:   ["junta_principal","ceo"],
  // Solo CEO: borrar cuentas y el buscador/filtro por rol del módulo Usuarios.
  // "eliminar_usuarios" debe reflejar ROLES_ELIMINAR_USUARIOS en functions/eliminaciones.js.
  eliminar_usuarios:    ["ceo"],
  filtrar_usuarios:     ["ceo"],
  // Debe reflejar ROLES_ELIMINAR_PARTICIPANTES en functions/eliminaciones.js.
  eliminar_participantes: ["ceo", "junta_principal"],
  exportar_participantes: ["ceo", "junta_principal"],
  // Las credenciales llevan el QR con el token de acceso de cada participante
  // (la clave de su perfil), por eso van con los mismos roles que exportar.
  imprimir_credenciales:  ["ceo", "junta_principal"],
  // Debe reflejar ROLES_IMPORTAR_PARTICIPANTES en functions/importaciones.js.
  importar_participantes: ["ceo", "junta_principal"],
  // Módulo Credenciales: imprimir las de participantes, voluntarios, comité
  // organizador y expositores, y llevar el control de cuáles se imprimieron
  // (colección credenciales_impresas en firestore.rules).
  gestionar_credenciales: ["ceo"],
  // Botón "Reenviar correo de credencial" del perfil. Antes iba con
  // "ver_participantes"; se separa para poder darlo o quitarlo suelto.
  reenviar_credencial:    ["ceo", "junta_principal", "junta", "coordinador", "staff_contecs"],
  gestionar_inscripciones: ["ceo", "staff_contecs"],
  // Borrar un evento o checkpoint que ya tiene asistencias o inscripciones
  // (con todo su rastro). Debe reflejar ROLES_ELIMINAR_CON_HISTORIAL en
  // functions/eliminar-eventos.js.
  eliminar_con_historial: ["ceo"],
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

// ── Sub-permisos (pestañas y botones de un módulo) ───────────────────────────
// No tienen lista de roles: por defecto siguen al permiso del módulo (con sus
// ajustes), así que quien entra al módulo ve todo como siempre. El CEO puede
// quitar o dar cada uno suelto. Los que también se validan en el servidor
// (lectura QR, avisos de giras, editar eventos, salones) están copiados en
// functions/permisos.js y firestore.rules (permiteSub).
export const SUBPERMISOS = {
  // Gestión de Evento
  lectura_qr:              "gestionar_inscripciones",
  evento_editar:           "gestionar_inscripciones",
  evento_participantes:    "gestionar_inscripciones",
  evento_asistencia:       "gestionar_inscripciones",
  evento_documentos:       "gestionar_inscripciones",
  evento_salones:          "gestionar_inscripciones",
  // Fondos
  fondos_exportar:         "ver_fondos",
  // Actividades de venta
  ventas_exportar:         "gestionar_ventas",
  // Bitácora
  bitacora_ventas:         "ver_bitacora",
  bitacora_compras:        "ver_bitacora",
  bitacora_fondos:         "ver_bitacora",
  bitacora_inventario:     "ver_bitacora",
  bitacora_mermas:         "ver_bitacora",
  // Catálogo
  catalogo_categorias:     "editar_catalogo",
  catalogo_productos:      "editar_catalogo",
  // Voluntarios
  voluntarios_lectura_qr:  "gestionar_voluntarios",
  voluntarios_asignar:     "gestionar_voluntarios",
  voluntarios_importar:    "gestionar_voluntarios",
  voluntarios_registro:    "gestionar_voluntarios",
  voluntarios_asistencias: "gestionar_voluntarios",
  voluntarios_exportar:    "gestionar_voluntarios",
  // Actividades
  actividades_formularios: "gestionar_actividades",
  // Giras
  giras_lectura_qr:        "gestionar_giras",
  giras_notificar:         "gestionar_giras",
  giras_eliminar:          "gestionar_giras",
};

// ── Ajustes individuales ─────────────────────────────────────────────────────
// El rol es la plantilla; el CEO puede darle o quitarle permisos sueltos a una
// persona desde Usuarios. Viven en usuarios/{uid}.permisosExtra:
//   { ver_participantes: { modo: "otorgar", vence: Timestamp | null },
//     exportar_participantes: { modo: "quitar" } }
// Un "otorgar" con vence deja de valer solo al pasar esa fecha.
// La misma regla está en functions/permisos.js y en permite()/otorgado() de
// firebase_rules/firestore.rules: si cambia aquí, cambia allá.

// Solo cuentan para roles internos. "Sin rol" desactiva la cuenta aunque
// conserve ajustes, el patrocinador queda en su pestaña y el CEO ya tiene todo.
const ROLES_CON_AJUSTES = Object.keys(ROLES).filter(r => r !== "ceo" && r !== "posper");

export function admiteAjustes(rol) {
  return ROLES_CON_AJUSTES.includes(rol);
}

// Firestore Timestamp, Date, milisegundos o { seconds } (lo que quede en
// sessionStorage) -> milisegundos, o null si no vence.
export function venceEnMs(vence) {
  if (vence == null) return null;
  if (typeof vence === "number") return vence;
  if (typeof vence.toMillis === "function") return vence.toMillis();
  if (vence instanceof Date) return vence.getTime();
  if (typeof vence.seconds === "number") return vence.seconds * 1000;
  return null;
}

// "otorgar", "quitar" o null (sin ajuste o ya vencido).
export function ajusteDePermiso(rol, permiso, extra, ahora = Date.now()) {
  if (!admiteAjustes(rol)) return null;
  const ajuste = extra?.[permiso];
  if (ajuste?.modo === "quitar") return "quitar";
  if (ajuste?.modo === "otorgar") {
    const vence = venceEnMs(ajuste.vence);
    return vence == null || ahora < vence ? "otorgar" : null;
  }
  return null;
}

// Lo que el rol da por sí solo, sin ajustes. Un sub-permiso, lo mismo que su
// módulo.
export function rolIncluyePermiso(rol, permiso) {
  if (!rol || !permiso) return false;
  if (rol === "ceo") return true; // CEO tiene acceso a todo sin excepción
  if (SUBPERMISOS[permiso]) return rolIncluyePermiso(rol, SUBPERMISOS[permiso]);
  return (PERMISOS[permiso] || []).includes(rol);
}

// Ajuste del rol (Usuarios → "Permisos por rol"): config/permisos_roles.roles[rol].
// `ajustesRol` es el mapa de ESE rol: { permiso: { modo } }.
export function ajusteDelRol(rol, permiso, ajustesRol) {
  if (!admiteAjustes(rol)) return null;
  const modo = ajustesRol?.[permiso]?.modo;
  return modo === "otorgar" || modo === "quitar" ? modo : null;
}

// ¿Puede? Primero el ajuste de la persona (`extra`, usuarios/{uid}.permisosExtra),
// luego el de su rol (`ajustesRol`) y al final lo que el rol trae en el código.
// Sin ajustes se responde solo por rol. Un sub-permiso sin ajuste propio sigue
// a su módulo, incluidos los ajustes del módulo.
export function tienePermiso(rol, permiso, extra = null, ajustesRol = null) {
  const ajuste = ajusteDePermiso(rol, permiso, extra) ?? ajusteDelRol(rol, permiso, ajustesRol);
  if (ajuste === "otorgar") return true;
  if (ajuste === "quitar") return false;
  if (SUBPERMISOS[permiso]) return tienePermiso(rol, SUBPERMISOS[permiso], extra, ajustesRol);
  return rolIncluyePermiso(rol, permiso);
}

// Función para obtener todos los permisos de un rol
export function permisosDeRol(rol) {
  return Object.keys(PERMISOS).filter(p => rolIncluyePermiso(rol, p));
}

// Función para obtener info del rol
export function infoRol(rol) {
  return ROLES[rol] || { label: rol, color: "#717D7E" };
}

// ── Catálogo para el gestor de permisos (Usuarios) ───────────────────────────
// Agrupa los permisos por pantalla, con el texto que ve el CEO.
// - "requiere": acción con roles propios que solo sirve si se puede entrar al
//   módulo; el gestor da la entrada junto con ella.
// - Los sub-permisos (SUBPERMISOS) siguen al módulo mientras no se ajusten.
//   Darlos suelto da también la entrada al módulo, salvo los "independiente"
//   (páginas propias, como Lectura QR).
// ver_precios y aprobar_gastos no aparecen porque hoy ninguna pantalla los usa.
export const CATALOGO_PERMISOS = [
  {
    modulo: "Participantes",
    permisos: [
      { id: "ver_participantes",      label: "Ver participantes", detalle: "Entrar al módulo, ver la lista y los perfiles." },
      { id: "aprobar_pagos",          label: "Revisar pagos", detalle: "Aprobar o rechazar pagos, ver comprobantes y subir la foto del pago en efectivo.", requiere: "ver_participantes" },
      { id: "reenviar_credencial",    label: "Reenviar correo de credencial", detalle: "Botón de reenvío en el perfil (máximo 4 por persona).", requiere: "ver_participantes" },
      { id: "eliminar_participantes", label: "Eliminar participantes", detalle: "Borrado definitivo, con sus asistencias y comprobante.", requiere: "ver_participantes" },
      { id: "exportar_participantes", label: "Exportar a Excel", detalle: "Descarga la lista completa con datos personales.", requiere: "ver_participantes" },
      { id: "imprimir_credenciales",  label: "Imprimir credenciales", detalle: "Las credenciales llevan el QR de acceso de cada persona.", requiere: "ver_participantes" },
      { id: "importar_participantes", label: "Importar listas", detalle: "Inscribir estudiantes desde el Excel o CSV de un profesor.", requiere: "ver_participantes" },
    ],
  },
  {
    modulo: "Credenciales",
    permisos: [
      { id: "gestionar_credenciales", label: "Módulo Credenciales", detalle: "Imprimir y descargar credenciales de participantes, voluntarios, comité organizador y expositores, y marcar cuáles ya se imprimieron." },
    ],
  },
  {
    modulo: "Gestión de Evento",
    permisos: [
      { id: "gestionar_inscripciones", label: "Entrar a Gestión de Evento", detalle: "El módulo completo. Sus pestañas, abajo, siguen a este permiso salvo que las ajustes." },
      { id: "lectura_qr",           label: "Lectura QR", detalle: "Escanear credenciales para marcar asistencia (también sin entrar al resto del módulo).", independiente: true },
      { id: "evento_editar",        label: "Crear y editar eventos", detalle: "Eventos y checkpoints: crear, editar, activar, cancelar y eliminar." },
      { id: "evento_participantes", label: "Pestaña Participantes", detalle: "Lista del evento y exportar todos los QR." },
      { id: "evento_asistencia",    label: "Pestaña Asistencia", detalle: "Matriz de asistencia por checkpoint." },
      { id: "evento_documentos",    label: "Pestaña Certificados", detalle: "PDF y Excel del programa, exponentes y participantes elegibles." },
      { id: "evento_salones",       label: "Salones", detalle: "Configurar nombre y capacidad de los salones (pestaña y Mapa)." },
      { id: "eliminar_con_historial", label: "Eliminar con historial", detalle: "Borrar un evento o checkpoint que ya tiene asistencias, inscripciones o RFID, con todo su rastro. Sin esto solo se pueden borrar los vacíos.", requiere: "gestionar_inscripciones" },
    ],
  },
  {
    modulo: "Mapa y estadísticas",
    permisos: [
      { id: "ver_estadisticas_congreso", label: "Estadísticas del congreso", detalle: "Asistencia, checkpoints y participantes." },
      { id: "ver_mapa",                  label: "Mapa del evento", detalle: "Ver la maqueta y la ocupación de los salones." },
      { id: "liberar_asiento",           label: "Liberar asientos", detalle: "Desde el Mapa, para quien salió antes.", requiere: "ver_mapa" },
      { id: "mapa_gestionar_actividades", label: "Botón Gestionar actividades", detalle: "En el Mapa, abre Gestión de Evento en el mismo evento. Darlo da también la entrada a Gestión de Evento.", requiere: "gestionar_inscripciones" },
    ],
  },
  {
    modulo: "POSPER",
    permisos: [
      { id: "acceso_posper", label: "POSPER, Randomizer y Sorteo", detalle: "La pestaña del patrocinador." },
      { id: "liberar_rfid",  label: "Liberar RFID", detalle: "Quitar un RFID asignado por error.", requiere: "acceso_posper" },
    ],
  },
  {
    modulo: "Fondos",
    permisos: [
      { id: "ver_fondos",      label: "Ver fondos", detalle: "Saldos y movimientos de los fondos." },
      { id: "editar_fondos",   label: "Mover fondos", detalle: "Registrar entradas y salidas de un fondo.", requiere: "ver_fondos" },
      { id: "fondos_exportar", label: "Exportar reporte financiero", detalle: "El Excel del detalle de fondos." },
    ],
  },
  {
    modulo: "Ventas",
    permisos: [
      { id: "acceso_venta_rapida", label: "Ventas", detalle: "Entrar a Venta rápida." },
      { id: "registrar_ventas",    label: "Registrar mermas en ventas", detalle: "Dentro de Ventas.", requiere: "acceso_venta_rapida" },
      { id: "gestionar_ventas",    label: "Actividades de venta", detalle: "Crear y administrar las actividades de venta." },
      { id: "ventas_exportar",     label: "Exportar actividades de venta", detalle: "El Excel del listado de actividades." },
    ],
  },
  {
    modulo: "Compras y reportes",
    permisos: [
      { id: "registrar_compras", label: "Compras", detalle: "Registrar compras y subir facturas." },
      { id: "ver_reportes",      label: "Reportes financieros", detalle: "" },
    ],
  },
  {
    modulo: "Bitácora",
    permisos: [
      { id: "ver_bitacora",        label: "Entrar a Bitácora", detalle: "Historial financiero. Sus pestañas siguen a este permiso salvo que las ajustes." },
      { id: "bitacora_ventas",     label: "Pestaña Ventas", detalle: "" },
      { id: "bitacora_compras",    label: "Pestaña Compras", detalle: "" },
      { id: "bitacora_fondos",     label: "Pestaña Fondos", detalle: "" },
      { id: "bitacora_inventario", label: "Pestaña Inventario", detalle: "" },
      { id: "bitacora_mermas",     label: "Pestaña Mermas", detalle: "" },
    ],
  },
  {
    modulo: "Logística",
    permisos: [
      { id: "ver_inventario",      label: "Inventario", detalle: "Ver existencias y movimientos de stock." },
      { id: "editar_catalogo",     label: "Catálogo", detalle: "Crear y editar productos y categorías." },
      { id: "catalogo_categorias", label: "Pestaña Categorías", detalle: "" },
      { id: "catalogo_productos",  label: "Pestaña Productos", detalle: "" },
    ],
  },
  {
    modulo: "Voluntarios",
    permisos: [
      { id: "gestionar_voluntarios",   label: "Entrar a Voluntarios", detalle: "El módulo completo. Sus pestañas siguen a este permiso salvo que las ajustes." },
      { id: "voluntarios_lectura_qr",  label: "Escanear QR de voluntarios", detalle: "Marcar asistencia de voluntarios (también sin entrar al resto del módulo).", independiente: true },
      { id: "voluntarios_asignar",     label: "Pestaña Voluntariado", detalle: "Asignar voluntarios y grupos a actividades." },
      { id: "voluntarios_registro",    label: "Pestaña Voluntarios", detalle: "Registro de voluntarios." },
      { id: "voluntarios_asistencias", label: "Pestaña Asistencias", detalle: "" },
      { id: "voluntarios_importar",    label: "Pestaña Importar", detalle: "" },
      { id: "voluntarios_exportar",    label: "Exportar Excel y QR", detalle: "Botones de exportar de las pestañas." },
    ],
  },
  {
    modulo: "Actividades",
    permisos: [
      { id: "gestionar_actividades",   label: "Actividades", detalle: "Crear y administrar actividades." },
      { id: "actividades_formularios", label: "Solicitud e informe de actividad", detalle: "Los formularios universitarios." },
    ],
  },
  {
    modulo: "Giras",
    permisos: [
      { id: "gestionar_giras",  label: "Entrar a Giras", detalle: "Armar giras. Sus acciones siguen a este permiso salvo que las ajustes." },
      { id: "giras_lectura_qr", label: "Lectura QR de giras", detalle: "Entrada y salida de la gira (también sin entrar al resto del módulo).", independiente: true },
      { id: "giras_notificar",  label: "Enviar correos de gira", detalle: "Notificar participantes y no seleccionados, y reenviar." },
      { id: "giras_eliminar",   label: "Eliminar giras", detalle: "" },
    ],
  },
  {
    modulo: "Calendario y Secretaría",
    permisos: [
      { id: "ver_calendario",       label: "Calendario", detalle: "" },
      { id: "gestionar_secretaria", label: "Secretaría", detalle: "Reuniones y minutas." },
    ],
  },
  {
    modulo: "Administración",
    permisos: [
      { id: "gestionar_usuarios", label: "Usuarios", detalle: "Ver usuarios y cambiar roles (nunca el propio ni el de CEO)." },
      { id: "filtrar_usuarios",   label: "Buscar y filtrar usuarios", detalle: "", requiere: "gestionar_usuarios" },
      { id: "eliminar_usuarios",  label: "Eliminar usuarios", detalle: "", requiere: "gestionar_usuarios" },
      { id: "exportar_datos",     label: "Exportar base de datos", detalle: "" },
    ],
  },
];
