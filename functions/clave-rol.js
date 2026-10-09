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

// Pase de Usuarios: tras escribir la contraseña una vez, el panel recibe un
// token firmado (HMAC) que vale para guardar permisos durante un rato. La
// llave sale del hash guardado: si se cambia la contraseña, los pases viejos
// dejan de valer. Formato: base64url(JSON {uid, exp}) + "." + base64url(firma).
const llaveDePase = (guardado) =>
  crypto.createHash("sha256").update(`pase-usuarios|${String(guardado || "").trim()}`).digest();

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function firmarPase(uid, guardado, duracionMs, ahora = Date.now()) {
  const cuerpo = b64url(JSON.stringify({uid, exp: ahora + duracionMs}));
  const firma = crypto.createHmac("sha256", llaveDePase(guardado)).update(cuerpo).digest();
  return {pase: `${cuerpo}.${b64url(firma)}`, vence: ahora + duracionMs};
}

// true solo si la firma es buena, es de `uid` y no ha vencido.
function paseValido(pase, uid, guardado, ahora = Date.now()) {
  if (typeof pase !== "string" || pase.length > 500 || !guardado) return false;
  const [cuerpo, firma, sobra] = pase.split(".");
  if (!cuerpo || !firma || sobra !== undefined) return false;
  const esperada = crypto.createHmac("sha256", llaveDePase(guardado)).update(cuerpo).digest();
  const recibida = Buffer.from(firma, "base64url");
  if (recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) return false;
  try {
    const datos = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8"));
    return datos.uid === uid && Number.isFinite(datos.exp) && ahora < datos.exp;
  } catch {
    return false;
  }
}

module.exports = {verificarClave, generarHash, firmarPase, paseValido};
