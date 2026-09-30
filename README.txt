# GoFlyMX — Stock menor a 2 — V3

## Qué hace

El sistema consulta GoFlyMX mediante REQUEST y muestra únicamente:

- CÓDIGO
- STOCK

Filtro:

- stock numérico < 2
- SIN STOCK = 1

No muestra ni exporta precio, marca, descripción, nombre de producto ni imágenes.

## Por qué esta versión es diferente

GoFlyMX actualmente muestra en sus listados el `Código` y, para productos sin disponibilidad, un botón `Sin stock`. En otras fichas aparece `STOCK DISPONIBLE`.

El extractor ahora:
1. Recorre páginas internas.
2. Sigue la paginación.
3. Detecta directamente `Sin stock` en las tarjetas/listados.
4. Guarda ese código como stock `1 (SIN STOCK)`.
5. Consulta las fichas individuales para detectar una cantidad numérica si el HTML público la expone.
6. Nunca interpreta `Min. Vta.` o `Max Vta.` como inventario.
7. Deduplica por código.

## Instalación

Necesitás Node.js 18+.

```bash
npm install
npm start
```

Luego abrir:

http://localhost:3000

NO abras `index.html` con doble clic. El HTML necesita `server.js` porque el navegador no puede hacer el REQUEST de scraping directamente a otro dominio si ese dominio no habilita CORS.

## Si la pantalla dice "NO está conectado"

Significa que el servidor no está ejecutándose.

Ejecutá:

```bash
npm start
```

y entrá nuevamente en:

```text
http://localhost:3000
```

## Resultado

Ejemplo:

```text
CÓDIGO                 STOCK
-----------------------------
MT2335KM               1 (SIN STOCK)
MYS2403BK              1 (SIN STOCK)
R-HP3ADVBNNR0          1 (SIN STOCK)
```

La tienda pública actualmente confirma que estos estados aparecen como `Sin stock` en las tarjetas, junto con sus respectivos códigos.
