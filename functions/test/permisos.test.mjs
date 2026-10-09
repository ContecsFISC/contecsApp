// Prueba de los permisos individuales (rol + ajustes del CEO). La misma regla
// vive en dos archivos que no se pueden importar entre sí: el panel
// (js/core/permisos.js) y las Cloud Functions (functions/permisos.js). Si se
// separan, el panel muestra un botón que el servidor rechaza, o al revés,
// sin ningún error visible. Aquí se comparan caso por caso.
// La tercera copia está en firebase_rules (permite/otorgado/quitado); esa se
// prueba contra el emulador: test/permisos-reglas.integration.mjs.
//   node functions/test/permisos.test.mjs

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  ROLES, PERMISOS, SUBPERMISOS, CATALOGO_PERMISOS, tienePermiso, rolIncluyePermiso,
  ajusteDePermiso, ajusteDelRol, admiteAjustes,
} from "../../js/core/permisos.js";

const require = createRequire(import.meta.url);
const servidor = require("../permisos.js");

let pasadas = 0;
function prueba(nombre, fn) {
  fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}

const AHORA = Date.UTC(2026, 9, 8, 15, 0, 0);
const AYER = AHORA - 24 * 3600 * 1000;
const MANANA = AHORA + 24 * 3600 * 1000;
// Como llega de Firestore (Timestamp) y como queda en sessionStorage (ms).
const timestamp = (ms) => ({ toMillis: () => ms });

// En el servidor, el set ROLES_* de cada función es lo que en el panel es
// PERMISOS[permiso] (para un sub-permiso, el de su módulo); para comparar se
// usa el mismo.
// `delRol`: los permisos por rol (config/permisos_roles.roles[rol]), que en
// el servidor llegan como usuario._ajustesRol (ajustes-rol.js).
function servidorPuede(rol, permiso, extra, ahora = AHORA, delRol = undefined) {
  const lista = PERMISOS[SUBPERMISOS[permiso] || permiso] || [];
  const roles = new Set(["ceo", ...lista]);
  return servidor.usuarioPuede({ rol, permisosExtra: extra, _ajustesRol: delRol }, permiso, roles, ahora);
}

// La regla escrita a mano, independiente de tienePermiso(): ajuste propio,
// luego el del rol, luego el módulo (si es sub-permiso) y al final el rol.
function panelPuede(rol, permiso, extra, ahora = AHORA, delRol = null) {
  const ajuste = ajusteDePermiso(rol, permiso, extra, ahora) ?? ajusteDelRol(rol, permiso, delRol);
  if (ajuste === "otorgar") return true;
  if (ajuste === "quitar") return false;
  if (SUBPERMISOS[permiso]) return panelPuede(rol, SUBPERMISOS[permiso], extra, ahora, delRol);
  return rolIncluyePermiso(rol, permiso);
}

console.log("\nSin ajustes, el rol decide como siempre:\n");

prueba("ventas no ve participantes; junta sí", () => {
  assert.equal(tienePermiso("ventas", "ver_participantes"), false);
  assert.equal(tienePermiso("junta", "ver_participantes"), true);
  assert.equal(tienePermiso("ventas", "ver_participantes", {}), false);
});

prueba("CEO tiene todo, incluso permisos que no existen en la lista", () => {
  assert.equal(tienePermiso("ceo", "eliminar_usuarios"), true);
  assert.equal(tienePermiso("ceo", "cualquier_cosa"), true);
});

prueba("sin rol o sin permiso: no", () => {
  assert.equal(tienePermiso("", "ver_participantes"), false);
  assert.equal(tienePermiso("junta", ""), false);
  assert.equal(tienePermiso(null, "ver_participantes"), false);
});

console.log("\nAjustes individuales:\n");

prueba("otorgar suma un permiso que el rol no trae", () => {
  const extra = { ver_participantes: { modo: "otorgar", vence: null } };
  assert.equal(tienePermiso("ventas", "ver_participantes", extra), true);
  // y solo ese: lo demás sigue igual
  assert.equal(tienePermiso("ventas", "aprobar_pagos", extra), false);
  assert.equal(tienePermiso("ventas", "acceso_venta_rapida", extra), true);
});

prueba("quitar resta un permiso que el rol sí trae", () => {
  const extra = { exportar_participantes: { modo: "quitar" } };
  assert.equal(tienePermiso("junta_principal", "exportar_participantes", extra), false);
  assert.equal(tienePermiso("junta_principal", "ver_participantes", extra), true);
});

prueba("otorgar con vencimiento vale hasta esa hora y después no", () => {
  const extra = { ver_participantes: { modo: "otorgar", vence: timestamp(MANANA) } };
  assert.equal(ajusteDePermiso("ventas", "ver_participantes", extra, AHORA), "otorgar");
  assert.equal(ajusteDePermiso("ventas", "ver_participantes", extra, MANANA), null);
  const vencido = { ver_participantes: { modo: "otorgar", vence: AYER } };
  assert.equal(ajusteDePermiso("ventas", "ver_participantes", vencido, AHORA), null);
});

prueba("vencimiento en ms, Timestamp, Date o {seconds} se leen igual", () => {
  for (const vence of [MANANA, timestamp(MANANA), new Date(MANANA), { seconds: MANANA / 1000 }]) {
    const extra = { ver_participantes: { modo: "otorgar", vence } };
    assert.equal(ajusteDePermiso("ventas", "ver_participantes", extra, AHORA), "otorgar");
    assert.equal(servidor.ajusteDePermiso({ rol: "ventas", permisosExtra: extra }, "ver_participantes", AHORA), "otorgar");
  }
});

prueba("sin_rol desactiva la cuenta aunque conserve ajustes", () => {
  const extra = { ver_participantes: { modo: "otorgar", vence: null } };
  assert.equal(tienePermiso("sin_rol", "ver_participantes", extra), false);
  assert.equal(servidorPuede("sin_rol", "ver_participantes", extra), false);
});

prueba("el patrocinador POSPER no admite ajustes", () => {
  const extra = { ver_participantes: { modo: "otorgar", vence: null } };
  assert.equal(admiteAjustes("posper"), false);
  assert.equal(tienePermiso("posper", "ver_participantes", extra), false);
  assert.equal(servidorPuede("posper", "ver_participantes", extra), false);
});

prueba("a un CEO no se le puede quitar nada", () => {
  const extra = { eliminar_usuarios: { modo: "quitar" } };
  assert.equal(tienePermiso("ceo", "eliminar_usuarios", extra), true);
  assert.equal(servidorPuede("ceo", "eliminar_usuarios", extra), true);
});

prueba("un modo desconocido se ignora", () => {
  const extra = { ver_participantes: { modo: "si" }, exportar_participantes: "otorgar" };
  assert.equal(tienePermiso("ventas", "ver_participantes", extra), false);
  assert.equal(tienePermiso("junta_principal", "exportar_participantes", extra), true);
});

console.log("\nSub-permisos (pestañas y botones):\n");

prueba("sin ajustes, una pestaña sigue a su módulo", () => {
  assert.equal(tienePermiso("staff_contecs", "evento_salones"), true);
  assert.equal(tienePermiso("ventas", "evento_salones"), false);
  assert.equal(tienePermiso("ceo", "giras_notificar"), true);
});

prueba("quitar una pestaña deja el resto del módulo", () => {
  const extra = { evento_salones: { modo: "quitar" } };
  assert.equal(tienePermiso("staff_contecs", "evento_salones", extra), false);
  assert.equal(tienePermiso("staff_contecs", "evento_asistencia", extra), true);
  assert.equal(tienePermiso("staff_contecs", "gestionar_inscripciones", extra), true);
});

prueba("otorgar el módulo trae sus pestañas", () => {
  const extra = { gestionar_inscripciones: { modo: "otorgar", vence: null } };
  assert.equal(tienePermiso("ventas", "evento_asistencia", extra), true);
  assert.equal(tienePermiso("ventas", "lectura_qr", extra), true);
});

prueba("Lectura QR suelta, sin el módulo", () => {
  const extra = { lectura_qr: { modo: "otorgar", vence: null } };
  assert.equal(tienePermiso("ventas", "lectura_qr", extra), true);
  assert.equal(tienePermiso("ventas", "gestionar_inscripciones", extra), false);
  assert.equal(servidorPuede("ventas", "lectura_qr", extra), true);
});

prueba("quitar el módulo apaga las pestañas que lo seguían", () => {
  const extra = { gestionar_giras: { modo: "quitar" } };
  assert.equal(tienePermiso("giras", "giras_notificar", extra), false);
  assert.equal(servidorPuede("giras", "giras_notificar", extra), false);
});

prueba("si el módulo vence, sus pestañas también", () => {
  const extra = { ver_bitacora: { modo: "otorgar", vence: AYER } };
  assert.equal(tienePermiso("miembro", "bitacora_ventas", extra), false);
});

prueba("panel y servidor tienen la misma lista de sub-permisos", () => {
  assert.deepEqual(servidor.SUBPERMISOS, SUBPERMISOS);
  for (const [sub, modulo] of Object.entries(SUBPERMISOS)) {
    assert.ok(PERMISOS[modulo], `${sub} sigue a ${modulo}, que no existe`);
    assert.ok(!PERMISOS[sub], `${sub} no debe tener lista de roles propia`);
  }
});

console.log("\nPanel y servidor responden lo mismo:\n");

prueba("todas las combinaciones rol × permiso × ajuste", () => {
  const ajustes = [
    undefined,
    { modo: "otorgar", vence: null },
    { modo: "otorgar", vence: MANANA },
    { modo: "otorgar", vence: timestamp(AYER) },
    { modo: "quitar" },
  ];
  const roles = ["sin_rol", ...Object.keys(ROLES)];
  let casos = 0;
  for (const rol of roles) {
    for (const permiso of [...Object.keys(PERMISOS), ...Object.keys(SUBPERMISOS)]) {
      const modulo = SUBPERMISOS[permiso];
      // Para un sub-permiso, también con ajustes en su módulo.
      const extras = ajustes.flatMap(ajuste => [
        ajuste ? { [permiso]: ajuste } : {},
        ...(modulo ? ajustes.filter(Boolean).map(am => ({ [modulo]: am, ...(ajuste ? { [permiso]: ajuste } : {}) })) : []),
      ]);
      for (const extra of extras) {
        const ajuste = extra[permiso];
        assert.equal(servidorPuede(rol, permiso, extra), panelPuede(rol, permiso, extra),
          `${rol} / ${permiso} / ${JSON.stringify(ajuste)}`);
        assert.equal(tienePermiso(rol, permiso, extra), panelPuede(rol, permiso, extra));
        casos += 1;
      }
    }
  }
  assert.ok(casos > 1000);
});

console.log("\nPermisos por rol (config/permisos_roles):\n");

prueba("otorgar o quitar al rol cambia a todos los de ese rol", () => {
  const delRol = { ver_participantes: { modo: "otorgar" }, acceso_venta_rapida: { modo: "quitar" } };
  assert.equal(tienePermiso("ventas", "ver_participantes", {}, delRol), true);
  assert.equal(tienePermiso("ventas", "acceso_venta_rapida", {}, delRol), false);
  assert.equal(servidorPuede("ventas", "ver_participantes", {}, AHORA, delRol), true);
  assert.equal(servidorPuede("ventas", "acceso_venta_rapida", {}, AHORA, delRol), false);
});

prueba("el ajuste propio de la persona manda sobre el de su rol", () => {
  const delRol = { ver_participantes: { modo: "otorgar" } };
  const extra = { ver_participantes: { modo: "quitar" } };
  assert.equal(tienePermiso("ventas", "ver_participantes", extra, delRol), false);
  assert.equal(servidorPuede("ventas", "ver_participantes", extra, AHORA, delRol), false);
  const quitadoAlRol = { ver_participantes: { modo: "quitar" } };
  const otorgado = { ver_participantes: { modo: "otorgar", vence: null } };
  assert.equal(tienePermiso("junta", "ver_participantes", otorgado, quitadoAlRol), true);
});

prueba("si el otorgado propio vence, vuelve a mandar el rol", () => {
  const delRol = { ver_participantes: { modo: "quitar" } };
  const extra = { ver_participantes: { modo: "otorgar", vence: AYER } };
  assert.equal(panelPuede("junta", "ver_participantes", extra, AHORA, delRol), false);
  assert.equal(servidorPuede("junta", "ver_participantes", extra, AHORA, delRol), false);
});

prueba("una pestaña sigue a su módulo ajustado en el rol", () => {
  const delRol = { gestionar_inscripciones: { modo: "otorgar" } };
  assert.equal(tienePermiso("ventas", "evento_asistencia", {}, delRol), true);
  assert.equal(servidorPuede("ventas", "evento_asistencia", {}, AHORA, delRol), true);
});

prueba("CEO, POSPER y sin_rol no admiten permisos por rol", () => {
  const delRol = { eliminar_usuarios: { modo: "quitar" }, ver_participantes: { modo: "otorgar" } };
  assert.equal(tienePermiso("ceo", "eliminar_usuarios", {}, delRol), true);
  assert.equal(tienePermiso("posper", "ver_participantes", {}, delRol), false);
  assert.equal(tienePermiso("sin_rol", "ver_participantes", {}, delRol), false);
  assert.equal(servidorPuede("ceo", "eliminar_usuarios", {}, AHORA, delRol), true);
  assert.equal(servidorPuede("sin_rol", "ver_participantes", {}, AHORA, delRol), false);
});

prueba("todas las combinaciones con ajuste propio y del rol", () => {
  const propios = [undefined, { modo: "otorgar", vence: null }, { modo: "otorgar", vence: AYER }, { modo: "quitar" }];
  const delRoles = [undefined, { modo: "otorgar" }, { modo: "quitar" }, { modo: "raro" }];
  let casos = 0;
  for (const rol of ["sin_rol", ...Object.keys(ROLES)]) {
    for (const permiso of [...Object.keys(PERMISOS), ...Object.keys(SUBPERMISOS)]) {
      const modulo = SUBPERMISOS[permiso];
      for (const propio of propios) {
        for (const r of delRoles) {
          for (const rModulo of modulo ? delRoles : [undefined]) {
            const extra = propio ? { [permiso]: propio } : {};
            const delRol = { ...(r ? { [permiso]: r } : {}), ...(rModulo ? { [modulo]: rModulo } : {}) };
            const esperado = panelPuede(rol, permiso, extra, AHORA, delRol);
            assert.equal(tienePermiso(rol, permiso, extra, delRol), esperado);
            assert.equal(servidorPuede(rol, permiso, extra, AHORA, delRol), esperado,
              `${rol} / ${permiso} / ${JSON.stringify(propio)} / ${JSON.stringify(delRol)}`);
            casos += 1;
          }
        }
      }
    }
  }
  assert.ok(casos > 5000);
});

prueba("los mismos roles admiten ajustes en ambos lados", () => {
  const panel = Object.keys(ROLES).filter(admiteAjustes).sort();
  assert.deepEqual([...servidor.ROLES_CON_AJUSTES].sort(), panel);
});

console.log("\nCatálogo del gestor de permisos:\n");

prueba("cada permiso del catálogo existe y su requisito también", () => {
  const ids = CATALOGO_PERMISOS.flatMap(m => m.permisos.map(p => p.id));
  assert.equal(new Set(ids).size, ids.length, "permiso repetido en el catálogo");
  for (const m of CATALOGO_PERMISOS) {
    for (const p of m.permisos) {
      assert.ok(PERMISOS[p.id] || SUBPERMISOS[p.id], `${p.id} no está en PERMISOS ni en SUBPERMISOS`);
      if (p.requiere) assert.ok(ids.includes(p.requiere), `${p.id} requiere ${p.requiere}`);
    }
  }
});

prueba("todo permiso en uso aparece en el catálogo", () => {
  const ids = new Set(CATALOGO_PERMISOS.flatMap(m => m.permisos.map(p => p.id)));
  assert.deepEqual(Object.keys(SUBPERMISOS).filter(p => !ids.has(p)), []);
  const fuera = Object.keys(PERMISOS).filter(p => !ids.has(p));
  // Ninguna pantalla usa estos dos hoy (ver comentario del catálogo).
  assert.deepEqual(fuera.sort(), ["aprobar_gastos", "ver_precios"]);
});

prueba("reenviar_credencial conserva a quienes antes reenviaban (ver_participantes)", () => {
  assert.deepEqual([...PERMISOS.reenviar_credencial].sort(), [...PERMISOS.ver_participantes].sort());
});

console.log(`\n${pasadas} pruebas pasaron.\n`);
