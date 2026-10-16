// =============================================
// CONTECS — Módulo Credenciales
// =============================================
// Un solo lugar para imprimir las credenciales de participantes, voluntarios,
// comité organizador y expositores. El dibujo es el de credenciales.js (lo
// mismo que imprime Participantes); quién lleva credencial lo arma
// personas-credenciales.js. Además lleva el control de cuáles se imprimieron
// (colección credenciales_impresas) para no dejar a nadie sin la suya ni
// imprimir dos veces por error.

import { app, db } from "../core/firebase-config.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js";
import {
  collection, doc, getDocs, query, where, orderBy, writeBatch, serverTimestamp, increment,
  addDoc, updateDoc, deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { esperarSesionLista, getUsuarioActual } from "../core/auth.js";
import { escaparAtributo, escaparHtml, neutralizarFormulaHoja } from "../core/seguridad.js";
import {
  TAMANOS, medidaImpresa, dibujarCredencial, generarPdf, generarZip, generarPng,
  nombreArchivo, nombreLote, descargarBlob, imprimirPdf, imprimirHtml, limpiarImpresion, nombreDe, categoriaDe,
} from "./credenciales.js";
import {
  TIPOS, personaParticipante, personaVoluntario, personasExpositores, estadoImpresion, normalizar,
  inicialDe, gruposEquilibrados, cedulaDe, partesCedula,
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
  agrupar: "letra", // letra | nombre | cedula (grupos parejos para la entrega)
  nGrupos: 4,
  bloque: "", // letra o número de grupo elegido ("" = todas)
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

// El QR del personal abre su perfil con un token que crea el servidor
// (functions/personal.js). Si falta alguno se pide antes de armar las
// credenciales; si la función no responde, esas credenciales llevan la
// cédula en el QR, como antes, y Lectura QR las sigue leyendo.
async function asegurarTokensPersonal() {
  if (!S.voluntarios.some(v => !v.token)) return;
  try {
    const fn = httpsCallable(getFunctions(app, "us-central1"), "asegurarTokensPersonal");
    const { data } = await fn();
    S.voluntarios.forEach(v => { if (data.tokens?.[v._docId]) v.token = data.tokens[v._docId]; });
  } catch (err) {
    console.warn("Credenciales: tokens del personal no disponibles:", err);
    alerta("warning", "No se pudieron preparar los enlaces de perfil del personal: sus QR llevan solo la cédula.");
  }
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
  await asegurarTokensPersonal();
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
  S.bloque = "";
  el("cr-buscar").value = "";
  ocultarAviso();
  renderTodo();
});

// ── Lista ──────────────────────────────────────────────────────────────────
// Para imprimir y entregar por bloques: una letra a la vez, o toda la lista
// partida en N grupos parejos por nombre o por cédula (uno por mesa).
const ordenLetras = (a, b) => (a === "#") - (b === "#") || a.localeCompare(b, "es");

const botonBloque = (valor, contenido, n) =>
  `<button type="button" class="cr-letra" data-bloque="${escaparAtributo(valor)}" aria-pressed="${S.bloque === valor}" title="${n} persona${n !== 1 ? "s" : ""}">${contenido}</button>`;

function renderLetras(base) {
  const cuenta = new Map();
  base.forEach(p => { const l = inicialDe(p); cuenta.set(l, (cuenta.get(l) || 0) + 1); });
  const letras = [...cuenta.keys()].sort(ordenLetras);
  el("cr-letras").innerHTML = botonBloque("", "Todas", base.length) +
    letras.map(l => botonBloque(l, h(l), cuenta.get(l))).join("");
}

// Los grupos salen de todos los que llevan credencial de este tipo, no de la
// búsqueda ni del estado: así no se mueven al marcar impresas ni al buscar.
let memoGrupos = null;
function gruposDelTipo() {
  const conPendientes = el("cr-no-aprobados").checked;
  const clave = `${S.tipo}|${S.nGrupos}|${conPendientes}`;
  if (memoGrupos?.clave !== clave || memoGrupos.personas !== S.personas[S.tipo]) {
    const poblacion = S.personas[S.tipo].filter(p => p._imprimible && (S.tipo !== "participante" || conPendientes || p._aprobado));
    memoGrupos = {
      clave, personas: S.personas[S.tipo], total: poblacion.length,
      sinCedula: poblacion.filter(p => !partesCedula(cedulaDe(p))).length,
      nombre: gruposEquilibrados(poblacion, "nombre", S.nGrupos),
      cedula: gruposEquilibrados(poblacion, "cedula", S.nGrupos),
    };
  }
  return memoGrupos;
}

// Con los dos métodos a la vista se decide cuál deja las mesas más parejas.
function textoComparacion(todos) {
  if (!todos.total) return "Nadie de este tipo tiene credencial para repartir todavía.";
  const tam = r => r.grupos.map(g => g.personas.length);
  const dif = r => Math.max(...tam(r)) - Math.min(...tam(r));
  const linea = (nombre, r) => `por ${nombre}: ${tam(r).join(" · ")} (diferencia de ${dif(r)}` +
    `${r.grupos.length < S.nGrupos ? `; solo alcanza para ${r.grupos.length} grupo${r.grupos.length !== 1 ? "s" : ""}` : ""})`;
  const [ced, nom] = [todos.cedula, todos.nombre];
  const mejor = ced.grupos.length !== nom.grupos.length ? (ced.grupos.length > nom.grupos.length ? "cedula" : "nombre")
    : dif(ced) === dif(nom) ? "" : dif(ced) < dif(nom) ? "cedula" : "nombre";
  return `Con ${S.nGrupos} grupos para ${todos.total} personas (≈${Math.round(todos.total / S.nGrupos)} por mesa) — ` +
    `${h(linea("cédula", ced))} · ${h(linea("nombre", nom))}. ` +
    (mejor ? `<b>Queda más parejo por ${mejor === "cedula" ? "cédula" : "nombre"}.</b>` : "<b>Los dos quedan igual de parejos.</b>") +
    (todos.sinCedula ? ` ${todos.sinCedula} sin cédula panameña (pasaporte, mal escrita o vacía) van al último grupo por cédula.` : "");
}

function renderGrupos() {
  const todos = gruposDelTipo();
  const { grupos } = todos[S.agrupar];
  el("cr-letras").innerHTML = botonBloque("", "Todas", todos.total) + grupos.map((g, i) =>
    botonBloque(String(i), `<b>${i + 1}</b> ${h(g.etiqueta)}<span class="g-n">${g.personas.length}</span>`, g.personas.length)).join("");
  el("cr-comparar").innerHTML = textoComparacion(todos);
}

// Por cédula, la lista y el PDF salen en orden de cédula: la pila impresa
// llega a la mesa ya ordenada.
function ordenEntrega(lista) {
  if (S.agrupar !== "cedula") return lista;
  const pos = gruposDelTipo().cedula.posicion;
  return [...lista].sort((a, b) => (pos.get(a._clave) ?? pos.size) - (pos.get(b._clave) ?? pos.size));
}

function alCambiarBloque() {
  renderLista();
  renderPreview();
  actualizarBotones();
}

el("cr-letras").addEventListener("click", e => {
  const b = e.target.closest("[data-bloque]");
  if (!b || S.tarea) return;
  S.bloque = b.dataset.bloque;
  alCambiarBloque();
});

el("cr-agrupar").addEventListener("change", () => {
  S.agrupar = el("cr-agrupar").value;
  S.bloque = "";
  alCambiarBloque();
});

el("cr-ngrupos").addEventListener("change", () => {
  const n = Math.round(Number(el("cr-ngrupos").value));
  S.nGrupos = Math.min(30, Math.max(2, Number.isFinite(n) ? n : 4));
  el("cr-ngrupos").value = S.nGrupos;
  S.bloque = "";
  alCambiarBloque();
});

function filtrar() {
  const base = filtrarSinLetra();
  const enGrupos = S.agrupar !== "letra";
  el("cr-agrupa").hidden = !S.personas[S.tipo].length;
  el("cr-ngrupos-wrap").hidden = !enGrupos;
  el("cr-comparar").hidden = !enGrupos;
  if (!enGrupos) {
    // Si la letra elegida ya no tiene a nadie con los otros filtros, vuelve a todas.
    if (S.bloque && !base.some(p => inicialDe(p) === S.bloque)) S.bloque = "";
    renderLetras(base);
    return S.bloque ? base.filter(p => inicialDe(p) === S.bloque) : base;
  }
  const { grupos, grupoDe } = gruposDelTipo()[S.agrupar];
  if (S.bloque && !grupos[Number(S.bloque)]) S.bloque = "";
  renderGrupos();
  return ordenEntrega(S.bloque ? base.filter(p => grupoDe.get(p._clave) === Number(S.bloque)) : base);
}

// ── Listas para la entrega ─────────────────────────────────────────────────
// La hoja que va en cada mesa: nombre, cédula y casillas de entregada y
// firma. Sale de lo que se ve arriba: el modo (letra o grupos), la letra o el
// grupo elegido ("Todas" = una sección por letra o una hoja por grupo) y los
// filtros de búsqueda, estado y categoría. Solo entra quien lleva credencial.
function seccionesLista() {
  const base = filtrarSinLetra().filter(p => p._imprimible);
  if (S.agrupar === "letra") {
    const letras = S.bloque ? [S.bloque] : [...new Set(base.map(inicialDe))].sort(ordenLetras);
    return letras.map(l => ({
      titulo: l === "#" ? "Nombres que no empiezan con letra" : `Letra ${l}`,
      corto: l,
      personas: base.filter(p => inicialDe(p) === l),
    }));
  }
  const enBase = new Set(base.map(p => p._clave));
  const que = S.agrupar === "cedula" ? "cédulas" : "nombres";
  return gruposDelTipo()[S.agrupar].grupos
    .map((g, i) => ({
      i, titulo: `Grupo ${i + 1} — ${que} ${g.etiqueta}`, corto: `${i + 1} — ${g.etiqueta}`,
      personas: g.personas.filter(p => enBase.has(p._clave)),
    }))
    .filter(s => S.bloque === "" || s.i === Number(S.bloque));
}

// Lo que lleva cada fila de la lista, impresa o en Excel.
// El código es el del participante (también el expositor inscrito); el
// personal no tiene, su cred.codigo es la cédula.
function datosLista(p) {
  const cedula = cedulaDe(p);
  const codigo = String(p.codigo || "").trim();
  // _sub ya trae el código (participantes) o la cédula (voluntarios): no se repiten.
  const detalle = (p._sub || "").split(" · ").filter(x => x && x !== cedula && x !== codigo).join(" · ");
  return { nombre: nombreDe(p), cedula, codigo, detalle };
}

function sufijoLista() {
  const bloque = !S.bloque ? "" : S.agrupar === "letra" ? `_letra_${S.bloque}` : `_grupo_${Number(S.bloque) + 1}`;
  return `lista_${S.tipo}_${S.agrupar}${bloque}`;
}

function textoFiltros() {
  const opcion = id => el(id).value ? el(id).selectedOptions[0]?.text : "";
  const buscar = el("cr-buscar").value.trim();
  return [
    opcion("cr-estado"),
    S.tipo === "participante" && opcion("cr-categoria"),
    ...FILTROS_UTP.map(f => !el(f.id).hidden && opcion(f.id).replace(/ \(\d+\)$/, "")),
    S.tipo === "participante" && el("cr-no-aprobados").checked && "incluye pagos no aprobados",
    S.tipo === "expositor" && opcion("cr-evento"),
    buscar && `búsqueda «${buscar}»`,
  ].filter(Boolean);
}

function htmlListas(secciones) {
  const info = TIPOS[S.tipo];
  const total = secciones.reduce((s, x) => s + x.personas.length, 0);
  const grupos = S.agrupar === "letra" ? 0 : gruposDelTipo()[S.agrupar].grupos.length;
  const modo = S.agrupar === "letra" ? "Por letra inicial del nombre"
    : `Grupos por ${S.agrupar === "cedula" ? "cédula" : "nombre"} (${grupos} en total)`;
  const filtros = textoFiltros();
  const fecha = new Date().toLocaleString("es-PA", { dateStyle: "medium", timeStyle: "short" });
  const plural = n => `${n} persona${n !== 1 ? "s" : ""}`;
  const fila = (p, n) => {
    const d = datosLista(p);
    return `<tr><td class="n">${n}</td><td>${h(d.nombre)}</td><td>${h(d.cedula || "—")}</td><td>${h([d.codigo, d.detalle].filter(Boolean).join(" · "))}</td><td class="ok"><span class="caja"></span></td><td class="firma"></td></tr>`;
  };
  const seccion = (s, i) => `<section${i && S.agrupar !== "letra" ? ' class="salto"' : ""}><table>
    <colgroup><col style="width:8mm"/><col style="width:34%"/><col style="width:26mm"/><col/><col style="width:22mm"/><col style="width:34mm"/></colgroup>
    <thead><tr><th colspan="6" class="titulo">${h(info.nombre)} · ${h(s.titulo)}<span>${plural(s.personas.length)}</span></th></tr>
    <tr><th>N°</th><th>Nombre</th><th>Cédula</th><th>Detalle</th><th>Entregada</th><th>Firma</th></tr></thead>
    <tbody>${s.personas.length ? s.personas.map((p, k) => fila(p, k + 1)).join("")
    : `<tr><td colspan="6" class="vacio">Nadie en este grupo con los filtros actuales.</td></tr>`}</tbody></table></section>`;
  const nombreDoc = `CONTECS_${sufijoLista()}`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><title>${h(nombreDoc)}</title><style>
    @page { size: letter; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 10pt/1.35 Arial, Helvetica, sans-serif; color: #111; }
    header { margin-bottom: 5mm; border-bottom: 2px solid #064e3b; padding-bottom: 2mm; }
    h1 { margin: 0; font-size: 15pt; color: #064e3b; }
    .meta { font-size: 9pt; color: #444; margin-top: 1mm; }
    section { margin-bottom: 6mm; }
    section.salto { break-before: page; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    td { overflow-wrap: anywhere; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th, td { border: 1px solid #9a9a9a; padding: 4px 6px; text-align: left; vertical-align: middle; }
    th { background: #eef3f0; font-size: 8pt; text-transform: uppercase; }
    th.titulo { background: #064e3b; color: #fff; font-size: 11pt; text-transform: none; }
    th.titulo span { float: right; font-weight: normal; }
    td.n { text-align: right; color: #555; }
    td.ok { text-align: center; }
    td.vacio { text-align: center; color: #666; padding: 10px; }
    .caja { display: inline-block; width: 4mm; height: 4mm; border: 1px solid #333; }
    </style></head><body>
    <header><h1>CONTECS — Entrega de credenciales: ${h(info.nombre)}</h1>
    <div class="meta">${h(modo)} · ${plural(total)}${filtros.length ? ` · ${h(filtros.join(" · "))}` : ""} · ${h(fecha)}</div></header>
    ${secciones.map(seccion).join("")}
    </body></html>`;
}

// La misma lista en Excel. La hoja "Lista" trae a todos con su grupo o letra
// (para filtrar y ordenar en Excel); con varios grupos, además una hoja por grupo.
async function descargarExcelListas(secciones) {
  const XLSX = await cargarLibreria("XLSX", "xlsx.full.min.js");
  const encabezado = ["N°", "Nombre", "Cédula", "Código", "Detalle", "Entregada", "Firma"];
  const anchos = [5, 34, 16, 14, 30, 11, 24].map(wch => ({ wch }));
  const filaDe = (p, n) => { const d = datosLista(p); return [n, d.nombre, d.cedula, d.codigo, d.detalle, "", ""]; };
  const hoja = (filas, columnas) => {
    const ws = XLSX.utils.aoa_to_sheet(filas.map(f => f.map(v => (typeof v === "string" ? neutralizarFormulaHoja(v) : v))));
    ws["!cols"] = columnas;
    if (filas.length > 1) ws["!autofilter"] = { ref: ws["!ref"] };
    return ws;
  };
  const libro = XLSX.utils.book_new();
  const todas = [[S.agrupar === "letra" ? "Letra" : "Grupo", ...encabezado],
    ...secciones.flatMap(s => s.personas.map((p, k) => [s.corto, ...filaDe(p, k + 1)]))];
  XLSX.utils.book_append_sheet(libro, hoja(todas, [{ wch: S.agrupar === "letra" ? 7 : 30 }, ...anchos]), "Lista");
  if (S.agrupar !== "letra" && secciones.length > 1) {
    secciones.forEach(s => XLSX.utils.book_append_sheet(libro,
      hoja([encabezado, ...s.personas.map((p, k) => filaDe(p, k + 1))], anchos), `Grupo ${s.i + 1}`));
  }
  XLSX.writeFile(libro, nombreLote("xlsx", sufijoLista()));
}

// Lo que va a la lista, o null (con aviso) si no queda nadie.
function seccionesConGente() {
  const secciones = seccionesLista();
  if (secciones.some(s => s.personas.length)) return secciones;
  alerta("warning", "No hay nadie con credencial en la lista con los filtros actuales.");
  return null;
}

el("cr-listas-excel").addEventListener("click", async () => {
  if (S.tarea) return;
  const secciones = seccionesConGente();
  if (!secciones) return;
  el("cr-listas-excel").disabled = true;
  try {
    await descargarExcelListas(secciones);
  } catch (err) {
    console.error(err);
    alerta("error", "No se pudo generar el Excel: " + err.message);
  } finally {
    el("cr-listas-excel").disabled = !!S.tarea;
  }
});

function actualizarBotonListas() {
  const b = el("cr-listas");
  b.disabled = !!S.tarea;
  el("cr-listas-excel").disabled = !!S.tarea;
  b.textContent = S.agrupar === "letra"
    ? S.bloque ? `Imprimir lista de la letra ${S.bloque}` : "Imprimir lista (por letra)"
    : S.bloque ? `Imprimir lista del grupo ${Number(S.bloque) + 1}` : "Imprimir listas de todos los grupos";
}

el("cr-listas").addEventListener("click", async () => {
  if (S.tarea) return;
  const secciones = seccionesConGente();
  if (!secciones) return;
  try {
    await imprimirHtml(htmlListas(secciones));
  } catch (err) {
    console.error(err);
    alerta("error", "No se pudo abrir la impresión de la lista: " + err.message);
  }
});

// Centro regional y facultad: el valor del filtro es el texto normalizado
// (así "Campus central" y "Campus Central" son la misma opción); SIN_DATO
// junta a quienes no lo tienen.
const SIN_DATO = "__sin_dato__";
const valorUtp = texto => normalizar(texto) || SIN_DATO;
const FILTROS_UTP = [
  { id: "cr-centro", campo: "_centro", todos: "Todos los centros regionales", sin: "Sin centro regional" },
  { id: "cr-facultad", campo: "_facultad", todos: "Todas las facultades", sin: "Sin facultad" },
];

function filtrarSinLetra() {
  const tipo = S.tipo;
  const q = normalizar(el("cr-buscar").value).split(" ").filter(Boolean);
  const estado = el("cr-estado").value;
  const categoria = el("cr-categoria").value;
  const conPendientes = el("cr-no-aprobados").checked;
  const utp = FILTROS_UTP.map(f => ({ campo: f.campo, valor: el(f.id).hidden ? "" : el(f.id).value })).filter(f => f.valor);
  return S.personas[tipo].filter(p => {
    if (tipo === "participante" && !conPendientes && !p._aprobado) return false;
    if (tipo === "participante" && categoria && p.categoria !== categoria) return false;
    if (utp.some(f => valorUtp(p[f.campo]) !== f.valor)) return false;
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
  // Las opciones (con cuántas personas hay) salen de quienes se listan en este
  // tipo; si nadie tiene el dato (p. ej. expositores agregados a mano), el
  // filtro no se muestra.
  const conPendientes = el("cr-no-aprobados").checked;
  const base = S.personas[tipo].filter(p => tipo !== "participante" || conPendientes || p._aprobado);
  FILTROS_UTP.forEach(f => {
    const sel = el(f.id);
    const opciones = new Map();
    base.forEach(p => {
      const texto = String(p[f.campo] || "").trim();
      const valor = valorUtp(texto);
      if (!opciones.has(valor)) opciones.set(valor, { texto: texto || f.sin, n: 0 });
      opciones.get(valor).n++;
    });
    const conDato = [...opciones.keys()].some(v => v !== SIN_DATO);
    sel.hidden = !conDato;
    if (!conDato) { sel.value = ""; return; }
    const actual = sel.value;
    const orden = [...opciones].sort(([va, a], [vb, b]) => (va === SIN_DATO) - (vb === SIN_DATO) || a.texto.localeCompare(b.texto, "es"));
    sel.innerHTML = `<option value="">${h(f.todos)}</option>` +
      orden.map(([v, o]) => `<option value="${escaparAtributo(v)}">${h(o.texto)} (${o.n})</option>`).join("");
    sel.value = opciones.has(actual) ? actual : "";
  });
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

["cr-buscar", "cr-estado", "cr-categoria", "cr-centro", "cr-facultad", "cr-no-aprobados"].forEach(id =>
  el(id).addEventListener(id === "cr-buscar" ? "input" : "change", () => {
    if (id === "cr-no-aprobados" && !el(id).checked) {
      // Al ocultar los pendientes de pago también salen de la selección.
      S.personas.participante.filter(p => !p._aprobado).forEach(p => S.seleccion.participante.delete(p._clave));
    }
    // Los conteos de centro y facultad cambian con los pagos no aprobados.
    if (id === "cr-no-aprobados") renderFiltros();
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
  return ordenEntrega(S.personas[S.tipo].filter(p => p._imprimible && sel.has(p._clave)));
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
  actualizarBotonListas();
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
