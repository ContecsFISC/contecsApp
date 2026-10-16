// =============================================
// CONTECS — Hora del servidor para los lectores (Lectura QR y POSPER)
// =============================================
// Los celulares y equipos prestados suelen traer la hora o la zona horaria
// mal: con su reloj, "hoy" o "ahora" no coinciden con los checkpoints y el
// selector queda vacío o muestra los que no son. Se usa la hora del
// encabezado Date del servidor; si no llega, la del equipo.

import { enPanama } from "./permanencia.js";

let desfase = 0;

export async function sincronizarReloj() {
  try {
    const antes = Date.now();
    const r = await fetch(window.location.href, { method: "HEAD", cache: "no-store" });
    const servidor = Date.parse(r.headers.get("date") || "");
    if (!Number.isNaN(servidor)) desfase = servidor - Math.round((antes + Date.now()) / 2);
  } catch (_) {
    // Sin respuesta: se queda el reloj del equipo.
  }
}

// Milisegundos que el reloj del equipo va atrasado (+) o adelantado (−).
export const desfaseReloj = () => desfase;
export const ahoraMs = () => Date.now() + desfase;
export const ahoraPanama = () => enPanama(new Date(ahoraMs()));
