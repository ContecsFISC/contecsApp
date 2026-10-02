"use strict";

// importarParticipantes contra el emulador de Firestore: permisos, secuencia
// de códigos, documento resultante, locks de identidad y filas omitidas.
//   npm run test:importar   (desde functions/)

const assert = require("node:assert/strict");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

initializeApp({projectId: "contecs-fa6e6"});
const db = getFirestore();
const {importarParticipantes} = require("../importaciones");
const {idBloqueoParticipante} = require("../identidad");

const request = (uid, data) => ({auth: uid ? {uid} : null, data});
const lote = (filas, extra = {}) => ({
  categoria: "estudiante_utp",
  referencia: "Prof. Rivera — Redes I",
  loteId: "imp_prueba",
  camposComunes: {facultad: "FISC", carrera: "Lic. en Redes"},
  filas,
  ...extra,
});

async function rechazaCon(promesa, codigo) {
  await assert.rejects(promesa, (error) => {
    assert.equal(error.code, codigo);
    return true;
  });
}

async function lockExiste(tipo, valor) {
  const snap = await db.collection("identificadores_participantes")
      .doc(idBloqueoParticipante(tipo, valor)).get();
  return snap.exists ? snap.data().participanteId : null;
}

async function main() {
  await Promise.all([
    db.collection("usuarios").doc("ceo-prueba").set({rol: "ceo"}),
    db.collection("usuarios").doc("staff-prueba").set({rol: "staff_contecs"}),
    db.doc("contadores/inscripciones2026").set({valor: 59}),
    db.collection("participantes").doc("c_8_000_0001").set({
      codigo: "CTCS-2026-00001", cedula: "8-000-0001", correo: "ya@utp.ac.pa",
    }),
  ]);

  // ── Permisos ──────────────────────────────────────────────────────────────
  await rechazaCon(importarParticipantes(request(null, lote([{nombre: "A", cedula: "1"}]))), "unauthenticated");
  await rechazaCon(importarParticipantes(request("staff-prueba", lote([{nombre: "A", cedula: "1"}]))), "permission-denied");
  await rechazaCon(importarParticipantes(request("ceo-prueba", lote([{nombre: "A", cedula: "1"}], {categoria: "colegio"}))), "invalid-argument");
  console.log("  ok  solo CEO y Junta A importan; colegio no es importable");

  // ── Lote mixto ────────────────────────────────────────────────────────────
  const filas = [
    {fila: 2, nombre: "Ana", apellido: "Pérez", cedula: "8-111-1111", correo: "Ana@gmail.com", telefono: "6000-0001",
      camposExtra: {"correo-inst": "ana.perez@utp.ac.pa", "carrera": "Lic. en Ciberseguridad"}},
    {fila: 3, nombre: "Beto", apellido: "Ruiz", cedula: "8-222-2222"}, // sin correo
    {fila: 4, nombre: "Carla", apellido: "Díaz", cedula: "8-333-3333"}, // sin correo: no choca con Beto
    {fila: 5, nombre: "Dani", correo: "dani@gmail.com"}, // sin cédula ni apellido
    {fila: 6, apellido: "Sin Nombre", cedula: "8-444-4444"},
    {fila: 7, nombre: "Ana bis", cedula: "8-111-1111"},
    {fila: 8, nombre: "Ya Inscrito", cedula: "8-000-0001"},
    {fila: 9, nombre: "Correo malo", cedula: "8-555-5555", correo: "malo@"},
  ];
  const r = await importarParticipantes(request("ceo-prueba", lote(filas)));

  assert.deepEqual(r.creados.map((c) => [c.fila, c.codigo]), [
    [2, "CTCS-2026-00060"], [3, "CTCS-2026-00061"], [4, "CTCS-2026-00062"], [5, "CTCS-2026-00063"],
  ]);
  assert.deepEqual(r.omitidos.map((o) => o.fila), [6, 7, 8, 9]);
  assert.equal(r.omitidos[0].motivo, "Falta el nombre.");
  assert.equal(r.omitidos[1].motivo, "Repite la cédula de la fila 2.");
  assert.match(r.omitidos[2].motivo, /Ya está inscrito con la cédula 8-000-0001 \(CTCS-2026-00001\)/);
  assert.match(r.omitidos[3].motivo, /malo@ no es válido/);
  console.log("  ok  crea las filas válidas en orden y explica cada omitida");

  const contador = (await db.doc("contadores/inscripciones2026").get()).data().valor;
  assert.equal(contador, 63);
  console.log("  ok  sigue la misma secuencia del registro (contador 59 → 63)");

  const ana = (await db.collection("participantes").doc("c_8_111_1111").get()).data();
  assert.equal(ana.nombreCompleto, "Ana Pérez");
  assert.equal(ana.correo, "ana@gmail.com");
  assert.equal(ana.categoria, "estudiante_utp");
  assert.equal(ana.categoriaNombre, "Estudiante UTP");
  assert.match(ana.token, /^[0-9a-f]{48}$/);
  assert.deepEqual(
      {metodo: ana.pago.metodo, estado: ana.pago.estado, monto: ana.pago.monto, aprobadoPor: ana.pago.aprobadoPor},
      {metodo: "efectivo", estado: "pendiente_efectivo", monto: 10, aprobadoPor: null},
  );
  assert.deepEqual(ana.camposExtra, {
    "facultad": "FISC", "carrera": "Lic. en Ciberseguridad", "correo-inst": "ana.perez@utp.ac.pa",
  });
  assert.equal(ana.estadoRegistro, "activo");
  assert.deepEqual(ana.asistencias, {});
  assert.equal(ana.importacion.loteId, "imp_prueba");
  assert.equal(ana.importacion.referencia, "Prof. Rivera — Redes I");
  assert.equal(ana.importacion.fila, 2);
  assert.equal(ana.importacion.por, "ceo-prueba");
  assert.ok(ana.fechaRegistro, "lleva fechaRegistro para ordenarse con el resto");
  console.log("  ok  documento igual al de registro.html, pago pendiente y datos del lote");

  const dani = (await db.collection("participantes").doc("e_dani_gmail_com").get()).data();
  assert.equal(dani.nombreCompleto, "Dani");
  assert.equal(dani.cedula, "");

  assert.equal(await lockExiste("cedula", "8-111-1111"), "c_8_111_1111");
  assert.equal(await lockExiste("correo", "ana@gmail.com"), "c_8_111_1111");
  assert.equal(await lockExiste("cedula", "8-222-2222"), "c_8_222_2222");
  assert.equal(await lockExiste("correo", ""), null, "sin correo no se toma el lock vacío");
  assert.equal(await lockExiste("correo", "dani@gmail.com"), "e_dani_gmail_com");
  console.log("  ok  locks de identidad creados; sin correo no se bloquea el correo vacío");

  // ── Reimportar el mismo archivo no duplica nada ───────────────────────────
  const r2 = await importarParticipantes(request("ceo-prueba", lote(filas.slice(0, 4))));
  assert.equal(r2.creados.length, 0);
  assert.ok(r2.omitidos.every((o) => o.motivo.startsWith("Ya está inscrito")));
  assert.equal((await db.doc("contadores/inscripciones2026").get()).data().valor, 63);
  console.log("  ok  reimportar el mismo archivo no duplica ni gasta códigos");

  // ── Lock vivo sin registro previo en /participantes con esa cédula ───────
  // (la consulta previa no lo ve; la transacción sí debe frenarlo)
  await db.collection("identificadores_participantes")
      .doc(idBloqueoParticipante("correo", "carrera@gmail.com"))
      .set({participanteId: "c_8_111_1111"});
  const r3 = await importarParticipantes(request("ceo-prueba", lote([{fila: 2, nombre: "Eva", cedula: "8-999-9999", correo: "carrera@gmail.com"}])));
  assert.equal(r3.creados.length, 0);
  assert.match(r3.omitidos[0].motivo, /correo carrera@gmail.com/);
  console.log("  ok  la transacción frena una identidad tomada que la consulta previa no vio");

  console.log("\nimportarParticipantes: todas las pruebas pasaron.\n");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
