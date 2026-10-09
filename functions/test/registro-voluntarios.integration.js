"use strict";

// registrarVoluntario contra el emulador: normalización, cédula y correo únicos
// (con candado y contra voluntarios importados antes) y validaciones.
//   npm run test:voluntarios   (desde functions/)

const assert = require("node:assert/strict");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

initializeApp({projectId: "contecs-fa6e6"});
const db = getFirestore();
const {registrarVoluntario, normalizarCedula} = require("../registro-voluntarios");

const sinLimite = async () => {};
const registrar = (data) => registrarVoluntario({data}, {aplicarLimite: sinLimite});
const base = {
  nombre: "  MARÍA JOSÉ  ", apellido: "de la CRUZ", cedula: "8 – 888 - 8888", correo: "Maria@Gmail.com",
  telefono: "6000 1234", centro: "Campus Central", facultad: "FISC", carrera: "Ing. de Software",
  anio: "3", horario: "Vespertino", habilidad: "Diseño", aceptaDatos: true,
};

let pasadas = 0;
async function prueba(nombre, fn) {
  await fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}
async function rechazaCon(promesa, codigo, texto) {
  await assert.rejects(promesa, (e) => {
    assert.equal(e.code, codigo, e.message);
    if (texto) assert.match(e.message, texto);
    return true;
  });
}

async function main() {
  await db.collection("voluntarios").doc("importado").set({nombre: "Ya", id: "PE-12-345", correo: "importado@utp.ac.pa", totalHoras: 0});
  console.log("\nregistrarVoluntario:\n");

  await prueba("formatos de cédula y pasaporte", () => {
    assert.equal(normalizarCedula("8 - 888 - 8888").valor, "8-888-8888");
    assert.equal(normalizarCedula("pe-12-345").valor, "PE-12-345");
    assert.equal(normalizarCedula("8-av-12-345").valor, "8-AV-12-345");
    assert.equal(normalizarCedula("e-8-123456").ok, true);
    assert.equal(normalizarCedula("A1234567").tipo, "pasaporte");
    assert.equal(normalizarCedula("PE 12 345").valor, "PE-12-345");
    assert.equal(normalizarCedula("hola").ok, false);
    assert.equal(normalizarCedula("8-888").ok, false);
  });

  await prueba("registra con los datos normalizados, como voluntario", async () => {
    await registrar(base);
    const snap = await db.collection("voluntarios").where("id", "==", "8-888-8888").get();
    assert.equal(snap.size, 1);
    const v = snap.docs[0].data();
    assert.equal(v.nombre, "María José");
    assert.equal(v.apellido, "De la Cruz");
    assert.equal(v.correo, "maria@gmail.com");
    assert.equal(v.telefono, "6000-1234");
    assert.equal(v.grupo, "voluntario");
    assert.equal(v.totalHoras, 0);
    assert.equal(v.horario, "Vespertino");
    assert.equal((await db.doc("identificadores_voluntarios/8-888-8888").get()).exists, true);
  });

  await prueba("la misma cédula escrita distinto no se registra dos veces", async () => {
    await rechazaCon(registrar({...base, cedula: "8-888-8888", correo: "otro@gmail.com"}), "already-exists");
  });

  await prueba("tampoco si ya estaba importado (sin candado)", async () => {
    await rechazaCon(registrar({...base, cedula: "pe 12 345"}), "already-exists");
  });

  await prueba("el mismo correo (aunque cambien mayúsculas) no se registra dos veces", async () => {
    await rechazaCon(registrar({...base, cedula: "3-111-222", correo: "  MARIA@gmail.COM "}), "already-exists", /correo/);
    assert.equal((await db.collection("voluntarios").where("id", "==", "3-111-222").get()).size, 0);
  });

  await prueba("tampoco si el correo ya estaba importado (sin candado)", async () => {
    await rechazaCon(registrar({...base, cedula: "3-111-223", correo: "importado@utp.ac.pa"}), "already-exists", /correo/);
  });

  await prueba("valida horario, año, correo, teléfono, cédula y consentimiento", async () => {
    const otro = {...base, cedula: "4-123-456"};
    await rechazaCon(registrar({...otro, horario: "Sábados"}), "invalid-argument", /horario/);
    await rechazaCon(registrar({...otro, anio: "9"}), "invalid-argument", /año/);
    await rechazaCon(registrar({...otro, correo: "x@"}), "invalid-argument", /correo/);
    await rechazaCon(registrar({...otro, telefono: "12"}), "invalid-argument", /teléfono/);
    await rechazaCon(registrar({...otro, cedula: "abc"}), "invalid-argument", /cédula/);
    await rechazaCon(registrar({...otro, aceptaDatos: false}), "invalid-argument", /datos/);
    await rechazaCon(registrar({...otro, nombre: "<script>"}), "invalid-argument");
    assert.equal((await db.collection("voluntarios").where("id", "==", "4-123-456").get()).size, 0);
  });

  console.log(`\n${pasadas} pruebas pasaron.\n`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
