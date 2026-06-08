import { db } from "./firebase-config.js";
import {
  collection, query, where, limit, getDocs
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/**
 * Busca un participante por código + token directamente en Firestore.
 * Sin Cloud Functions — requiere índice compuesto: codigo ASC, token ASC
 */
export async function accederParticipante(codigo, token) {
  if (!codigo || !token) {
    throw new Error("Ingresa tu código de participante y tu código de acceso.");
  }

  const snap = await getDocs(
    query(
      collection(db, "participantes"),
      where("codigo", "==", codigo.trim().toUpperCase()),
      where("token",  "==", token.trim()),
      limit(1)
    )
  );

  if (snap.empty) {
    throw new Error("Código o clave incorrectos. Revisa el correo que recibiste al inscribirte.");
  }

  const data = snap.docs[0].data();

  // Devolver solo los campos que necesita perfil.html
  return {
    nombre:         data.nombre,
    apellido:       data.apellido,
    nombreCompleto: data.nombreCompleto,
    cedula:         data.cedula  || "",
    correo:         data.correo,
    telefono:       data.telefono || "",
    categoria:      data.categoria,
    categoriaNombre: data.categoriaNombre,
    institucion:    data.institucion || null,
    colegio:        data.colegio    || null,
    codigo:         data.codigo,
    token:          data.token,
    pago: {
      metodo:  data.pago?.metodo  || null,
      estado:  data.pago?.estado  || "pendiente_efectivo",
      monto:   data.pago?.monto   ?? null,
      aprobadoEn: data.pago?.aprobadoEn || null,
    },
    esColegio: !!data.esColegio,
  };
}
