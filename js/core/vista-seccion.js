// ═══════════════════════════════════════════════════════════════
// CONTECS — Vista de una seccion (inicio del panel)
//
// Al entrar a una tarjeta del carrusel, el "boom" crece desde ella y, con la
// pantalla cubierta, se monta debajo la vista de esa seccion: su cabecera en
// el tono de la seccion y las tarjetas de sus modulos (que abren cada pagina
// con su propio boom). Es una capa del mismo documento: el boton Atras del
// navegador la cierra (history) y #seccion la abre directo al volver.
// Una seccion con un solo modulo no necesita vista: el boom lleva al modulo.
// ═══════════════════════════════════════════════════════════════
import { boomDesde } from "./boom.js?v=20261015.5";
import { iconoSeccion } from "./navbar.js?v=20261015.5";
import { pintarRejillaSeccion } from "./tarjetas-modulos.js?v=20261015.5";

let secciones = [];
let abierta = null;          // { el, id }
let fondo = null;            // contenido de la pagina que queda detras (inert)

function nodo(etiqueta, clase, texto) {
  const n = document.createElement(etiqueta);
  if (clase) n.className = clase;
  if (texto != null) n.textContent = texto;
  return n;
}

function construir(sec) {
  const vista = nodo("div", "cx-vista");
  vista.setAttribute("role", "dialog");
  vista.setAttribute("aria-modal", "true");
  vista.setAttribute("aria-labelledby", "cx-vista-titulo");
  vista.dataset.id = sec.id;
  vista.style.setProperty("--tono-fondo", `var(--cx-tono-${sec.id}-fondo, var(--cx-ink))`);
  vista.style.setProperty("--tono-tinta", `var(--cx-tono-${sec.id}-tinta, var(--cx-champagne))`);

  const marco = nodo("div", "cx-vista__marco");
  const hero = nodo("header", "cx-vista__hero");
  const volver = nodo("button", "cx-vista__volver");
  volver.type = "button";
  volver.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M11 18l-6-6 6-6"/></svg>';
  volver.append(document.createTextNode("Módulos"));
  volver.addEventListener("click", () => cerrarSeccion());

  const identidad = nodo("div", "cx-vista__identidad");
  const icono = nodo("span", "cx-vista__icono");
  icono.appendChild(iconoSeccion(sec.id));
  const textos = nodo("div", "cx-vista__textos");
  const titulo = nodo("h2", "cx-vista__titulo", sec.label);
  titulo.id = "cx-vista-titulo";
  const n = sec.modulos.length;
  textos.append(nodo("span", "cx-vista__kicker", "Sección"), titulo, nodo("p", "cx-vista__nota", `${n} módulo${n === 1 ? "" : "s"} disponible${n === 1 ? "" : "s"}`));
  identidad.append(icono, textos);
  hero.append(volver, identidad);

  const modulos = nodo("div", "cx-vista__modulos");
  pintarRejillaSeccion(modulos, sec);
  marco.append(hero, modulos);
  vista.appendChild(marco);
  return { vista, volver };
}

function abrir(sec, { empujar = false, suave = false } = {}) {
  if (abierta?.id === sec.id) return;
  if (abierta) quitar(abierta.el);
  const { vista, volver } = construir(sec);
  if (suave) vista.classList.add("cx-vista--suave");
  document.body.appendChild(vista);
  document.documentElement.classList.add("cx-vista-abierta");
  if (fondo) fondo.inert = true;
  abierta = { el: vista, id: sec.id };
  if (empujar) history.pushState({ cxSeccion: sec.id }, "", `#${sec.id}`);
  volver.focus({ preventScroll: true });
}

function quitar(el) {
  el.remove();
  if (!document.querySelector(".cx-vista")) {
    document.documentElement.classList.remove("cx-vista-abierta");
    if (fondo) fondo.inert = false;
  }
}

function cerrarAnimado() {
  if (!abierta) return;
  const { el, id } = abierta;
  abierta = null;
  const salir = () => {
    quitar(el);
    // El foco vuelve a la tarjeta de la seccion en el carrusel.
    document.querySelector(`.cx-car[data-id="${CSS.escape(id)}"]`)?.closest(".cx-car-escenario")?.focus({ preventScroll: true });
  };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return salir();
  el.classList.add("is-saliendo");
  el.addEventListener("animationend", salir, { once: true });
  setTimeout(() => { if (el.isConnected) salir(); }, 600);
}

/** Cerrar la vista: si la abrio un clic (hay entrada en el historial), Atras. */
export function cerrarSeccion() {
  if (!abierta) return;
  if (history.state?.cxSeccion === abierta.id) history.back();
  else {
    if (location.hash) history.replaceState(history.state, "", location.pathname + location.search);
    cerrarAnimado();
  }
}

/** Entrar a una seccion desde su tarjeta (el elemento visible, para el boom). */
export function entrarASeccion(sec, origen) {
  if (sec.modulos.length === 1) {
    const m = sec.modulos[0];
    return boomDesde(origen, { tono: sec.id, nombre: m.label, href: m.href });
  }
  return boomDesde(origen, { tono: sec.id, nombre: sec.label, alCubrir: () => abrir(sec, { empujar: true }) });
}

/**
 * Registra las secciones visibles y el contenido de fondo. Abre la del
 * #hash si la hay (volver con Atras desde un modulo deja la vista donde estaba).
 */
export function iniciarVistas(lista, contenidoFondo) {
  secciones = lista.filter(s => s.modulos.length > 1);
  fondo = contenidoFondo || null;
  const idHash = decodeURIComponent(location.hash.slice(1));
  const sec = secciones.find(s => s.id === idHash);
  if (sec) {
    if (history.state?.cxSeccion !== sec.id) history.replaceState({ cxSeccion: sec.id }, "", `#${sec.id}`);
    abrir(sec, { suave: true });
  }
}

addEventListener("popstate", e => {
  const id = e.state?.cxSeccion;
  const sec = id && secciones.find(s => s.id === id);
  if (sec) abrir(sec, { suave: true });
  else cerrarAnimado();
});

document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || !abierta) return;
  // Un menu del navbar abierto se cierra primero (lo maneja el navbar).
  if (document.querySelector(".cx-item[data-open]") || document.documentElement.classList.contains("cx-sheet-open")) return;
  cerrarSeccion();
}, true);   // en captura: ve el menu abierto antes de que el navbar lo cierre
