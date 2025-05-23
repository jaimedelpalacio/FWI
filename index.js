const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');
const gdal = require('gdal-async');

const app = express();
const PORT = process.env.PORT || 3000;

// Tamaño del raster
const WIDTH = 512;
const HEIGHT = 512;

// Conversión lon/lat a EPSG:3857
function lonLatTo3857(lon, lat) {
  const R = 6378137.0;
  const x = R * lon * Math.PI / 180.0;
  const y = R * Math.log(Math.tan(Math.PI / 4.0 + lat * Math.PI / 360.0));
  return [x, y];
}

app.use(express.json());

app.post('/fwi/poligono', async (req, res) => {
  try {
    // Leer polígono y parámetros
    const poligonoCoords = req.body.poligono;
    if (!Array.isArray(poligonoCoords) || poligonoCoords.length < 3)
      return res.status(400).json({ status: "error", message: 'Parámetro polígono inválido (debe ser array de al menos 3 puntos)' });

    if (JSON.stringify(poligonoCoords[0]) !== JSON.stringify(poligonoCoords[poligonoCoords.length-1])) {
      poligonoCoords.push(poligonoCoords[0]);
    }
    const poligonoGeoJSON = turf.polygon([poligonoCoords]);
    const umbral = req.body.umbral !== undefined ? parseFloat(req.body.umbral) : 11;
    const fecha = req.body.fecha || new Date().toISOString().slice(0,10);

    // Calcular bbox en EPSG:3857
    const mercatorCoords = poligonoCoords.map(([lon, lat]) => lonLatTo3857(lon, lat));
    const mercatorPolygon = turf.polygon([mercatorCoords]);
    const bbox3857 = turf.bbox(mercatorPolygon);

    // Construir la URL y nombre temporal único para el TIFF
    const GWIS_URL = `https://maps.effis.emergency.copernicus.eu/gwis?service=WMS&request=GetMap&layers=ecmwf.fwi&styles=&format=image/tiff&transparent=true&version=1.1.1&singletile=false&time=${fecha}&width=${WIDTH}&height=${HEIGHT}&srs=EPSG:3857&bbox=${bbox3857.join(',')}`;
    const RASTER_PATH = path.join(__dirname, `fwi_temp_${Date.now()}.tif`);

    // Descargar el raster SIEMPRE (nunca caché)
    console.log('Descargando TIFF desde:', GWIS_URL);
    const response = await axios({ url: GWIS_URL, method: 'GET', responseType: 'stream' });
    const writer = fs.createWriteStream(RASTER_PATH);
    await new Promise((resolve, reject) => {
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // Abrir el raster y procesar
    const ds = gdal.open(RASTER_PATH);
    const band = ds.bands.get(1);
    const geoTransform = ds.geoTransform;

    // DEPURACIÓN: Mostrar metadatos
    console.log('Metadatos TIFF:', ds.description, ds.srs ? ds.srs.toWKT() : 'Sin SRS');
    const bandMeta = band.getMetadata();
    console.log('Banda meta:', bandMeta);

    // Leer rango de valores para depuración
    let minVal = Infinity, maxVal = -Infinity, values = [];
    for (let px = 0; px < ds.rasterSize.x; px += Math.floor(ds.rasterSize.x / 10)) {
      for (let py = 0; py < ds.rasterSize.y; py += Math.floor(ds.rasterSize.y / 10)) {
        const fwi = band.pixels.get(px, py);
        if (!isNaN(fwi)) {
          if (fwi < minVal) minVal = fwi;
          if (fwi > maxVal) maxVal = fwi;
          values.push(fwi);
        }
      }
    }
    console.log(`Valores FWI ejemplo:`, values.slice(0, 10));
    console.log(`Rango FWI TIFF: min=${minVal} max=${maxVal}`);

    // Procesamiento normal
    const fwiPoints = [];
    for (let px = 0; px < ds.rasterSize.x; px++) {
      for (let py = 0; py < ds.rasterSize.y; py++) {
        const x = geoTransform[0] + px * geoTransform[1] + py * geoTransform[2];
        const y = geoTransform[3] + px * geoTransform[4] + py * geoTransform[5];
        // Convertir a lon/lat
        const lon = x * 180.0 / 6378137.0 / Math.PI;
        const lat = (2 * Math.atan(Math.exp(y / 6378137.0)) - Math.PI / 2) * 180.0 / Math.PI;
        if (!turf.booleanPointInPolygon(turf.point([lon, lat]), poligonoGeoJSON)) continue;
        const fwi = band.pixels.get(px, py);
        if (fwi >= umbral) {
          let nivel = '';
          if (fwi < 5) nivel = 'Muy bajo';
          else if (fwi < 11) nivel = 'Bajo';
          else if (fwi < 21) nivel = 'Moderado';
          else if (fwi < 33) nivel = 'Alto';
          else if (fwi < 50) nivel = 'Muy alto';
          else nivel = 'Extremo';
          fwiPoints.push({ lon, lat, fwi, nivel });
        }
      }
    }

    // Borrar el archivo TIFF temporal
    fs.unlinkSync(RASTER_PATH);

    res.json({
      status: "ok",
      fecha: fecha,
      poligono: poligonoCoords,
      umbral_usado: umbral,
      total: fwiPoints.length,
      puntos: fwiPoints
    });

  } catch (err) {
    console.error('ERROR:', err);
    res.status(500).json({ status: "error", message: err.toString() });
  }
});

app.get('/', (req, res) => {
  res.send('Servicio FWI GWIS DEBUG - POST a /fwi/poligono con {poligono, umbral, fecha}');
});

app.listen(PORT, () => {
  console.log(`Servicio escuchando en puerto ${PORT}`);
});
