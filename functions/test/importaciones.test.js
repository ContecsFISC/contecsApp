"use strict";

// Reglas por fila de la importación de listas de profesores: qué se exige,
// qué se limpia y cómo se detectan las filas repetidas dentro del lote.
//
// No necesita emulador: normalizarFila y separarRepetidas son puras.
//   node functions/test/importaciones.test.js

const assert = require("node:assert/strict");
const {initializeApp} = require("firebase-admin/app");

// importaciones.js pide getFirestore() al cargarse; no se conecta hasta usarlo.
initializeApp({projectId: "demo-importaciones"});
const {normalizarFila, separarRepetidas} = require("../importaciones");

let pasadas = 0;
function prueba(nombre, fn) {
  fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}

console.log("\nnormalizarFila:\n");

prueba("fila completa: limpia espacios y pasa el correo a minúsculas", () => {
  const {datos, error} = normalizarFila({
    nombre: "  Ana   María ", apellido: "Pérez", cedula: " 8-123-456 ",
    correo: "Ana.Perez@UTP.ac.pa", telefono: "6000-0000",
  });
  assert.equal(error, undefined);
  assert.equal(datos.nombre, "Ana María");
  assert.equal(datos.cedula, "8-123-456");
  assert.equal(datos.correo, "ana.perez@utp.ac.pa");
  assert.deepEqual(datos.camposExtra, {});
});

prueba("sin correo pero con cédula se acepta (las listas llegan incompletas)", () => {
  const {datos, error} = normalizarFila({nombre: "Luis", cedula: "4-55-66"});
  assert.equal(error, undefined);
  assert.equal(datos.correo, "");
  assert.equal(datos.apellido, "");
});

prueba("sin cédula pero con correo se acepta", () => {
  const {error} = normalizarFila({nombre: "Luis", correo: "luis@gmail.com"});
  assert.equal(error, undefined);
});

prueba("sin nombre se rechaza", () => {
  assert.equal(normalizarFila({cedula: "1-2-3"}).error, "Falta el nombre.");
});

prueba("sin cédula ni correo se rechaza", () => {
  assert.match(normalizarFila({nombre: "Ana"}).error, /cédula o el correo/);
});

prueba("correo inválido se rechaza nombrando el correo", () => {
  assert.match(normalizarFila({nombre: "Ana", correo: "ana@"}).error, /ana@ no es válido/);
});

prueba("caracteres < > se rechazan como en registro.html", () => {
  assert.match(normalizarFila({nombre: "<b>Ana</b>", cedula: "1"}).error, /no permitidos/);
});

prueba("campos extra: solo los de registro.html, sin vacíos", () => {
  const {datos} = normalizarFila({
    nombre: "Ana", cedula: "1",
    camposExtra: {"facultad": " FISC ", "carrera": "", "inventado": "x", "correo-inst": "ana@utp.ac.pa"},
  });
  assert.deepEqual(datos.camposExtra, {"facultad": "FISC", "correo-inst": "ana@utp.ac.pa"});
});

console.log("\nseparaRepetidas:\n");

prueba("la segunda aparición de una cédula se omite citando la fila original", () => {
  const {unicas, repetidas} = separarRepetidas([
    {fila: 2, cedula: "8-1-1", correo: ""},
    {fila: 3, cedula: "8-1-1", correo: "otro@gmail.com"},
  ]);
  assert.equal(unicas.length, 1);
  assert.deepEqual(repetidas, [{fila: 3, motivo: "Repite la cédula de la fila 2."}]);
});

prueba("el correo se compara sin importar mayúsculas", () => {
  const {repetidas} = separarRepetidas([
    {fila: 2, cedula: "", correo: "ana@gmail.com"},
    {fila: 5, cedula: "", correo: "ANA@gmail.com"},
  ]);
  assert.deepEqual(repetidas, [{fila: 5, motivo: "Repite el correo de la fila 2."}]);
});

prueba("dos filas sin correo no chocan entre sí", () => {
  const {unicas, repetidas} = separarRepetidas([
    {fila: 2, cedula: "1-1-1", correo: ""},
    {fila: 3, cedula: "2-2-2", correo: ""},
  ]);
  assert.equal(unicas.length, 2);
  assert.equal(repetidas.length, 0);
});

console.log(`\n${pasadas} pruebas pasadas.\n`);
