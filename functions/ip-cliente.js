"use strict";

// IP de quien llama a una función, para limitar registros (aplicarLimiteRegistro).
//
// X-Forwarded-For lo puede escribir el propio cliente: si manda
// "X-Forwarded-For: 1.2.3.4", la función recibe "1.2.3.4, <su IP real>",
// porque la red de Google AGREGA al final la IP desde la que llegó la
// conexión. Por eso se toma el ÚLTIMO valor y no el primero: el primero
// cambia a gusto del cliente y saltaba el límite.
//
// Las funciones se llaman directo en cloudfunctions.net (sin balanceador ni
// Hosting delante). Si algún día se ponen detrás de uno, ese agrega su propia
// IP al final y habría que tomar el penúltimo valor.

function ipDelCliente(raw) {
  const cabecera = raw?.headers?.["x-forwarded-for"];
  const valores = (Array.isArray(cabecera) ? cabecera.join(",") : String(cabecera || ""))
      .split(",").map((v) => v.trim()).filter(Boolean);
  return valores.pop() || String(raw?.ip || "").trim() || "desconocida";
}

// Una conexión IPv6 de casa o de celular tiene un bloque /64 entero (millones
// de direcciones): se cuenta el bloque, no cada dirección, para que cambiar
// de dirección no reinicie el límite. IPv4 se cuenta tal cual.
function claveDeLimite(ip) {
  const texto = String(ip || "").trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
  const mapeada = texto.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapeada) return mapeada[1];
  if (!texto.includes(":")) return texto || "desconocida";
  const partes = texto.split("::");
  if (partes.length > 2) return texto;
  const izquierda = partes[0] ? partes[0].split(":") : [];
  const derecha = partes.length === 2 && partes[1] ? partes[1].split(":") : [];
  const faltan = 8 - izquierda.length - derecha.length;
  if (partes.length === 1 ? faltan !== 0 : faltan < 1) return texto;
  const grupos = [...izquierda, ...Array(partes.length === 2 ? faltan : 0).fill("0"), ...derecha];
  if (!grupos.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return texto;
  return `${grupos.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

module.exports = {ipDelCliente, claveDeLimite};
