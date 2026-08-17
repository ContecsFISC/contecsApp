# CONTECS — guía de contexto para agentes

Antes de realizar cambios de código no triviales:

1. Ejecuta `python .\AlphaToolGraph.py .` desde la raíz para reconstruir el mapa completo.
2. Lee primero `graph-out/GraphCompacto.json` para localizar el dominio y los archivos relevantes.
3. Abre únicamente el código fuente señalado por el mapa compacto.
4. Consulta secciones concretas de `GraphCompleto.json` si necesitas relaciones exactas.
5. Consulta claves concretas de `GraphProfundo.json` sólo para evidencia por línea, símbolos, DOM, eventos o auditorías profundas. No cargues el archivo entero sin necesidad.
6. Considera siempre el código fuente y las pruebas como la fuente definitiva; el grafo es un índice estático.

No edites manualmente archivos dentro de `graph-out/`. Todos son generados por `AlphaToolGraph.py` y comparten una misma huella del proyecto.

Después de modificar código compartido, revisa consumidores, contratos de Firebase, rutas, IDs DOM, permisos y diagnósticos relacionados antes de afirmar que funciona.
