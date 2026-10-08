// Lectura del "RFID" que se ancla a un participante (POSPER, con el lector
// EA530). Es lo que traiga la siguiente lectura tras la credencial:
// normalmente un QR con un texto hexadecimal largo, pero puede ser un código
// de barras u otro texto. Se muestra un serial corto (primeros + últimos
// caracteres) y se guarda el valor completo para que el mismo RFID no quede
// anclado a dos personas.
//
// Vive aparte de operaciones-qr.js para poder probarlo sin Firestore
// (test/rfid.test.js).

const crypto = require("crypto");

const RFID_PREFIJO = 4;
const RFID_SUFIJO = 4;
const RFID_MIN = 4;
const RFID_MAX = 512;

// Se acepta lo que traiga la lectura (QR, código de barras, lo que sea): solo
// se quitan espacios y separadores, que el teclado del equipo puede meter o
// el generador del código pone entre bytes. Lo único que se rechaza es la
// credencial CONTECS, que llega cuando el gatillo se dispara dos veces sobre
// el QR del participante.
function normalizarRfid(crudo) {
  const texto = String(crudo ?? "").trim();
  if (!texto) return {ok: false, motivo: "La lectura del RFID está vacía."};

  if (/[?&]c=[^&\s]+.*[?&]t=/i.test(texto) || /"codigo"\s*:.*"token"\s*:/i.test(texto)) {
    return {
      ok: false,
      motivo: "Eso es la credencial del participante, no un RFID. Escanea el RFID.",
    };
  }

  // eslint-disable-next-line no-control-regex
  const limpio = texto.replace(/[\s:\u0000-\u001f\u007f-]/g, "");
  if (limpio.length < RFID_MIN) {
    return {
      ok: false,
      motivo: `La lectura es demasiado corta (mínimo ${RFID_MIN} caracteres).`,
    };
  }
  if (limpio.length > RFID_MAX) {
    return {ok: false, motivo: "La lectura del RFID es demasiado larga."};
  }
  // Un hexadecimal puro se guarda en mayúsculas para que el serial se vea
  // siempre igual; cualquier otra lectura se respeta tal cual.
  return {ok: true, completo: /^[0-9a-f]+$/i.test(limpio) ? limpio.toUpperCase() : limpio};
}

// "E2801160600002...3F1A" -> "E280...3F1A"
// Si la lectura es corta, el serial es la lectura completa.
function serialRfid(completo) {
  if (completo.length <= RFID_PREFIJO + RFID_SUFIJO) return completo;
  return `${completo.slice(0, RFID_PREFIJO)}...${completo.slice(-RFID_SUFIJO)}`;
}

// ID del documento-lock en `rfid_participantes`: el valor completo puede ser
// más largo de lo cómodo para un ID, así que se usa su hash.
// Sin distinguir mayúsculas: el teclado del equipo puede cambiarlas.
function idLockRfid(completo) {
  return crypto.createHash("sha256").update(completo.toUpperCase()).digest("hex");
}

module.exports = {
  RFID_PREFIJO,
  RFID_SUFIJO,
  idLockRfid,
  normalizarRfid,
  serialRfid,
};
