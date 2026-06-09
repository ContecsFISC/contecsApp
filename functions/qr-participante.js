// Misma lógica que perfil.html y modulos_participantes.html (QRCode.js en browser).
const QRCode = require("qrcode");

const URL_BASE_PERFIL = "https://contecsfisc.github.io/contecsApp/perfil.html";

const QR_OPTS = {
  width: 194,
  margin: 2,
  color: {dark: "#045223", light: "#ffffff"},
  errorCorrectionLevel: "H",
};

function linkPerfilParticipante(codigo, token) {
  return `${URL_BASE_PERFIL}?c=${encodeURIComponent(codigo)}&t=${encodeURIComponent(token)}`;
}

async function generarQrDataUrl(codigo, token) {
  return QRCode.toDataURL(linkPerfilParticipante(codigo, token), QR_OPTS);
}

module.exports = {
  URL_BASE_PERFIL,
  linkPerfilParticipante,
  generarQrDataUrl,
};
