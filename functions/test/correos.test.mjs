// Prueba del parseo de "correos de personas no inscritas" del panel de Giras.
// Es la entrada más frágil de esa pantalla: la escribe una persona a mano,
// pegando de un chat o de una hoja, y de ahí salen correos reales.
//
// Importa el código REAL (js/core/correos.js), no una copia — una copia habría
// seguido pasando estas pruebas después de romper el parser de verdad.
//
//   node functions/test/correos.test.mjs

import assert from "node:assert/strict";
import {
  RE_CORREO,
  esCorreoValido,
  parsearEntradaCorreo,
  parsearListaCorreos,
} from "../../js/core/correos.js";
import identidad from "../identidad.js";

let pasadas = 0;
function prueba(nombre, fn) {
  fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}

console.log("\ncorreos:\n");

prueba("navegador y servidor usan la MISMA expresión", () => {
  // Si se desincronizan, el panel acepta direcciones que el servidor rechaza
  // (o al revés) y el fallo aparece recién al enviar.
  assert.equal(String(RE_CORREO), String(identidad.RE_CORREO));
  assert.equal(esCorreoValido("ana@gmail.com"), identidad.esCorreoValido("ana@gmail.com"));
  assert.equal(esCorreoValido("mailto:a@b.com"), identidad.esCorreoValido("mailto:a@b.com"));
});

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

prueba("rechaza pegados que antes pasaban y rebotaban en el proveedor", () => {
  // Los cuatro venían de casos reales: copiar de un enlace, copiar de una
  // frase, y líneas partidas por el corchete.
  assert.equal(parsearEntradaCorreo("mailto:ana@gmail.com"), null);
  assert.equal(parsearEntradaCorreo("ana@gmail.com."), null);
  assert.equal(parsearEntradaCorreo("<ana@gmail.com"), null);
  assert.equal(parsearEntradaCorreo("ana@gmail.com>"), null);
});

prueba("no se traga la primera de dos direcciones en la misma línea", () => {
  // Antes devolvía {correo:"b@c.com", nombre:"Ana <ana@gmail.com>"} y la
  // primera persona se perdía sin ningún aviso.
  assert.equal(parsearEntradaCorreo("Ana <ana@gmail.com> <b@c.com>"), null);
});

prueba("rechaza texto sin arroba, dominio sin punto y espacios internos", () => {
  assert.equal(parsearEntradaCorreo("no soy un correo"), null);
  assert.equal(parsearEntradaCorreo("ana@localhost"), null);
  assert.equal(parsearEntradaCorreo("an a@gmail.com"), null);
});

prueba("rechaza vacío, nulo y correos absurdamente largos", () => {
  assert.equal(parsearEntradaCorreo(""), null);
  assert.equal(parsearEntradaCorreo("   "), null);
  assert.equal(parsearEntradaCorreo(null), null);
  assert.equal(parsearEntradaCorreo("a".repeat(250) + "@gmail.com"), null);
});

prueba("acepta direcciones institucionales y con +", () => {
  assert.ok(esCorreoValido("ana.perez@utp.ac.pa"));
  assert.ok(esCorreoValido("a+b@x.co"));
});

prueba("separa una lista pegada de un chat", () => {
  const texto = "ana@gmail.com, Luis <luis@gmail.com>\npedro@utp.ac.pa; basura\n\n";
  const {validos, invalidos, repetidos} = parsearListaCorreos(texto);
  assert.deepEqual(validos.map((v) => v.correo),
      ["ana@gmail.com", "luis@gmail.com", "pedro@utp.ac.pa"]);
  assert.deepEqual(invalidos, ["basura"]);
  assert.equal(repetidos, 0);
});

prueba("cuenta repetidos contra los que ya estaban", () => {
  const {validos, repetidos} = parsearListaCorreos(
      "ana@gmail.com, nueva@gmail.com", ["ana@gmail.com"]);
  assert.deepEqual(validos.map((v) => v.correo), ["nueva@gmail.com"]);
  assert.equal(repetidos, 1);
});

prueba("no repite dentro del mismo pegado", () => {
  const {validos, repetidos} = parsearListaCorreos("a@x.com, A@X.com, b@x.com");
  assert.deepEqual(validos.map((v) => v.correo), ["a@x.com", "b@x.com"]);
  assert.equal(repetidos, 1);
});

console.log(`\n${pasadas} pruebas OK\n`);
