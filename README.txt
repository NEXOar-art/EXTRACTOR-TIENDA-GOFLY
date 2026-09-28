# Extractor de catálogo GoFlyMX

Extrae del catálogo público de GoFlyMX:

- TIPO / CATEGORÍA
- PRODUCTO
- STOCK
- DESCRIPCIÓN

No exporta precio, código, marca ni imágenes.

## Requisitos

Node.js 18 o superior.

## Instalación

1. Abrí una terminal dentro de esta carpeta.
2. Ejecutá:

```bash
npm install
npm start
```

3. Abrí en el navegador:

http://localhost:3000

4. Presioná "EXTRAER TODO EL CATÁLOGO".

## Exportación

El panel permite descargar:

- CSV compatible con Excel.
- JSON.

## Importante

El navegador por sí solo no puede hacer scraping directo de otro dominio cuando el servidor remoto no habilita CORS. Por eso `server.js` hace la descarga y el HTML se comunica con ese servidor local.

El extractor recorre enlaces internos del catálogo, detecta fichas `.html`, visita cada ficha y busca selectores comunes para nombre, stock y descripción. Como la estructura de una tienda puede cambiar, los selectores están centralizados en `server.js` para poder ajustarlos fácilmente.

Usá el extractor respetando los términos de uso, robots.txt y límites razonables del sitio de origen.
