"use strict";

const assert = require("node:assert/strict");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

initializeApp({projectId: "contecs-fa6e6"});
const db = getFirestore();
const {ejecutarOperacionQr} = require("../operaciones-qr");

const request = (data) => ({auth: {uid: "staff-prueba"}, data});
const requestPosper = (data) => ({auth: {uid: "posper-prueba"}, data});
const requestCeo = (data) => ({auth: {uid: "ceo-prueba"}, data});
const participante = (nombre, pago = "aprobado") => ({
  nombreCompleto: nombre,
  correo: `${nombre.toLowerCase().replace(/\s+/g, ".")}@example.com`,
  cedula: `TEST-${nombre}`,
  codigo: `QR-${nombre}`,
  pago: {estado: pago},
  asistencias: {},
  totalAsistencias: 0,
});

async function rechazaCon(promesa, codigo) {
  await assert.rejects(promesa, (error) => {
    assert.equal(error.code, codigo);
    return true;
  });
}

async function prepararDatos() {
  const batch = db.batch();
  batch.set(db.collection("usuarios").doc("staff-prueba"), {
    rol: "staff_contecs",
  });
  batch.set(db.collection("usuarios").doc("posper-prueba"), {
    rol: "posper",
  });
  batch.set(db.collection("usuarios").doc("ceo-prueba"), {
    rol: "ceo",
  });
  batch.set(db.collection("checkpoints").doc("cancelado-prueba"), {
    eventoId: "evento-prueba",
    nombre: "Conferencia cancelada",
    tipo: "conferencia",
    estado: "cancelado",
  });
  batch.set(db.collection("checkpoints").doc("inactivo-prueba"), {
    eventoId: "evento-prueba",
    nombre: "Conferencia desactivada",
    tipo: "conferencia",
    activo: false,
  });
  batch.set(db.collection("eventos").doc("evento-prueba"), {
    nombre: "Congreso de prueba",
    activo: true,
  });
  batch.set(db.collection("eventos").doc("evento-ajeno"), {
    nombre: "Otro evento",
    activo: true,
  });
  batch.set(db.collection("checkpoints").doc("acceso-prueba"), {
    eventoId: "evento-prueba",
    eventoNombre: "Congreso de prueba",
    nombre: "Entrada general",
    tipo: "congreso",
  });
  batch.set(db.collection("checkpoints").doc("taller-prueba"), {
    eventoId: "evento-prueba",
    eventoNombre: "Congreso de prueba",
    nombre: "Workshop de prueba",
    tipo: "workshop",
    cupos: 2,
    cuposDisponibles: 2,
  });
  batch.set(db.collection("checkpoints").doc("ultimo-cupo"), {
    eventoId: "evento-prueba",
    eventoNombre: "Congreso de prueba",
    nombre: "Último cupo",
    tipo: "taller",
    cupos: 1,
    cuposDisponibles: 1,
  });
  batch.set(db.collection("participantes").doc("participante-uno"),
      participante("Participante Uno"));
  batch.set(db.collection("participantes").doc("pago-pendiente"),
      participante("Pago Pendiente", "comprobante_enviado"));
  batch.set(db.collection("participantes").doc("concurrente-uno"),
      participante("Concurrente Uno"));
  batch.set(db.collection("participantes").doc("concurrente-dos"),
      participante("Concurrente Dos"));
  batch.set(db.collection("inscripciones").doc("legacy-uno"), {
    nombre: "Participante Legacy",
    eventoId: "evento-prueba",
    asistencias: {},
    totalAsistencias: 0,
  });
  await batch.commit();
}

async function probarEntradaGeneral() {
  const datos = {
    tipo: "asistencia_participante",
    participanteId: "participante-uno",
    checkpointId: "acceso-prueba",
    eventoId: "evento-prueba",
    coleccion: "participantes",
  };
  const resultado = await ejecutarOperacionQr(request(datos));
  assert.equal(resultado.ok, true);
  assert.equal(resultado.totalAsistencias, 1);

  const [pSnap, asistenciaSnap] = await Promise.all([
    db.collection("participantes").doc("participante-uno").get(),
    db.collection("asistencias_congreso")
        .doc("acceso-prueba_participantes_participante-uno").get(),
  ]);
  assert.ok(pSnap.data().asistencias["acceso-prueba"]);
  assert.equal(asistenciaSnap.data().eventoId, "evento-prueba");
  assert.equal(asistenciaSnap.data().checkpointTipo, "congreso");

  await rechazaCon(ejecutarOperacionQr(request(datos)), "already-exists");
  await rechazaCon(ejecutarOperacionQr(request({
    ...datos,
    participanteId: "pago-pendiente",
  })), "failed-precondition");
  await rechazaCon(ejecutarOperacionQr(request({
    ...datos,
    eventoId: "evento-ajeno",
  })), "failed-precondition");
  // Cancelado o desactivado desde Gestión de Eventos: no se marca nada.
  await rechazaCon(ejecutarOperacionQr(request({
    ...datos,
    participanteId: "concurrente-dos",
    checkpointId: "cancelado-prueba",
  })), "failed-precondition");
  await rechazaCon(ejecutarOperacionQr(request({
    ...datos,
    participanteId: "concurrente-dos",
    checkpointId: "inactivo-prueba",
  })), "failed-precondition");
  // El patrocinador también marca entradas desde POSPER.
  const desdePosper = await ejecutarOperacionQr(requestPosper({
    ...datos,
    participanteId: "concurrente-dos",
  }));
  assert.equal(desdePosper.ok, true);
}

async function probarTallerConAsistencia() {
  const datos = {
    tipo: "inscripcion_taller",
    participanteId: "legacy-uno",
    checkpointId: "taller-prueba",
    eventoId: "evento-prueba",
    coleccion: "inscripciones",
  };
  const resultado = await ejecutarOperacionQr(request(datos));
  assert.equal(resultado.cuposDisponibles, 1);
  assert.equal(resultado.totalAsistencias, 1);

  const [cpSnap, pSnap, inscripcionSnap, asistenciaSnap] = await Promise.all([
    db.collection("checkpoints").doc("taller-prueba").get(),
    db.collection("inscripciones").doc("legacy-uno").get(),
    db.collection("inscripciones_checkpoint")
        .doc("taller-prueba_inscripciones_legacy-uno").get(),
    db.collection("asistencias_congreso")
        .doc("taller-prueba_inscripciones_legacy-uno").get(),
  ]);
  assert.equal(cpSnap.data().cuposDisponibles, 1);
  assert.ok(pSnap.data().asistencias["taller-prueba"]);
  assert.equal(inscripcionSnap.data().participanteColeccion, "inscripciones");
  assert.equal(asistenciaSnap.data().checkpointTipo, "workshop");

  await rechazaCon(ejecutarOperacionQr(request(datos)), "already-exists");
}

async function probarUltimoCupoConcurrente() {
  const base = {
    tipo: "inscripcion_taller",
    checkpointId: "ultimo-cupo",
    eventoId: "evento-prueba",
    coleccion: "participantes",
  };
  const resultados = await Promise.allSettled([
    ejecutarOperacionQr(request({...base, participanteId: "concurrente-uno"})),
    ejecutarOperacionQr(request({...base, participanteId: "concurrente-dos"})),
  ]);
  assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(resultados.filter((r) => r.status === "rejected").length, 1);
  assert.equal(resultados.find((r) => r.status === "rejected").reason.code,
      "resource-exhausted");
  const cpSnap = await db.collection("checkpoints").doc("ultimo-cupo").get();
  assert.equal(cpSnap.data().cuposDisponibles, 0);
}

// POSPER: el RFID queda en el participante, el mismo RFID no puede quedar en
// dos personas y quien ya tiene un RFID no recibe otro.
async function probarAnclarRfid() {
  const base = {tipo: "anclar_rfid", eventoId: "evento-prueba"};
  const rfidA = "e2:80:11:60:60:00:02:0a:3b:4c:3f:1a";
  const rfidB = "E2801160600002FFFFFF9999";

  // Staff marca asistencia, pero el RFID solo se ancla desde POSPER.
  await rechazaCon(ejecutarOperacionQr(request({
    ...base, participanteId: "participante-uno", rfid: rfidA,
  })), "permission-denied");

  const r1 = await ejecutarOperacionQr(requestPosper({
    ...base, participanteId: "participante-uno", rfid: rfidA,
  }));
  assert.equal(r1.serial, "E280...3F1A");
  assert.equal(r1.yaAnclado, false);
  const p1 = await db.collection("participantes").doc("participante-uno").get();
  assert.equal(p1.data().rfid.serial, "E280...3F1A");
  assert.equal(p1.data().rfid.eventoId, "evento-prueba");

  await rechazaCon(ejecutarOperacionQr(requestPosper({
    ...base, participanteId: "concurrente-uno", rfid: "E28011606000020A3B4C3F1A",
  })), "already-exists");
  await rechazaCon(ejecutarOperacionQr(requestPosper({
    ...base, participanteId: "pago-pendiente", rfid: rfidB,
  })), "failed-precondition");
  await rechazaCon(ejecutarOperacionQr(requestPosper({
    ...base, participanteId: "participante-uno", rfid: "https://x.test/?c=A&t=B",
  })), "invalid-argument");

  // Un segundo RFID para la misma persona se rechaza y el primero se conserva.
  await rechazaCon(ejecutarOperacionQr(requestPosper({
    ...base, participanteId: "participante-uno", rfid: rfidB,
  })), "already-exists");
  const p2 = await db.collection("participantes").doc("participante-uno").get();
  assert.equal(p2.data().rfid.lockId, p1.data().rfid.lockId);

  // Volver a leer su mismo RFID no es error.
  const repetido = await ejecutarOperacionQr(requestPosper({
    ...base, participanteId: "participante-uno", rfid: rfidA,
  }));
  assert.equal(repetido.yaAnclado, true);

  // El RFID que nadie usó queda libre para otra persona.
  const r3 = await ejecutarOperacionQr(requestPosper({
    ...base, participanteId: "concurrente-uno", rfid: rfidB,
  }));
  assert.equal(r3.serial, "E280...9999");
}

// RFID asignado por error: solo el CEO lo libera; después el RFID puede ir a
// otra persona y el participante puede recibir uno nuevo.
async function probarLiberarRfid() {
  const base = {tipo: "anclar_rfid", eventoId: "evento-prueba"};
  const liberar = {tipo: "liberar_rfid", participanteId: "participante-uno"};
  const rfidA = "E28011606000020A3B4C3F1A";

  await rechazaCon(ejecutarOperacionQr(requestPosper(liberar)), "permission-denied");
  await rechazaCon(ejecutarOperacionQr(request(liberar)), "permission-denied");

  const r = await ejecutarOperacionQr(requestCeo(liberar));
  assert.equal(r.serial, "E280...3F1A");
  const p = await db.collection("participantes").doc("participante-uno").get();
  assert.equal(p.data().rfid, undefined);
  assert.equal(p.data().rfidLiberado.serial, "E280...3F1A");

  await rechazaCon(ejecutarOperacionQr(requestCeo(liberar)), "failed-precondition");

  // El RFID liberado ya lo puede recibir otra persona...
  const otro = await ejecutarOperacionQr(requestPosper({
    ...base, participanteId: "concurrente-dos", rfid: rfidA,
  }));
  assert.equal(otro.yaAnclado, false);
  // ...y quien lo tenía puede recibir uno nuevo.
  const nuevo = await ejecutarOperacionQr(requestPosper({
    ...base, participanteId: "participante-uno", rfid: "ABCD1234EF",
  }));
  assert.equal(nuevo.yaAnclado, false);
}

// Mapa del evento: Staff libera el asiento de quien salió antes; la entrada
// se conserva con su hora de salida.
async function probarLiberarAsiento() {
  const datos = {
    tipo: "liberar_asiento",
    participanteId: "participante-uno",
    checkpointId: "acceso-prueba",
    coleccion: "participantes",
  };
  await rechazaCon(ejecutarOperacionQr(requestPosper(datos)), "permission-denied");
  const r = await ejecutarOperacionQr(request(datos));
  assert.equal(r.ok, true);
  const snap = await db.collection("asistencias_congreso")
      .doc("acceso-prueba_participantes_participante-uno").get();
  assert.ok(snap.data().salidaEn);
  assert.ok(snap.data().marcadoEn);
  await rechazaCon(ejecutarOperacionQr(request(datos)), "already-exists");
  await rechazaCon(ejecutarOperacionQr(request({
    ...datos, participanteId: "pago-pendiente",
  })), "not-found");
}

async function main() {
  await prepararDatos();
  await probarEntradaGeneral();
  await probarTallerConAsistencia();
  await probarUltimoCupoConcurrente();
  await probarAnclarRfid();
  await probarLiberarRfid();
  await probarLiberarAsiento();
  console.log("Integración QR: comprobaciones críticas superadas.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
