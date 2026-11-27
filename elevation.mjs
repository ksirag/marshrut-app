import {distance} from './activity.mjs';

export async function loadElevation(points, signal) {
  let total = 0;
  const cumulative = points.map((point, index) => {
    if (index) total += distance(points[index - 1], point);
    return total;
  });
  if (!(total > 0)) return null;

  let segment = 1;
  const count = Math.max(3, Math.min(48, Math.ceil(total / 90) + 1));
  const positions = Array.from({length: count}, (_, index) => {
    const meters = total * (index / (count - 1));
    while (segment < points.length - 1 && cumulative[segment] <= meters) segment++;
    const start = points[segment - 1];
    const end = points[segment];
    const span = cumulative[segment] - cumulative[segment - 1];
    const fraction = span > 0 ? (meters - cumulative[segment - 1]) / span : 1;
    return start.map((value, axis) => (value + (end[axis] - value) * fraction).toFixed(3));
  });
  const query = new URLSearchParams({latitude: positions.map(point => point[0]).join(','), longitude: positions.map(point => point[1]).join(',')});
  const response = await fetch(`https://api.open-meteo.com/v1/elevation?${query}`, {signal});
  if (!response.ok) return null;
  const {elevation} = await response.json();
  if (!Array.isArray(elevation) || elevation.length !== count || !elevation.every(Number.isFinite)) return null;
  return elevation.map((value, index) => ({value, meters: total * (index / (count - 1))}));
}
