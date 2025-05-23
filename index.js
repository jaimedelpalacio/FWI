const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');
const gdal = require('gdal-async');

const app = express();
const PORT = process.env.PORT || 3000;

// Tamaño de imagen raster WMS
const WIDTH = 800;
const HEIGHT = 800;

app.use(express.json());

app.post('/fwi/poligono', async (req, res) => {
  try {
    // 1. Leer polígono y umbral del body
    const poligonoCoords = req.body.poligono;
    if (!Array.isArray(poligonoCoords) || poligonoCoords.length < 3)
      return res.status(400).json({ status: "error", message: 'Parámetro polígono inválido (debe ser array de al menos 3 puntos)' });
    // Cerrar polígono si hace falta
    if (JSON.stringify(poligonoCoords[0]) !== JSON.stringify(poligonoCoords[poligonoCoords.length-1])) {
      poligonoCoords.push(poligonoCoords[0]);
    }
    const poligonoGeoJSON = turf.polygon([poligonoCoords]);
    const umbral = req.body.umbral !== undefined ? parseFloat(req.body.umbral) : 11;
    const fecha = req.body.fecha || new Date().toISOString().slice(0,10);

    // 2. Calcular el bbox del polígono para pedir solo el raster necesario
    const bbox = turf.bbox(poligonoGeoJSON);

    // 3. Construir la URL de descarga del raster FWI WMS
    const FWI_URL = `https://maps.effis.emergency.copernicus.eu/effis?LAYERS=ecmwf007.fwi&FORMAT=image/tiff&TRANSPARENT=true&SINGLETILE=false&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&STYLES=&SRS=EPSG:4326&BBOX=${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}&WIDTH=${WIDTH}&HEIGHT=${HEIGHT}&TIME=${fecha}`;
    const RASTER_PATH = path.join(__dirname, `fwi_poligono_${fecha}.tif`);

    // 4. Descargar el raster si no existe ya en disco
    if (!fs.existsSync(RASTER_PATH)) {
      const response = await axios({ url: FWI_URL, method: 'GET', responseType: 'stream' });
      const writer = fs.createWriteStream(RASTER_PATH);
      await new Promise((resolve, reject) => {
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
    }

    // 5. Abrir el raster y procesar píxeles
    const ds = gdal.open(RASTER_PATH);
    const band = ds.bands.get(1);
    const geoTransform = ds.geoTransform;

    const fwiPoints = [];
    for (let px = 0; px < ds.rasterSize.x; px++) {
      for (let py = 0; py < ds.rasterSize.y; py++) {
        const lon = geoTransform[0] + px * geoTransform[1] + py * geoTransform[2];
        const lat = geoTransform[3] + px * geoTransform[4] + py * geoTransform[5];
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

    // 6. Devolver el resultado
    res.json({
      status: "ok",
      fecha: fecha,
      poligono: poligonoCoords,
      umbral_usado: umbral,
      total: fwiPoints.length,
      puntos: fwiPoints
    });

  } catch (err) {
    res.status(500).json({ status: "error", message: err.toString() });
  }
});

app.get('/', (req, res) => {
  res.send('Servicio FWI Polígono: envía POST a /fwi/poligono con {poligono, umbral, fecha}');
});

app.listen(PORT, () => {
  console.log(`Servicio escuchando en puerto ${PORT}`);
});
