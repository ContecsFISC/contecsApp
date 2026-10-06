"use strict";

// Lectura del "RFID" que POSPER y Lectura QR anclan a un participante. Lo
// delicado es que dos lecturas del mismo RFID (con o sin separadores, en
// minúsculas o mayúsculas) terminen en el MISMO lock, y que una credencial
// escaneada por error no se ancle como RFID. Fuera de eso, cualquier lectura
// sirve (QR, código de barras, texto).
//   node functions/test/rfid.test.js

const assert = require("node:assert/strict");
const {normalizarRfid, serialRfid, idLockRfid} = require("../rfid");

let pasadas = 0;
function prueba(nombre, fn) {
  fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}

console.log("\nnormalizarRfid:\n");

prueba("hex largo se pasa a mayúsculas", () => {
  const r = normalizarRfid("  e28011606000020a3b4c3f1a \n");
  assert.equal(r.ok, true);
  assert.equal(r.completo, "E28011606000020A3B4C3F1A");
});

prueba("espacios, : y - se quitan", () => {
  assert.equal(normalizarRfid("E2 80:11-60 60 00 3F 1A").completo, "E280116060003F1A");
});

prueba("cualquier lectura sirve: código de barras, texto, URL ajena", () => {
  assert.equal(normalizarRfid("7501031311309").completo, "7501031311309");
  assert.equal(normalizarRfid("Rfid#0042/b").completo, "Rfid#0042/b");
  assert.equal(normalizarRfid("https://tags.example.com/t/9F3A21").ok, true);
});

prueba("la credencial del participante NO es un RFID", () => {
  const url = normalizarRfid("https://contecs.app/public/perfil.html?c=CT-001&t=abc");
  assert.equal(url.ok, false);
  assert.match(url.motivo, /credencial/);
  assert.equal(normalizarRfid("]Q1https://x.app/perfil.html?C=CT-1&t=ab").ok, false);
  assert.equal(normalizarRfid("{\"codigo\":\"CT-1\",\"token\":\"x\"}").ok, false);
});

prueba("vacío o demasiado corto se rechaza", () => {
  assert.equal(normalizarRfid("").ok, false);
  assert.equal(normalizarRfid(null).ok, false);
  assert.equal(normalizarRfid("A1 ").ok, false);
});

prueba("demasiado largo se rechaza", () => {
  assert.equal(normalizarRfid("A".repeat(513)).ok, false);
});

console.log("\nserialRfid / idLockRfid:\n");

prueba("serial = 4 primeros ... 4 últimos", () => {
  assert.equal(serialRfid("E28011606000020A3B4C3F1A"), "E280...3F1A");
});

prueba("lectura corta: el serial es la lectura completa", () => {
  assert.equal(serialRfid("12345678"), "12345678");
  assert.equal(serialRfid("ABC12"), "ABC12");
});

prueba("la misma lectura escrita distinto da el mismo lock", () => {
  const a = normalizarRfid("e2:80:11:60:60:00:3f:1a").completo;
  const b = normalizarRfid("E28011606000 3F1A").completo;
  assert.equal(idLockRfid(a), idLockRfid(b));
  assert.match(idLockRfid(a), /^[0-9a-f]{64}$/);
});

prueba("RFID distintos con el mismo serial NO comparten lock", () => {
  const a = "E2800000000000003F1A";
  const b = "E2801111111111113F1A";
  assert.equal(serialRfid(a), serialRfid(b));
  assert.notEqual(idLockRfid(a), idLockRfid(b));
});

console.log(`\n${pasadas} pruebas pasadas.\n`);
