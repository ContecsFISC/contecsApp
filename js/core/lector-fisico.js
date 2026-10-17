// =============================================
// CONTECS — Lector físico de los equipos del congreso
// =============================================
// Memor 12, HT330, EDA51-1, EA530 y EDA52 traen un lector que se dispara con
// el botón lateral y "teclea" lo que lee en el campo que tenga el foco
// (emulación de teclado). Este módulo mantiene ese campo con foco permanente,
// sin teclado en pantalla y sin mostrar el texto que va escribiendo el
// lector, y entrega la lectura entera a la página (posper.js, lecturaQR.js).
//
// Una lectura termina con:
//   - Enter o Tab, también cuando el equipo los manda como tecla
//     "Unidentified" con keyCode 13/9 (HT330);
//   - un silencio sin texto nuevo (lectores sin sufijo);
//   - el valor quieto entre dos revisiones (servicios de Android que
//     escriben el campo sin disparar eventos).
//
// HT330: con su teclado físico en modo letras, los números que manda el
// lector llegan como letras (5 → j, 4 → g). Si el navegador informa qué tecla
// física fue (KeyboardEvent.code "Digit5"), se escribe el número. Igual
// conviene dejar ese teclado en modo 123.

const SILENCIO_FIN_MS = 600;
const LONGITUD_MAX_LECTURA = 2048;
// "1" = mostrar el teclado en pantalla en este equipo (si con el teclado
// oculto el lector no llega a la página). Se comparte entre POSPER y Lectura QR.
const CLAVE_TECLADO = "lector.tecladoVisible";

const ES_TERMINADOR = e => e.key === "Enter" || e.key === "Tab" || e.keyCode === 13 || e.keyCode === 9;
const nombreTerminador = e => (e.key === "Tab" || e.keyCode === 9 ? "Tab" : "Enter") +
  (e.key === "Enter" || e.key === "Tab" ? "" : ` (${e.key || "?"} ${e.keyCode})`);

// El número de la tecla física cuando el teclado del equipo lo cambió por una
// letra; null si no aplica (un teclado normal nunca da letras en Digit*).
function digitoReparado(e) {
  const digito = /^(?:Digit|Numpad)(\d)$/.exec(e.code || "")?.[1];
  return digito && /^[a-z]$/i.test(e.key || "") ? digito : null;
}

/**
 * @param {object} o
 * @param {HTMLInputElement} o.campo  campo de captura (type="text")
 * @param {(texto: string, info: object) => void} o.alLeer  lectura completa
 * @param {() => boolean} [o.aceptaTeclasSueltas]  juntar teclas que llegan al
 *   documento cuando el campo perdió el foco (solo mientras se escanea)
 * @param {() => void} [o.alEmpezar]  llegó el primer carácter de una lectura
 * @param {(conFoco: boolean) => void} [o.alFoco]
 * @param {(tecla: string) => void} [o.alTeclaEspecial]  para el diagnóstico
 */
export function crearLectorFisico({ campo, alLeer, aceptaTeclasSueltas = () => true, alEmpezar, alFoco, alTeclaEspecial }) {
  const lectura = { inicio: 0, metodo: "teclado", timer: null, componiendo: false, ultimoValor: "", reparados: 0 };
  let activo = true;

  // El texto del lector no se ve: la página muestra "Leyendo…" y el resultado.
  campo.style.color = "transparent";
  campo.style.caretColor = "transparent";
  campo.style.textShadow = "none";
  campo.setAttribute("autocomplete", "off");
  campo.setAttribute("autocorrect", "off");
  campo.setAttribute("autocapitalize", "off");
  campo.setAttribute("spellcheck", "false");
  campo.setAttribute("enterkeyhint", "done");

  let tecladoVisible = false;
  try { tecladoVisible = localStorage.getItem(CLAVE_TECLADO) === "1"; } catch (_) { /* sin almacenamiento */ }
  aplicarTeclado();

  function aplicarTeclado() {
    if (tecladoVisible) campo.removeAttribute("inputmode");
    else campo.setAttribute("inputmode", "none");
  }

  // Solo se cede el foco a donde se escribe a mano (o a un selector abierto).
  // Casillas y botones no: tras tocarlos, el lector debe seguir escuchando.
  function enfocar() {
    if (!activo) return;
    const actual = document.activeElement;
    if (actual && actual !== campo && actual.matches?.("select, textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit])")) return;
    campo.focus({ preventScroll: true });
  }
  // Al elegir algo en un selector (evento, checkpoint) o marcar una casilla,
  // el foco vuelve al lector (si no, las lecturas irían al selector y hasta
  // podrían cambiar el evento escribiendo sobre él).
  document.addEventListener("change", e => {
    if (e.target !== campo && e.target.matches?.("select, input[type=checkbox], input[type=radio]")) {
      setTimeout(() => { e.target.blur?.(); enfocar(); }, 60);
    }
  }, true);

  function empezar() {
    if (lectura.inicio) return;
    lectura.inicio = performance.now();
    alEmpezar?.();
  }

  function programarFin() {
    clearTimeout(lectura.timer);
    // Mientras el teclado del equipo compone texto se espera más para no cortar.
    const pausa = lectura.componiendo ? SILENCIO_FIN_MS * 3 : SILENCIO_FIN_MS;
    lectura.timer = setTimeout(() => terminar("ninguno (pausa)"), pausa);
  }

  function escribir(texto) {
    campo.value += texto;
    lectura.ultimoValor = "";
    programarFin();
  }

  function terminar(terminador) {
    clearTimeout(lectura.timer);
    const texto = campo.value.trim().slice(0, LONGITUD_MAX_LECTURA);
    const info = {
      terminador,
      metodo: lectura.reparados ? `${lectura.metodo} (${lectura.reparados} números reparados)` : lectura.metodo,
      duracion: lectura.inicio ? Math.round(performance.now() - lectura.inicio) : 0,
      longitud: texto.length,
    };
    campo.value = "";
    Object.assign(lectura, { inicio: 0, metodo: "teclado", ultimoValor: "", componiendo: false, reparados: 0 });
    if (texto && activo) alLeer(texto, info);
  }

  campo.addEventListener("focus", () => alFoco?.(true));
  campo.addEventListener("blur", () => {
    alFoco?.(false);
    setTimeout(() => {
      enfocar();
      alFoco?.(document.activeElement === campo);
    }, 60);
  });

  campo.addEventListener("keydown", e => {
    if (ES_TERMINADOR(e)) {
      e.preventDefault();
      if (campo.value.trim()) terminar(nombreTerminador(e));
      return;
    }
    const digito = digitoReparado(e);
    if (digito) {
      e.preventDefault();
      empezar();
      lectura.reparados += 1;
      escribir(digito);
      return;
    }
    if (e.key?.length === 1) empezar();
    else if (!["Shift", "Backspace"].includes(e.key)) alTeclaEspecial?.(`${e.key || "?"}${e.keyCode ? ` (${e.keyCode})` : ""}${e.code ? ` ${e.code}` : ""}`);
  });

  campo.addEventListener("paste", () => { lectura.metodo = "pegado"; });
  campo.addEventListener("input", () => {
    if (campo.value) empezar();
    // Algunos lectores entregan el texto completo en un solo evento y sin
    // Enter: se da por terminado cuando deja de llegar texto.
    programarFin();
  });
  campo.addEventListener("compositionstart", () => { lectura.componiendo = true; });
  campo.addEventListener("compositionend", () => {
    lectura.componiendo = false;
    programarFin();
  });

  setInterval(() => {
    const valor = campo.value;
    if (valor.trim() && valor === lectura.ultimoValor && !lectura.componiendo) {
      lectura.metodo = "texto sin eventos";
      terminar("ninguno (sin eventos)");
    }
    lectura.ultimoValor = campo.value;
  }, SILENCIO_FIN_MS);

  // El gatillo de algunos equipos llega como una tecla propia: se anota para
  // poder diagnosticar la configuración del lector.
  document.addEventListener("keydown", e => {
    if (e.target !== campo && e.key?.length !== 1 && !ES_TERMINADOR(e) && e.key !== "Shift") {
      alTeclaEspecial?.(`${e.key || "?"}${e.keyCode ? ` (${e.keyCode})` : ""}${e.code ? ` ${e.code}` : ""}`);
    }
  }, true);

  // Si el campo perdió el foco, los lectores que mandan pulsaciones de tecla
  // siguen llegando al documento: se juntan igual en el campo.
  document.addEventListener("keydown", e => {
    if (!activo || e.target === campo || !aceptaTeclasSueltas()) return;
    if (e.target.matches?.("select, textarea, input, button")) return;
    if (ES_TERMINADOR(e)) {
      if (!campo.value.trim()) return;
      e.preventDefault();
      terminar(nombreTerminador(e));
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const caracter = digitoReparado(e) || (e.key?.length === 1 ? e.key : "");
    if (!caracter) return;
    e.preventDefault();
    empezar();
    lectura.metodo = "teclas sin foco";
    if (caracter !== e.key) lectura.reparados += 1;
    escribir(caracter);
    enfocar();
  });

  // Tocar la pantalla devuelve el foco al campo (si no se tocó un control).
  document.addEventListener("pointerup", e => {
    if (!e.target.closest("select, input, textarea, button, a, summary, label")) enfocar();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) enfocar();
  });

  return {
    enfocar,
    /** Encendido: el campo recibe y entrega lecturas. Apagado (p. ej. con la
     *  cámara abierta): no roba el foco ni procesa nada. */
    activar(encendido) {
      activo = encendido;
      if (!encendido) {
        clearTimeout(lectura.timer);
        campo.value = "";
        campo.blur();
      } else {
        enfocar();
      }
    },
    get tecladoVisible() { return tecladoVisible; },
    mostrarTeclado(visible) {
      tecladoVisible = visible;
      try { localStorage.setItem(CLAVE_TECLADO, visible ? "1" : "0"); } catch (_) { /* solo esta visita */ }
      aplicarTeclado();
      // Re-enfocar para que el cambio de teclado se aplique ya.
      campo.blur();
      setTimeout(enfocar, 80);
    },
  };
}

// Equipos que entregó POSPER (solo para el diagnóstico: la lectura es la misma).
export const EQUIPOS_LECTOR = /EA530|EDA52|EDA51(?:-\d+)?|HT330|Memor ?12/i;

// Modelo y datos del equipo para el panel "Dispositivo y lector".
export async function leerDispositivo() {
  const ua = navigator.userAgent || "";
  const datos = {
    modelo: (ua.match(/Android [^;)]*;\s*([^;)]+?)(?:\s+Build|\))/) || [])[1] || "",
    sistema: (ua.match(/Android [\d.]+/) || [])[0] || navigator.platform || "",
    arquitectura: "",
  };
  try {
    const alta = await navigator.userAgentData?.getHighEntropyValues?.(
      ["model", "platform", "platformVersion", "architecture", "bitness"],
    );
    if (alta) {
      if (alta.model) datos.modelo = alta.model;
      if (alta.platform) datos.sistema = `${alta.platform} ${alta.platformVersion || ""}`.trim();
      datos.arquitectura = [alta.architecture, alta.bitness ? `${alta.bitness} bits` : ""].filter(Boolean).join(" ");
    }
  } catch (_) {
    // El navegador no comparte estos datos: se queda lo del user agent.
  }
  datos.equipo = `${datos.modelo} ${ua}`.match(EQUIPOS_LECTOR)?.[0]?.toUpperCase() || "";
  datos.navegador = (ua.match(/(Chrome|Firefox|SamsungBrowser|Edg)\/[\d.]+/) || [ua.slice(0, 60)])[0];
  return datos;
}
