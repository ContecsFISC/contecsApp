// ═══════════════════════════════════════════════════════════════
// CONTECS — Navbar en las paginas de modulo (y publicas con .topbar)
//
// Reemplaza al topbar: monta el MISMO navbar del dashboard (secciones con
// desplegables, carril lateral al hacer scroll). El .topbar de la pagina deja
// de ser una barra y pasa a ser la cabecera de la pagina (titulo + acciones),
// sin mover ni recrear sus nodos: ids, data-permiso y listeners siguen igual.
//
// Las secciones son las de js/core/navegacion.js filtradas con el mismo
// tienePermiso() de siempre, cuando la sesion de la pagina ya esta lista.
// En paginas publicas (fuera de /panel/) no hay secciones ni "Salir".
// ═══════════════════════════════════════════════════════════════
import { montarNavbar } from "./navbar.js?v=20261015.5";
import { CATEGORIAS, categoriasPara } from "./navegacion.js?v=20261015.3";

const raizSitio = new URL("../../", import.meta.url);   // js/core/ -> raiz del sitio
const panel = new URL("panel/", raizSitio);
const enPanel = location.pathname.includes("/panel/");

async function cerrarSesionPagina() {
  const { cerrarSesion } = await import("./auth.js");
  return cerrarSesion();
}

const nav = montarNavbar({
  marca: {
    titulo: "CONTECS",
    logo: new URL("img/ui/contecs-mark-champagne.png", raizSitio).href,
    href: enPanel ? new URL("dashboard.html", panel).href : location.href,
  },
  alCerrarSesion: enPanel ? cerrarSesionPagina : null,
  conEspaciador: false,
});

// La cabecera de la pagina (antes topbar) se alinea con el contenido: mismo
// ancho y relleno que el primer .container (cada pagina tiene el suyo).
const cabecera = document.querySelector(".topbar");
const contenido = document.querySelector(".container");
if (cabecera && contenido) {
  const alinear = () => {
    const cs = getComputedStyle(contenido);
    cabecera.style.setProperty("--cabecera-ancho", `${contenido.offsetWidth}px`);
    cabecera.style.setProperty("--cabecera-pi", cs.paddingLeft);
    cabecera.style.setProperty("--cabecera-pd", cs.paddingRight);
  };
  alinear();
  new ResizeObserver(alinear).observe(contenido);
}

// Antetitulo de la cabecera en movil (css/movil.css): la seccion del panel a
// la que pertenece la pagina; si el modulo no esta en el menu, la de su carpeta.
if (cabecera && enPanel) {
  const ruta = location.pathname;
  const carpeta = ruta.match(/\/modulos\/([^/]+)\//)?.[1];
  const seccion =
    CATEGORIAS.find(c => c.modulos.some(m => ruta.endsWith("/" + m.href))) ||
    CATEGORIAS.find(c => c.id === carpeta);
  if (seccion) cabecera.dataset.cxSeccion = seccion.label;
}

// Movil y tablet: tarjetas y filas entran en cascada al aparecer.
if (matchMedia("(max-width: 1023.98px)").matches) {
  import("./movil-paginas.js?v=20261015.4").then(m => m.iniciarMovilPaginas()).catch(() => {});
}

if (enPanel) {
  // Misma instancia que la pagina (misma URL de modulo): esperarSesionLista()
  // se resuelve cuando el guardRoute() de la pagina termina.
  const [{ esperarSesionLista, getUsuarioActual }, { tienePermiso, infoRol }] = await Promise.all([
    import("./auth.js"),
    import("./permisos.js"),
  ]);
  await esperarSesionLista();
  const usuario = getUsuarioActual();
  if (usuario.uid) {
    nav.establecerCategorias(categoriasPara(usuario, tienePermiso, href => new URL(href, panel).href));
    // La cuenta en la barra (nombre, rol, Inicio y Salir).
    nav.establecerPerfil({ nombre: usuario.nombre || "Usuario", rol: infoRol(usuario.rol || "sin_rol")?.label || "" });
  }
}
