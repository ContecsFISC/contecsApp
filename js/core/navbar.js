// ═══════════════════════════════════════════════════════════════
// CONTECS — Navbar v2
//
// Pinta la barra superior blanca y el carril lateral derecho al que se
// acopla al hacer scroll. SOLO presentacion: no importa Firebase, no lee
// roles ni permisos. La pagina le pasa las categorias ya filtradas
// (con el mismo `puede()` de siempre) y un callback para cerrar sesion.
//
// Uso:
//   import { montarNavbar } from "../js/core/navbar.js";
//   const nav = montarNavbar({
//     marca: { titulo: "CONTECS", logo: "../img/ui/contecs-mark.png", href: "dashboard.html" },
//     categorias: [{ id: "finanzas", label: "Finanzas", modulos: [{ label: "Fondos", href: "...", admin: true }] }],
//     alCerrarSesion: cerrarSesion,
//   });
//
// Rendimiento: el cambio barra <-> carril lo decide un IntersectionObserver
// (fuera del hilo principal), no un listener de scroll. Todas las animaciones
// son transform/opacity en CSS.
// ═══════════════════════════════════════════════════════════════

const ICONOS = {
  congreso:     '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  mapa:         '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
  posper:       '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  finanzas:     '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  logistica:    '<path d="M16.5 9.4 7.5 4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  voluntariado: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  admin:        '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  _defecto:     '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  chevron:      '<polyline points="6 9 12 15 18 9"/>',
  salir:        '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  burger:       '<line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/>',
  cerrar:       '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
};

// Los iconos son constantes de este archivo, nunca datos externos.
function svg(nombre, clase) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("fill", "none");
  el.setAttribute("stroke", "currentColor");
  el.setAttribute("stroke-width", "1.9");
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("focusable", "false");
  if (clase) el.setAttribute("class", clase);
  el.innerHTML = ICONOS[nombre] || ICONOS._defecto;
  return el;
}

function el(etiqueta, clase, atributos) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (atributos) for (const [k, v] of Object.entries(atributos)) nodo.setAttribute(k, v);
  return nodo;
}

function rutaDe(href) {
  // Un enlace solo-ancla (#algo) apunta a la misma pagina: no es "la actual".
  if (!href || href.startsWith("#")) return "";
  try { return new URL(href, location.href).pathname.replace(/\/+$/, ""); }
  catch { return ""; }
}

export function montarNavbar({
  categorias = [],
  marca = {},
  actual = location.href,
  alCerrarSesion = null,
  etiquetaSalir = "Salir",
  destino = document.body,
  umbralAcople = 48,
} = {}) {
  const ctl = new AbortController();
  const { signal } = ctl;
  const rutaActual = rutaDe(actual);
  const escritorio = matchMedia("(min-width: 1024px)");

  // ── Estructura ────────────────────────────────────────────────
  const raiz = el("div", "cx-nav", { "data-state": "top", "data-scrolled": "false", "data-sheet": "closed" });
  const espaciador = el("div", "cx-spacer", { "aria-hidden": "true" });
  const centinela = el("div", "cx-sentinel", { "aria-hidden": "true" });
  centinela.style.height = `${umbralAcople}px`;
  const barra = el("header", "cx-bar", { role: "banner" });
  const carril = el("aside", "cx-rail", { "aria-label": "Navegación lateral" });
  const hoja = el("nav", "cx-sheet", { "aria-label": "Secciones" });
  const velo = el("div", "cx-scrim");

  // Marca
  const titulo = marca.titulo || "CONTECS";
  const crearMarca = (clase, conTexto) => {
    const a = el("a", clase, { href: marca.href || "#", "aria-label": titulo });
    if (marca.logo) {
      const img = el("img", conTexto ? "cx-brand__mark" : "", { src: marca.logo, alt: "", decoding: "async" });
      a.appendChild(img);
    }
    if (conTexto) {
      const t = el("span", "cx-brand__name");
      t.textContent = titulo;
      a.appendChild(t);
    }
    return a;
  };
  barra.appendChild(crearMarca("cx-brand", true));

  // Secciones (barra)
  const nav = el("nav", "cx-bar__nav", { "aria-label": "Secciones" });
  const glide = el("span", "cx-glide", { "aria-hidden": "true" });
  nav.appendChild(glide);
  barra.appendChild(nav);

  // Zona derecha de la barra
  const fin = el("div", "cx-bar__end");
  let botonSalir = null;
  if (alCerrarSesion) {
    botonSalir = el("button", "cx-logout", { type: "button" });
    botonSalir.append(svg("salir"), document.createTextNode(etiquetaSalir));
    fin.appendChild(botonSalir);
  }
  const burger = el("button", "cx-burger", { type: "button", "aria-label": "Abrir menú", "aria-expanded": "false" });
  burger.append(svg("burger", "cx-burger__bars"), svg("cerrar", "cx-burger__x"));
  fin.appendChild(burger);
  barra.appendChild(fin);

  // Carril: marca + separador + secciones + salir
  const marcaCarril = crearMarca("cx-rail__brand", false);
  marcaCarril.style.setProperty("--i", "0");
  carril.appendChild(marcaCarril);
  const sep = el("div", "cx-rail__sep", { "aria-hidden": "true" });
  sep.style.setProperty("--i", "1");
  carril.appendChild(sep);

  // ── Menus ─────────────────────────────────────────────────────
  const items = []; // { item, btn, menu, ubicacion }
  let abierto = null;
  let temporizador = 0;
  let ultimoPuntero = "";

  function crearMenu(cat, idMenu) {
    const menu = el("div", "cx-menu", { id: idMenu, role: "menu", "aria-label": cat.label });
    const t = el("div", "cx-menu__title");
    t.textContent = cat.label;
    menu.appendChild(t);
    (cat.modulos || []).forEach((m, i) => {
      const a = el("a", "cx-menu__link", { href: m.href, role: "menuitem" });
      a.style.setProperty("--i", String(i));
      const txt = el("span");
      txt.textContent = m.label;
      a.appendChild(txt);
      if (m.admin) a.appendChild(el("span", "cx-menu__dot", { title: "Administración" }));
      if (rutaDe(m.href) === rutaActual) { a.classList.add("is-current"); a.setAttribute("aria-current", "page"); }
      menu.appendChild(a);
    });
    return menu;
  }

  function crearItem(cat, indice, ubicacion) {
    const idMenu = `cx-menu-${ubicacion}-${cat.id || indice}`;
    const item = el("div", "cx-item", { "data-id": cat.id || String(indice) });
    const esActual = (cat.modulos || []).some(m => rutaDe(m.href) === rutaActual);
    if (esActual) item.classList.add("is-current");

    const btn = el("button", "cx-item__btn", {
      type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": idMenu,
    });
    if (ubicacion === "rail") {
      btn.setAttribute("aria-label", cat.label);
      btn.setAttribute("title", cat.label);
      btn.appendChild(svg(cat.icono || cat.id));
    } else {
      const t = el("span");
      t.textContent = cat.label;
      btn.append(t, svg("chevron", "cx-chevron"));
    }
    const menu = crearMenu(cat, idMenu);
    item.append(btn, menu);
    const registro = { item, btn, menu, ubicacion };
    items.push(registro);
    return registro;
  }

  function abrir(registro) {
    clearTimeout(temporizador);
    if (abierto === registro) return;
    cerrar();
    registro.item.setAttribute("data-open", "true");
    registro.btn.setAttribute("aria-expanded", "true");
    if (registro.ubicacion === "rail") {
      // Si el menu no cabe hacia abajo, crece hacia arriba.
      registro.item.removeAttribute("data-flip");
      const arriba = registro.btn.getBoundingClientRect().top;
      if (arriba + registro.menu.offsetHeight > innerHeight - 12) registro.item.setAttribute("data-flip", "");
    }
    abierto = registro;
  }

  function cerrar() {
    if (!abierto) return;
    abierto.item.removeAttribute("data-open");
    abierto.btn.setAttribute("aria-expanded", "false");
    abierto = null;
  }

  function cerrarConRetraso(registro) {
    clearTimeout(temporizador);
    // Margen de gracia: el cursor puede cruzar el hueco entre boton y menu.
    temporizador = setTimeout(() => { if (abierto === registro) cerrar(); }, 160);
  }

  function enlazar(registro) {
    const { item, btn, menu } = registro;
    btn.addEventListener("pointerdown", e => { ultimoPuntero = e.pointerType; }, { signal });
    item.addEventListener("pointerenter", e => {
      if (e.pointerType !== "mouse") return;
      abrir(registro);
      if (registro.ubicacion === "bar") moverGlide(item);
    }, { signal });
    item.addEventListener("pointerleave", e => {
      if (e.pointerType === "mouse") cerrarConRetraso(registro);
    }, { signal });
    btn.addEventListener("click", e => {
      // Con raton el menu ya se abrio al pasar: el clic no debe cerrarlo.
      const porRaton = e.detail > 0 && ultimoPuntero === "mouse";
      if (porRaton && abierto === registro) return;
      abierto === registro ? cerrar() : abrir(registro);
    }, { signal });
    item.addEventListener("focusout", e => {
      if (!item.contains(e.relatedTarget) && abierto === registro) cerrar();
    }, { signal });
    item.addEventListener("keydown", e => {
      const enlaces = [...menu.querySelectorAll(".cx-menu__link")];
      const idx = enlaces.indexOf(document.activeElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        abrir(registro);
        (enlaces[idx + 1] || enlaces[0])?.focus();
      } else if (e.key === "ArrowUp" && abierto === registro) {
        e.preventDefault();
        (idx > 0 ? enlaces[idx - 1] : enlaces[enlaces.length - 1])?.focus();
      } else if (e.key === "Home" && idx >= 0) { e.preventDefault(); enlaces[0]?.focus(); }
      else if (e.key === "End" && idx >= 0) { e.preventDefault(); enlaces[enlaces.length - 1]?.focus(); }
    }, { signal });
  }

  // ── Subrayado deslizante (solo barra) ─────────────────────────
  // Se mide al pasar el cursor, nunca durante el scroll.
  let itemActualBarra = null;
  function moverGlide(item) {
    glide.style.transform = `translate3d(${item.offsetLeft}px, 0, 0) scaleX(${item.offsetWidth / 100})`;
    glide.style.opacity = "1";
    if (!glide.classList.contains("is-ready")) {
      // Primera colocacion sin transicion: que no "viaje" desde x=0.
      void glide.offsetWidth;
      glide.classList.add("is-ready");
    }
  }
  function reposoGlide() {
    if (itemActualBarra) moverGlide(itemActualBarra);
    else glide.style.opacity = "0";
  }
  nav.addEventListener("pointerleave", reposoGlide, { signal });

  // ── Salir en carril y panel movil ─────────────────────────────
  // Se crean ANTES de las secciones: estas se insertan siempre delante de ellos.
  let separadorSalir = null, botonSalirCarril = null, botonSalirHoja = null;
  if (alCerrarSesion) {
    separadorSalir = el("div", "cx-rail__sep", { "aria-hidden": "true" });
    separadorSalir.style.setProperty("--i", "20");
    carril.appendChild(separadorSalir);
    botonSalirCarril = el("button", "cx-rail__logout", { type: "button", "aria-label": etiquetaSalir, title: etiquetaSalir });
    botonSalirCarril.appendChild(svg("salir"));
    botonSalirCarril.style.setProperty("--i", "21");
    carril.appendChild(botonSalirCarril);

    botonSalirHoja = el("button", "cx-sheet__logout", { type: "button" });
    botonSalirHoja.append(svg("salir"), document.createTextNode(etiquetaSalir));
    hoja.appendChild(botonSalirHoja);

    for (const b of [botonSalir, botonSalirCarril, botonSalirHoja]) {
      b.addEventListener("click", () => alCerrarSesion(), { signal });
    }
  }

  // ── Secciones ─────────────────────────────────────────────────
  // Se pueden (re)establecer en cualquier momento: el dashboard monta la barra
  // enseguida y le pasa las categorias cuando los permisos ya estan resueltos.
  let nodosSecciones = [];
  function establecerCategorias(lista = []) {
    cerrar();
    clearTimeout(temporizador);
    nodosSecciones.forEach(n => n.remove());
    nodosSecciones = [];
    items.length = 0;
    itemActualBarra = null;

    lista.forEach((cat, i) => {
      const r1 = crearItem(cat, i, "bar");
      nav.appendChild(r1.item);
      enlazar(r1);
      if (r1.item.classList.contains("is-current")) itemActualBarra = r1.item;

      const r2 = crearItem(cat, i, "rail");
      r2.item.style.setProperty("--i", String(i + 2));
      carril.insertBefore(r2.item, separadorSalir);
      enlazar(r2);

      // Panel movil: bloque por categoria.
      const grupo = el("div", "cx-sheet__group");
      const t = el("div", "cx-menu__title");
      t.textContent = cat.label;
      grupo.appendChild(t);
      (cat.modulos || []).forEach((m, j) => {
        const a = el("a", "cx-menu__link", { href: m.href });
        a.style.setProperty("--i", String(i * 2 + j));
        const txt = el("span");
        txt.textContent = m.label;
        a.appendChild(txt);
        if (m.admin) a.appendChild(el("span", "cx-menu__dot"));
        if (rutaDe(m.href) === rutaActual) { a.classList.add("is-current"); a.setAttribute("aria-current", "page"); }
        grupo.appendChild(a);
      });
      hoja.insertBefore(grupo, botonSalirHoja);

      nodosSecciones.push(r1.item, r2.item, grupo);
    });
    // El "Salir" del carril entra despues de la ultima seccion.
    separadorSalir?.style.setProperty("--i", String(lista.length + 2));
    botonSalirCarril?.style.setProperty("--i", String(lista.length + 3));
    reposoGlide();
  }

  // ── Panel movil ───────────────────────────────────────────────
  function abrirHoja(si) {
    raiz.dataset.sheet = si ? "open" : "closed";
    burger.setAttribute("aria-expanded", String(si));
    burger.setAttribute("aria-label", si ? "Cerrar menú" : "Abrir menú");
    document.documentElement.classList.toggle("cx-sheet-open", si);
  }
  burger.addEventListener("click", () => abrirHoja(raiz.dataset.sheet !== "open"), { signal });
  velo.addEventListener("click", () => abrirHoja(false), { signal });
  hoja.addEventListener("click", e => { if (e.target.closest("a")) abrirHoja(false); }, { signal });

  // ── Teclado y clic fuera ──────────────────────────────────────
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (abierto) {
      const btn = abierto.btn;
      const foco = abierto.item.contains(document.activeElement);
      cerrar();
      if (foco) btn.focus();
    }
    if (raiz.dataset.sheet === "open") { abrirHoja(false); burger.focus(); }
  }, { signal });
  document.addEventListener("pointerdown", e => {
    if (abierto && !abierto.item.contains(e.target)) cerrar();
  }, { signal });

  // ── Barra <-> carril ──────────────────────────────────────────
  let enTope = true;
  function aplicarEstado() {
    const acoplado = escritorio.matches && !enTope;
    const estadoNuevo = acoplado ? "docked" : "top";
    raiz.dataset.scrolled = String(!enTope);
    if (raiz.dataset.state === estadoNuevo) return;
    raiz.dataset.state = estadoNuevo;
    cerrar();
    barra.inert = acoplado;
    carril.inert = !acoplado;
    if (!acoplado) reposoGlide();
  }
  const observador = new IntersectionObserver(([entrada]) => {
    enTope = entrada.isIntersecting;
    aplicarEstado();
  });
  escritorio.addEventListener("change", () => {
    if (!escritorio.matches) abrirHoja(false);
    aplicarEstado();
  }, { signal });

  // ── Montaje ───────────────────────────────────────────────────
  carril.inert = true;
  establecerCategorias(categorias);
  raiz.append(espaciador, centinela, barra, carril, velo, hoja);
  // Una pagina puede traer un espaciador estatico para que el contenido no
  // salte mientras carga el modulo: ya no hace falta.
  document.getElementById("cx-spacer-previo")?.remove();
  destino.prepend(raiz);
  document.body.classList.add("cx-nav-on");
  observador.observe(centinela);
  // Las fuentes cambian el ancho de los botones: se mide cuando ya cargaron.
  (document.fonts?.ready ?? Promise.resolve()).then(reposoGlide);
  addEventListener("resize", reposoGlide, { signal, passive: true });

  return {
    el: raiz,
    establecerCategorias,
    destruir() {
      ctl.abort();
      observador.disconnect();
      clearTimeout(temporizador);
      document.documentElement.classList.remove("cx-sheet-open");
      document.body.classList.remove("cx-nav-on");
      raiz.remove();
    },
  };
}
