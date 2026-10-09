// =============================================
// CONTECS — Módulo Credenciales
// =============================================
// Un solo lugar para imprimir las credenciales de participantes, voluntarios,
// comité organizador y expositores. El dibujo es el de credenciales.js (lo
// mismo que imprime Participantes); quién lleva credencial lo arma
// personas-credenciales.js. Además lleva el control de cuáles se imprimieron
// (colección credenciales_impresas) para no dejar a nadie sin la suya ni
// imprimir dos veces por error.

import { db } from "../core/firebase-config.js";
import {
  collection, doc, getDocs, query, where, orderBy, writeBatch, serverTimestamp, increment,
  addDoc, updateDoc, deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { esperarSesionLista, getUsuarioActual } from "../core/auth.js";
import { escaparAtributo, escaparHtml } from "../core/seguridad.js";
import {
  TAMANOS, medidaImpresa, dibujarCredencial, generarPdf, generarZip, generarPng,
  nombreArchivo, nombreLote, descargarBlob, imprimirPdf, limpiarImpresion, nombreDe, categoriaDe,
} from "./credenciales.js";
import {
  TIPOS, personaParticipante, personaVoluntario, personasExpositores, estadoImpresion, normalizar,
} from "./personas-credenciales.js";
import { leerArchivo, nombrePropio, separarNombreCompleto } from "./importar-participantes.js";
import { esCorreoValido } from "../core/correos.js";
import { cargarLibreria } from "../core/librerias.js";

const el = id => document.getElementById(id);
const h = escaparHtml;

const S = {
  tipo: "participante",
  participantes: [], // datos crudos
  voluntarios: [],
  eventos: [],
  checkpoints: [],
  expositores: [], // agregados a mano (colección expositores)
  evento: "",
  personas: { participante: [], voluntario: [], comite: [], expositor: [] },
  impresas: new Map(), // _clave -> { veces, ultimaEn }
  historialDisponible: true,
  seleccion: { participante: new Set(), voluntario: new Set(), comite: new Set(), expositor: new Set() },
  actual: null, // _clave de la vista previa
  visibles: [],
  tamano: null,
  tarea: null,
  porMarcar: [], // personas generadas que falta confirmar como impresas
};

function alerta(tipo, msg) {
  const div = el("alerta");
  div.className = `alerta alerta-${tipo} show`;
  div.textContent = msg;
  clearTimeout(alerta.t);
  alerta.t = setTimeout(() => div.classList.remove("show"), 6000);
}

// ── Datos ──────────────────────────────────────────────────────────────────
async function leer(consulta, etiqueta) {
  try {
    const snap = await getDocs(consulta);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(`Credenciales: ${etiqueta}:`, err);
    alerta("error", `No se pudieron cargar ${etiqueta}: ${err.message}`);
    return [];
  }
}

async function cargarHistorial() {
  try {
    const snap = await getDocs(collection(db, "credenciales_impresas"));
    S.impresas = new Map(snap.docs.map(d => [d.id, d.data()]));
    S.historialDisponible = true;
  } catch (err) {
    // Sin las reglas desplegadas todavía: se imprime igual, sin historial.
    console.warn("Credenciales: historial no disponible:", err);
    S.historialDisponible = false;
  }
}

async function cargarExpositoresManuales() {
  try {
    const snap = await getDocs(collection(db, "expositores"));
    S.expositores = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("Credenciales: expositores agregados no disponibles:", err);
    S.expositores = [];
  }
}

async function cargarCheckpoints() {
  S.checkpoints = S.evento
    ? await leer(query(collection(db, "checkpoints"), where("eventoId", "==", S.evento)), "las actividades del evento")
    : [];
}

async function cargarTodo() {
  const [participantes, voluntariosDocs, eventos] = await Promise.all([
    leer(collection(db, "participantes"), "los participantes"),
    getDocs(query(collection(db, "voluntarios"), orderBy("creadoEn", "desc")))
      .then(s => s.docs.map(d => ({ _docId: d.id, ...d.data() })))
      .catch(err => { console.error(err); alerta("error", "No se pudieron cargar los voluntarios."); return []; }),
    leer(query(collection(db, "eventos"), orderBy("creadoEn", "desc")), "los eventos"),
    cargarHistorial(),
    cargarExpositoresManuales(),
  ]);
  S.participantes = participantes;
  // En `voluntarios` el campo `id` es la cédula (lo que lleva el QR) y el
  // documento va aparte en _docId.
  S.voluntarios = voluntariosDocs;
  S.eventos = eventos.filter(ev => ev.estado !== "cancelado" && ev.activo !== false);
  S.evento = S.eventos[0]?.id || "";
  el("cr-evento").innerHTML = S.eventos.length
    ? S.eventos.map(ev => `<option value="${escaparAtributo(ev.id)}">${h(ev.nombre || "Evento")}</option>`).join("")
    : `<option value="">Sin eventos activos</option>`;
  await cargarCheckpoints();
  armarPersonasDesdeDocs();
}

// personaVoluntario espera el documento de `voluntarios` con su _docId.
function armarPersonasDesdeDocs() {
  S.personas.participante = S.participantes.map(personaParticipante)
    .sort((a, b) => nombreDe(a).localeCompare(nombreDe(b), "es"));
  const vols = S.voluntarios.map(personaVoluntario)
    .sort((a, b) => nombreDe(a).localeCompare(nombreDe(b), "es"));
  S.personas.voluntario = vols.filter(p => p._tipo === "voluntario");
  S.personas.comite = vols.filter(p => p._tipo === "comite");
  S.personas.expositor = personasExpositores({
    participantes: S.participantes, checkpoints: S.checkpoints, manuales: S.expositores,
  });
  // La selección no guarda a quien ya no está.
  Object.entries(S.seleccion).forEach(([tipo, set]) => {
    const vivas = new Set(S.personas[tipo].map(p => p._clave));
    [...set].forEach(k => { if (!vivas.has(k)) set.delete(k); });
  });
}

// ── Tarjetas por tipo ──────────────────────────────────────────────────────
function cuentaTipo(tipo) {
  const lista = S.personas[tipo].filter(p => p._imprimible && (tipo !== "participante" || p._aprobado));
  const impresas = lista.filter(p => S.impresas.has(p._clave)).length;
  return { total: lista.length, impresas };
}

function renderTipos() {
  el("cr-tipos").innerHTML = Object.entries(TIPOS).map(([tipo, info]) => {
    const { total, impresas } = cuentaTipo(tipo);
    const pct = total ? Math.round(impresas / total * 100) : 0;
    return `<button type="button" class="cr-tipo" role="tab" data-tipo="${tipo}" aria-selected="${tipo === S.tipo}" style="--c:${info.color}">
      <span class="t-cab"><i></i>${h(info.nombre)}</span>
      <span class="t-num">${total}</span>
      <span class="t-barra" aria-hidden="true"><span style="width:${pct}%"></span></span>
      <span class="t-pie">${S.historialDisponible ? `${impresas} de ${total} impresas` : "Historial de impresión no disponible"}${tipo === "participante" ? " · con pago aprobado" : ""}</span>
    </button>`;
  }).join("");
}

el("cr-tipos").addEventListener("click", e => {
  const b = e.target.closest("[data-tipo]");
  if (!b || b.dataset.tipo === S.tipo || S.tarea) return;
  S.tipo = b.dataset.tipo;
  S.actual = null;
  el("cr-buscar").value = "";
  ocultarAviso();
  renderTodo();
});

// ── Lista ──────────────────────────────────────────────────────────────────
function filtrar() {
  const tipo = S.tipo;
  const q = normalizar(el("cr-buscar").value).split(" ").filter(Boolean);
  const estado = el("cr-estado").value;
  const categoria = el("cr-categoria").value;
  const conPendientes = el("cr-no-aprobados").checked;
  return S.personas[tipo].filter(p => {
    if (tipo === "participante" && !conPendientes && !p._aprobado) return false;
    if (tipo === "participante" && categoria && p.categoria !== categoria) return false;
    if (estado === "impresa" && !S.impresas.has(p._clave)) return false;
    if (estado === "pendiente" && S.impresas.has(p._clave)) return false;
    return q.every(t => p._buscar.includes(t));
  });
}

function fechaCorta(ts) {
  const d = ts?.toDate ? ts.toDate() : null;
  return d ? d.toLocaleDateString("es-PA", { day: "numeric", month: "short" }) : "";
}

function renderFiltros() {
  const tipo = S.tipo;
  el("cr-categoria").hidden = tipo !== "participante";
  el("cr-no-aprobados-wrap").hidden = tipo !== "participante";
  el("cr-evento").hidden = tipo !== "expositor";
  el("cr-exp-acciones").hidden = tipo !== "expositor";
  if (tipo === "participante") {
    const cats = new Map(S.participantes.filter(p => p.categoria).map(p => [p.categoria, categoriaDe(p)]));
    const actual = el("cr-categoria").value;
    el("cr-categoria").innerHTML = `<option value="">Todas las categorías</option>` +
      [...cats].sort((a, b) => a[1].localeCompare(b[1], "es"))
        .map(([v, t]) => `<option value="${escaparAtributo(v)}">${h(t)}</option>`).join("");
    el("cr-categoria").value = cats.has(actual) ? actual : "";
  }
  el("cr-estado").disabled = !S.historialDisponible;
}

function renderLista() {
  const info = TIPOS[S.tipo];
  const sel = S.seleccion[S.tipo];
  S.visibles = filtrar();
  const imprimibles = S.visibles.filter(p => p._imprimible);
  const marcadas = imprimibles.filter(p => sel.has(p._clave)).length;
  el("cr-todos").checked = !!imprimibles.length && marcadas === imprimibles.length;
  el("cr-todos").indeterminate = marcadas > 0 && marcadas < imprimibles.length;
  el("cr-todos-txt").textContent = `Seleccionar las ${imprimibles.length} de la lista`;
  el("cr-sel-num").textContent = `${sel.size} seleccionada${sel.size !== 1 ? "s" : ""}`;

  if (!S.visibles.length) {
    const vacio = S.personas[S.tipo].length
      ? "Nadie coincide con la búsqueda o los filtros."
      : {
        participante: "Todavía no hay participantes.",
        voluntario: "No hay voluntarios registrados. Se importan en Voluntariado → Voluntarios → Importar.",
        comite: "Nadie está marcado como comité organizador. Se marca en Voluntariado → Voluntarios (columna Grupo) o con la columna Grupo al importar.",
        expositor: "No hay expositores: se toman de los participantes que marcaron ponencia y de los exponentes de las actividades del evento elegido.",
      }[S.tipo];
    el("cr-items").innerHTML = `<li class="cr-vacio">${h(vacio)}</li>`;
    return;
  }

  // Los seleccionados primero, para ver de un vistazo lo que se va a imprimir.
  const orden = [...S.visibles].sort((a, b) => Number(sel.has(b._clave)) - Number(sel.has(a._clave)));
  el("cr-items").innerHTML = orden.map(p => {
    const est = estadoImpresion(p, S.impresas);
    const chip = !p._imprimible
      ? `<span class="cr-estado sin-qr" title="${escaparAtributo(p._aviso || "Sin datos para el QR")}">Sin QR</span>`
      : !S.historialDisponible ? ""
        : est.impresa
          ? `<span class="cr-estado impresa" title="Última: ${escaparAtributo(fechaCorta(est.ultima))}">Impresa${est.veces > 1 ? ` · ${est.veces}×` : ""}</span>`
          : `<span class="cr-estado pendiente">Pendiente</span>`;
    const acciones = p._origen === "manual"
      ? `<span class="i-acciones"><button type="button" class="i-acc" data-editar="${escaparAtributo(p._doc.id)}" title="Editar" aria-label="Editar a ${escaparAtributo(nombreDe(p))}">✎</button><button type="button" class="i-acc quitar" data-quitar="${escaparAtributo(p._doc.id)}" title="Quitar" aria-label="Quitar a ${escaparAtributo(nombreDe(p))}">&times;</button></span>`
      : "";
    return `<li class="cr-item${acciones ? " con-acciones" : ""}${p._clave === S.actual ? " actual" : ""}${p._imprimible ? "" : " no-imprimible"}" data-clave="${escaparAtributo(p._clave)}" style="--c:${info.color}">
      <input type="checkbox" value="${escaparAtributo(p._clave)}" ${sel.has(p._clave) ? "checked" : ""} ${p._imprimible ? "" : "disabled"} aria-label="Seleccionar a ${escaparAtributo(nombreDe(p))}"/>
      <span style="min-width:0;"><span class="i-nombre" style="display:block;">${h(nombreDe(p))}</span><span class="i-sub" style="display:block;">${h(p._aviso || p._sub || "")}</span></span>
      ${chip}${acciones}
    </li>`;
  }).join("");
}

el("cr-items").addEventListener("click", e => {
  const editar = e.target.closest("[data-editar]");
  const quitar = e.target.closest("[data-quitar]");
  if (editar) { abrirExpositor(S.expositores.find(x => x.id === editar.dataset.editar)); return; }
  if (quitar) { quitarExpositor(S.expositores.find(x => x.id === quitar.dataset.quitar)); return; }
  const li = e.target.closest("[data-clave]");
  if (!li || S.tarea) return;
  const clave = li.dataset.clave;
  const p = S.personas[S.tipo].find(x => x._clave === clave);
  if (!p) return;
  if (e.target.matches("input[type=checkbox]")) {
    const sel = S.seleccion[S.tipo];
    if (e.target.checked) sel.add(clave); else sel.delete(clave);
  }
  S.actual = clave;
  renderLista();
  el("cr-items").querySelector(`[data-clave="${CSS.escape(clave)}"] input`)?.focus({ preventScroll: true });
  renderPreview();
  actualizarBotones();
});

el("cr-todos").addEventListener("change", e => {
  const sel = S.seleccion[S.tipo];
  S.visibles.filter(p => p._imprimible).forEach(p => (e.target.checked ? sel.add(p._clave) : sel.delete(p._clave)));
  renderLista();
  renderPreview();
  actualizarBotones();
});

el("cr-limpiar").addEventListener("click", () => {
  S.seleccion[S.tipo].clear();
  renderLista();
  renderPreview();
  actualizarBotones();
});

["cr-buscar", "cr-estado", "cr-categoria", "cr-no-aprobados"].forEach(id =>
  el(id).addEventListener(id === "cr-buscar" ? "input" : "change", () => {
    if (id === "cr-no-aprobados" && !el(id).checked) {
      // Al ocultar los pendientes de pago también salen de la selección.
      S.personas.participante.filter(p => !p._aprobado).forEach(p => S.seleccion.participante.delete(p._clave));
    }
    renderLista();
    renderPreview();
    actualizarBotones();
  }));

el("cr-evento").addEventListener("change", async () => {
  S.evento = el("cr-evento").value;
  await cargarCheckpoints();
  armarPersonasDesdeDocs();
  renderTodo();
});

// ── Vista previa ───────────────────────────────────────────────────────────
let secuenciaPreview = 0;
function seleccionadas() {
  const sel = S.seleccion[S.tipo];
  return S.personas[S.tipo].filter(p => p._imprimible && sel.has(p._clave));
}

async function renderPreview() {
  const n = ++secuenciaPreview;
  const lista = S.personas[S.tipo];
  const p = lista.find(x => x._clave === S.actual && x._imprimible) || seleccionadas()[0] || S.visibles.find(x => x._imprimible);
  const caja = el("cr-preview");
  if (!p || !S.tamano) {
    caja.innerHTML = `<div class="cr-vacio">${lista.length ? "Elige a alguien de la lista para ver su credencial." : "No hay credenciales de este tipo todavía."}</div>`;
    el("cr-preview-txt").textContent = "";
    return;
  }
  try {
    const lienzo = await dibujarCredencial(p, S.tamano, { dpi: 150 });
    if (n !== secuenciaPreview) return;
    lienzo.setAttribute("role", "img");
    lienzo.setAttribute("aria-label", `Vista previa de la credencial de ${nombreDe(p)}`);
    caja.classList.toggle("doblada", !!S.tamano.doblez);
    caja.replaceChildren(lienzo);
    const { ancho, alto } = medidaImpresa(S.tamano);
    el("cr-preview-txt").textContent = `${nombreDe(p)} · ${ancho} × ${alto} mm${S.tamano.doblez ? " · se dobla en dos caras" : ""}`;
  } catch (err) {
    console.error(err);
    caja.innerHTML = `<div class="cr-vacio">No se pudo dibujar la vista previa.</div>`;
  }
}

// ── Tamaño y acciones ──────────────────────────────────────────────────────
el("cr-tamano").innerHTML = Object.entries(TAMANOS)
  .map(([clave, t]) => `<option value="${clave}">${h(t.nombre)}</option>`).join("");
const leerTamano = () => { S.tamano = TAMANOS[el("cr-tamano").value] || null; };
el("cr-tamano").addEventListener("change", () => { leerTamano(); renderPreview(); });
leerTamano();

const formato = () => document.querySelector("input[name=cr-formato]:checked")?.value || "pdf";

function actualizarBotones() {
  const n = seleccionadas().length;
  el("cr-imprimir").disabled = !n || !!S.tarea;
  el("cr-descargar").disabled = !n || !!S.tarea;
  el("cr-imprimir").textContent = n ? `Imprimir ${n}` : "Imprimir";
  el("cr-descargar").textContent = n ? `Descargar ${n}` : "Descargar";
}

async function ejecutarTarea(total, etiqueta, trabajo) {
  const tarea = { cancelado: false };
  S.tarea = tarea;
  ocultarAviso();
  actualizarBotones();
  el("cr-progreso").hidden = false;
  const alProgresar = hechos => {
    el("cr-barra").style.width = `${Math.round(hechos / total * 100)}%`;
    el("cr-progreso-txt").textContent = `${etiqueta} ${hechos} de ${total}…`;
  };
  alProgresar(0);
  let ok = false;
  try {
    await trabajo({ alProgresar, cancelado: () => tarea.cancelado });
    ok = true;
  } catch (err) {
    if (err?.name !== "AbortError") {
      console.error(err);
      alerta("error", "No se pudieron generar las credenciales: " + err.message);
    }
  } finally {
    S.tarea = null;
    el("cr-progreso").hidden = true;
    el("cr-barra").style.width = "0%";
    actualizarBotones();
  }
  return ok;
}

el("cr-cancelar").addEventListener("click", () => { if (S.tarea) S.tarea.cancelado = true; });

el("cr-descargar").addEventListener("click", async () => {
  const lista = seleccionadas();
  if (!lista.length || !S.tamano) return;
  const fmt = formato();
  const ok = await ejecutarTarea(lista.length, "Generando", async control => {
    if (lista.length === 1) {
      const blob = fmt === "png" ? await generarPng(lista[0], S.tamano) : await generarPdf(lista, S.tamano, control);
      descargarBlob(blob, nombreArchivo(lista[0], fmt));
    } else if (fmt === "pdf") {
      descargarBlob(await generarPdf(lista, S.tamano, control), nombreLote("pdf", S.tipo));
    } else {
      descargarBlob(await generarZip(lista, S.tamano, "png", control), nombreLote("zip", `${S.tipo}_png`));
    }
  });
  if (ok) preguntarSiSeImprimieron(lista, "descargaste");
});

el("cr-imprimir").addEventListener("click", async () => {
  const lista = seleccionadas();
  if (!lista.length || !S.tamano) return;
  const ok = await ejecutarTarea(lista.length, "Preparando", async control => {
    const pdf = await generarPdf(lista, S.tamano, control);
    try {
      await imprimirPdf(pdf);
    } catch (err) {
      // Algunos navegadores no dejan imprimir un PDF dentro de un iframe.
      console.warn(err);
      descargarBlob(pdf, nombreLote("pdf", S.tipo));
      alerta("aviso", "El navegador no abrió el diálogo de impresión: se descargó el PDF para imprimirlo desde tu visor.");
    }
  });
  if (ok) preguntarSiSeImprimieron(lista, "mandaste a imprimir");
});

// ── Historial de impresión ─────────────────────────────────────────────────
// Imprimir no confirma que la credencial salió bien (papel, impresora...):
// se pregunta, y solo lo confirmado cuenta como impresa.
function preguntarSiSeImprimieron(lista, accion) {
  if (!S.historialDisponible) return;
  S.porMarcar = lista;
  el("cr-aviso-txt").textContent = `¿Salieron bien las ${lista.length} credencial${lista.length !== 1 ? "es" : ""} que ${accion}? Márcalas para llevar la cuenta de lo impreso.`;
  el("cr-aviso").hidden = false;
}

function ocultarAviso() {
  el("cr-aviso").hidden = true;
  S.porMarcar = [];
}

el("cr-aviso-no").addEventListener("click", ocultarAviso);
el("cr-aviso-si").addEventListener("click", async () => {
  const lista = S.porMarcar;
  if (!lista.length) return;
  el("cr-aviso-si").disabled = true;
  const uid = getUsuarioActual().uid;
  try {
    for (let i = 0; i < lista.length; i += 400) {
      const batch = writeBatch(db);
      lista.slice(i, i + 400).forEach(p => {
        const previo = S.impresas.get(p._clave);
        batch.set(doc(db, "credenciales_impresas", p._clave), {
          tipo: p._tipo,
          nombre: nombreDe(p).slice(0, 200),
          veces: previo ? increment(1) : 1,
          ...(previo ? {} : { primeraEn: serverTimestamp() }),
          ultimaEn: serverTimestamp(),
          ultimaPor: uid,
        }, { merge: true });
      });
      await batch.commit();
    }
    await cargarHistorial();
    // Lo ya impreso sale de la selección: lo que queda marcado es lo pendiente.
    lista.forEach(p => S.seleccion[S.tipo].delete(p._clave));
    alerta("success", `${lista.length} credencial${lista.length !== 1 ? "es" : ""} marcada${lista.length !== 1 ? "s" : ""} como impresa${lista.length !== 1 ? "s" : ""}.`);
    ocultarAviso();
    renderTodo();
  } catch (err) {
    console.error(err);
    alerta("error", "No se pudo guardar el historial: " + err.message);
  } finally {
    el("cr-aviso-si").disabled = false;
  }
});

// ── Expositores agregados a mano ───────────────────────────────────────────
// Para quien expone y no se inscribió como participante. Se guardan en
// `expositores` (firestore.rules: solo con el módulo Credenciales).
const dlgExp = el("dlg-exp");
let editandoExp = null;

function abrirExpositor(exp = null) {
  editandoExp = exp;
  el("exp-titulo").textContent = exp ? "Editar expositor" : "Agregar expositor";
  ["nombre", "apellido", "institucion", "tema", "cedula", "correo"].forEach(c => { el(`exp-${c}`).value = exp?.[c] || ""; });
  el("exp-error").hidden = true;
  dlgExp.showModal();
  setTimeout(() => el("exp-nombre").focus(), 30);
}

async function refrescarExpositores() {
  await cargarExpositoresManuales();
  armarPersonasDesdeDocs();
  renderTodo();
}

el("exp-form").addEventListener("submit", async e => {
  e.preventDefault();
  const datos = {
    nombre: nombrePropio(el("exp-nombre").value.trim()),
    apellido: nombrePropio(el("exp-apellido").value.trim()),
    institucion: el("exp-institucion").value.trim(),
    tema: el("exp-tema").value.trim(),
    cedula: el("exp-cedula").value.trim().toUpperCase(),
    correo: el("exp-correo").value.trim().toLowerCase(),
  };
  const error = !datos.nombre ? "Escribe el nombre."
    : datos.correo && !esCorreoValido(datos.correo) ? "El correo no es válido."
      : [datos.nombre, datos.apellido, datos.institucion, datos.tema].some(t => /[<>]/.test(t)) ? "No uses los caracteres < o >." : "";
  if (error) { el("exp-error").textContent = error; el("exp-error").hidden = false; return; }
  el("exp-guardar").disabled = true;
  try {
    if (editandoExp) {
      await updateDoc(doc(db, "expositores", editandoExp.id), { ...datos, actualizadoEn: serverTimestamp() });
    } else {
      await addDoc(collection(db, "expositores"), { ...datos, creadoPor: getUsuarioActual().uid, creadoEn: serverTimestamp() });
    }
    dlgExp.close();
    alerta("success", `${datos.nombre} ${datos.apellido}`.trim() + (editandoExp ? " actualizado." : " agregado a los expositores."));
    await refrescarExpositores();
  } catch (err) {
    el("exp-error").textContent = "No se pudo guardar: " + err.message;
    el("exp-error").hidden = false;
  } finally {
    el("exp-guardar").disabled = false;
  }
});

async function quitarExpositor(exp) {
  if (!exp) return;
  const nombre = `${exp.nombre} ${exp.apellido || ""}`.trim();
  if (!confirm(`¿Quitar a ${nombre} de los expositores? Su credencial ya impresa no se ve afectada.`)) return;
  try {
    await deleteDoc(doc(db, "expositores", exp.id));
    alerta("success", `${nombre} ya no está en los expositores.`);
    await refrescarExpositores();
  } catch (err) {
    alerta("error", "No se pudo quitar: " + err.message);
  }
}

// Importar desde Excel: columnas reconocidas por su título.
const dlgImp = el("dlg-exp-imp");
const impExp = { filas: [] };
const COLUMNAS_EXP = [
  ["correo", h => /\b(correo|email|e mail|mail)\b/.test(h)],
  ["cedula", h => /\b(cedula|pasaporte|identificacion|documento|id)\b/.test(h)],
  ["institucion", h => /\b(institucion|empresa|organizacion|universidad|procedencia)\b/.test(h)],
  ["tema", h => /\b(tema|charla|ponencia|titulo|conferencia)\b/.test(h)],
  ["nombreCompleto", h => /\bnombres?\b/.test(h) && /\bapellidos?\b/.test(h)],
  ["nombreCompleto", h => /\b(nombre completo|expositor|ponente)\b/.test(h)],
  ["apellido", h => /\bapellidos?\b/.test(h)],
  ["nombre", h => /\bnombres?\b/.test(h)],
];
const normCol = t => normalizar(t).replace(/[^a-z0-9]+/g, " ").trim();
function columnasExp(encabezados) {
  const usados = new Set();
  return encabezados.map(t => {
    const hdr = normCol(t);
    const destino = hdr ? COLUMNAS_EXP.find(([, ok]) => ok(hdr))?.[0] || "" : "";
    if (!destino || usados.has(destino)) return "";
    usados.add(destino);
    return destino;
  });
}

async function leerExcelExpositores(archivo) {
  el("expi-error").hidden = true;
  try {
    const [hoja] = await leerArchivo(archivo);
    if (!hoja) throw new Error("no tiene datos");
    // La fila de títulos es, entre las 10 primeras, la que más reconoce.
    let enc = 0, mejor = 0;
    hoja.filas.slice(0, 10).forEach((f, i) => { const n = columnasExp(f).filter(Boolean).length; if (n > mejor) { mejor = n; enc = i; } });
    const cols = columnasExp(hoja.filas[enc] || []);
    if (!cols.includes("nombre") && !cols.includes("nombreCompleto")) throw new Error("no encontré una columna de nombre");
    const ya = new Set(S.expositores.map(x => normalizar(`${x.nombre} ${x.apellido || ""}`)));
    const vistos = new Map();
    impExp.filas = hoja.filas.slice(enc + 1).flatMap((celdas, i) => {
      if (!celdas.some(Boolean)) return [];
      const v = c => { const k = cols.indexOf(c); return k === -1 ? "" : String(celdas[k] || "").trim(); };
      let nombre = nombrePropio(v("nombre")), apellido = nombrePropio(v("apellido"));
      if (!cols.includes("nombre") && cols.includes("nombreCompleto")) {
        ({ nombre, apellido } = separarNombreCompleto(nombrePropio(v("nombreCompleto"))));
        if (v("apellido")) apellido = nombrePropio(v("apellido"));
      }
      const fila = {
        fila: hoja.primeraFila + enc + i + 1, nombre, apellido,
        institucion: v("institucion"), tema: v("tema"), cedula: v("cedula").toUpperCase(), correo: v("correo").toLowerCase(),
      };
      const clave = normalizar(`${nombre} ${apellido}`);
      fila.error = !nombre ? "Falta el nombre"
        : fila.correo && !esCorreoValido(fila.correo) ? "Correo no válido"
          : [nombre, apellido, fila.institucion, fila.tema].some(t => /[<>]/.test(t)) ? "Tiene < o >"
            : ya.has(clave) ? "Ya está agregado"
              : vistos.has(clave) ? `Repite la fila ${vistos.get(clave)}` : "";
      if (!fila.error) vistos.set(clave, fila.fila);
      return [fila];
    });
    const buenas = impExp.filas.filter(f => !f.error);
    el("expi-resumen").textContent = `${buenas.length} para importar · ${impExp.filas.length - buenas.length} con errores (no se importan).`;
    el("expi-filas").innerHTML = impExp.filas.map(f => `<tr class="${f.error ? "error" : ""}">
      <td>${f.fila}</td><td>${h(`${f.nombre} ${f.apellido}`.trim() || "—")}</td><td>${h(f.institucion || "—")}</td>
      <td>${h(f.tema || "—")}</td><td>${h(f.error || "Lista")}</td></tr>`).join("");
    el("expi-revision").hidden = false;
    el("expi-importar").disabled = !buenas.length;
    el("expi-importar").textContent = `Importar ${buenas.length}`;
  } catch (err) {
    el("expi-error").textContent = `No se pudo leer "${archivo.name}": ${err.message}.`;
    el("expi-error").hidden = false;
    el("expi-revision").hidden = true;
    el("expi-importar").disabled = true;
  }
}

el("expi-importar").addEventListener("click", async () => {
  const buenas = impExp.filas.filter(f => !f.error);
  if (!buenas.length) return;
  el("expi-importar").disabled = true;
  const lote = `exp_${Date.now().toString(36)}`;
  const uid = getUsuarioActual().uid;
  try {
    for (let i = 0; i < buenas.length; i += 400) {
      const batch = writeBatch(db);
      buenas.slice(i, i + 400).forEach(({ nombre, apellido, institucion, tema, cedula, correo }) =>
        batch.set(doc(collection(db, "expositores")), {
          nombre, apellido, institucion, tema, cedula, correo, lote, creadoPor: uid, creadoEn: serverTimestamp(),
        }));
      await batch.commit();
    }
    dlgImp.close();
    alerta("success", `${buenas.length} expositor${buenas.length !== 1 ? "es" : ""} importado${buenas.length !== 1 ? "s" : ""}.`);
    await refrescarExpositores();
  } catch (err) {
    el("expi-error").textContent = "No se pudo importar: " + err.message;
    el("expi-error").hidden = false;
    el("expi-importar").disabled = false;
  }
});

el("expi-plantilla").addEventListener("click", async () => {
  const XLSX = await cargarLibreria("XLSX", "xlsx.full.min.js");
  const columnas = ["Nombre", "Apellido", "Institución", "Tema de la charla", "Cédula", "Correo"];
  const hoja = XLSX.utils.aoa_to_sheet([columnas]);
  hoja["!cols"] = columnas.map(c => ({ wch: Math.max(16, c.length + 8) }));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Expositores");
  XLSX.writeFile(libro, "CONTECS_plantilla_expositores.xlsx");
});

el("cr-exp-agregar").addEventListener("click", () => abrirExpositor());
el("cr-exp-importar").addEventListener("click", () => {
  impExp.filas = [];
  el("expi-archivo").value = "";
  el("expi-error").hidden = true;
  el("expi-revision").hidden = true;
  el("expi-importar").disabled = true;
  el("expi-importar").textContent = "Importar";
  dlgImp.showModal();
});
el("expi-archivo").addEventListener("change", e => e.target.files[0] && leerExcelExpositores(e.target.files[0]));
const dropExp = el("expi-drop");
dropExp.addEventListener("dragover", e => { e.preventDefault(); dropExp.classList.add("encima"); });
dropExp.addEventListener("dragleave", () => dropExp.classList.remove("encima"));
dropExp.addEventListener("drop", e => { e.preventDefault(); dropExp.classList.remove("encima"); if (e.dataTransfer.files[0]) leerExcelExpositores(e.dataTransfer.files[0]); });
document.querySelectorAll("[data-cerrar]").forEach(b => b.addEventListener("click", () => b.closest("dialog")?.close()));

// ── Inicio ─────────────────────────────────────────────────────────────────
function renderTodo() {
  renderTipos();
  renderFiltros();
  renderLista();
  renderPreview();
  actualizarBotones();
  el("cr-nota").textContent = S.historialDisponible
    ? "Los voluntarios y el comité llevan su cédula en el QR: es la que lee Lectura QR de voluntarios para marcar sus horas. Los expositores inscritos llevan su QR de acceso; los que no están inscritos, lo que exponen."
    : "El historial de impresión todavía no está disponible (faltan las reglas de Firestore). Puedes imprimir igual.";
}

async function iniciar() {
  await esperarSesionLista();
  await cargarTodo();
  renderTodo();
}

iniciar().catch(err => {
  console.error("Credenciales:", err);
  el("cr-preview").innerHTML = `<div class="cr-vacio">No se pudo cargar el módulo. Recarga la página.</div>`;
});
window.addEventListener("pagehide", limpiarImpresion);
