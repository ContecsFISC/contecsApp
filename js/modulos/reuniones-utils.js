import { tienePermiso } from "../core/permisos.js";

// ¿El usuario puede ver esta reunión (en calendario o listados)?
export function usuarioPuedeVerReunion(reunion, usuario) {
  if (!usuario?.rol) return false;
  if (usuario.rol === "ceo") return true;
  if (tienePermiso(usuario.rol, "gestionar_secretaria")) return true; // secretario administra todas
  if (reunion.modoInvitados === "todos") return true;
  if (reunion.modoInvitados === "rol") return (reunion.invitadosRoles || []).includes(usuario.rol);
  if (reunion.modoInvitados === "individual") return (reunion.invitadosUids || []).includes(usuario.uid);
  return false;
}

// ¿El usuario puede crear/editar/eliminar reuniones y minutas?
export function usuarioPuedeGestionarMinuta(usuario) {
  return tienePermiso(usuario?.rol, "gestionar_secretaria");
}

// Resuelve modoInvitados + catálogo de usuarios a la lista real de invitados
export function resolverInvitados(reunion, listaUsuarios) {
  if (reunion.modoInvitados === "todos") return listaUsuarios;
  if (reunion.modoInvitados === "rol") {
    const roles = reunion.invitadosRoles || [];
    return listaUsuarios.filter(u => roles.includes(u.rol));
  }
  if (reunion.modoInvitados === "individual") {
    const uids = reunion.invitadosUids || [];
    return listaUsuarios.filter(u => uids.includes(u.id));
  }
  return [];
}

// Formatea la duración entre dos Timestamps/Dates como "1h 30min"
export function formatearDuracion(fechaInicio, fechaFin) {
  const di = fechaInicio?.toDate ? fechaInicio.toDate() : new Date(fechaInicio);
  const df = fechaFin?.toDate ? fechaFin.toDate() : new Date(fechaFin);
  const minutosTotal = Math.max(0, Math.round((df - di) / 60000));
  const horas = Math.floor(minutosTotal / 60);
  const minutos = minutosTotal % 60;
  if (horas === 0) return `${minutos}min`;
  if (minutos === 0) return `${horas}h`;
  return `${horas}h ${minutos}min`;
}
