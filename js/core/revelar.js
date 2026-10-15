// ═══════════════════════════════════════════════════════════════
// CONTECS — Revelar al entrar en pantalla
//
// Marca cada elemento con .is-visto cuando aparece en la ventana. Los que
// entran juntos (al cargar, o una fila de tarjetas al hacer scroll) reciben
// un retraso escalonado en --d para llegar en cascada y no de golpe.
// La animacion y el estado oculto inicial los pone el CSS (solo transform y
// opacity); aqui no se mide nada en cada fotograma: un IntersectionObserver.
// ═══════════════════════════════════════════════════════════════

const reducido = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * @param elementos lista o NodeList de elementos a revelar
 * @param opciones  { paso: ms entre uno y otro, max: tope de pasos }
 */
export function revelarAlEntrar(elementos, { paso = 60, max = 8 } = {}) {
  const lista = [...elementos].filter(Boolean);
  if (!lista.length) return;
  if (reducido() || !("IntersectionObserver" in window)) {
    lista.forEach(el => el.classList.add("is-visto"));
    return;
  }
  const io = new IntersectionObserver(entradas => {
    let n = 0;
    for (const e of entradas) {
      if (!e.isIntersecting) continue;
      e.target.style.setProperty("--d", `${Math.min(n++, max) * paso}ms`);
      e.target.classList.add("is-visto");
      io.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -6% 0px" });
  lista.forEach(el => io.observe(el));
}
