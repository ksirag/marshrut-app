const earthRadius = 6371008.8;
const radians = Math.PI / 180;

export function distance(a, b) {
  const dLat = (b[0] - a[0]) * radians;
  const dLon = (b[1] - a[1]) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * radians) * Math.cos(b[0] * radians) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(Math.min(h, 1)));
}

export function routeDistance(points) {
  return points.reduce((total, point, index) => total + (index ? distance(points[index - 1], point) : 0), 0);
}

export function pace(value) {
  if (!Number.isFinite(value) || value <= 0) return '—';
  const seconds = Math.round(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function duration(value) {
  const seconds = Math.max(0, Math.round(value));
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function parsePace(value) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  return seconds >= 120 && seconds <= 3600 ? seconds : null;
}

export function number(value, digits = 0) {
  return new Intl.NumberFormat('ru-RU', {minimumFractionDigits: digits, maximumFractionDigits: digits}).format(value);
}

function randomFrom(text) {
  let seed = 2166136261;
  for (const char of text) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function partitions(points) {
  const meters = routeDistance(points);
  const count = Math.min(2000, Math.max(2, Math.ceil(meters / 75)));
  return Array.from({length: count + 1}, (_, index) => meters * index / count);
}

function buildSplits(samples) {
  if (samples.length < 2) return [];
  const total = samples.at(-1).meters;
  let sampleIndex = 1;
  let previousMeters = 0;
  let previousSeconds = 0;
  const splits = [];
  for (let end = Math.min(1000, total); previousMeters < total; end = Math.min(end + 1000, total)) {
    while (samples[sampleIndex].meters < end) sampleIndex++;
    const from = samples[sampleIndex - 1];
    const to = samples[sampleIndex];
    const fraction = (end - from.meters) / (to.meters - from.meters);
    const endpointSeconds = from.seconds + (to.seconds - from.seconds) * fraction;
    splits.push({meters: end - previousMeters, seconds: endpointSeconds - previousSeconds});
    previousMeters = end;
    previousSeconds = endpointSeconds;
  }
  return splits;
}

function createId() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
}

export function buildActivity({points, startedAt, kind, source, targetPace, track, elapsed, id}) {
  const meters = routeDistance(points);
  if (!Number.isFinite(meters) || meters < 10) throw new Error('Маршрут должен быть длиной хотя бы 10 м.');
  let samples;
  let seconds;
  if (track) {
    let cumulative = 0;
    samples = points.map((point, index) => {
      if (index) cumulative += distance(points[index - 1], point);
      return {meters: cumulative, seconds: track[index]};
    }).filter((sample, index, all) => index === 0 || sample.meters > all[index - 1].meters);
    seconds = Math.max(1, Math.round(elapsed));
  } else {
    seconds = Math.max(1, Math.round(meters * targetPace / 1000));
    const random = randomFrom(`${startedAt}/${kind}/${JSON.stringify(points)}`);
    const checkpoints = partitions(points);
    const variation = checkpoints.slice(1).map((_, index) => 1 + 0.1 * Math.sin(index * 0.86) + 0.12 * (random() - 0.5) + 0.06 * Math.cos(index * 0.25));
    const sum = variation.reduce((total, value) => total + value, 0);
    let cumulative = 0;
    samples = checkpoints.map((meters, index) => {
      if (index) cumulative += variation[index - 1];
      return {meters, seconds: seconds * cumulative / sum};
    });
  }
  const averagePace = seconds * 1000 / meters;
  const stride = kind === 'run' ? 0.82 + Math.min(0.35, 90 / averagePace) : 0.64 + Math.min(0.2, 65 / averagePace);
  return {
    id: id || createId(), kind, source, startedAt, points,
    meters, seconds, averagePace, samples, splits: buildSplits(samples),
    steps: Math.round(meters / stride), calories: Math.round(meters / 1000 * (kind === 'run' ? 67 : 45)),
  };
}
