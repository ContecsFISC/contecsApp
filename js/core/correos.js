// Lectura de direcciones de correo escritas a mano.
//
// Vive aparte para que se pueda probar con el código real en vez de una copia
// (functions/test/correos.test.mjs). El equivalente del servidor está en
// functions/identidad.js: las dos expresiones deben ser idénticas y hay una
// prueba que lo comprueba, porque el navegador nunca es la última palabra —
// los roles con escritura sobre `giras_voluntarios` pueden guardar entradas
// sin pasar nunca por este parseo.

// Deliberadamente estricta. Una versión permisiva como
// /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/ acepta pegados reales que después rebotan en
// el proveedor de correo sin decir cuál falló: "mailto:ana@gmail.com",
// "ana@gmail.com." (copiado de una frase), "<ana@gmail.com" y "ana@gmail.com>"
// (líneas partidas por el corchete).
export const RE_CORREO =
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export function esCorreoValido(valor) {
  const texto = String(valor ?? "").trim();
  return texto.length > 0 && texto.length <= 254 && RE_CORREO.test(texto);
}

// Acepta "correo@x.com" y "Nombre Apellido <correo@x.com>". Devuelve null si no
// hay una dirección reconocible.
//
// El nombre no puede contener "@", "<" ni ">": sin esa condición, pegar dos
// direcciones en una misma línea ("Ana <ana@x.com> <b@c.com>") hacía que la
// primera se tragara como parte del nombre y se perdiera sin aviso.
export function parsearEntradaCorreo(texto) {
  const bruto = String(texto ?? "").trim();
  if (!bruto) return null;

  const conNombre = bruto.match(/^(.*?)<([^>]+)>$/);
  const nombre = conNombre ?
    conNombre[1].trim().replace(/^["']|["']$/g, "") : "";
  if (/[@<>]/.test(nombre)) return null;

  const correo = (conNombre ? conNombre[2] : bruto).trim().toLowerCase();
  if (!esCorreoValido(correo)) return null;
  return { correo, nombre };
}

// Parte lo que el staff pegó (saltos de línea, comas o punto y coma) y separa
// lo legible de lo que no se pudo interpretar, para poder devolverle lo malo en
// vez de descartarlo en silencio.
export function parsearListaCorreos(texto, yaExistentes = []) {
  const vistos = new Set(yaExistentes);
  const validos = [];
  const invalidos = [];
  let repetidos = 0;

  String(texto ?? "").split(/[\n,;]+/).map(t => t.trim()).filter(Boolean)
    .forEach(parte => {
      const entrada = parsearEntradaCorreo(parte);
      if (!entrada) { invalidos.push(parte); return; }
      if (vistos.has(entrada.correo)) { repetidos += 1; return; }
      vistos.add(entrada.correo);
      validos.push(entrada);
    });

  return { validos, invalidos, repetidos };
}
