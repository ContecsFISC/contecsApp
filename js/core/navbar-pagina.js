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

// Una linea que explica cada modulo, bajo el titulo (como las paginas del
// proyecto de referencia). Solo texto de presentacion.
const DESCRIPCIONES = {
  "agendarReunion.html":          "Programa una reunión, define su agenda e invita a quienes deben asistir.",
  "exportar.html":                "Exporta reportes y bitácoras del sistema.",
  "minutaReunion.html":           "La minuta de la reunión: lo que se trató y lo que se acordó.",
  "minutas.html":                 "Las reuniones agendadas y sus minutas.",
  "secretaria.html":              "Minutas, reuniones y calendario de la secretaría.",
  "usuarios.html":                "Cuentas, roles y permisos de quienes usan el panel.",
  "credenciales.html":            "Credenciales de participantes, voluntarios, comité y expositores: cuáles faltan y cuáles ya se imprimieron.",
  "inscripciones.html":           "Eventos, inscritos y asistencia del congreso.",
  "lecturaQR.html":               "Escanea la credencial para marcar la entrada a cada checkpoint.",
  "modulos_participantes.html":   "Registrados, pagos y comprobantes de los participantes.",
  "reportes_estadisticaCont.html":"Actividades, asistencias y horas del congreso.",
  "bitacora.html":                "Historial de ventas, compras, fondos, inventario y mermas.",
  "compras.html":                 "Registra las compras de productos y su costo.",
  "compras2.html":                "Registra las compras de productos y su costo.",
  "detalleFondo.html":            "Movimientos del fondo: balance, ingresos y egresos.",
  "fondos.html":                  "Balance del fondo y registro de movimientos, en tiempo real.",
  "reportes.html":                "Reportes financieros y estadísticas del evento.",
  "reportes_financieros.html":    "Ventas, compras, ganancia y pérdidas.",
  "ventaRapida.html":             "Registra las ventas de cada actividad de venta.",
  "actividadVentas.html":         "Crea actividades de venta y asígnales productos o combos.",
  "catalogo.html":                "Categorías y productos que se pueden vender.",
  "inventario.html":              "Existencias de cada producto y alertas de stock bajo o agotado.",
  "actividades.html":             "Actividades de voluntariado, con sus solicitudes e informes.",
  "calendario.html":              "Actividades, giras, ventas y reuniones en un solo calendario.",
  "giras.html":                   "Giras académicas: participantes, cupos y check-in.",
  "informeActividad.html":        "El informe de una actividad realizada.",
  "lecturaQRGiras.html":          "Escanea el QR para el check-in y check-out de las giras.",
  "lecturaQRVoluntarios.html":    "Escanea el QR de los voluntarios para registrar su asistencia.",
  "solicitudActividad.html":      "Solicita una nueva actividad de voluntariado.",
  "voluntarios.html":             "Voluntarios, áreas asignadas y asistencias.",
};

// Cabecera (css/movil.css): antetitulo con la seccion del panel (si el modulo
// no esta en el menu, la de su carpeta), descripcion y titulo palabra por palabra.
if (cabecera && enPanel) {
  const ruta = location.pathname;
  const carpeta = ruta.match(/\/modulos\/([^/]+)\//)?.[1];
  const seccion =
    CATEGORIAS.find(c => c.modulos.some(m => ruta.endsWith("/" + m.href))) ||
    CATEGORIAS.find(c => c.id === carpeta);
  if (seccion) cabecera.dataset.cxSeccion = seccion.label;
  const descripcion = DESCRIPCIONES[ruta.split("/").pop()];
  if (descripcion) cabecera.dataset.cxDescripcion = descripcion;

  // Solo si el titulo es texto plano (POSPER lleva su logo). Si la pagina lo
  // cambia despues (p. ej. "Minuta — cargando…"), lo reemplaza como siempre.
  const h1 = cabecera.querySelector("h1");
  const texto = h1?.textContent.trim();
  if (h1 && texto && [...h1.childNodes].every(n => n.nodeType === Node.TEXT_NODE)
      && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const palabras = texto.split(/\s+/);
    const natural = Math.max(palabras.length - 1, 0) * 0.05;
    const factor = natural > 0.35 ? 0.35 / natural : 1;
    h1.replaceChildren();
    palabras.forEach((p, i) => {
      const span = document.createElement("span");
      span.className = "cx-palabra";
      span.style.animationDelay = `${(0.12 + i * 0.05 * factor).toFixed(3)}s`;
      span.textContent = p;
      h1.append(span, i < palabras.length - 1 ? " " : "");
    });
  }
}

// Tarjetas y filas entran en cascada al aparecer (en todas las anchuras).
import("./movil-paginas.js?v=20261015.4").then(m => m.iniciarMovilPaginas()).catch(() => {});

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
