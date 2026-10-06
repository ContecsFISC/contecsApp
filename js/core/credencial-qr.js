// Lectura del texto de una credencial CONTECS (el QR de perfil.html o el
// impreso). La comparten la lectura por cámara (lecturaQR.js) y el lector
// físico EA530 (posper.js), para que ambos acepten exactamente lo mismo.

export function extraerCredencialQr(rawQR) {
  const texto = String(rawQR || "").trim();
  if (!texto) throw new Error("El QR está vacío.");

  try {
    const url = new URL(texto);
    const codigo = url.searchParams.get("c")?.trim().toUpperCase();
    const token = url.searchParams.get("t")?.trim();
    if (codigo && token) return { tipo: "participante", codigo, token };
  } catch (_) {
    // Continuar con formatos sin URL.
  }

  try {
    const datos = JSON.parse(texto);
    const codigo = String(datos.codigo || "").trim().toUpperCase();
    const token = String(datos.token || "").trim();
    if (codigo && token) return { tipo: "participante", codigo, token };
  } catch (_) {
    // Continuar con el ID legacy.
  }

  if (/^[A-Za-z0-9_-]{1,200}$/.test(texto)) {
    return { tipo: "legacy", id: texto };
  }
  throw new Error("El contenido no corresponde a una credencial CONTECS válida.");
}
