// =============================================
// CONTECS — Sorteo en vivo (para proyectar)
// =============================================
// Misma lista que randomizer.js (participantes con RFID anclado desde
// POSPER), pero pensada para la pantalla grande: cada BATIR hace girar un
// carrete de RFID que va frenando, con sonido y confeti, y revela UN ganador.
// Se repite hasta completar la cantidad de ganadores; quien ya ganó no vuelve
// a entrar en el sorteo hasta "Reiniciar sorteo".
//
// En pantalla solo se muestra nombre, institución y RFID (nada de cédula ni
// correo: esto se proyecta frente al público).

import { db } from "../core/firebase-config.js";
import {
  collection, getDocs, onSnapshot, orderBy, query, where,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { escaparHtml } from "../core/seguridad.js";

const el = id => document.getElementById(id);
const h = escaparHtml;

const DURACION_GIRO_MS = 6500;
const CLAVE_GANADORES = "randomizerint.ganadores";
const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let participantes = [];
let ganadores = [];          // [{ id, nombre, institucion, serial }]
let girando = false;
let sonido = true;
let cancelarEscucha = null;

// ─── Utilidades ─────────────────────────────────────────────────────────────
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

function institucionDe(p) {
  return p.universidad || p.institucion || p.camposExtra?.universidad || p.camposExtra?.empresa || "";
}

function aleatorio(max) {
  // Entero uniforme en [0, max) sin sesgo de módulo.
  const limite = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limite);
  return buf[0] % max;
}

function cantidadObjetivo() {
  return Math.max(1, Math.floor(Number(el("cantidad").value)) || 1);
}

function elegibles() {
  const ya = new Set(ganadores.map(g => g.id));
  return participantes.filter(p => !ya.has(p.id));
}

// La lista de ganadores sobrevive a recargar la página (por si se cae la
// proyección a mitad del sorteo). Es por navegador: no se comparte.
function guardarGanadores() {
  try { localStorage.setItem(CLAVE_GANADORES, JSON.stringify({ evento: el("sel-evento").value, ganadores })); } catch (_) { /* sin almacenamiento */ }
}

function leerGanadores(evento) {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE_GANADORES) || "{}");
    return datos.evento === evento && Array.isArray(datos.ganadores) ? datos.ganadores : [];
  } catch (_) {
    return [];
  }
}

// ─── Sonido (Web Audio, sin archivos) ───────────────────────────────────────
let audio = null;
function ctxAudio() {
  if (!sonido) return null;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    return audio;
  } catch (_) {
    return null;
  }
}

function tono(frecuencia, duracion, { tipo = "square", volumen = 0.05, retraso = 0 } = {}) {
  const ctx = ctxAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + retraso;
  const osc = ctx.createOscillator();
  const gan = ctx.createGain();
  osc.type = tipo;
  osc.frequency.setValueAtTime(frecuencia, t0);
  gan.gain.setValueAtTime(volumen, t0);
  gan.gain.exponentialRampToValueAtTime(0.0001, t0 + duracion);
  osc.connect(gan).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duracion + 0.02);
}

const tick = () => tono(880 + aleatorio(240), 0.035, { volumen: 0.035 });
function fanfarria() {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tono(f, 0.32, { tipo: "triangle", volumen: 0.09, retraso: i * 0.13 }));
  tono(1046.5, 0.9, { tipo: "triangle", volumen: 0.08, retraso: 0.55 });
}

// ─── Confeti ────────────────────────────────────────────────────────────────
const lienzo = el("confeti");
const pincel = lienzo.getContext("2d");
let piezas = [];
let animandoConfeti = false;
const COLORES = ["#ffd34d", "#2f80ed", "#00a651", "#ffffff", "#ff6b6b", "#7ad3ff"];

function ajustarLienzo() {
  lienzo.width = window.innerWidth * devicePixelRatio;
  lienzo.height = window.innerHeight * devicePixelRatio;
}
window.addEventListener("resize", ajustarLienzo);
ajustarLienzo();

function lanzarConfeti() {
  if (reducido) return;
  const W = lienzo.width;
  const H = lienzo.height;
  for (let i = 0; i < 260; i++) {
    const desdeIzq = i % 2 === 0;
    piezas.push({
      x: desdeIzq ? 0 : W,
      y: H * (0.55 + Math.random() * 0.3),
      vx: (desdeIzq ? 1 : -1) * (6 + Math.random() * 14) * devicePixelRatio,
      vy: -(14 + Math.random() * 16) * devicePixelRatio,
      giro: Math.random() * Math.PI,
      vGiro: (Math.random() - 0.5) * 0.4,
      tam: (6 + Math.random() * 8) * devicePixelRatio,
      color: COLORES[i % COLORES.length],
      vida: 0,
    });
  }
  if (!animandoConfeti) requestAnimationFrame(pasoConfeti);
}

function pasoConfeti() {
  animandoConfeti = true;
  pincel.clearRect(0, 0, lienzo.width, lienzo.height);
  const g = 0.45 * devicePixelRatio;
  piezas = piezas.filter(p => p.y < lienzo.height + 40 && p.vida < 420);
  for (const p of piezas) {
    p.vida++;
    p.vx *= 0.985;
    p.vy += g;
    p.x += p.vx;
    p.y += p.vy;
    p.giro += p.vGiro;
    pincel.save();
    pincel.translate(p.x, p.y);
    pincel.rotate(p.giro);
    pincel.fillStyle = p.color;
    pincel.fillRect(-p.tam / 2, -p.tam / 4, p.tam, p.tam / 2);
    pincel.restore();
  }
  if (piezas.length) requestAnimationFrame(pasoConfeti);
  else { animandoConfeti = false; pincel.clearRect(0, 0, lienzo.width, lienzo.height); }
}

// ─── Pantalla ───────────────────────────────────────────────────────────────
function mostrarEnCarrete(p) {
  el("ri-rfid").textContent = p.rfid?.serial || "—";
  el("ri-nombre").textContent = nombreDe(p);
  el("ri-dato").textContent = institucionDe(p);
}

function renderEstado() {
  const n = participantes.length;
  const objetivo = cantidadObjetivo();
  const quedan = elegibles().length;
  const completo = ganadores.length >= objetivo;
  const btn = el("btn-batir");
  btn.disabled = girando || !quedan || completo;
  btn.classList.toggle("listo", !btn.disabled);
  btn.textContent = girando ? "BATIENDO..."
    : completo ? "SORTEO COMPLETO"
    : ganadores.length ? `SIGUIENTE GANADOR (#${ganadores.length + 1})` : "BATIR";

  el("ri-estado").innerHTML = !n
    ? "Todavía nadie tiene un RFID anclado. Se anclan desde POSPER."
    : completo
      ? `Sorteo completo: <strong>${ganadores.length}</strong> ganador${ganadores.length === 1 ? "" : "es"}. Usa "Reiniciar sorteo" para empezar otro.`
      : !quedan
        ? "Ya ganaron todos los participantes con RFID."
        : `<strong>${quedan}</strong> participante${quedan === 1 ? "" : "s"} con RFID en el sorteo · ganador ${ganadores.length + 1} de ${objetivo}`;
}

function renderGanadores() {
  el("ri-ganadores").innerHTML = ganadores.map((g, i) => `
    <div class="ri-g">
      <div class="ri-g-pos">GANADOR #${i + 1}</div>
      <div class="ri-g-nombre">${h(g.nombre)}</div>
      ${g.institucion ? `<div class="ri-g-dato">${h(g.institucion)}</div>` : ""}
      <div class="ri-g-rfid">RFID ${h(g.serial)}</div>
    </div>`).join("");
}

// ─── BATIR ──────────────────────────────────────────────────────────────────
function batir() {
  const lista = elegibles();
  if (girando || !lista.length || ganadores.length >= cantidadObjetivo()) return;
  girando = true;
  const ganador = lista[aleatorio(lista.length)];
  const carrete = el("carrete");
  carrete.classList.remove("ganador");
  carrete.classList.add("girando");
  renderEstado();

  const terminar = () => {
    carrete.classList.remove("girando");
    carrete.classList.add("ganador");
    const registro = {
      id: ganador.id,
      nombre: nombreDe(ganador),
      institucion: institucionDe(ganador),
      serial: ganador.rfid?.serial || "—",
    };
    mostrarEnCarrete(ganador);
    ganadores.push(registro);
    guardarGanadores();
    girando = false;
    fanfarria();
    lanzarConfeti();
    renderGanadores();
    renderEstado();
  };

  if (reducido || lista.length === 1) { terminar(); return; }

  // Cada vuelta tarda un poco más que la anterior: el carrete "frena".
  const inicio = performance.now();
  let anterior = null;
  const vuelta = () => {
    const t = performance.now() - inicio;
    if (t >= DURACION_GIRO_MS) { terminar(); return; }
    let p;
    do { p = lista[aleatorio(lista.length)]; } while (lista.length > 1 && p === anterior);
    anterior = p;
    mostrarEnCarrete(p);
    // Reinicia la animación del salto en cada cambio.
    el("ri-rfid").style.animation = "none";
    void el("ri-rfid").offsetWidth;
    el("ri-rfid").style.animation = "";
    tick();
    const avance = t / DURACION_GIRO_MS;
    setTimeout(vuelta, 45 + 520 * Math.pow(avance, 2.6));
  };
  vuelta();
}

el("btn-batir").addEventListener("click", batir);
document.addEventListener("keydown", e => {
  // Barra espaciadora o Enter = BATIR (cómodo con un control de presentación).
  if ((e.key === " " || e.key === "Enter") && !e.target.closest("input, select, button")) {
    e.preventDefault();
    batir();
  }
});

el("btn-reiniciar").addEventListener("click", () => {
  if (girando) return;
  if (ganadores.length && !confirm("¿Reiniciar el sorteo? Los ganadores actuales vuelven a participar.")) return;
  ganadores = [];
  guardarGanadores();
  el("carrete").classList.remove("ganador", "girando");
  el("ri-rfid").textContent = "• • • •";
  el("ri-nombre").textContent = "¿Quién se lleva el premio?";
  el("ri-dato").textContent = "";
  renderGanadores();
  renderEstado();
});

el("cantidad").addEventListener("input", renderEstado);

el("btn-sonido").addEventListener("click", () => {
  sonido = !sonido;
  el("btn-sonido").textContent = `Sonido: ${sonido ? "sí" : "no"}`;
  el("btn-sonido").setAttribute("aria-pressed", String(sonido));
});

el("btn-pantalla").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => alerta("aviso", "El navegador no permitió la pantalla completa."));
});
document.addEventListener("fullscreenchange", () => {
  el("btn-pantalla").textContent = document.fullscreenElement ? "Salir de pantalla completa" : "Pantalla completa";
});

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
      .filter(p => p.rfid?.serial);
    renderEstado();
  }, e => {
    console.error("Sorteo en vivo:", e);
    alerta("error", "No se pudieron cargar los participantes: " + (e.message || e));
    el("ri-estado").textContent = "Error al cargar.";
  });
}

el("sel-evento").addEventListener("change", () => {
  if (girando) return;
  ganadores = leerGanadores(el("sel-evento").value);
  renderGanadores();
  el("ri-estado").textContent = "Cargando participantes...";
  escuchar(el("sel-evento").value);
});

async function cargarEventos() {
  const snap = await getDocs(query(collection(db, "eventos"), orderBy("creadoEn", "desc")));
  snap.docs
    .filter(d => d.data().estado !== "cancelado")
    .forEach(d => {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.data().nombre || d.id;
      el("sel-evento").appendChild(opt);
    });
}

cargarEventos().catch(e => console.error("Sorteo en vivo: eventos:", e));
ganadores = leerGanadores("");
renderGanadores();
escuchar("");
window.addEventListener("pagehide", () => cancelarEscucha?.());
