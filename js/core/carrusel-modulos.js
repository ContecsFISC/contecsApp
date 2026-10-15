// ═══════════════════════════════════════════════════════════════
// CONTECS — Carrusel 3D de secciones (inicio del panel)
//
// Traido del proyecto de referencia (CarruselModulos.jsx) a vanilla:
// profundidad y giro por posicion, la tarjeta del frente se inclina hacia el
// cursor (con zoom) y un brillo la sigue, y un destello cruza la que pasa al
// frente. Arrastrar, flechas, puntos y teclado. Todo se pinta con transform.
//
// Cada tarjeta son dos capas: .cx-car lleva el lugar en el carrusel
// (transform por JS) y .cx-car__cara lleva lo que se ve y la entrada (llegan
// desde la derecha dando dos vueltas). Separadas, no se pisan el transform.
//
// Las tarjetas son las SECCIONES ya filtradas por permisos (las mismas del
// navbar). Elegir la del frente llama a `alElegir(seccion, cara)`.
// ═══════════════════════════════════════════════════════════════
import { iconoSeccion } from "./navbar.js?v=20261015.5";

const FISICA = { profundidad: 200, giro: 38, espacio: 244, paso: 0.15, visibles: 3, escalaMinima: 0.42 };
const reducido = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function nodo(etiqueta, clase, texto) {
  const n = document.createElement(etiqueta);
  if (clase) n.className = clase;
  if (texto != null) n.textContent = texto;
  return n;
}

const FLECHA = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

/**
 * @param contenedor elemento vacio
 * @param secciones  [{ id, label, modulos: [{ label, href }] }] ya filtradas
 * @param alElegir   (seccion, caraElemento) => void|Promise
 */
export function montarCarrusel(contenedor, secciones = [], { alElegir = () => {} } = {}) {
  contenedor.replaceChildren();
  if (!secciones.length) return null;

  let activo = 0;
  let eligiendo = false;
  const arrastre = { x: 0, t: 0, movio: false };

  const escenario = nodo("div", "cx-car-escenario");
  escenario.setAttribute("role", "region");
  escenario.setAttribute("aria-roledescription", "carrusel");
  escenario.setAttribute("aria-label", "Módulos");
  escenario.tabIndex = 0;
  const resplandor = nodo("div", "cx-car-resplandor");
  resplandor.setAttribute("aria-hidden", "true");
  const pista = nodo("div", "cx-car-pista");
  escenario.append(resplandor, pista);

  const tarjetas = secciones.map((s, i) => {
    const t = nodo("div", "cx-car");
    t.dataset.id = s.id;
    t.style.setProperty("--tono-fondo", `var(--cx-tono-${s.id}-fondo, var(--cx-ink))`);
    t.style.setProperty("--tono-tinta", `var(--cx-tono-${s.id}-tinta, var(--cx-champagne))`);
    const cara = nodo("div", "cx-car__cara");
    cara.style.setProperty("--i", String(i));
    const icono = nodo("span", "cx-car__icono");
    icono.setAttribute("data-boom-icono", "");
    icono.appendChild(iconoSeccion(s.id));
    const total = s.modulos.length;
    const brillo = nodo("span", "cx-car__brillo");
    brillo.setAttribute("aria-hidden", "true");
    cara.append(
      brillo,
      icono,
      nodo("b", "cx-car__nombre", s.label),
      nodo("span", "cx-car__descripcion", s.modulos.map(m => m.label).join(" · ")),
      nodo("small", "cx-car__estado", total === 1 ? "Entrar" : `Entrar · ${total} módulos`),
    );
    t.appendChild(cara);
    pista.appendChild(t);
    return t;
  });

  const controles = nodo("div", "cx-car-controles");
  const anterior = nodo("button", "cx-car-flecha");
  anterior.type = "button";
  anterior.setAttribute("aria-label", "Anterior");
  anterior.innerHTML = FLECHA("M15 18l-6-6 6-6");
  const siguiente = nodo("button", "cx-car-flecha");
  siguiente.type = "button";
  siguiente.setAttribute("aria-label", "Siguiente");
  siguiente.innerHTML = FLECHA("M9 18l6-6-6-6");
  const puntos = nodo("div", "cx-car-puntos");
  const listaPuntos = secciones.map((s, i) => {
    const p = nodo("button", "cx-car-punto");
    p.type = "button";
    p.setAttribute("aria-label", `Ir a ${s.label}`);
    p.addEventListener("click", () => ir(i));
    puntos.appendChild(p);
    return p;
  });
  controles.append(anterior, puntos, siguiente);
  contenedor.append(escenario, controles);
  // Una sola seccion: sin flechas ni puntos.
  controles.hidden = secciones.length < 2;

  function transformar(i, desplazamiento = 0) {
    const offset = i - activo;
    const d = Math.abs(offset);
    const x = offset * FISICA.espacio + (offset === 0 ? desplazamiento : desplazamiento * 0.4);
    const z = reducido() ? 0 : -d * FISICA.profundidad;
    const giro = reducido() ? 0 : -offset * FISICA.giro;
    const escala = Math.max(1 - d * FISICA.paso, FISICA.escalaMinima);
    return `translate3d(${x}px,0,${z}px) scale(${escala}) rotateY(${giro}deg)`;
  }

  function pintar(animar, desplazamiento = 0) {
    tarjetas.forEach((el, i) => {
      const d = Math.abs(i - activo);
      el.style.transition = animar ? "" : "none";
      el.style.transform = transformar(i, desplazamiento);
      el.style.zIndex = String(tarjetas.length - d);
      el.style.opacity = d >= FISICA.visibles ? "0" : "1";
      el.classList.toggle("is-activo", i === activo);
      el.setAttribute("aria-hidden", String(i !== activo));
    });
    listaPuntos.forEach((p, i) => p.dataset.activo = String(i === activo));
    anterior.disabled = activo === 0;
    siguiente.disabled = activo === tarjetas.length - 1;
  }

  function ir(i) {
    const nuevo = Math.max(0, Math.min(tarjetas.length - 1, i));
    if (nuevo === activo) return pintar(true);
    activo = nuevo;
    pintar(true);
    // La que pasa al frente recibe un destello (al llegar ya entraron girando).
    const el = tarjetas[activo];
    if (!reducido()) {
      el.classList.remove("destello");
      void el.offsetWidth;
      el.classList.add("destello");
    }
  }

  async function elegir(i) {
    if (eligiendo) return;
    eligiendo = true;
    pintar(true);
    try { await alElegir(secciones[i], tarjetas[i].querySelector(".cx-car__cara")); }
    finally { eligiendo = false; }
  }

  // Arrastre con escuchas en window (sin pointer capture: si no, el clic no llega a la tarjeta).
  pista.addEventListener("pointerdown", e => {
    if (e.button > 0) return;
    Object.assign(arrastre, { x: e.clientX, t: performance.now(), movio: false });
    pista.classList.add("arrastrando");
    let raf = 0, ultimoX = e.clientX;
    const mover = ev => {
      ultimoX = ev.clientX;
      if (Math.abs(ultimoX - arrastre.x) > 5) arrastre.movio = true;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; pintar(false, (ultimoX - arrastre.x) * 0.5); });
    };
    const soltar = ev => {
      removeEventListener("pointermove", mover);
      removeEventListener("pointerup", soltar);
      removeEventListener("pointercancel", soltar);
      cancelAnimationFrame(raf);
      pista.classList.remove("arrastrando");
      const dx = ev.clientX - arrastre.x;
      const velocidad = dx / Math.max((performance.now() - arrastre.t) / 1000, 0.001);
      if (dx < -70 || velocidad < -500) ir(activo + 1);
      else if (dx > 70 || velocidad > 500) ir(activo - 1);
      else pintar(true);
    };
    addEventListener("pointermove", mover, { passive: true });
    addEventListener("pointerup", soltar);
    addEventListener("pointercancel", soltar);
  });

  tarjetas.forEach((el, i) => {
    // La del frente se inclina hacia el cursor (con zoom) y el brillo la sigue.
    el.addEventListener("pointermove", e => {
      if (i !== activo || reducido() || eligiendo || e.pointerType !== "mouse" || pista.classList.contains("arrastrando")) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      el.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
      el.style.setProperty("--my", (py * 100).toFixed(1) + "%");
      el.style.transition = "none";
      el.style.transform = `translate3d(0,0,0) scale(1.06) rotateX(${((0.5 - py) * 14).toFixed(2)}deg) rotateY(${((px - 0.5) * 14).toFixed(2)}deg)`;
    });
    el.addEventListener("pointerleave", () => { if (i === activo && !eligiendo) pintar(true); });
    el.addEventListener("click", () => {
      if (arrastre.movio || eligiendo) return;
      if (i !== activo) return ir(i);
      elegir(i);
    });
  });

  escenario.addEventListener("keydown", e => {
    if (e.key === "ArrowRight") { e.preventDefault(); ir(activo + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); ir(activo - 1); }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegir(activo); }
  });
  anterior.addEventListener("click", () => ir(activo - 1));
  siguiente.addEventListener("click", () => ir(activo + 1));

  pintar(false);
  return { ir, get activo() { return activo; } };
}
