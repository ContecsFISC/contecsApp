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
  const marcar = (el, d) => {
    el.style.setProperty("--d", `${d}ms`);
    el.classList.add("is-visto");
    io.unobserve(el);
  };
  const io = new IntersectionObserver(entradas => {
    let n = 0, ultimo = -1;
    for (const e of entradas) {
      if (!e.isIntersecting || e.target.classList.contains("is-visto")) continue;
      ultimo = Math.max(ultimo, lista.indexOf(e.target));
      marcar(e.target, Math.min(n++, max) * paso);
    }
    // Un salto largo (fin de pagina, ancla) deja atras elementos que nunca
    // cruzaron la ventana: los anteriores al ultimo visto quedan revelados.
    for (let i = 0; i < ultimo; i++) {
      if (!lista[i].classList.contains("is-visto")) marcar(lista[i], 0);
    }
  }, { rootMargin: "0px 0px -6% 0px" });
  lista.forEach(el => io.observe(el));
}
