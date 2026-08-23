const fs = require("fs");
const path = require("path");

const TEMPLATES_DIR = path.join(__dirname, "templates");

function aplicarPlantilla(texto, vars) {
  if (!texto) return "";
  return String(texto).replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function escaparHtml(valor) {
  return String(valor ?? "").replace(/[&<>'"]/g, (caracter) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[caracter]);
}

function leer(nombre) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, nombre), "utf8");
}

function parseMeta(html) {
  const subject = html.match(/<!--\s*subject:\s*(.+?)\s*-->/)?.[1] ?? "";
  const activoRaw = html.match(/<!--\s*activo:\s*(.+?)\s*-->/)?.[1]?.trim();
  return {
    subject,
    activo: activoRaw !== "false",
  };
}

function htmlATexto(html) {
  return html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<div[^>]*display:\s*none[^>]*>[\s\S]*?<\/div>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
}

function cargarCorreoPagoAprobado(vars) {
  const raw = leer("correo-pago-aprobado.html");
  const meta = parseMeta(raw);
  const varsHtml = Object.fromEntries(
      Object.entries(vars || {}).map(([key, value]) => [key, escaparHtml(value)]),
  );
  const htmlContent = aplicarPlantilla(raw, varsHtml);

  return {
    activo: meta.activo,
    subject: aplicarPlantilla(meta.subject, vars),
    htmlContent,
    textContent: htmlATexto(htmlContent),
  };
}

function cargarCorreoNotificacionGira(vars) {
  const raw = leer("correo-notificacion-gira.html");
  const meta = parseMeta(raw);
  const varsHtml = Object.fromEntries(
      Object.entries(vars || {}).map(([key, value]) => [key, escaparHtml(value)]),
  );
  const htmlContent = aplicarPlantilla(raw, varsHtml);

  return {
    activo: meta.activo,
    subject: aplicarPlantilla(meta.subject, vars),
    htmlContent,
    textContent: htmlATexto(htmlContent),
  };
}

module.exports = {aplicarPlantilla, cargarCorreoPagoAprobado, cargarCorreoNotificacionGira};
