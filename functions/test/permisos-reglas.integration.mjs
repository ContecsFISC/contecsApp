// Permisos individuales contra las reglas reales (firebase_rules/firestore.rules)
// en el emulador. Es la tercera copia de la regla rol + ajustes (las otras dos
// se comparan en test/permisos.test.mjs) y la única que de verdad bloquea:
// si aquí falla, el panel muestra un botón que Firestore rechaza, o deja
// pasar a alguien a quien se le quitó el permiso.
//   npm run test:reglas   (desde functions/)

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const PROYECTO = "contecs-fa6e6";
const HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const BASE = `http://${HOST}/v1/projects/${PROYECTO}/databases/(default)/documents`;

initializeApp({ projectId: PROYECTO });
const db = getFirestore();

let pasadas = 0;
async function prueba(nombre, fn) {
  await fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}

// Token sin firma: el emulador lo acepta como si viniera de Firebase Auth.
function token(uid) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const ahora = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({
    iss: `https://securetoken.google.com/${PROYECTO}`, aud: PROYECTO,
    sub: uid, user_id: uid, iat: ahora, exp: ahora + 3600, auth_time: ahora,
    email: `${uid}@example.com`, firebase: { sign_in_provider: "google.com" },
  })}.`;
}

function aValor(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, aValor(x)])) } };
}

// Devuelve el status HTTP: 200 = permitido, 403 = reglas lo negaron.
async function como(uid, metodo, ruta, campos = null) {
  let url = `${BASE}/${ruta}`;
  const init = { method: metodo, headers: { Authorization: `Bearer ${token(uid)}` } };
  if (campos) {
    url += "?" + Object.keys(campos).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify({ fields: Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, aValor(v)])) });
  }
  const res = await fetch(url, init);
  return res.status;
}
const puede = async (...a) => assert.equal(await como(...a), 200);
const noPuede = async (...a) => assert.equal(await como(...a), 403);

const MANANA = Timestamp.fromMillis(Date.now() + 24 * 3600 * 1000);
const AYER = Timestamp.fromMillis(Date.now() - 24 * 3600 * 1000);

const USUARIOS = {
  "ceo-1": { rol: "ceo" },
  "jp-1": { rol: "junta_principal" },
  "jp-sin-usuarios": { rol: "junta_principal", permisosExtra: { gestionar_usuarios: { modo: "quitar" } } },
  "jp-sin-eliminar": { rol: "junta_principal", permisosExtra: { eliminar_participantes: { modo: "quitar" } } },
  "junta-sin-ver": { rol: "junta", permisosExtra: { ver_participantes: { modo: "quitar" } } },
  "ventas-1": { rol: "ventas" },
  "ventas-ve": { rol: "ventas", permisosExtra: { ver_participantes: { modo: "otorgar", vence: null } } },
  "ventas-ve-hasta-manana": { rol: "ventas", permisosExtra: { ver_participantes: { modo: "otorgar", vence: MANANA } } },
  "ventas-ve-vencido": { rol: "ventas", permisosExtra: { ver_participantes: { modo: "otorgar", vence: AYER } } },
  "ventas-aprueba": { rol: "ventas", permisosExtra: {
    ver_participantes: { modo: "otorgar", vence: null },
    aprobar_pagos: { modo: "otorgar", vence: null },
  } },
  "ventas-usuarios": { rol: "ventas", permisosExtra: { gestionar_usuarios: { modo: "otorgar", vence: null } } },
  "ventas-fondos": { rol: "ventas", permisosExtra: { ver_fondos: { modo: "otorgar", vence: null } } },
  "finanzas-sin-fondos": { rol: "finanzas", permisosExtra: { ver_fondos: { modo: "quitar" } } },
  "miembro-bitacora": { rol: "miembro", permisosExtra: { ver_bitacora: { modo: "otorgar", vence: null } } },
  "secretario-sin-secretaria": { rol: "secretario", permisosExtra: { gestionar_secretaria: { modo: "quitar" } } },
  "sinrol-con-ajuste": { rol: "sin_rol", permisosExtra: { ver_participantes: { modo: "otorgar", vence: null } } },
  "objetivo": { rol: "miembro" },
  "miembro-1": { rol: "miembro" },
  "staff-1": { rol: "staff_contecs" },
  "staff-sin-editar": { rol: "staff_contecs", permisosExtra: { evento_editar: { modo: "quitar" } } },
  "staff-sin-salones": { rol: "staff_contecs", permisosExtra: { evento_salones: { modo: "quitar" } } },
  "ventas-solo-qr": { rol: "ventas", permisosExtra: { lectura_qr: { modo: "otorgar", vence: null } } },
  "ventas-sin-categorias": { rol: "ventas", permisosExtra: { catalogo_categorias: { modo: "quitar" } } },
  "miembro-evento": { rol: "miembro", permisosExtra: { gestionar_inscripciones: { modo: "otorgar", vence: null } } },
};

async function preparar() {
  const batch = db.batch();
  Object.entries(USUARIOS).forEach(([uid, data]) =>
    batch.set(db.collection("usuarios").doc(uid), { nombre: uid, email: `${uid}@example.com`, ...data }));
  batch.set(db.collection("participantes").doc("p-1"), { nombreCompleto: "Prueba", pago: { estado: "comprobante_enviado" } });
  batch.set(db.collection("participantes").doc("p-borrable"), { nombreCompleto: "Borrable", pago: { estado: "pendiente_efectivo" } });
  batch.set(db.collection("fondos").doc("f-1"), { balance: 0 });
  batch.set(db.collection("compras").doc("c-1"), { total: 1 });
  await batch.commit();
}

await preparar();

console.log("\nParticipantes:\n");

await prueba("ventas no lee participantes; con el permiso otorgado sí", async () => {
  await noPuede("ventas-1", "GET", "participantes/p-1");
  await puede("ventas-ve", "GET", "participantes/p-1");
});

await prueba("otorgado con vencimiento: vale antes, no después", async () => {
  await puede("ventas-ve-hasta-manana", "GET", "participantes/p-1");
  await noPuede("ventas-ve-vencido", "GET", "participantes/p-1");
});

await prueba("a junta se le puede quitar ver participantes", async () => {
  await noPuede("junta-sin-ver", "GET", "participantes/p-1");
});

await prueba("sin_rol desactiva aunque conserve ajustes", async () => {
  await noPuede("sinrol-con-ajuste", "GET", "participantes/p-1");
});

await prueba("aprobar pagos: solo si se otorga, no por ver", async () => {
  const pago = { "pago.estado": "aprobado" };
  await noPuede("ventas-ve", "PATCH", "participantes/p-1", pago);
  await puede("ventas-aprueba", "PATCH", "participantes/p-1", pago);
});

await prueba("eliminar participantes se puede quitar a junta_principal", async () => {
  await noPuede("jp-sin-eliminar", "DELETE", "participantes/p-borrable");
  await puede("jp-1", "DELETE", "participantes/p-borrable");
});

console.log("\nUsuarios:\n");

await prueba("junta_principal cambia el rol de otra persona", async () => {
  await puede("jp-1", "PATCH", "usuarios/objetivo", { rol: "ventas" });
});

await prueba("...pero no el suyo, ni da o quita el rol de CEO", async () => {
  await noPuede("jp-1", "PATCH", "usuarios/jp-1", { rol: "ceo" });
  await noPuede("jp-1", "PATCH", "usuarios/objetivo", { rol: "ceo" });
  await noPuede("jp-1", "PATCH", "usuarios/ceo-1", { rol: "miembro" });
  await noPuede("jp-1", "PATCH", "usuarios/objetivo", { rol: "inventado" });
});

await prueba("solo el CEO toca permisos individuales", async () => {
  const extra = { permisosExtra: { ver_fondos: { modo: "otorgar", vence: null } } };
  await noPuede("jp-1", "PATCH", "usuarios/objetivo", extra);
  await noPuede("objetivo", "PATCH", "usuarios/objetivo", extra);
  await puede("ceo-1", "PATCH", "usuarios/objetivo", extra);
});

await prueba("gestionar usuarios: se otorga a ventas y se quita a junta_principal", async () => {
  await puede("ventas-usuarios", "PATCH", "usuarios/objetivo", { rol: "miembro" });
  await noPuede("jp-sin-usuarios", "PATCH", "usuarios/objetivo", { rol: "ventas" });
});

console.log("\nFinanzas y Secretaría:\n");

await prueba("fondos: se otorga a ventas y se quita a finanzas", async () => {
  await noPuede("ventas-1", "GET", "fondos/f-1");
  await puede("ventas-fondos", "GET", "fondos/f-1");
  await noPuede("finanzas-sin-fondos", "GET", "fondos/f-1");
});

await prueba("bitácora otorgada a un miembro abre la lectura de compras", async () => {
  await noPuede("miembro-1", "GET", "compras/c-1");
  await puede("miembro-bitacora", "GET", "compras/c-1");
});

await prueba("secretaría se le puede quitar al secretario", async () => {
  const reunion = { titulo: "Prueba" };
  await noPuede("secretario-sin-secretaria", "PATCH", "reuniones/r-1", reunion);
  await puede("ceo-1", "PATCH", "reuniones/r-1", reunion);
});

console.log("\nSub-permisos (pestañas y acciones):\n");

await prueba("sin evento_editar, staff ya no escribe eventos ni checkpoints", async () => {
  await puede("staff-1", "PATCH", "eventos/e-1", { nombre: "Evento" });
  await noPuede("staff-sin-editar", "PATCH", "eventos/e-1", { nombre: "Otro" });
  await noPuede("staff-sin-editar", "PATCH", "checkpoints/c-1", { nombre: "Taller" });
});

await prueba("quitar Salones bloquea salones pero no eventos", async () => {
  const salon = { espacioId: "3-101", piso: 3, nombre: "Aula", rotulo: "101", capacidad: 30 };
  await puede("staff-1", "PATCH", "salones/3-101", salon);
  await noPuede("staff-sin-salones", "PATCH", "salones/3-101", salon);
  await puede("staff-sin-salones", "PATCH", "eventos/e-1", { nombre: "Evento 2" });
});

await prueba("otorgar el módulo trae sus sub-permisos", async () => {
  await puede("miembro-evento", "PATCH", "eventos/e-1", { nombre: "Evento 3" });
});

await prueba("Lectura QR suelta abre la lectura de participantes", async () => {
  await noPuede("ventas-1", "GET", "participantes/p-1");
  await puede("ventas-solo-qr", "GET", "participantes/p-1");
  await noPuede("ventas-solo-qr", "PATCH", "eventos/e-1", { nombre: "No" });
});

await prueba("quitar Categorías del catálogo", async () => {
  await puede("ventas-1", "PATCH", "categorias/cat-1", { nombre: "Bebidas" });
  await noPuede("ventas-sin-categorias", "PATCH", "categorias/cat-1", { nombre: "Otra" });
});

console.log(`\n${pasadas} pruebas de reglas pasaron.\n`);
process.exit(0);
