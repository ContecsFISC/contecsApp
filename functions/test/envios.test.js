"use strict";

// Prueba de las dos piezas que hacen que los correos de gira lleguen de verdad.
//
// El fallo que arreglan no se veía: se mandaban los 40 correos de una gira a la
// vez, Brevo cortaba la mayoría con 429 (límite de velocidad), y como el
// reintento solo miraba los 5xx esos correos se daban por perdidos. Encima el
// motivo de cada fallo se descartaba, así que en el panel solo salía un número.
//
// Se prueban las funciones extraídas de index.js sin arrancar las Cloud
// Functions: index.js requiere firebase-admin y no se puede cargar suelto.
//
//   node functions/test/envios.test.js

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Se extraen del propio index.js para que la prueba no valide una copia que
// pueda quedar desfasada del código que corre en producción.
const FUENTE = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

function extraer(nombre) {
  const patron = new RegExp(
      `(?:async )?function ${nombre}\\s*\\([\\s\\S]*?\\n}\\n`, "m");
  const encontrado = FUENTE.match(patron);
  assert.ok(encontrado, `no se encontró ${nombre}() en index.js`);
  return encontrado[0];
}

const contexto = {console, setTimeout, Math, Array, Promise, String, Error};
vm.createContext(contexto);
vm.runInContext(
    [
      extraer("enLotes"),
      extraer("esErrorPasajeroBrevo"),
      extraer("resumirEnvios"),
    ].join("\n"),
    contexto,
);
const {enLotes, esErrorPasajeroBrevo, resumirEnvios} = contexto;

let pasadas = 0;
async function prueba(nombre, fn) {
  await fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}

const errorConEstado = (statusCode, message = "Brevo") =>
  Object.assign(new Error(message), {statusCode});

async function main() {
  console.log("\nesErrorPasajeroBrevo (a qué se le vuelve a intentar):\n");

  await prueba("429 sí se reintenta — era EL fallo de las giras", () => {
    assert.equal(esErrorPasajeroBrevo(errorConEstado(429)), true);
  });

  await prueba("500 y 503 se reintentan", () => {
    assert.equal(esErrorPasajeroBrevo(errorConEstado(500)), true);
    assert.equal(esErrorPasajeroBrevo(errorConEstado(503)), true);
  });

  await prueba("los cortes de red se reintentan", () => {
    assert.equal(esErrorPasajeroBrevo(new Error("Brevo timeout: sin respuesta en 25s")), true);
    assert.equal(esErrorPasajeroBrevo(new Error("socket hang up")), true);
    assert.equal(esErrorPasajeroBrevo(new Error("ECONNRESET")), true);
  });

  await prueba("400 NO se reintenta: reintentar un correo inválido no lo arregla", () => {
    assert.equal(esErrorPasajeroBrevo(errorConEstado(400)), false);
  });

  await prueba("401 NO se reintenta: la API key no se va a arreglar sola", () => {
    assert.equal(esErrorPasajeroBrevo(errorConEstado(401)), false);
  });

  console.log("\nenLotes (cuántos correos salen a la vez):\n");

  await prueba("nunca hay más envíos simultáneos que el límite", async () => {
    let vivos = 0;
    let pico = 0;
    await enLotes([...Array(20).keys()], 4, async () => {
      vivos += 1;
      pico = Math.max(pico, vivos);
      await new Promise((r) => setTimeout(r, 5));
      vivos -= 1;
    });
    assert.equal(pico, 4, `se abrieron ${pico} envíos a la vez, el tope es 4`);
  });

  await prueba("se procesan todos los elementos, ninguno se salta", async () => {
    const r = await enLotes([...Array(20).keys()], 4, async (n) => n * 2);
    assert.equal(r.length, 20);
    assert.deepEqual([...r].map((x) => x.value), [...Array(20).keys()].map((n) => n * 2));
  });

  await prueba("un fallo no tumba a los demás", async () => {
    const r = await enLotes([1, 2, 3, 4, 5], 2, async (n) => {
      if (n === 3) throw new Error("correo inválido");
      return n;
    });
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 4);
    assert.equal(r.filter((x) => x.status === "rejected").length, 1);
  });

  await prueba("el resultado conserva el orden de entrada", async () => {
    const r = await enLotes([50, 10, 30], 3, async (ms) => {
      await new Promise((s) => setTimeout(s, ms / 10));
      return ms;
    });
    assert.deepEqual([...r].map((x) => x.value), [50, 10, 30]);
  });

  await prueba("lista vacía no cuelga", async () => {
    assert.deepEqual([...await enLotes([], 4, async () => 1)], []);
  });

  await prueba("el límite no se pasa del tamaño de la lista", async () => {
    const r = await enLotes([1, 2], 10, async (n) => n);
    assert.equal(r.length, 2);
  });

  console.log("\nresumirEnvios (qué se le cuenta al staff):\n");

  await prueba("separa enviados de fallidos", async () => {
    const resultados = await enLotes(["a", "b", "c"], 2, async (x) => {
      if (x === "b") throw new Error("Brevo 400: email inválido");
      return x;
    });
    const {enviados, errores} = resumirEnvios(resultados, (i) => ["Ana", "Beto", "Caro"][i]);
    // Se copian a un array de este realm: los literales creados dentro del vm
    // tienen otro prototipo y deepEqual (estricto) los daría por distintos.
    assert.deepEqual([...enviados], ["a", "c"]);
    assert.equal(errores.length, 1);
  });

  await prueba("cada error dice A QUIÉN y POR QUÉ", async () => {
    const resultados = await enLotes(["a"], 1, async () => {
      throw new Error("Brevo 400: sender not verified");
    });
    const {errores} = resumirEnvios(resultados, () => "Beto Pérez");
    assert.equal(errores[0].destinatario, "Beto Pérez");
    assert.match(errores[0].motivo, /sender not verified/);
  });

  await prueba("el motivo se recorta para no reventar la respuesta", async () => {
    const resultados = await enLotes(["a"], 1, async () => {
      throw new Error("x".repeat(5000));
    });
    const {errores} = resumirEnvios(resultados, () => "Ana");
    assert.ok(errores[0].motivo.length <= 300);
  });

  console.log(`\n${pasadas} pruebas OK\n`);
}

main().catch((e) => {
  console.error("\nFALLÓ:", e.message, "\n");
  process.exitCode = 1;
});
