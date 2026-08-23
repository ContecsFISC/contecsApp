# Mapa de arquitectura — contecsApp

- Generado: **2026-08-23T03:35:58.037800+00:00**
- AlphaToolGraph: **v4.0.0** · esquema **4**
- Huella del proyecto: `6432abb95264865c…`
- Archivos analizados: **151**
- Relaciones internas tipadas: **472**
- Símbolos detectados: **3256**
- Llamadas detectadas: **7393**
- IDs DOM definidos: **760**
- Paquetes externos usados: **21**
- Colecciones de Firestore detectadas: **27**
- Cloud Functions detectadas: **12**
- Archivos huerfanos: **62**
- Dependencias circulares: **0**
- Posibles acoples implicitos (via window.X, sin confirmar): **5**

- Diagnósticos: **0 errores · 0 advertencias**

## Cerebro para IA: tres niveles

- `GraphCompacto.json` — ~**8,251 tokens** · leer primero
- `GraphCompleto.json` — ~**45,071 tokens** · relaciones exactas
- `GraphProfundo.json` — ~**83,022 tokens** · evidencia exhaustiva
- Reducción estimada al empezar por el compacto: **90.1%** frente al profundo

## Diagnósticos de integridad

Hallazgos estáticos: deben confirmarse en código cuando intervienen rutas o valores dinámicos.

- 🔵 `js/modulos/voluntarios.js:225` — ID DOM opcional #sel-actividad no está en las páginas anfitrionas (uso protegido)

## Archivos de mayor RIESGO al modificar

Combina: cuantas conexiones tiene, si esta metido en un ciclo, y su tamaño. Revisa estos primero.

- `js/core/auth.js` — riesgo 250.3 (conexiones: 124, 235 lineas)
- `js/core/seguridad.js` — riesgo 100.4 (conexiones: 50, 40 lineas)
- `panel/dashboard.html` — riesgo 96.2 (conexiones: 40, 1618 lineas)
- `css/styles.css` — riesgo 67.7 (conexiones: 30, 774 lineas)
- `js/core/firebase-config.js` — riesgo 66.3 (conexiones: 33, 35 lineas)
- `panel/modulos/logistica/catalogo.html` — riesgo 60.9 (conexiones: 26, 885 lineas)
- `js/modulos/catalogo.js` — riesgo 59.5 (conexiones: 29, 150 lineas)
- `js/core/iconos.js` — riesgo 56.9 (conexiones: 28, 88 lineas)
- `js/modulos/voluntarios.js` — riesgo 55.8 (conexiones: 17, 2027 lineas)
- `js/core/operaciones.js` — riesgo 52.4 (conexiones: 25, 243 lineas)
- `js/modulos/ventaRapida.js` — riesgo 45.9 (conexiones: 19, 785 lineas)
- `js/modulos/compras2.js` — riesgo 42.2 (conexiones: 17, 822 lineas)
- `js/modulos/compras.js` — riesgo 37.5 (conexiones: 16, 550 lineas)
- `panel/modulos/congreso/modulos_participantes.html` — riesgo 37.5 (conexiones: 14, 947 lineas)
- `panel/modulos/finanzas/bitacora.html` — riesgo 31.8 (conexiones: 11, 984 lineas)

## God nodes (mas conectados) y que exponen

- `js/core/auth.js` — grado 124 | exporta: cargarUsuario, cerrarSesion, escucharCambiosDeRol, esperarSesionLista, getUsuarioActual, guardRoute, loginConGoogle, loginConSSO
- `js/core/seguridad.js` — grado 50 | exporta: escaparAtributo, escaparHtml, neutralizarFormulaHoja, urlHttpSegura, urlImagenSegura
- `panel/dashboard.html` — grado 40 | exporta: (sin exports detectados)
- `js/core/firebase-config.js` — grado 33 | exporta: analytics, app, auth, db, storage
- `css/styles.css` — grado 30 | exporta: (sin exports detectados)
- `js/modulos/catalogo.js` — grado 29 | exporta: ICONOS, ICONOS_CATEGORIA, ICONOS_PRODUCTO, TODOS_ICONOS, crearCategoria, crearProducto, desactivarProducto, editarCategoria
- `js/core/iconos.js` — grado 28 | exporta: ICONOS_DISPONIBLES, estrellasImg, iconoComboImg, iconoImg, nombreIconoCombo, rutaIcono
- `panel/modulos/logistica/catalogo.html` — grado 26 | exporta: (sin exports detectados)
- `js/core/operaciones.js` — grado 25 | exporta: ajustarStock, esperarAuthListo, formatearMoneda, registrarCompra, registrarMerma, registrarMovimientoFondo, registrarVenta, registrarVentaConMerma
- `js/modulos/ventaRapida.js` — grado 19 | exporta: (sin exports detectados)
- `js/modulos/compras2.js` — grado 17 | exporta: (sin exports detectados)
- `js/modulos/voluntarios.js` — grado 17 | exporta: (sin exports detectados)
- `js/modulos/compras.js` — grado 16 | exporta: (sin exports detectados)
- `js/core/permisos.js` — grado 14 | exporta: PERMISOS, ROLES, infoRol, permisosDeRol, tienePermiso
- `js/modulos/fondo.js` — grado 14 | exporta: (sin exports detectados)

## 🟡 Posibles acoples implicitos (via variables globales `window.X`)

Esto es HEURISTICO, no certeza — revisalo a ojo antes de asumir que es real:

- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/voluntarios.js`
- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/actividadVentas.js`
- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/inscripciones.js`
- `window.eliminarActividad` definida en `js/modulos/voluntarios.js`, leida en `docs/cambios recientes.md`
- `window.eliminarGira` definida en `js/modulos/voluntarios.js`, leida en `docs/cambios recientes.md`

## Cloud Functions detectadas

- `functions/index.js`: accederGiraParticipante, accederParticipante, ejecutarOperacionFinanciera, ejecutarOperacionQr, enviarCorreoQrParticipante, listarParticipantesParaGiras, marcarCheckpointGira, notificarPagoAprobado, notificarParticipantesGira, registrarParticipante, subirFotoEfectivo, validarTokenSSO

## Archivos huerfanos

- `AGENTS.md`
- `assets/img/fisc-logo.png`
- `assets/img/utp-logo.png`
- `docs/Sprint 2 - bitacora_actualizaciones.md`
- `docs/cambios recientes.md`
- `firebase.json`
- `firebase_rules/firebase_backup.json`
- `firebase_rules/firestore.indexes.json`
- `firebase_rules/firestore.rules`
- `firebase_rules/storage.rules`
- `functions/.eslintrc.js`
- `functions/package.json`
- `functions/templates/correo-notificacion-gira.html`
- `functions/templates/correo-pago-aprobado.html`
- `icons/bebida-lata.svg`
- `img/iconos/agua.svg`
- `img/iconos/bubble_tea.svg`
- `img/iconos/cafe.svg`
- `img/iconos/caja.svg`
- `img/iconos/cat_bebidas.svg`
- `img/iconos/cat_comida.svg`
- `img/iconos/cat_dulces.svg`
- `img/iconos/cat_otros.svg`
- `img/iconos/cat_postres.svg`
- `img/iconos/cat_snacks.svg`
- `img/iconos/chocolate.svg`
- `img/iconos/combo.svg`
- `img/iconos/combo_hamburguesa_soda.svg`
- `img/iconos/combo_pizza_soda.svg`
- `img/iconos/donut.svg`
- `img/iconos/dulce.svg`
- `img/iconos/dulce_alt.svg`
- `img/iconos/estrella.svg`
- `img/iconos/extra_sin_identificar_1.svg`
- `img/iconos/galleta.svg`
- `img/iconos/galleta_alt.svg`
- `img/iconos/hamburguesa.svg`
- `img/iconos/helado.svg`
- `img/iconos/hotdog.svg`
- `img/iconos/jugo.svg`
- ...y 22 mas

## Colecciones de Firestore y quien las usa

### `actividades_ventas`
- `functions/operaciones-financieras.js`
- `js/modulos/actividadVentas.js`
- `js/modulos/ventaRapida.js`
- `js/modulos/voluntarios.js`
- `panel/modulos/finanzas/bitacora.html`

### `actividades_voluntarios`
- `functions/operaciones-qr.js`
- `js/modulos/informeActividad.js`
- `js/modulos/lecturaQRVoluntarios.js`
- `js/modulos/reportes_estadisticaCont.js`
- `js/modulos/voluntarios.js`

### `asignaciones_voluntarios`
- `js/modulos/voluntarios.js`

### `asistencias_congreso`
- `functions/operaciones-qr.js`
- `functions/test/operaciones-qr.integration.js`
- `js/modulos/inscripciones.js`
- `js/modulos/reportes_estadisticaCont.js`

### `asistencias_giras`
- `functions/index.js`
- `functions/operaciones-qr.js`

### `asistencias_voluntarios`
- `functions/operaciones-qr.js`
- `js/modulos/lecturaQRVoluntarios.js`
- `js/modulos/reportes_estadisticaCont.js`
- `js/modulos/voluntarios.js`

### `categorias`
- `js/modulos/catalogo.js`
- `js/modulos/reporteFinancieroExcel.js`

### `checkpoints`
- `functions/operaciones-qr.js`
- `functions/test/operaciones-qr.integration.js`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- `js/modulos/reportes_estadisticaCont.js`
- `panel/dashboard.html`

### `compras`
- `functions/operaciones-financieras.js`
- `js/core/operaciones.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `panel/modulos/finanzas/bitacora.html`

### `eventos`
- `functions/operaciones-qr.js`
- `functions/test/operaciones-qr.integration.js`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- `panel/dashboard.html`

### `fondos`
- `js/modulos/detalleFondo.js`
- `js/modulos/fondo.js`
- `panel/dashboard.html`

### `fondos_entrada`
- `functions/operaciones-financieras.js`
- `js/modulos/detalleFondo.js`
- `js/modulos/fondo.js`
- `panel/modulos/finanzas/bitacora.html`

### `giras_voluntarios`
- `functions/index.js`
- `functions/operaciones-qr.js`
- `js/modulos/lecturaQRGiras.js`
- `js/modulos/voluntarios.js`

### `identificadores_participantes`
- `functions/index.js`

### `informes_actividad`
- `js/modulos/informeActividad.js`

### `inscripciones`
- `functions/test/operaciones-qr.integration.js`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- `js/modulos/reportes_estadisticaCont.js`

### `inscripciones_checkpoint`
- `functions/operaciones-qr.js`
- `functions/test/operaciones-qr.integration.js`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- `js/modulos/reportes_estadisticaCont.js`

### `limites_registro`
- `functions/index.js`

### `mermas`
- `functions/operaciones-financieras.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `panel/modulos/finanzas/bitacora.html`

### `movimientos_inventario`
- `functions/operaciones-financieras.js`
- `panel/modulos/finanzas/bitacora.html`

### `participantes`
- `functions/index.js`
- `functions/operaciones-qr.js`
- `functions/test/operaciones-qr.integration.js`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- `js/modulos/reportes_estadisticaCont.js`
- `panel/dashboard.html`
- `panel/modulos/congreso/modulos_participantes.html`

### `productos`
- `functions/operaciones-financieras.js`
- `js/modulos/actividadVentas.js`
- `js/modulos/catalogo.js`
- `js/modulos/compras.js`
- `js/modulos/compras2.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `js/modulos/ventaRapida.js`
- `panel/dashboard.html`
- `panel/modulos/finanzas/bitacora.html`
- ...y 1 archivos mas

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
- `functions/index.js`
- `functions/operaciones-financieras.js`
- `functions/operaciones-qr.js`
- `functions/test/operaciones-qr.integration.js`
- `index.html`
- `js/core/auth.js`
- `js/modulos/actividadVentas.js`
- `js/modulos/agendarReunion.js`
- `js/modulos/detalleFondo.js`
- `js/modulos/fondo.js`
- ...y 5 archivos mas

### `ventas`
- `functions/operaciones-financieras.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `panel/modulos/finanzas/bitacora.html`

### `voluntarios`
- `functions/operaciones-qr.js`
- `js/modulos/lecturaQRVoluntarios.js`
- `js/modulos/reportes_estadisticaCont.js`
- `js/modulos/voluntarios.js`
- `panel/dashboard.html`

## Cobertura de reglas de Firestore

- `actividades_ventas` — regla explícita · 8 operaciones detectadas
- `actividades_voluntarios` — regla explícita · 9 operaciones detectadas
- `asignaciones_voluntarios` — regla explícita · 4 operaciones detectadas
- `asistencias_congreso` — regla explícita · 4 operaciones detectadas
- `asistencias_giras` — regla explícita · 1 operaciones detectadas
- `asistencias_voluntarios` — regla explícita · 2 operaciones detectadas
- `categorias` — regla explícita · 4 operaciones detectadas
- `checkpoints` — regla explícita · 9 operaciones detectadas
- `compras` — regla explícita · 4 operaciones detectadas
- `comprobantes` — regla explícita · 0 operaciones detectadas
- `contadores` — regla explícita · 0 operaciones detectadas
- `eventos` — regla explícita · 8 operaciones detectadas
- `fondos` — regla explícita · 1 operaciones detectadas
- `fondos_entrada` — regla explícita · 6 operaciones detectadas
- `giras_voluntarios` — regla explícita · 6 operaciones detectadas
- `identificadores_participantes` — regla explícita · 0 operaciones detectadas
- `informes_actividad` — regla explícita · 2 operaciones detectadas
- `inscripciones` — regla explícita · 3 operaciones detectadas
- `inscripciones_checkpoint` — regla explícita · 7 operaciones detectadas
- `limites_registro` — regla explícita · 0 operaciones detectadas
- `mermas` — regla explícita · 3 operaciones detectadas
- `movimientos_inventario` — regla explícita · 1 operaciones detectadas
- `participantes` — regla explícita · 10 operaciones detectadas
- `productos` — regla explícita · 19 operaciones detectadas
- `reuniones` — regla explícita · 8 operaciones detectadas
- `solicitudes_actividad` — regla explícita · 4 operaciones detectadas
- `usuarios` — regla explícita · 12 operaciones detectadas
- `ventas` — regla explícita · 4 operaciones detectadas
- `voluntarios` — regla explícita · 9 operaciones detectadas

## Tipos de relaciones

- `calls_imported_symbol`: 180
- `imports`: 149
- `navigates_to`: 57
- `loads_script`: 37
- `loads_stylesheet`: 30
- `loads_asset`: 19

## Paquetes/SDKs externos

- `crypto` — usado en 1 archivo(s)
- `firebase-admin/app` — usado en 2 archivo(s)
- `firebase-admin/auth` — usado en 1 archivo(s)
- `firebase-admin/firestore` — usado en 4 archivo(s)
- `firebase-admin/storage` — usado en 1 archivo(s)
- `firebase-functions/params` — usado en 1 archivo(s)
- `firebase-functions/v2/firestore` — usado en 1 archivo(s)
- `firebase-functions/v2/https` — usado en 3 archivo(s)
- `fs` — usado en 1 archivo(s)
- `https` — usado en 1 archivo(s)
- `https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.min.js` — usado en 2 archivo(s)
- `https://contecsfisc.github.io/contecsApp/logocontecs.png` — usado en 3 archivo(s)
- `https://esm.sh/docx@9` — usado en 3 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-analytics.js` — usado en 1 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js` — usado en 1 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js` — usado en 5 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js` — usado en 31 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js` — usado en 5 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js` — usado en 3 archivo(s)
- `node:assert/strict` — usado en 1 archivo(s)
- `path` — usado en 1 archivo(s)
