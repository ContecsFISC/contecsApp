// Lectura del texto de una credencial CONTECS (el QR de perfil.html o el
// impreso). La comparten la lectura por cámara (lecturaQR.js) y el lector
// físico EA530 (posper.js), para que ambos acepten exactamente lo mismo.

export function extraerCredencialQr(rawQR) {
  // Una credencial nunca lleva espacios: se quitan los que pueda meter el
  // teclado del equipo al recibir la lectura (autoespaciado tras "." o "?").
  const texto = String(rawQR || "").replace(/\s+/g, "");
  if (!texto) throw new Error("El QR está vacío.");

  try {
    const url = new URL(texto);
    const codigo = url.searchParams.get("c")?.trim().toUpperCase();
    const token = url.searchParams.get("t")?.trim();
    if (codigo && token) return participante(codigo, token);
  } catch (_) {
    // Continuar con formatos sin URL.
  }

  // URL de perfil.html con caracteres extra antes o después (prefijos/sufijos
  // que puede agregar un lector físico): se buscan ?c= y &t= dentro del texto.
  const codigoTexto = parametroEnTexto(texto, "c").toUpperCase();
  const tokenTexto = parametroEnTexto(texto, "t");
  if (codigoTexto && tokenTexto) return participante(codigoTexto, tokenTexto);

  try {
    const inicio = texto.indexOf("{");
    const datos = JSON.parse(inicio >= 0 ? texto.slice(inicio, texto.lastIndexOf("}") + 1) : texto);
    const codigo = String(datos.codigo || "").trim().toUpperCase();
    const token = String(datos.token || "").trim();
    if (codigo && token) return participante(codigo, token);
  } catch (_) {
    // Continuar con los símbolos cambiados.
  }

  // Un lector físico que "teclea" con otra distribución de teclado cambia los
  // símbolos de la URL (? = & : / -), pero letras y números llegan bien: se
  // buscan el código CTCS-2026-NNNNN y el token de 48 hex (functions/registro.js).
  const codigoSuelto = texto.match(/CTCS\W?(\d{4})\W?(\d{5})(?!\d)/i);
  const tokenSuelto = texto.match(/(?<![0-9a-f])[0-9a-f]{48}(?![0-9a-f])/i);
  if (codigoSuelto && tokenSuelto) {
    return {
      tipo: "participante",
      codigo: `CTCS-${codigoSuelto[1]}-${codigoSuelto[2]}`,
      token: tokenSuelto[0].toLowerCase(),
    };
  }

  if (/^[A-Za-z0-9_-]{1,200}$/.test(texto)) {
    return { tipo: "legacy", id: texto };
  }
  // Se muestra lo recibido para detectar lecturas incompletas o con caracteres cambiados.
  const muestra = texto.length > 120 ? `${texto.slice(0, 120)}…` : texto;
  throw new Error(`El contenido no corresponde a una credencial CONTECS válida. Se leyó: "${muestra}"`);
}

function parametroEnTexto(texto, nombre) {
  // Sin distinguir mayúsculas: el teclado puede poner "?C=" tras el "?".
  const coincidencia = texto.match(new RegExp(`[?&]${nombre}=([^&#\\s]+)`, "i"));
  if (!coincidencia) return "";
  try {
    return decodeURIComponent(coincidencia[1]).trim();
  } catch (_) {
    return coincidencia[1].trim();
  }
}

// El token de participante es hex en minúsculas (functions/registro.js): si el
// lector lo mandó en mayúsculas se devuelve como se guardó.
function participante(codigo, token) {
  return { tipo: "participante", codigo, token: /^[0-9a-f]{48}$/i.test(token) ? token.toLowerCase() : token };
}
