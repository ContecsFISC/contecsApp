// Utilidades pequeñas y sin dependencias para tratar datos externos antes de
// insertarlos en HTML, atributos o archivos que abrirá una hoja de cálculo.

export function escaparHtml(valor) {
  return String(valor ?? "").replace(/[&<>'"]/g, caracter => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[caracter]);
}

export const escaparAtributo = escaparHtml;

export function urlHttpSegura(valor, {permitirHttpLocal = false} = {}) {
  const texto = String(valor ?? "").trim();
  if (!texto) return "";
  try {
    const url = new URL(texto, window.location.origin);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol === "https:" ||
        (permitirHttpLocal && local && url.protocol === "http:")) {
      return url.href;
    }
  } catch (_) {
    // Una URL inválida no debe llegar a un atributo navegable.
  }
  return "";
}

export function urlImagenSegura(valor) {
  return urlHttpSegura(valor);
}

export function neutralizarFormulaHoja(valor) {
  const texto = String(valor ?? "");
  return /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
}
