// Identidad de participantes: cómo se deriva el id de un documento, cómo se
// derivan los documentos-lock de `identificadores_participantes` y cuándo un
// lock bloquea de verdad un registro nuevo.
//
// Vive aparte de index.js para que estas piezas se puedan probar sin cargar
// todas las Cloud Functions (ver test/identidad.test.js) y para que el script
// de diagnóstico test/id-bloqueo.js use exactamente la misma derivación que
// producción, en vez de una copia que se pueda desincronizar.

const crypto = require("crypto");
const {HttpsError} = require("firebase-functions/v2/https");

// Debe ser IDENTICA a RE_CORREO en js/core/correos.js. El navegador parsea y
// filtra, pero los roles con escritura sobre `giras_voluntarios` pueden dejar
// entradas ahi sin pasar por el panel, asi que esta es la validacion que
// realmente cuenta antes de enviar un correo. test/correos.test.mjs comprueba
// que las dos expresiones no se desincronicen.
const RE_CORREO =
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

function esCorreoValido(valor) {
  const texto = String(valor ?? "").trim();
  return texto.length > 0 && texto.length <= 254 && RE_CORREO.test(texto);
}

const CORREO_SOPORTE = "congresofisc@utp.ac.pa";

// El id del documento del participante se deriva de la cédula si la hay, y del
// correo si no. Es estable: dos veces la misma identidad dan el mismo id.
function generarDocId(cedula, correo) {
  const ced = String(cedula || "").trim();
  const mail = String(correo || "").trim().toLowerCase();
  if (ced) return `c_${ced.replace(/[^a-zA-Z0-9]/g, "_")}`;
  if (mail) return `e_${mail.replace(/[^a-zA-Z0-9]/g, "_")}`;
  return null;
}

// Id del documento-lock. Se hashea el valor para no dejar cédulas ni correos
// legibles en los nombres de documento.
function idBloqueoParticipante(tipo, valor) {
  const hash = crypto.createHash("sha256")
      .update(String(valor || "").trim().toLowerCase())
      .digest("hex");
  return `${tipo}_${hash}`;
}

// Mensaje que nombra el campo que chocó. Antes se devolvía un genérico
// "esta cédula o correo" que mandaba a buscar el duplicado en el campo
// equivocado; el cliente además lo sobrescribía (ver participantes-api.js).
function errorDuplicado(campo, valor) {
  const etiqueta = campo === "cedula" ? "la cédula" : "el correo";
  return new HttpsError(
      "already-exists",
      `Ya existe una inscripción con ${etiqueta} ${valor}. ` +
      `Si crees que es un error, escribe a ${CORREO_SOPORTE}.`,
  );
}

// De los locks que existen, ¿cuáles bloquean de verdad?
//
// Un lock solo significa "esta identidad ya está tomada" mientras el
// participante al que apunta siga existiendo. Si se borró al participante (por
// ejemplo un registro de prueba, desde la Consola), el lock queda huérfano: sin
// esta comprobación bloquearía esa cédula y ese correo PARA SIEMPRE, y nadie
// podría averiguar por qué, porque `identificadores_participantes` es
// `read, write: if false` — invisible desde la app y desde el panel.
//
// `idsVivos` se indexa por id de documento, no por posición, para no depender
// del orden en que Firestore devuelva los snapshots.
function locksQueBloquean(ocupados, idsVivos) {
  return ocupados.filter(
      (o) => o.participanteId && idsVivos.has(o.participanteId),
  );
}

module.exports = {
  CORREO_SOPORTE,
  RE_CORREO,
  esCorreoValido,
  generarDocId,
  idBloqueoParticipante,
  errorDuplicado,
  locksQueBloquean,
};
