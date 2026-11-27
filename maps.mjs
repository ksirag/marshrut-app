import {distance} from './activity.mjs';

export const defaultCenter = [56.8391, 60.6135];
const mapAttribution = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="https://www.openstreetmap.de/germanstyle/" target="_blank" rel="noopener">OSM DE</a>';
const tileSources = ['https://tile.openstreetmap.de/{z}/{x}/{y}.png', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'];

function routeTiles() {
  const pending = new Map();
  const tiles = L.tileLayer(tileSources[0], {maxZoom: 19, attribution: mapAttribution, keepBuffer: 1, updateWhenIdle: true});
  tiles.createTile = (coords, done) => {
    const tile = document.createElement('div');
    const images = [];
    let failed = 0;
    let backupStarted = false;
    const cancel = winner => {
      clearTimeout(backupTimer);
      clearTimeout(deadline);
      for (const image of images) {
        image.onload = null;
        image.onerror = null;
        if (image !== winner) image.removeAttribute('src');
      }
      pending.delete(tile);
    };
    const finish = winner => {
      cancel(winner);
      if (winner) tile.append(winner);
      done(winner ? null : new Error('Map tile unavailable'), tile);
    };
    function useBackup() {
      if (backupStarted) return;
      backupStarted = true;
      requestTile(tileSources[1]);
    }
    function requestTile(source) {
      const image = document.createElement('img');
      image.alt = '';
      image.referrerPolicy = 'strict-origin-when-cross-origin';
      image.onload = () => finish(image);
      image.onerror = () => {
        failed += 1;
        if (failed === tileSources.length) finish();
        else useBackup();
      };
      images.push(image);
      image.src = L.Util.template(source, coords);
    }
    const backupTimer = setTimeout(useBackup, 3200);
    const deadline = setTimeout(finish, 10500);
    pending.set(tile, cancel);
    requestTile(tileSources[0]);
    return tile;
  };
  tiles.on('tileunload tileabort', event => pending.get(event.tile)?.());
  tiles.on('remove', () => { for (const cancel of pending.values()) cancel(); });
  return tiles;
}

function color(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawSpeedLine(layer, points, samples, averagePace) {
  const groups = Array.from({length: 5}, () => []);
  let sample = 1;
  let meters = 0;
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1];
    const end = points[index];
    const length = distance(start, end);
    while (sample < samples.length - 1 && samples[sample].meters < meters + length / 2) sample++;
    const a = samples[sample - 1];
    const b = samples[sample];
    const ratio = averagePace * (b.meters - a.meters) / (1000 * (b.seconds - a.seconds));
    const band = Number.isFinite(ratio) ? Math.max(0, Math.min(4, Math.round(2 + (ratio - 1) * 12))) : 2;
    const previous = groups[band].at(-1);
    if (previous?.at(-1) === start) previous.push(end);
    else groups[band].push([start, end]);
    meters += length;
  }
  for (const [index, lines] of groups.entries()) {
    if (lines.length) L.polyline(lines, {weight: 5, color: color(`--speed-${index}`), interactive: false}).addTo(layer);
  }
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
    ...(options.preview ? {attributionControl: false, dragging: false, touchZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, tapHold: false} : {}),
  });
  map.attributionControl?.setPrefix(false);
  if (options.onPoint) {
    map.attributionControl.addAttribution('<a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener">Маршруты: FOSSGIS</a> | <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">Исправить карту</a>');
  }
  if (options.points?.length > 1) {
    map.fitBounds(L.latLngBounds(options.points), {padding: options.preview ? [15, 13] : [32, 28], maxZoom: 17, animate: false});
  } else map.setView(options.center || options.points?.[0] || defaultCenter, options.zoom || 14);
  const tiles = routeTiles();
  let loaded = false;
  element.classList.add('tiles-loading');
  const wait = setTimeout(() => {
    element.classList.remove('tiles-loading');
    if (!loaded) element.classList.add('tiles-unavailable');
  }, 10800);
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
  tiles.addTo(map);

  function draw(points, {fit = false, markers = points} = {}) {
    layers.clearLayers();
    if (points.length > 1) {
      const line = L.polyline(points, {weight: 8, color: color('--map-halo'), interactive: false}).addTo(layers);
      if (options.samples?.length > 2) drawSpeedLine(layers, points, options.samples, options.averagePace);
      else L.polyline(points, {weight: options.preview ? 3 : 4, color: color('--accent'), interactive: false}).addTo(layers);
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

  if (options.points) draw(options.points);
  return {
    draw,
    move: (point, zoom = 16) => map.setView(point, zoom, {animate: false}),
    center: () => [map.getCenter().lat, map.getCenter().lng],
    zoom: () => map.getZoom(),
    fit: () => draw(options.points, {fit: true}),
    remove: () => { clearTimeout(wait); map.remove(); },
  };
}

export function observePreviews(root, activities) {
  const cards = [...root.querySelectorAll('[data-map-preview]')];
  const byId = new Map(activities.map(activity => [activity.id, activity]));
  const visibleMaps = new Map();
  function show(element) {
    const points = byId.get(element.dataset.mapPreview)?.points;
    if (!points?.length || !globalThis.L) return;
    element.replaceChildren();
    visibleMaps.set(element, openMap(element, {points, preview: true, controls: false}));
  }
  function hide(element) {
    if (!visibleMaps.has(element)) return;
    visibleMaps.get(element).remove();
    visibleMaps.delete(element);
    element.innerHTML = routeThumbnail(byId.get(element.dataset.mapPreview).points);
  }
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) show(entry.target);
      else hide(entry.target);
    }
  }, {rootMargin: '120px 0px'}) : null;
  for (const card of cards) {
    if (observer) observer.observe(card);
    else show(card);
  }
  return () => {
    observer?.disconnect();
    for (const instance of visibleMaps.values()) instance.remove();
    visibleMaps.clear();
  };
}

export {mapAttribution};
