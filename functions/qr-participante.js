// El correo de aprobación NO envía el QR como imagen: solo incluye los datos
// del participante y un botón/enlace hacia perfil.html, donde el QR se genera
// en el navegador (misma lógica que modulos_participantes.html).
const URL_BASE_PERFIL = "https://contecsfisc.github.io/contecsApp/public/perfil.html";

function linkPerfilParticipante(codigo, token) {
  return `${URL_BASE_PERFIL}?c=${encodeURIComponent(codigo)}&t=${encodeURIComponent(token)}`;
}

module.exports = {
  URL_BASE_PERFIL,
  linkPerfilParticipante,
};
