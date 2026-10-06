// Lectura del QR "RFID" que se ancla a un participante desde POSPER (lector
// EA530). Ese QR trae un texto hexadecimal largo; al participante se le
// muestra un serial corto (primeros + últimos caracteres) y se guarda el
// valor completo para que el mismo RFID no quede anclado a dos personas.
//
// Vive aparte de operaciones-qr.js para poder probarlo sin Firestore
// (test/rfid.test.js).

const crypto = require("crypto");

const RFID_PREFIJO = 4;
const RFID_SUFIJO = 4;
const RFID_MIN = RFID_PREFIJO + RFID_SUFIJO;
const RFID_MAX = 512;

// El lector entrega el texto tal cual viene en el QR; algunos generadores
// separan los bytes con espacios, ":" o "-".
function normalizarRfid(crudo) {
  const texto = String(crudo ?? "").trim();
  if (!texto) return {ok: false, motivo: "El QR del RFID está vacío."};

  // Si el operador escanea por error la credencial del participante.
  if (/^https?:\/\//i.test(texto) || texto.startsWith("{")) {
    return {
      ok: false,
      motivo: "Ese QR es una credencial, no un RFID. Escanea el QR del RFID.",
    };
  }

  const limpio = texto.replace(/[\s:-]/g, "").toUpperCase();
  if (!/^[0-9A-Z]+$/.test(limpio)) {
    return {ok: false, motivo: "El QR del RFID trae caracteres no válidos."};
  }
  if (limpio.length < RFID_MIN) {
    return {
      ok: false,
      motivo: `El RFID es demasiado corto (mínimo ${RFID_MIN} caracteres).`,
    };
  }
  if (limpio.length > RFID_MAX) {
    return {ok: false, motivo: "El RFID es demasiado largo."};
  }
  return {ok: true, completo: limpio};
}

// "E2801160600002...3F1A" -> "E280...3F1A"
function serialRfid(completo) {
  return `${completo.slice(0, RFID_PREFIJO)}...${completo.slice(-RFID_SUFIJO)}`;
}

// ID del documento-lock en `rfid_participantes`: el valor completo puede ser
// más largo de lo cómodo para un ID, así que se usa su hash.
function idLockRfid(completo) {
  return crypto.createHash("sha256").update(completo).digest("hex");
}

module.exports = {
  RFID_PREFIJO,
  RFID_SUFIJO,
  idLockRfid,
  normalizarRfid,
  serialRfid,
};
