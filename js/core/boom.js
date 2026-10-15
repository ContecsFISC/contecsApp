// ═══════════════════════════════════════════════════════════════
// CONTECS — "Boom": entrar a un modulo
//
// Adaptado del proyecto de referencia para un sitio de varias paginas: el
// origen (tarjeta o enlace del menu) toma impulso, y desde su mismo rectangulo
// crece una forma que cubre la pantalla mientras se tine del color de la
// seccion y aparece el nombre del modulo. Con todo cubierto se navega; la View
// Transition entre documentos (styles.css) funde la llegada de la pagina nueva.
//
// 60 fps: la forma es UNA caja fija del tamano de la pantalla (+R por lado) a la
// que solo se le anima transform (y a su tinte, opacity), en el compositor. El
// radio R grande se ve como el de la tarjeta cuando esta escalada, y sus esquinas
// quedan fuera de la pantalla a tamano completo.
//
// Se activa sola: cualquier <a data-boom> de la pagina. No toca la logica de
// navegacion: el destino es el mismo href; solo se retrasa unos milisegundos.
// ═══════════════════════════════════════════════════════════════

const T = { retraer: 120, expandir: 440, navegarAl: 0.82, rescate: 2400 };
const reducido = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
let enCurso = false;

function iconoDeSeccion(tono) {
  // El carril siempre tiene un icono por seccion: se clona de ahi.
  const svg = document.querySelector(`.cx-rail .cx-item[data-id="${CSS.escape(tono)}"] svg`);
  return svg ? svg.cloneNode(true) : null;
}

function quitarCapas() {
  document.querySelectorAll(".cx-boom").forEach(c => c.remove());
  document.querySelectorAll("[data-boom-oculto]").forEach(el => {
    el.getAnimations().forEach(a => a.cancel());   // deshace el "impulso" (scale .94)
    el.style.visibility = "";
    el.removeAttribute("data-boom-oculto");
  });
  document.querySelectorAll(".cx-bar").forEach(b => { b.style.viewTransitionName = ""; });
  enCurso = false;
}

async function boom(enlace) {
  const origen = enlace.closest("[data-boom-origen]") || enlace;
  const tono = enlace.dataset.boom || "congreso";
  const nombre = enlace.dataset.boomNombre || enlace.textContent.trim();
  return boomDesde(origen, { tono, nombre, href: enlace.href });
}

/**
 * El mismo boom lanzado desde cualquier elemento (p. ej. una tarjeta del
 * carrusel). Con `href` navega; con `alCubrir` llama a esa funcion cuando la
 * pantalla ya esta cubierta y despues la forma se desvanece y deja ver lo que
 * se haya montado debajo (la vista de una seccion del inicio).
 */
export async function boomDesde(origen, { tono = "congreso", nombre = "", href = "", alCubrir = null } = {}) {
  if (enCurso) return;
  if (reducido()) {
    if (alCubrir) alCubrir(); else if (href) location.assign(href);
    return;
  }
  enCurso = true;

  // 1. Impulso: el origen se retrae un poco.
  const retraer = origen.animate(
    [{ transform: "none" }, { transform: "scale(0.94)" }],
    { duration: T.retraer, easing: "cubic-bezier(.45,0,.55,1)", fill: "forwards" },
  );
  await retraer.finished.catch(() => {});

  // 2. La forma crece desde el rectangulo del origen hasta cubrir la pantalla.
  const r = origen.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  const radio = parseFloat(getComputedStyle(origen).borderTopLeftRadius) || 14;
  const R = Math.min(260, Math.max(60, (radio * vw) / Math.max(r.width - 24, 40), (radio * vh) / Math.max(r.height - 24, 40)));
  const W = vw + 2 * R, H = vh + 2 * R;
  const desde = `translate3d(${r.left + R}px, ${r.top + R}px, 0) scale(${r.width / W}, ${r.height / H})`;

  const capa = document.createElement("div");
  capa.className = "cx-boom";
  capa.setAttribute("aria-hidden", "true");
  capa.style.setProperty("--boom-fondo", `var(--cx-tono-${tono}-fondo, var(--cx-ink))`);
  capa.style.setProperty("--boom-tinta", `var(--cx-tono-${tono}-tinta, var(--cx-champagne))`);
  capa.innerHTML =
    '<div class="cx-boom__forma"><div class="cx-boom__tinte"></div></div>' +
    '<div class="cx-boom__sello"><span class="cx-boom__icono"></span><b class="cx-boom__nombre"></b>' +
    '<span class="cx-boom__carga"><i></i></span></div>';
  const forma = capa.firstChild, tinte = forma.firstChild, sello = capa.lastChild;
  Object.assign(forma.style, { left: -R + "px", top: -R + "px", width: W + "px", height: H + "px", borderRadius: R + "px", transform: desde });
  sello.querySelector(".cx-boom__nombre").textContent = nombre;
  const icono = origen.querySelector("[data-boom-icono] svg, .cx-mod__icono svg")?.cloneNode(true) || iconoDeSeccion(tono);
  if (icono) sello.querySelector(".cx-boom__icono").appendChild(icono);
  document.body.appendChild(capa);
  // La forma toma el lugar del origen en el mismo cuadro: sin parpadeo.
  origen.style.visibility = "hidden";
  origen.setAttribute("data-boom-oculto", "");
  // El navbar queda debajo de la forma: que la View Transition no lo saque encima.
  document.querySelectorAll(".cx-bar").forEach(b => { b.style.viewTransitionName = "none"; });

  forma.animate([{ transform: desde }, { transform: "translate3d(0,0,0) scale(1,1)" }],
    { duration: T.expandir, easing: "cubic-bezier(.72,0,.18,1)", fill: "forwards" });
  tinte.animate([{ opacity: 0 }, { opacity: 1 }],
    { duration: T.expandir * 0.62, delay: T.expandir * 0.12, easing: "cubic-bezier(.4,0,.2,1)", fill: "both" });
  sello.animate(
    [{ opacity: 0, transform: "translate3d(-50%,-50%,0) scale(.72)" }, { opacity: 1, transform: "translate3d(-50%,-50%,0) scale(1)" }],
    { duration: 420, delay: T.expandir * 0.38, easing: "cubic-bezier(.2,.9,.25,1.12)", fill: "both" },
  );

  // 3a. Sin navegar: con la pantalla cubierta se monta lo nuevo debajo y la
  //     forma se desvanece encima (solo opacity).
  if (alCubrir) {
    await new Promise(r => setTimeout(r, T.expandir + 160));
    try { alCubrir(); } catch (error) { console.error(error); }
    await capa.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 340, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" })
      .finished.catch(() => {});
    quitarCapas();
    return;
  }

  // 3. Casi cubierto: se navega (la red empieza mientras termina la expansion).
  setTimeout(() => location.assign(href), T.expandir * T.navegarAl + T.retraer * 0.2);
  // Rescate: si la navegacion no ocurrio (bloqueada, misma pagina...), se deshace.
  setTimeout(() => {
    if (!document.body.contains(capa)) return;
    capa.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" }).finished.then(quitarCapas, quitarCapas);
  }, T.rescate);
}

document.addEventListener("click", e => {
  const enlace = e.target.closest?.("a[data-boom]");
  if (!enlace || enCurso || e.defaultPrevented) return;
  // Abrir en otra pestana, clic central o con teclas: navegacion normal.
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || enlace.target === "_blank") return;
  if (reducido() || !enlace.href || new URL(enlace.href, location.href).origin !== location.origin) return;
  e.preventDefault();
  boom(enlace).catch(() => { quitarCapas(); location.assign(enlace.href); });
});

// Al volver con el boton Atras (bfcache) la pagina vuelve tal como quedo: se limpia.
addEventListener("pageshow", e => { if (e.persisted) quitarCapas(); });
