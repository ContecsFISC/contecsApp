// ═══════════════════════════════════════════════════════════════
// CONTECS — Tarjetas de modulos del dashboard
//
// Una tarjeta por modulo, agrupadas por seccion (las mismas categorias ya
// filtradas por permisos que recibe el navbar). Efectos del proyecto de
// referencia, en vanilla y solo con transform/opacity:
//   - entrada escalonada cuando la seccion entra en pantalla
//   - la tarjeta se inclina hacia el cursor y un brillo la sigue
//   - al tocarla, la transicion "boom" (js/core/boom.js) abre el modulo
//
// Dos capas por tarjeta: .cx-mod lleva la ENTRADA y .cx-mod__cara la
// INCLINACION, para que las dos animaciones no se pisen el transform.
// ═══════════════════════════════════════════════════════════════
import { iconoSeccion } from "./navbar.js?v=20261015.3";
import { revelarAlEntrar } from "./revelar.js?v=20261015.3";

const reducido = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const conRaton = matchMedia("(hover: hover) and (pointer: fine)");
// Movil y tablet: rejilla de mosaicos; cada tarjeta entra cuando se ve.
const angosto = matchMedia("(max-width: 1023.98px)");

function nodo(etiqueta, clase, texto) {
  const n = document.createElement(etiqueta);
  if (clase) n.className = clase;
  if (texto != null) n.textContent = texto;
  return n;
}

function crearTarjeta(cat, mod, indice) {
  const a = nodo("a", "cx-mod");
  a.href = mod.href;
  a.dataset.boom = cat.id;
  a.dataset.boomNombre = mod.label;
  a.setAttribute("data-boom-origen", "");
  a.style.setProperty("--i", String(indice));
  a.style.setProperty("--tono-fondo", `var(--cx-tono-${cat.id}-fondo, var(--cx-ink))`);
  a.style.setProperty("--tono-tinta", `var(--cx-tono-${cat.id}-tinta, var(--cx-champagne))`);

  const cara = nodo("span", "cx-mod__cara");
  const icono = nodo("span", "cx-mod__icono");
  icono.appendChild(iconoSeccion(cat.id));
  const textos = nodo("span", "cx-mod__textos");
  textos.append(nodo("b", "cx-mod__nombre", mod.label), nodo("small", "cx-mod__seccion", cat.label));
  const ir = nodo("span", "cx-mod__ir");
  ir.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>';
  cara.append(nodo("span", "cx-mod__brillo"), icono, textos, ir);
  if (mod.admin) cara.appendChild(Object.assign(nodo("span", "cx-mod__admin"), { title: "Administración" }));
  a.appendChild(cara);
  return a;
}

/** Inclinacion hacia el cursor + brillo. Un solo rAF por fotograma. */
function animarInclinacion(rejilla) {
  let pendiente = null, raf = 0;
  const aplicar = () => {
    raf = 0;
    if (!pendiente) return;
    const { cara, x, y } = pendiente;
    const r = cara.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (x - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (y - r.top) / r.height));
    cara.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
    cara.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
    cara.style.transform = `perspective(900px) rotateX(${((0.5 - py) * 9).toFixed(2)}deg) rotateY(${((px - 0.5) * 11).toFixed(2)}deg) translate3d(0,-3px,0)`;
  };
  rejilla.addEventListener("pointermove", e => {
    if (e.pointerType !== "mouse" || reducido()) return;
    const cara = e.target.closest(".cx-mod__cara");
    if (!cara) return;
    if (pendiente && pendiente.cara !== cara) soltar(pendiente.cara);
    cara.classList.add("is-inclinada");
    pendiente = { cara, x: e.clientX, y: e.clientY };
    if (!raf) raf = requestAnimationFrame(aplicar);
  }, { passive: true });
  const soltar = cara => { cara.classList.remove("is-inclinada"); cara.style.transform = ""; };
  rejilla.addEventListener("pointerout", e => {
    const cara = e.target.closest(".cx-mod__cara");
    if (cara && !cara.contains(e.relatedTarget)) { soltar(cara); if (pendiente?.cara === cara) pendiente = null; }
  });
}

/** En pantallas tactiles el brillo nace donde cae el dedo (lo enciende :active). */
function brilloAlTocar(rejilla) {
  rejilla.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse") return;
    const cara = e.target.closest(".cx-mod__cara");
    if (!cara) return;
    const r = cara.getBoundingClientRect();
    cara.style.setProperty("--mx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    cara.style.setProperty("--my", `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
  }, { passive: true });
}

/**
 * Pinta (o vuelve a pintar) las tarjetas dentro de `contenedor`.
 * @param contenedor elemento vacio de la pagina
 * @param categorias [{ id, label, modulos: [{ label, href, admin }] }]  (ya filtradas)
 */
export function pintarTarjetasModulos(contenedor, categorias = []) {
  if (!contenedor) return;
  contenedor.replaceChildren();
  const total = categorias.reduce((n, c) => n + c.modulos.length, 0);
  contenedor.hidden = total === 0;
  if (!total) return;

  const cabeza = nodo("div", "cx-modulos__cabeza");
  const titulos = nodo("div");
  titulos.append(nodo("span", "cx-modulos__kicker", "Accesos"), nodo("h2", "cx-modulos__titulo", "Tus módulos"));
  cabeza.append(titulos, nodo("span", "cx-modulos__cuenta", `${total} disponibles`));
  contenedor.appendChild(cabeza);

  let indice = 0;
  for (const cat of categorias) {
    const grupo = nodo("section", "cx-modulos__grupo");
    grupo.setAttribute("aria-label", cat.label);
    const titulo = nodo("h3", "cx-modulos__seccion");
    const ico = nodo("span", "cx-modulos__seccion-ico");
    ico.style.setProperty("--tono-fondo", `var(--cx-tono-${cat.id}-fondo, var(--cx-ink))`);
    ico.style.setProperty("--tono-tinta", `var(--cx-tono-${cat.id}-tinta, var(--cx-champagne))`);
    ico.appendChild(iconoSeccion(cat.id));
    titulo.append(ico, document.createTextNode(cat.label));
    const rejilla = nodo("div", "cx-modulos__rejilla");
    for (const mod of cat.modulos) rejilla.appendChild(crearTarjeta(cat, mod, indice++));
    grupo.append(titulo, rejilla);
    contenedor.appendChild(grupo);
    if (conRaton.matches) animarInclinacion(rejilla);
    else brilloAlTocar(rejilla);
  }

  // Movil: la lista es larga, asi que cada tarjeta llega al aparecer en pantalla.
  if (angosto.matches) {
    contenedor.dataset.visto = "uno";
    revelarAlEntrar(contenedor.querySelectorAll(".cx-mod"), { paso: 55 });
    return;
  }

  // Entrada escalonada cuando la seccion se ve (no animar lo que esta fuera de pantalla).
  if (reducido() || !("IntersectionObserver" in window)) {
    contenedor.dataset.visto = "true";
    return;
  }
  contenedor.dataset.visto = "false";
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    contenedor.dataset.visto = "true";
    io.disconnect();
  }, { rootMargin: "0px 0px -8% 0px" });
  io.observe(contenedor);
}
