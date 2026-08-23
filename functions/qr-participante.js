// El correo de aprobación NO envía el QR como imagen: solo incluye los datos
// del participante y un botón/enlace hacia perfil.html, donde el QR se genera
// en el navegador (misma lógica que modulos_participantes.html).
const URL_BASE_PERFIL = "https://contecsfisc.github.io/contecsApp/public/perfil.html";

// Página pública de gira — nueva y separada de perfil.html a propósito (ver
// PLAN_GIRAS_Y_CSV.md, punto 4). Reutiliza el mismo token del participante,
// no genera credenciales nuevas.
const URL_BASE_GIRA = "https://contecsfisc.github.io/contecsApp/public/gira.html";

function linkPerfilParticipante(codigo, token) {
  return `${URL_BASE_PERFIL}?c=${encodeURIComponent(codigo)}&t=${encodeURIComponent(token)}`;
}

function linkGiraParticipante(codigo, token, giraId) {
  return `${URL_BASE_GIRA}?c=${encodeURIComponent(codigo)}&t=${encodeURIComponent(token)}&g=${encodeURIComponent(giraId)}`;
}

module.exports = {
  URL_BASE_PERFIL,
  URL_BASE_GIRA,
  linkPerfilParticipante,
  linkGiraParticipante,
};
