"use strict";

// Prueba del parseo de "correos de personas no inscritas" del panel de Giras
// (js/modulos/voluntarios.js). Es la entrada más frágil de esa pantalla: la
// escribe una persona a mano, pegando de un chat o una hoja de cálculo, y de
// ahí salen correos reales.
//
//   node functions/test/correos-nosel.test.js

const assert = require("node:assert/strict");

// Copia de parsearEntradaCorreo en js/modulos/voluntarios.js. Se replica porque
// ese archivo es un módulo de navegador que importa Firebase por URL y no se
// puede cargar en Node. Si cambias una, cambia la otra.
const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function parsearEntradaCorreo(texto) {
  const bruto = String(texto || "").trim();
  if (!bruto) return null;
  const conNombre = bruto.match(/^(.*?)<([^>]+)>$/);
  const nombre = conNombre ? conNombre[1].trim().replace(/^["']|["']$/g, "") : "";
  const correo = (conNombre ? conNombre[2] : bruto).trim().toLowerCase();
  if (!RE_CORREO.test(correo) || correo.length > 254) return null;
  return {correo, nombre};
}

let pasadas = 0;
function prueba(nombre, fn) {
  fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}

console.log("\nparsearEntradaCorreo:\n");

prueba("correo simple", () => {
  assert.deepEqual(parsearEntradaCorreo("ana@gmail.com"),
      {correo: "ana@gmail.com", nombre: ""});
});

prueba("normaliza mayúsculas y espacios", () => {
  assert.deepEqual(parsearEntradaCorreo("  Ana.Perez@UTP.AC.PA  "),
      {correo: "ana.perez@utp.ac.pa", nombre: ""});
});

prueba("formato Nombre <correo>", () => {
  assert.deepEqual(parsearEntradaCorreo("Luis Gómez <luis@gmail.com>"),
      {correo: "luis@gmail.com", nombre: "Luis Gómez"});
});

prueba("quita comillas alrededor del nombre", () => {
  const conComillas = "\"Luis Gómez\" <luis@gmail.com>";
  assert.deepEqual(parsearEntradaCorreo(conComillas),
      {correo: "luis@gmail.com", nombre: "Luis Gómez"});
});

prueba("rechaza texto sin arroba", () => {
  assert.equal(parsearEntradaCorreo("no soy un correo"), null);
});

prueba("rechaza dominio sin punto", () => {
  assert.equal(parsearEntradaCorreo("ana@localhost"), null);
});

prueba("rechaza espacios internos", () => {
  assert.equal(parsearEntradaCorreo("an a@gmail.com"), null);
});

prueba("rechaza vacío y solo espacios", () => {
  assert.equal(parsearEntradaCorreo(""), null);
  assert.equal(parsearEntradaCorreo("   "), null);
  assert.equal(parsearEntradaCorreo(null), null);
});

prueba("rechaza correos absurdamente largos", () => {
  assert.equal(parsearEntradaCorreo("a".repeat(250) + "@gmail.com"), null);
});

prueba("separa una lista pegada de un chat", () => {
  const texto = "ana@gmail.com, Luis <luis@gmail.com>\npedro@utp.ac.pa; basura\n\n";
  const partes = texto.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
  const validos = partes.map(parsearEntradaCorreo).filter(Boolean);
  const invalidos = partes.filter((t) => !parsearEntradaCorreo(t));
  assert.equal(validos.length, 3);
  assert.deepEqual(validos.map((v) => v.correo),
      ["ana@gmail.com", "luis@gmail.com", "pedro@utp.ac.pa"]);
  assert.deepEqual(invalidos, ["basura"]);
});

console.log(`\n${pasadas} pruebas OK\n`);
