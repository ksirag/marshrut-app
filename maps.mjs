export const defaultCenter = [56.8391, 60.6135];

function color(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function routeThumbnail(points, width = 640, height = 192) {
  if (points.length < 2) return '';
  const latitude = points[0][0] * Math.PI / 180;
  const coordinates = points.map(([lat, lon]) => [lon * Math.cos(latitude), -lat]);
  const xs = coordinates.map(point => point[0]);
  const ys = coordinates.map(point => point[1]);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
  const scale = Math.min((width - 52) / Math.max(xmax - xmin, 1e-8), (height - 32) / Math.max(ymax - ymin, 1e-8));
  const projected = coordinates.map(([x, y]) => [width / 2 + (x - (xmin + xmax) / 2) * scale, height / 2 + (y - (ymin + ymax) / 2) * scale]);
  const [sx, sy] = projected[0];
  const [ex, ey] = projected.at(-1);
  const line = projected.map(point => point.map(value => value.toFixed(1)).join(',')).join(' ');
  return `<svg class="route-thumbnail" viewBox="0 0 ${width} ${height}" role="img" aria-label="Схема маршрута"><polyline points="${line}" class="route-shadow"/><polyline points="${line}" class="route-line"/><circle cx="${sx}" cy="${sy}" r="5" class="route-start"/><circle cx="${ex}" cy="${ey}" r="5" class="route-end"/></svg>`;
}

export function openMap(element, options = {}) {
  if (!globalThis.L) {
    element.innerHTML = routeThumbnail(options.points || []);
    return null;
  }
  const map = L.map(element, {
    zoomControl: false, scrollWheelZoom: false, zoomSnap: 0.5, maxZoom: 19,
    zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false,
  });
  map.attributionControl.setPrefix(false);
  if (options.onPoint) {
    map.attributionControl.addAttribution('<a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener">Маршруты: FOSSGIS</a> | <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">Исправить карту</a>');
  }
  map.setView(options.center || defaultCenter, options.zoom || 14);
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);
  let loaded = false;
  element.classList.add('tiles-loading');
  const wait = setTimeout(() => {
    element.classList.remove('tiles-loading');
    if (!loaded) element.classList.add('tiles-unavailable');
  }, 8000);
  tiles.on('tileload', () => {
    loaded = true;
    clearTimeout(wait);
    element.classList.remove('tiles-loading', 'tiles-unavailable');
  });
  tiles.on('load', () => {
    clearTimeout(wait);
    element.classList.remove('tiles-loading');
    if (!loaded) element.classList.add('tiles-unavailable');
  });
  if (options.controls !== false) L.control.zoom({position: 'topright', zoomInTitle: 'Приблизить', zoomOutTitle: 'Отдалить'}).addTo(map);
  if (options.onPoint) map.on('click', event => {
    const {lat, lng} = event.latlng.wrap();
    options.onPoint([lat, lng]);
  });
  const layers = L.layerGroup().addTo(map);

  function draw(points, {fit = false, markers = points} = {}) {
    layers.clearLayers();
    if (points.length > 1) {
      const line = L.polyline(points, {weight: 8, color: color('--map-halo'), interactive: false}).addTo(layers);
      L.polyline(points, {weight: 4, color: color('--accent'), interactive: false}).addTo(layers);
      if (fit) map.fitBounds(line.getBounds(), {padding: [32, 28], maxZoom: 17, animate: false});
    } else if (fit && points.length) map.setView(points[0], 16);
    if (!markers.length) return;
    if (options.onPoint) {
      for (const point of markers.slice(1, -1)) L.circleMarker(point, {radius: 3, weight: 1, color: color('--white'), fillColor: color('--accent'), fillOpacity: 1, interactive: false}).addTo(layers);
    }
    const marker = {radius: 5, weight: 2, color: color('--white'), fillOpacity: 1, interactive: false};
    L.circleMarker(markers[0], {...marker, fillColor: color('--success')}).addTo(layers);
    if (markers.length > 1) L.circleMarker(markers.at(-1), {...marker, fillColor: color('--accent')}).addTo(layers);
  }

  if (options.points) draw(options.points, {fit: true});
  return {
    draw,
    move: (point, zoom = 16) => map.setView(point, zoom, {animate: false}),
    center: () => [map.getCenter().lat, map.getCenter().lng],
    zoom: () => map.getZoom(),
    remove: () => { clearTimeout(wait); map.remove(); },
  };
}
