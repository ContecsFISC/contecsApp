# Mapa de arquitectura — contecsApp

- Generado: **2026-08-17T09:31:03.984976+00:00**
- AlphaToolGraph: **v4.0.0** · esquema **4**
- Huella del proyecto: `f632590c3e699398…`
- Archivos analizados: **143**
- Relaciones internas tipadas: **395**
- Símbolos detectados: **2743**
- Llamadas detectadas: **6252**
- IDs DOM definidos: **691**
- Paquetes externos usados: **20**
- Colecciones de Firestore detectadas: **23**
- Cloud Functions detectadas: **6**
- Archivos huerfanos: **61**
- Dependencias circulares: **0**
- Posibles acoples implicitos (via window.X, sin confirmar): **5**

- Diagnósticos: **0 errores · 1 advertencias**

## Cerebro para IA: tres niveles

- `GraphCompacto.json` — ~**6,875 tokens** · leer primero
- `GraphCompleto.json` — ~**39,309 tokens** · relaciones exactas
- `GraphProfundo.json` — ~**72,458 tokens** · evidencia exhaustiva
- Reducción estimada al empezar por el compacto: **90.5%** frente al profundo

## Diagnósticos de integridad

Hallazgos estáticos: deben confirmarse en código cuando intervienen rutas o valores dinámicos.

- 🟡 `public/ms/auth.html:161` — Destino de navegación no encontrado: ../dashboard.html
- 🔵 `js/modulos/voluntarios.js:186` — ID DOM opcional #sel-actividad no está en las páginas anfitrionas (uso protegido)

## Archivos de mayor RIESGO al modificar

Combina: cuantas conexiones tiene, si esta metido en un ciclo, y su tamaño. Revisa estos primero.

- `js/core/auth.js` — riesgo 236.2 (conexiones: 117, 221 lineas)
- `panel/dashboard.html` — riesgo 88.3 (conexiones: 39, 1026 lineas)
- `css/styles.css` — riesgo 62.9 (conexiones: 29, 486 lineas)
- `js/core/firebase-config.js` — riesgo 62.4 (conexiones: 31, 35 lineas)
- `js/modulos/catalogo.js` — riesgo 59.5 (conexiones: 29, 150 lineas)
- `js/core/operaciones.js` — riesgo 58.6 (conexiones: 25, 860 lineas)
- `js/core/iconos.js` — riesgo 56.9 (conexiones: 28, 88 lineas)
- `panel/modulos/logistica/catalogo.html` — riesgo 55.9 (conexiones: 24, 785 lineas)
- `js/modulos/voluntarios.js` — riesgo 41.9 (conexiones: 11, 1841 lineas)
- `js/modulos/ventaRapida.js` — riesgo 41.8 (conexiones: 17, 783 lineas)
- `js/modulos/compras2.js` — riesgo 40.2 (conexiones: 16, 820 lineas)
- `js/modulos/compras.js` — riesgo 35.5 (conexiones: 15, 548 lineas)
- `panel/modulos/congreso/modulos_participantes.html` — riesgo 31.1 (conexiones: 11, 910 lineas)
- `panel/modulos/voluntariado/voluntarios.html` — riesgo 30.6 (conexiones: 13, 456 lineas)
- `js/core/permisos.js` — riesgo 28.8 (conexiones: 14, 80 lineas)

## God nodes (mas conectados) y que exponen

- `js/core/auth.js` — grado 117 | exporta: cargarUsuario, cerrarSesion, escucharCambiosDeRol, esperarSesionLista, getUsuarioActual, guardRoute, loginConGoogle, loginConSSO
- `panel/dashboard.html` — grado 39 | exporta: (sin exports detectados)
- `js/core/firebase-config.js` — grado 31 | exporta: analytics, app, auth, db, storage
- `css/styles.css` — grado 29 | exporta: (sin exports detectados)
- `js/modulos/catalogo.js` — grado 29 | exporta: ICONOS, ICONOS_CATEGORIA, ICONOS_PRODUCTO, TODOS_ICONOS, crearCategoria, crearProducto, desactivarProducto, editarCategoria
- `js/core/iconos.js` — grado 28 | exporta: ICONOS_DISPONIBLES, estrellasImg, iconoComboImg, iconoImg, nombreIconoCombo, rutaIcono
- `js/core/operaciones.js` — grado 25 | exporta: ajustarStock, esperarAuthListo, formatearMoneda, registrarCompra, registrarMerma, registrarMovimientoFondo, registrarVenta, registrarVentaConMerma
- `panel/modulos/logistica/catalogo.html` — grado 24 | exporta: (sin exports detectados)
- `js/modulos/ventaRapida.js` — grado 17 | exporta: (sin exports detectados)
- `js/modulos/compras2.js` — grado 16 | exporta: (sin exports detectados)
- `js/modulos/compras.js` — grado 15 | exporta: (sin exports detectados)
- `js/core/permisos.js` — grado 14 | exporta: PERMISOS, ROLES, infoRol, permisosDeRol, tienePermiso
- `panel/modulos/admin/minutas.html` — grado 14 | exporta: (sin exports detectados)
- `js/modulos/fondo.js` — grado 13 | exporta: (sin exports detectados)
- `panel/modulos/voluntariado/voluntarios.html` — grado 13 | exporta: (sin exports detectados)

## 🟡 Posibles acoples implicitos (via variables globales `window.X`)

Esto es HEURISTICO, no certeza — revisalo a ojo antes de asumir que es real:

- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/actividadVentas.js`
- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/inscripciones.js`
- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/voluntarios.js`
- `window.eliminarActividad` definida en `js/modulos/voluntarios.js`, leida en `docs/cambios recientes.md`
- `window.eliminarGira` definida en `js/modulos/voluntarios.js`, leida en `docs/cambios recientes.md`

## Cloud Functions detectadas

- `functions/index.js`: accederParticipante, enviarCorreoQrParticipante, notificarPagoAprobado, registrarParticipante, subirFotoEfectivo, validarTokenSSO

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
- `img/iconos/manos.svg`
- ...y 21 mas

## Colecciones de Firestore y quien las usa

### `actividades_ventas`
- `js/modulos/actividadVentas.js`
- `js/modulos/ventaRapida.js`
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
- `functions/index.js`
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
- `index.html`
- `js/core/auth.js`
- `js/modulos/actividadVentas.js`
- `js/modulos/agendarReunion.js`
- `js/modulos/detalleFondo.js`
- `js/modulos/fondo.js`
- `js/modulos/informeActividad.js`
- `js/modulos/minutaReunion.js`
- `js/modulos/usuarios.js`
- ...y 2 archivos mas

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

## Cobertura de reglas de Firestore

- `actividades_ventas` — regla explícita · 9 operaciones detectadas
- `actividades_voluntarios` — regla explícita · 9 operaciones detectadas
- `asignaciones_voluntarios` — regla explícita · 4 operaciones detectadas
- `asistencias_voluntarios` — regla explícita · 5 operaciones detectadas
- `categorias` — regla explícita · 4 operaciones detectadas
- `checkpoints` — regla explícita · 8 operaciones detectadas
- `compras` — regla explícita · 5 operaciones detectadas
- `comprobantes` — regla explícita · 0 operaciones detectadas
- `contadores` — regla explícita · 0 operaciones detectadas
- `eventos` — regla explícita · 6 operaciones detectadas
- `fondos` — regla explícita · 1 operaciones detectadas
- `fondos_entrada` — regla explícita · 6 operaciones detectadas
- `giras_voluntarios` — regla explícita · 4 operaciones detectadas
- `informes_actividad` — regla explícita · 2 operaciones detectadas
- `inscripciones` — regla explícita · 3 operaciones detectadas
- `inscripciones_checkpoint` — regla explícita · 3 operaciones detectadas
- `mermas` — regla explícita · 4 operaciones detectadas
- `movimientos_inventario` — regla explícita · 1 operaciones detectadas
- `participantes` — regla explícita · 9 operaciones detectadas
- `productos` — regla explícita · 18 operaciones detectadas
- `reuniones` — regla explícita · 8 operaciones detectadas
- `solicitudes_actividad` — regla explícita · 4 operaciones detectadas
- `usuarios` — regla explícita · 12 operaciones detectadas
- `ventas` — regla explícita · 4 operaciones detectadas
- `voluntarios` — regla explícita · 10 operaciones detectadas

## Tipos de relaciones

- `calls_imported_symbol`: 143
- `imports`: 117
- `navigates_to`: 54
- `loads_script`: 35
- `loads_stylesheet`: 29
- `loads_asset`: 17

## Paquetes/SDKs externos

- `crypto` — usado en 1 archivo(s)
- `firebase-admin/app` — usado en 1 archivo(s)
- `firebase-admin/auth` — usado en 1 archivo(s)
- `firebase-admin/firestore` — usado en 1 archivo(s)
- `firebase-admin/storage` — usado en 1 archivo(s)
- `firebase-functions/params` — usado en 1 archivo(s)
- `firebase-functions/v2/firestore` — usado en 1 archivo(s)
- `firebase-functions/v2/https` — usado en 1 archivo(s)
- `fs` — usado en 1 archivo(s)
- `https` — usado en 1 archivo(s)
- `https://cdn.jsdelivr.net/npm/chart.js` — usado en 2 archivo(s)
- `https://contecsfisc.github.io/contecsApp/logocontecs.png` — usado en 2 archivo(s)
- `https://esm.sh/docx@9` — usado en 3 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-analytics.js` — usado en 1 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js` — usado en 1 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js` — usado en 5 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js` — usado en 30 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js` — usado en 2 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js` — usado en 3 archivo(s)
- `path` — usado en 1 archivo(s)
