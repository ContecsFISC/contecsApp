// =============================================
// CONTECS — Salones: nombres y choques de horario
// =============================================
// Un salón es un espacio del plano (id "piso-número", js/data/
// planos-edificio3.js) con datos en la colección `salones`: nombre que ven
// los asistentes, rótulo en el plano y capacidad. Los checkpoints lo
// referencian con `salonId`; `salon` guarda el texto para los reportes.
//
// Sin Firebase ni DOM para probarlo con el código real
// (functions/test/agenda-salones.test.mjs).

import { minutosDeHora, estaCancelado } from "./permanencia.js";

export const RE_ESPACIO = /^\d{1,2}-\d{1,4}$/;
export const ROTULO_MAX = 7;

// Tipos del plano donde se pueden programar actividades.
export const TIPOS_PROGRAMABLES = new Set(["espacio", "vestibulo"]);

const PISOS = { 2: "Segundo piso", 3: "Tercer piso" };

export function nombrePiso(piso) {
  return PISOS[piso] || `Piso ${piso}`;
}

// Lo que se muestra del salón: el nombre configurado o "Salón 73".
export function nombreSalon(espacioId, salon) {
  if (salon?.nombre) return salon.nombre;
  const numero = String(espacioId || "").split("-")[1];
  return numero ? `Salón ${numero}` : "Salón";
}

export function rotuloSalon(espacioId, salon) {
  return salon?.rotulo || String(espacioId || "").split("-")[1] || "";
}

// "3-301 · Auditorio menor · 80 personas" para listas y selectores.
export function etiquetaSalon(espacioId, salon) {
  return [
    rotuloSalon(espacioId, salon),
    nombreSalon(espacioId, salon),
    salon?.capacidad ? `${salon.capacidad} personas` : "",
  ].filter(Boolean).join(" · ");
}

const normalizar = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * El salón de un checkpoint: `salonId` si lo tiene; si es de antes (solo
 * texto en `salon`), se busca un salón con ese nombre o rótulo.
 * @param {object} cp
 * @param {Record<string, object>} salones  id -> datos
 * @returns {string|null}
 */
export function salonDeCheckpoint(cp, salones = {}) {
  if (cp?.salonId) return cp.salonId;
  const texto = normalizar(cp?.salon);
  if (!texto) return null;
  for (const [id, s] of Object.entries(salones)) {
    if (normalizar(s.nombre) === texto || normalizar(s.rotulo) === texto || normalizar(id) === texto) return id;
  }
  return null;
}

// Clave para comparar lugares: el salón del plano o, si es "otro lugar",
// el texto normalizado.
function claveLugar(cp, salones) {
  const id = salonDeCheckpoint(cp, salones);
  if (id) return `salon:${id}`;
  const texto = normalizar(cp?.salon);
  return texto ? `texto:${texto}` : null;
}

function rango(cp) {
  const ini = minutosDeHora(cp.horaInicio);
  const fin = minutosDeHora(cp.horaFin);
  // Sin horario ocupa el día completo.
  return ini == null || fin == null ? [0, 24 * 60] : [ini, fin];
}

/**
 * Checkpoints que chocan con `nuevo`: mismo lugar, mismo día y horarios que
 * se cruzan (terminar a las 10:00 y empezar a las 10:00 no es choque). Los
 * cancelados no ocupan el salón; los desactivados sí (es una pausa).
 * @param {object} nuevo  { id?, salonId?, salon?, dia, horaInicio, horaFin }
 * @param {Array<object>} otros  checkpoints existentes (de cualquier evento)
 */
export function buscarChoques(nuevo, otros, salones = {}) {
  const lugar = claveLugar(nuevo, salones);
  if (!lugar || !nuevo?.dia) return [];
  const [ini, fin] = rango(nuevo);
  return (otros || []).filter(cp => {
    if (!cp || cp.id === nuevo.id || estaCancelado(cp)) return false;
    if (cp.dia !== nuevo.dia || claveLugar(cp, salones) !== lugar) return false;
    const [oIni, oFin] = rango(cp);
    return ini < oFin && oIni < fin;
  });
}

export function describirChoque(cp, salones = {}) {
  const id = salonDeCheckpoint(cp, salones);
  const lugar = id ? etiquetaSalon(id, salones[id]) : cp.salon;
  const horario = cp.horaInicio && cp.horaFin ? `de ${cp.horaInicio} a ${cp.horaFin}` : "todo el día";
  const evento = cp.eventoNombre ? ` del evento "${cp.eventoNombre}"` : "";
  return `Choca con "${cp.nombre || "otra actividad"}"${cp.titulo ? ` (${cp.titulo})` : ""}${evento}, el ${cp.dia} ${horario}, en ${lugar}.`;
}
