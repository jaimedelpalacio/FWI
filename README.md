# Microservicio FWI Polígono

## Descripción

Este microservicio expone un endpoint HTTP para consultar, de forma flexible y dinámica, los puntos con mayor riesgo meteorológico de incendio forestal (FWI) **dentro de cualquier polígono del mundo**, usando datos oficiales diarios de Copernicus/EFFIS (WMS).

- Recibe por POST un **polígono** (en formato array de coordenadas `[lon, lat]`), un **umbral mínimo de FWI** y, opcionalmente, una **fecha**.
- Descarga y procesa automáticamente el raster TIFF diario del FWI para el área mínima necesaria.
- Devuelve en **JSON** el estado de la consulta, la fecha, el número de puntos y la lista de puntos (coordenadas, valor FWI, nivel textual) que cumplen las condiciones.

---

## Uso

### **Endpoint principal**



POST /fwi/poligono
Content-Type: application/json



#### **Body de ejemplo:**
```json
{
  "poligono": [
    [-3.8, 37.2],
    [-3.9, 37.0],
    [-3.7, 37.1],
    [-3.8, 37.2]
  ],
  "umbral": 0,
  "fecha": "2024-07-15"
}



poligono:
Array de arrays [lon, lat] (mínimo 3 puntos, cerrado: el primer y último deben ser iguales).

Ejemplo: triángulo en Granada.

umbral:
Número real o entero (opcional, por defecto 11).
Ejemplo:

0 — Todos los puntos

11 — "Moderado" o superior

21 — "Alto" o superior

fecha:
String en formato YYYY-MM-DD (opcional; si no se indica, usa la fecha actual).


{
  "status": "ok",
  "fecha": "2024-07-15",
  "poligono": [
    [-3.8, 37.2],
    [-3.9, 37.0],
    [-3.7, 37.1],
    [-3.8, 37.2]
  ],
  "umbral_usado": 0,
  "total": 320,
  "puntos": [
    {
      "lon": -3.81,
      "lat": 37.19,
      "fwi": 12.3,
      "nivel": "Moderado"
    },
    {
      "lon": -3.78,
      "lat": 37.17,
      "fwi": 24.5,
      "nivel": "Alto"
    }
    // ...
  ]
}



status: "ok" si la consulta fue exitosa, "error" si hubo problema.

fecha: Fecha usada para la consulta.

poligono: Polígono recibido (array de arrays [lon, lat]).

umbral_usado: El valor de umbral que se aplicó.

total: Número de puntos devueltos.

puntos: Array de puntos que cumplen las condiciones, con:

lon, lat: Coordenadas del punto

fwi: Valor del Fire Weather Index en ese punto

nivel: Nivel textual ("Muy bajo", "Bajo", "Moderado", "Alto", "Muy alto", "Extremo")


| Nivel    | Rango FWI  |
| -------- | ---------- |
| Muy bajo | 0 – 4.99   |
| Bajo     | 5 – 10.99  |
| Moderado | 11 – 20.99 |
| Alto     | 21 – 32.99 |
| Muy alto | 33 – 49.99 |
| Extremo  | ≥ 50       |




Notas y recomendaciones
El polígono debe estar cerrado (el primer punto igual al último).

El área consultada puede ser cualquier zona del mundo compatible con EFFIS.

Si la consulta es para muchos puntos y días, limpia periódicamente los ficheros TIFF descargados.

El microservicio está pensado para integración con plataformas tipo MT Neo, dashboards, alertas automáticas, etc.



Ejemplo de llamada desde JavaScript/MT Neo

{
  url: 'https://fwigranada.onrender.com/fwi/poligono',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    poligono: [[-3.8,37.2],[-3.9,37.0],[-3.7,37.1],[-3.8,37.2]],
    umbral: 0,
    fecha: "2024-07-15"
  })
}



Dependencias principales
Node.js

express

axios

gdal-async

@turf/turf



Licencia
MIT © 2025 Jaime del Palacio y colaboradores

