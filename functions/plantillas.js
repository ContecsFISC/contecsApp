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
      // Se deshacen las entidades DESPUES de quitar etiquetas: el HTML viene
      // escapado, y sin esto la version en texto plano del correo mostraba
      // "cupo &lt;30 (empresa &amp; universidad)" en clientes sin HTML.
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, "\"")
      .replace(/&amp;/g, "&")
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

// Convierte el texto que escribe el equipo de Giras en el panel a HTML seguro:
// escapa todo primero y solo despues introduce el marcado, de modo que lo que
// escriba el staff nunca pueda inyectar etiquetas. Se respetan los parrafos
// (linea en blanco) y los saltos sueltos.
function textoAParrafosHtml(texto) {
  const bloques = String(texto || "")
      .replace(/\r\n/g, "\n")
      .trim()
      .split(/\n{2,}/);
  return bloques
      .filter((bloque) => bloque.trim())
      .map((bloque) =>
        `<p style="margin:0 0 14px;font-size:14px;color:#5c4e2e;line-height:1.75;">` +
        escaparHtml(bloque.trim()).replace(/\n/g, "<br/>") +
        `</p>`)
      .join("\n");
}

// Aviso a quien no fue seleccionado para una gira. El motivo y el cuerpo los
// escribe el equipo de Giras desde el panel; aqui no hay texto preestablecido.
// Como las otras plantillas de gira, no lleva codigo, token ni enlace: no fue
// incluido, asi que no se le entrega ningun acceso.
//
// `mensaje` es la unica variable que entra como HTML ya construido (parrafos),
// por eso se inserta despues del escapado general y no se vuelve a escapar.
function cargarCorreoNoSeleccionadoGira(vars) {
  const raw = leer("correo-no-seleccionado-gira.html");
  const meta = parseMeta(raw);
  const {mensaje, nombre, nota, ...resto} = vars || {};
  const varsHtml = Object.fromEntries(
      Object.entries(resto).map(([key, value]) => [key, escaparHtml(value)]),
  );
  varsHtml.mensaje_html = textoAParrafosHtml(mensaje);
  // Los avisos a correos sueltos (gente que aplico sin estar inscrita) pueden
  // no traer nombre. En ese caso el saludo va sin el, en vez de un "Hola ,".
  // Nota individual: solo aparece si esa persona tiene una. Se construye el
  // bloque entero aqui para que, cuando no la haya, no quede un recuadro vacio
  // en el correo.
  const notaLimpia = String(nota || "").trim();
  varsHtml.nota_html = notaLimpia ? [
    "<tr><td style=\"background:#ffffff;padding:4px 28px 8px;\">",
    "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"",
    " style=\"background:#fdfaf0;border-left:3px solid #856404;border-radius:8px;\">",
    "<tr><td style=\"padding:14px 18px;\">",
    textoAParrafosHtml(notaLimpia).replace(/margin:0 0 14px;/g, "margin:0 0 8px;"),
    "</td></tr></table></td></tr>",
  ].join("") : "";

  const limpio = String(nombre || "").trim();
  varsHtml.saludo_html = limpio ?
    `Hola <strong>${escaparHtml(limpio)}</strong>,` :
    "Hola,";
  const htmlContent = aplicarPlantilla(raw, varsHtml);

  return {
    activo: meta.activo,
    subject: aplicarPlantilla(meta.subject, resto),
    htmlContent,
    textContent: htmlATexto(htmlContent),
  };
}

module.exports = {
  aplicarPlantilla,
  cargarCorreoPagoAprobado,
  cargarCorreoNotificacionGira,
  cargarCorreoNoSeleccionadoGira,
};
