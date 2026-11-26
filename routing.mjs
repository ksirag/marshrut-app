const pedestrianEndpoint = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/';

export async function fetchWalkingRoute(points, signal) {
  const coordinates = points.map(([lat, lon]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const radiuses = points.map(() => '60').join(';');
  const url = `${pedestrianEndpoint}${coordinates}?geometries=geojson&overview=full&steps=false&continue_straight=false&radiuses=${radiuses}`;
  const response = await fetch(url, {signal});
  const data = await response.json();
  if (data.code === 'NoRoute' || data.code === 'NoSegment') return null;
  const geometry = data.routes?.[0]?.geometry;
  if (!response.ok || data.code !== 'Ok' || geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)
    || !geometry.coordinates.every(point => Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(Number.isFinite))) {
    throw new Error('Invalid walking route response');
  }
  return geometry.coordinates.map(([lon, lat]) => [lat, lon]);
}
