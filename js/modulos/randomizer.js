// =============================================
// CONTECS — Randomizer
// =============================================
// Lista en vivo a los participantes que ya tienen un RFID anclado desde
// POSPER (campo `rfid` del participante, que solo escribe el servidor) y,
// al tocar BATIR, elige 3 al azar.

import { db } from "../core/firebase-config.js";
import {
  collection, getDocs, onSnapshot, orderBy, query, where,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { escaparHtml } from "../core/seguridad.js";

const el = id => document.getElementById(id);
const h = escaparHtml;

const CANTIDAD_GANADORES = 3;
const DURACION_BATIDO_MS = 2200;

let participantes = [];
let ganadores = [];
let batiendo = false;
let cancelarEscucha = null;

function alerta(tipo, msg) {
  const div = el("alerta");
  div.className = `alerta alerta-${tipo} show`;
  div.textContent = msg;
  clearTimeout(alerta.t);
  alerta.t = setTimeout(() => div.classList.remove("show"), 5000);
}

function nombreDe(p) {
  return p.nombreCompleto || [p.nombre, p.apellido].filter(Boolean).join(" ") || "Participante";
}

function fechaAnclado(p) {
  const fecha = p.rfid?.ancladoEn?.toDate?.();
  return fecha ? fecha.toLocaleString("es-PA", { dateStyle: "short", timeStyle: "short" }) : "—";
}

// ─── Datos en vivo ──────────────────────────────────────────────────────────
function escuchar(eventoId) {
  cancelarEscucha?.();
  const base = collection(db, "participantes");
  const q = eventoId
    ? query(base, where("rfid.eventoId", "==", eventoId))
    : query(base, where("rfid.serial", ">", ""));
  cancelarEscucha = onSnapshot(q, snap => {
    participantes = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.rfid?.serial)
      .sort((a, b) => (b.rfid.ancladoEn?.toMillis?.() || 0) - (a.rfid.ancladoEn?.toMillis?.() || 0));
    // Un ganador que ya no tiene RFID (o fue eliminado) deja de contar.
    ganadores = ganadores
      .map(g => participantes.find(p => p.id === g.id))
      .filter(Boolean);
    render();
  }, e => {
    console.error("Randomizer:", e);
    alerta("error", "No se pudieron cargar los participantes: " + (e.message || e));
    el("conteo").textContent = "Error al cargar.";
  });
}

// ─── Render ─────────────────────────────────────────────────────────────────
function render() {
  const n = participantes.length;
  el("conteo").innerHTML = n
    ? `<strong>${n}</strong> participante${n === 1 ? "" : "s"} con RFID anclado.`
    : "Todavía nadie tiene un RFID anclado. Se anclan desde POSPER.";
  el("btn-batir").disabled = batiendo || n < CANTIDAD_GANADORES;
  el("btn-batir").title = n < CANTIDAD_GANADORES
    ? `Se necesitan al menos ${CANTIDAD_GANADORES} participantes con RFID.`
    : "";
  if (!batiendo) renderGanadores();
  renderTabla();
}

function renderTabla() {
  const filas = ganadores.length ? ganadores : participantes;
  el("titulo-tabla").textContent = ganadores.length
    ? `Seleccionados (${ganadores.length} de ${participantes.length})`
    : "Todos los participantes con RFID";
  el("btn-ver-todos").style.display = ganadores.length ? "inline-flex" : "none";
  el("tabla-rfid").innerHTML = filas.length
    ? filas.map((p, i) => `<tr class="${ganadores.length ? "es-ganador" : ""}">
        <td>${i + 1}</td>
        <td>${h(nombreDe(p))}</td>
        <td>${h(p.cedula || "—")}</td>
        <td>${h(p.correo || "—")}</td>
        <td>${h(p.universidad || p.institucion || "—")}</td>
        <td>${h(p.codigo || "—")}</td>
        <td class="rfid">${h(p.rfid.serial)}</td>
        <td>${h(fechaAnclado(p))}</td>
      </tr>`).join("")
    : `<tr><td colspan="8" style="text-align:center;color:var(--gris-medio)">Sin participantes con RFID</td></tr>`;
}

function tarjeta(p, i, listo) {
  return `<div class="ganador${listo ? " listo" : ""}">
    <span class="ganador-pos">#${i + 1}</span>
    <div class="ganador-nombre">${h(nombreDe(p))}</div>
    <div class="ganador-dato">${h(p.cedula || p.correo || "")}</div>
    <div class="ganador-dato">${h(p.universidad || p.institucion || "")}</div>
    <span class="ganador-rfid">${h(p.rfid.serial)}</span>
  </div>`;
}

function renderGanadores() {
  const caja = el("ganadores");
  caja.style.display = ganadores.length ? "grid" : "none";
  caja.innerHTML = ganadores.map((p, i) => tarjeta(p, i, true)).join("");
}

// ─── BATIR ──────────────────────────────────────────────────────────────────
function aleatorio(max) {
  // Entero uniforme en [0, max) sin sesgo de módulo.
  const limite = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limite);
  return buf[0] % max;
}

function elegir(lista, cantidad) {
  const copia = [...lista];
  for (let i = 0; i < cantidad; i++) {
    const j = i + aleatorio(copia.length - i);
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia.slice(0, cantidad);
}

el("btn-batir").addEventListener("click", () => {
  if (batiendo || participantes.length < CANTIDAD_GANADORES) return;
  batiendo = true;
  ganadores = [];
  el("btn-batir").disabled = true;
  el("btn-batir").textContent = "BATIENDO...";
  renderTabla();

  const caja = el("ganadores");
  caja.style.display = "grid";
  const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const inicio = performance.now();

  const girar = () => {
    if (!reducido && performance.now() - inicio < DURACION_BATIDO_MS) {
      caja.innerHTML = elegir(participantes, CANTIDAD_GANADORES).map((p, i) => tarjeta(p, i, false)).join("");
      setTimeout(girar, 90);
      return;
    }
    ganadores = elegir(participantes, CANTIDAD_GANADORES);
    batiendo = false;
    el("btn-batir").textContent = "BATIR DE NUEVO";
    render();
  };
  girar();
});

el("btn-ver-todos").addEventListener("click", () => {
  ganadores = [];
  el("btn-batir").textContent = "BATIR";
  render();
});

el("sel-evento").addEventListener("change", () => {
  ganadores = [];
  el("btn-batir").textContent = "BATIR";
  el("conteo").textContent = "Cargando participantes...";
  escuchar(el("sel-evento").value);
});

// ─── Init ───────────────────────────────────────────────────────────────────
async function cargarEventos() {
  const snap = await getDocs(query(collection(db, "eventos"), orderBy("creadoEn", "desc")));
  snap.docs.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.data().nombre || d.id;
    el("sel-evento").appendChild(opt);
  });
}

cargarEventos().catch(e => console.error("Randomizer: eventos:", e));
escuchar("");
window.addEventListener("pagehide", () => cancelarEscucha?.());
