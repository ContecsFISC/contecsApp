"use strict";

// Prueba del render de las plantillas de correo.
//
// Lo que se comprueba aquí no rompe nada ruidosamente: el correo sale igual,
// solo que mal. Los dos casos que ya habían mordido en producción:
//   · un participante sin nombre guardado recibía "Hola ," (y, peor, Brevo
//     rechazaba el envío entero con 400 por el `name` vacío del destinatario);
//   · una variable mal escrita dejaba un "{{gira_lugar}}" literal en el correo.
//
//   node functions/test/plantillas.test.js

const assert = require("node:assert/strict");
const {
  cargarCorreoNotificacionGira,
  cargarCorreoNoSeleccionadoGira,
  cargarCorreoPagoAprobado,
} = require("../plantillas");

let pasadas = 0;
function prueba(nombre, fn) {
  fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}

const VARS_GIRA = {
  gira_nombre: "Gira al Canal",
  gira_fecha: "lunes, 1 de junio de 2026",
  gira_hora: "8:00 a.m.",
  gira_lugar: "Miraflores",
  gira_lugar_encuentro: "Entrada de la FISC",
  coordinador_info: "Ana Ruiz (Staff) · 6000-0000",
  link_gira: "https://ejemplo/gira?c=1&t=2&g=3",
};

const sinPlaceholders = (html) => (html.match(/{{[^}]+}}/g) || []);

console.log("\nnotificación de gira:\n");

prueba("no queda ninguna variable sin sustituir", () => {
  const r = cargarCorreoNotificacionGira({nombre: "Ana", ...VARS_GIRA});
  assert.deepEqual(sinPlaceholders(r.htmlContent), []);
});

prueba("la plantilla está activa", () => {
  assert.equal(cargarCorreoNotificacionGira({nombre: "Ana", ...VARS_GIRA}).activo, true);
});

prueba("con nombre saluda por el nombre", () => {
  const r = cargarCorreoNotificacionGira({nombre: "Ana", ...VARS_GIRA});
  assert.match(r.textContent, /Hola Ana,/);
});

prueba("sin nombre NO deja 'Hola ,'", () => {
  const r = cargarCorreoNotificacionGira({nombre: "", ...VARS_GIRA});
  assert.match(r.textContent, /Hola,/);
  assert.doesNotMatch(r.textContent, /Hola\s+,/);
});

prueba("el nombre se escapa (no puede inyectar HTML)", () => {
  const r = cargarCorreoNotificacionGira({nombre: "<b>Ana</b> & Cía", ...VARS_GIRA});
  assert.ok(r.htmlContent.includes("&lt;b&gt;Ana&lt;/b&gt; &amp; Cía"));
  assert.ok(!r.htmlContent.includes("<b>Ana</b>"));
});

prueba("el asunto lleva el nombre de la gira sin escapar de más", () => {
  const r = cargarCorreoNotificacionGira({nombre: "Ana", ...VARS_GIRA});
  assert.ok(r.subject.includes("Gira al Canal"));
  assert.ok(!r.subject.includes("{{"));
});

prueba("la versión en texto plano no trae etiquetas ni entidades", () => {
  const r = cargarCorreoNotificacionGira({nombre: "Ana & Co", ...VARS_GIRA});
  assert.ok(!/<[a-z]/i.test(r.textContent));
  assert.ok(r.textContent.includes("Ana & Co"));
  assert.ok(!r.textContent.includes("&amp;"));
});

prueba("los datos de la gira aparecen en el correo", () => {
  const r = cargarCorreoNotificacionGira({nombre: "Ana", ...VARS_GIRA});
  ["Miraflores", "Entrada de la FISC", "8:00 a.m.", "Ana Ruiz"].forEach((dato) => {
    assert.ok(r.textContent.includes(dato), `falta "${dato}" en el correo`);
  });
});

console.log("\naviso a no seleccionados:\n");

const VARS_NOSEL = {
  gira_nombre: "Gira al Canal",
  gira_fecha: "lunes, 1 de junio de 2026",
  motivo: "Cupo lleno",
  mensaje: "El cupo lo definió la empresa.\n\nHabrá más giras este semestre.",
};

prueba("no queda ninguna variable sin sustituir", () => {
  const r = cargarCorreoNoSeleccionadoGira({nombre: "Ana", ...VARS_NOSEL});
  assert.deepEqual(sinPlaceholders(r.htmlContent), []);
});

prueba("sin nombre NO deja 'Hola ,'", () => {
  const r = cargarCorreoNoSeleccionadoGira({nombre: "", ...VARS_NOSEL});
  assert.match(r.textContent, /Hola,/);
  assert.doesNotMatch(r.textContent, /Hola\s+,/);
});

prueba("el mensaje del staff se parte en párrafos", () => {
  const r = cargarCorreoNoSeleccionadoGira({nombre: "Ana", ...VARS_NOSEL});
  assert.ok(r.textContent.includes("El cupo lo definió la empresa."));
  assert.ok(r.textContent.includes("Habrá más giras este semestre."));
});

prueba("el mensaje del staff no puede inyectar HTML", () => {
  const r = cargarCorreoNoSeleccionadoGira({
    ...VARS_NOSEL, nombre: "Ana", mensaje: "<script>alert(1)</script>",
  });
  assert.ok(!r.htmlContent.includes("<script>"));
  assert.ok(r.htmlContent.includes("&lt;script&gt;"));
});

prueba("sin nota no queda un recuadro vacío", () => {
  const conNota = cargarCorreoNoSeleccionadoGira({nombre: "Ana", nota: "Pasa por la oficina.", ...VARS_NOSEL});
  const sinNota = cargarCorreoNoSeleccionadoGira({nombre: "Ana", ...VARS_NOSEL});
  assert.ok(conNota.textContent.includes("Pasa por la oficina."));
  assert.ok(conNota.htmlContent.length > sinNota.htmlContent.length);
});

prueba("NO lleva enlace ni credenciales a la gira", () => {
  const r = cargarCorreoNoSeleccionadoGira({nombre: "Ana", ...VARS_NOSEL});
  assert.ok(!/gira\.html|[?&]t=/.test(r.htmlContent),
      "el aviso de no seleccionado nunca debe entregar acceso a la gira");
});

console.log("\npago aprobado:\n");

prueba("no queda ninguna variable sin sustituir", () => {
  const r = cargarCorreoPagoAprobado({
    nombre: "Ana", codigo: "C-001", categoria: "Estudiante",
    link_perfil: "https://ejemplo/perfil?c=1&t=2", metodo_pago: "Efectivo",
  });
  assert.deepEqual(sinPlaceholders(r.htmlContent), []);
  assert.ok(r.subject.includes("C-001"));
});

console.log(`\n${pasadas} pruebas OK\n`);
