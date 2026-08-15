# Mapa de arquitectura — contecsApp

- Archivos analizados: **78**
- Conexiones internas (imports): **147**
- Paquetes externos usados: **23**
- Colecciones de Firestore detectadas: **23**
- Cloud Functions detectadas: **1**
- Archivos huerfanos: **3**
- Dependencias circulares: **0**
- Posibles acoples implicitos (via window.X, sin confirmar): **3**

## Archivos de mayor RIESGO al modificar

Combina: cuantas conexiones tiene, si esta metido en un ciclo, y su tamaño. Revisa estos primero.

- `js/core/auth.js` — riesgo 88.1 (conexiones: 43, 210 lineas)
- `js/core/firebase-config.js` — riesgo 64.3 (conexiones: 32, 35 lineas)
- `js/modulos/voluntarios.js` — riesgo 30.4 (conexiones: 6, 1840 lineas)
- `js/core/operaciones.js` — riesgo 28.6 (conexiones: 10, 856 lineas)
- `js/modulos/ventas2.js` — riesgo 21.8 (conexiones: 5, 1182 lineas)
- `panel/dashboard.html` — riesgo 20.2 (conexiones: 5, 1025 lineas)
- `panel/modulos/congreso/modulos_participantes.html` — riesgo 19.1 (conexiones: 5, 910 lineas)
- `js/modulos/inscripciones.js` — riesgo 19.0 (conexiones: 2, 1497 lineas)
- `js/modulos/compras2.js` — riesgo 18.2 (conexiones: 5, 818 lineas)
- `js/modulos/catalogo.js` — riesgo 17.4 (conexiones: 8, 142 lineas)
- `js/core/permisos.js` — riesgo 16.8 (conexiones: 8, 80 lineas)
- `panel/modulos/voluntariado/voluntarios.html` — riesgo 16.6 (conexiones: 6, 456 lineas)
- `panel/modulos/congreso/inscripciones.html` — riesgo 16.5 (conexiones: 6, 447 lineas)
- `panel/modulos/finanzas/bitacora.html` — riesgo 15.8 (conexiones: 3, 981 lineas)
- `js/modulos/compras.js` — riesgo 15.5 (conexiones: 5, 547 lineas)

## God nodes (mas conectados) y que exponen

- `js/core/auth.js` — grado 43 | exporta: cargarUsuario, cerrarSesion, escucharCambiosDeRol, esperarSesionLista, getUsuarioActual, guardRoute, loginConGoogle, loginConSSO
- `js/core/firebase-config.js` — grado 32 | exporta: analytics, app, auth, db, storage
- `js/core/operaciones.js` — grado 10 | exporta: ajustarStock, esperarAuthListo, formatearMoneda, registrarCompra, registrarMerma, registrarMovimientoFondo, registrarVenta, registrarVentaConMerma
- `js/core/permisos.js` — grado 8 | exporta: PERMISOS, ROLES, infoRol, permisosDeRol, tienePermiso
- `js/modulos/catalogo.js` — grado 8 | exporta: ICONOS, ICONOS_CATEGORIA, ICONOS_PRODUCTO, TODOS_ICONOS, crearCategoria, crearProducto, desactivarProducto, editarCategoria
- `js/modulos/voluntarios.js` — grado 6 | exporta: (sin exports detectados)
- `panel/modulos/congreso/inscripciones.html` — grado 6 | exporta: (sin exports detectados)
- `panel/modulos/voluntariado/voluntarios.html` — grado 6 | exporta: (sin exports detectados)
- `panel/dashboard.html` — grado 5 | exporta: (sin exports detectados)
- `js/libs/xlsx.full.min.js` — grado 5 | exporta: (sin exports detectados)
- `js/modulos/compras.js` — grado 5 | exporta: (sin exports detectados)
- `js/modulos/compras2.js` — grado 5 | exporta: (sin exports detectados)
- `js/modulos/detalleFondo.js` — grado 5 | exporta: (sin exports detectados)
- `js/modulos/reuniones-utils.js` — grado 5 | exporta: formatearDuracion, resolverInvitados, usuarioPuedeGestionarMinuta, usuarioPuedeVerReunion
- `js/modulos/ventaRapida.js` — grado 5 | exporta: (sin exports detectados)

## 🟡 Posibles acoples implicitos (via variables globales `window.X`)

Esto es HEURISTICO, no certeza — revisalo a ojo antes de asumir que es real:

- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/actividadVentas.js`
- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/inscripciones.js`
- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/voluntarios.js`

## Cloud Functions detectadas

- `functions/index.js`: accederParticipante, enviarCorreoQrParticipante, notificarPagoAprobado, registrarParticipante, subirFotoEfectivo, validarTokenSSO

## Archivos huerfanos

- `functions/.eslintrc.js`
- `functions/templates/correo-pago-aprobado.html`
- `index.html`

## Colecciones de Firestore y quien las usa

### `actividades_ventas`
- `js/modulos/actividadVentas.js`
- `js/modulos/ventaRapida.js`
- `js/modulos/ventas2.js`
- `js/modulos/voluntarios.js`
- `panel/modulos/finanzas/bitacora.html`

### `actividades_voluntarios`
- `js/modulos/informeActividad.js`
- `js/modulos/lecturaQRVoluntarios.js`
- `js/modulos/reportes_estadisticaCont.js`
- `js/modulos/voluntarios.js`

### `asignaciones_voluntarios`
- `js/modulos/voluntarios.js`

### `asistencias_voluntarios`
- `js/modulos/lecturaQRVoluntarios.js`
- `js/modulos/reportes_estadisticaCont.js`
- `js/modulos/voluntarios.js`

### `categorias`
- `js/modulos/catalogo.js`
- `js/modulos/reporteFinancieroExcel.js`

### `checkpoints`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- `js/modulos/reportes_estadisticaCont.js`

### `compras`
- `js/core/operaciones.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `panel/modulos/finanzas/bitacora.html`

### `eventos`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`

### `fondos`
- `js/core/operaciones.js`
- `js/modulos/detalleFondo.js`
- `js/modulos/fondo.js`
- `panel/dashboard.html`

### `fondos_entrada`
- `js/core/operaciones.js`
- `js/modulos/detalleFondo.js`
- `js/modulos/fondo.js`
- `panel/modulos/finanzas/bitacora.html`

### `giras_voluntarios`
- `js/modulos/voluntarios.js`

### `informes_actividad`
- `js/modulos/informeActividad.js`

### `inscripciones`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`

### `inscripciones_checkpoint`
- `js/modulos/lecturaQR.js`
- `js/modulos/reportes_estadisticaCont.js`

### `mermas`
- `js/core/operaciones.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `panel/modulos/finanzas/bitacora.html`

### `movimientos_inventario`
- `js/core/operaciones.js`
- `panel/modulos/finanzas/bitacora.html`

### `participantes`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- `panel/dashboard.html`
- `panel/modulos/congreso/modulos_participantes.html`

### `productos`
- `js/core/operaciones.js`
- `js/modulos/actividadVentas.js`
- `js/modulos/catalogo.js`
- `js/modulos/compras.js`
- `js/modulos/compras2.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `js/modulos/ventaRapida.js`
- `js/modulos/ventas.js`
- `js/modulos/ventas2.js`
- ...y 3 archivos mas

### `reuniones`
- `js/modulos/agendarReunion.js`
- `js/modulos/minutaReunion.js`
- `js/modulos/minutas.js`
- `panel/dashboard.html`

### `solicitudes_actividad`
- `js/modulos/informeActividad.js`
- `js/modulos/solicitudActividad.js`
- `js/modulos/voluntarios.js`

### `usuarios`
- `js/core/auth.js`
- `js/modulos/actividadVentas.js`
- `js/modulos/agendarReunion.js`
- `js/modulos/detalleFondo.js`
- `js/modulos/fondo.js`
- `js/modulos/informeActividad.js`
- `js/modulos/minutaReunion.js`
- `js/modulos/usuarios.js`
- `panel/dashboard.html`
- `panel/index.html`

### `ventas`
- `js/core/operaciones.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `panel/modulos/finanzas/bitacora.html`

### `voluntarios`
- `js/modulos/lecturaQRVoluntarios.js`
- `js/modulos/reportes_estadisticaCont.js`
- `js/modulos/voluntarios.js`
- `panel/dashboard.html`

## Paquetes/SDKs externos

- `canvg` — usado en 1 archivo(s)
- `crypto` — usado en 1 archivo(s)
- `dompurify` — usado en 1 archivo(s)
- `firebase-admin/app` — usado en 1 archivo(s)
- `firebase-admin/auth` — usado en 1 archivo(s)
- `firebase-admin/firestore` — usado en 1 archivo(s)
- `firebase-admin/storage` — usado en 1 archivo(s)
- `firebase-functions/params` — usado en 1 archivo(s)
- `firebase-functions/v2/firestore` — usado en 1 archivo(s)
- `firebase-functions/v2/https` — usado en 1 archivo(s)
- `fs` — usado en 1 archivo(s)
- `html2canvas` — usado en 1 archivo(s)
- `https` — usado en 1 archivo(s)
- `https://cdn.jsdelivr.net/npm/chart.js` — usado en 2 archivo(s)
- `https://esm.sh/docx@9` — usado en 3 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-analytics.js` — usado en 1 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js` — usado en 1 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js` — usado en 5 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js` — usado en 31 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js` — usado en 2 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js` — usado en 3 archivo(s)
- `path` — usado en 1 archivo(s)
- `worker_threads` — usado en 1 archivo(s)
