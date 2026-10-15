// ═══════════════════════════════════════════════════════════════
// CONTECS — Shell visual de las paginas de modulo
//
// El .topbar de cada pagina NO se reemplaza ni se toca su DOM (algunas paginas
// ponen botones con id y JS propio dentro de el). Este script solo:
//   1. Observa un centinela en lo alto de la pagina (IntersectionObserver).
//   2. Al hacer scroll marca el topbar con data-docked="true" (el CSS lo envia
//      hacia arriba, con transform) y muestra un carril mini a la derecha con:
//      inicio, volver y subir.
//
// No importa Firebase, no lee roles, no navega por su cuenta: solo reutiliza el
// enlace .btn-volver que la pagina ya trae. Script clasico (defer), sin imports.
// ═══════════════════════════════════════════════════════════════
(() => {
  const topbar = document.querySelector(".topbar");
  if (!topbar || document.querySelector(".cx-nav--mini")) return;

  const escritorio = matchMedia("(min-width: 1024px)");
  const volver = topbar.querySelector(".btn-volver");
  const volverHref = volver?.getAttribute("href") || "";
  const tituloPagina = topbar.querySelector("h1")?.textContent.trim() || document.title;

  // Dashboard del panel: solo existe bajo /panel/. Las paginas publicas no lo tienen.
  const i = location.pathname.indexOf("/panel/");
  const inicioHref = i >= 0 ? `${location.pathname.slice(0, i)}/panel/dashboard.html` : "";

  const ICONOS = {
    inicio: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    volver: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
    subir:  '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
  };
  const svg = nombre => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [k, v] of Object.entries({
      viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.9",
      "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false",
    })) el.setAttribute(k, v);
    el.innerHTML = ICONOS[nombre]; // constantes de este archivo
    return el;
  };
  const el = (etiqueta, clase, atributos = {}) => {
    const nodo = document.createElement(etiqueta);
    if (clase) nodo.className = clase;
    for (const [k, v] of Object.entries(atributos)) nodo.setAttribute(k, v);
    return nodo;
  };

  // ── Carril mini ───────────────────────────────────────────────
  const raiz = el("div", "cx-nav cx-nav--mini", { "data-state": "top" });
  const carril = el("aside", "cx-rail", { "aria-label": "Navegación rápida" });
  let orden = 0;
  const poner = nodo => { nodo.style.setProperty("--i", String(orden++)); carril.appendChild(nodo); return nodo; };

  const boton = (clase, etiqueta, icono, tag = "button", atributos = {}) => {
    const nodo = el(tag, clase, { "aria-label": etiqueta, title: etiqueta, ...atributos });
    if (tag === "button") nodo.type = "button";
    nodo.appendChild(svg(icono));
    return nodo;
  };

  if (inicioHref) poner(boton("cx-rail__btn", "Inicio", "inicio", "a", { href: inicioHref }));
  if (volverHref && !volverHref.endsWith("dashboard.html")) {
    poner(boton("cx-rail__btn", "Volver", "volver", "a", { href: volverHref }));
  }
  if (inicioHref || volverHref) poner(el("div", "cx-rail__sep", { "aria-hidden": "true" }));
  const subir = poner(boton("cx-rail__btn", "Volver arriba", "subir"));
  subir.addEventListener("click", () => {
    scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });

  // Etiqueta con el nombre de la pagina: aparece al pasar el cursor por el carril.
  carril.setAttribute("data-titulo", tituloPagina);

  // ── Barra <-> carril ──────────────────────────────────────────
  const centinela = el("div", "cx-sentinel", { "aria-hidden": "true" });
  let enTope = true;
  function aplicar() {
    const acoplado = escritorio.matches && !enTope;
    const nuevo = acoplado ? "docked" : "top";
    if (raiz.dataset.state === nuevo) return;
    raiz.dataset.state = nuevo;
    topbar.dataset.docked = String(acoplado);
    carril.inert = !acoplado;
    topbar.inert = acoplado;
  }
  carril.inert = true;
  raiz.append(centinela, carril);
  document.body.prepend(raiz);
  // Reserva el ancho del carril (padding-right) y alinea la barra con el borde.
  document.body.classList.add("cx-nav-on");

  new IntersectionObserver(([e]) => { enTope = e.isIntersecting; aplicar(); }).observe(centinela);
  escritorio.addEventListener("change", aplicar);
})();
