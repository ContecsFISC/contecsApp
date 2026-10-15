// ═══════════════════════════════════════════════════════════════
// CONTECS — Entrada en cascada de las paginas de modulo (movil y tablet)
//
// Lo carga navbar-pagina.js solo por debajo de 1024 px. Las tarjetas y filas
// que quedan por DEBAJO de la pantalla esperan ocultas (.cx-asoma) y llegan
// escalonadas cuando el scroll las alcanza (revelar.js). Lo que ya se ve no
// se toca: ni parpadea al cargar ni cuando la pagina vuelve a pintar su lista.
// Los estilos estan en css/movil.css. Ninguna clase ni nodo de la pagina cambia.
// ═══════════════════════════════════════════════════════════════
import { revelarAlEntrar } from "./revelar.js?v=20261015.4";

// Bloques de contenido: las tarjetas comunes y las listas propias de cada modulo.
const BLOQUES = [
  ".card",
  ".chart-card",     // estadisticas del congreso
  ".cr-item",        // credenciales
  ".bita-card",      // bitacora
  ".venta-card",     // compras
  ".fondo-item",     // fondos
  ".cat-card",       // catalogo
  ".seccion-cat",    // inventario
  ".gira-card",      // giras
].join(",");
// Las tablas solo se apilan como tarjetas por debajo de 600 px (styles.css).
const FILAS = ".tabla-cards tbody > tr";
// Dentro de dialogos y modales todo se ve de una vez.
const FUERA = "dialog, .modal-overlay, .modal, .modal-box, .modal-content";

const angosto = matchMedia("(max-width: 600px)");
const selector = () => (angosto.matches ? `${BLOQUES},${FILAS}` : BLOQUES);
const preparados = new WeakSet();

function preparar(candidatos) {
  const nuevos = [];
  for (const el of candidatos) {
    if (preparados.has(el) || el.closest(FUERA)) continue;
    preparados.add(el);
    nuevos.push(el);
  }
  if (!nuevos.length) return;
  // Primero se lee (un solo calculo de layout), despues se escribe.
  const limite = innerHeight;
  const abajo = nuevos.filter(el => el.getBoundingClientRect().top > limite);
  if (!abajo.length) return;
  for (const el of abajo) el.classList.add("cx-asoma");
  revelarAlEntrar(abajo, { paso: 70, max: 6 });
}

export function iniciarMovilPaginas() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  preparar(document.querySelectorAll(selector()));

  // Listas que la pagina pinta despues (datos de Firebase, filtros, pestanas).
  // El observador corre antes del siguiente pintado: lo nuevo bajo la pantalla
  // nunca llega a verse en su sitio antes de ocultarse.
  let pendientes = [];
  new MutationObserver(registros => {
    const sel = selector();
    for (const r of registros) {
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches(sel)) pendientes.push(n);
        if (n.firstElementChild) pendientes.push(...n.querySelectorAll(sel));
      }
    }
    if (pendientes.length) { preparar(pendientes); pendientes = []; }
  }).observe(document.body, { childList: true, subtree: true });
}
