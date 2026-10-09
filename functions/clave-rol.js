"use strict";

// Hash de la contraseña para cambiar roles (ver cambio-rol.js). Sin Firebase:
// lo usan la Cloud Function, la herramienta herramientas/hash-clave-rol.js y
// las pruebas.

const crypto = require("crypto");

// Compara la clave con el hash guardado sin filtrar por tiempo cuánto acierta.
function verificarClave(clave, guardado) {
  const partes = String(guardado || "").trim().split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [, N, r, p, salB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64, "base64");
  if (!esperado.length || typeof clave !== "string" || !clave || clave.length > 200) return false;
  const obtenido = crypto.scryptSync(clave, Buffer.from(salB64, "base64"), esperado.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(obtenido, esperado);
}

function generarHash(clave, {N = 32768, r = 8, p = 1} = {}) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(clave, sal, 64, {N, r, p, maxmem: 256 * 1024 * 1024});
  return `scrypt$${N}$${r}$${p}$${sal.toString("base64")}$${hash.toString("base64")}`;
}

module.exports = {verificarClave, generarHash};
