import {buildActivity, distance, duration, number, pace, parsePace, routeDistance} from './activity.mjs';
import {defaultCenter, openMap, routeThumbnail} from './maps.mjs';
import {fetchWalkingRoute} from './routing.mjs';

const content = document.querySelector('#content');
const header = document.querySelector('#top');
const tabs = document.querySelector('.tabs');
const notice = document.querySelector('#notice');
const mainHeader = header.innerHTML;
const storageKey = 'marshrut.journal.v1';
const kindName = {walk: 'Ходьба', run: 'Бег'};
const plural = new Intl.PluralRules('ru-RU');
const dayFormat = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long'});
const dateFormat = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long', year: 'numeric'});
const timeFormat = new Intl.DateTimeFormat('ru-RU', {hour: '2-digit', minute: '2-digit'});
const weekday = new Intl.DateTimeFormat('ru-RU', {weekday: 'short'});

function load() {
  try {
    const state = JSON.parse(localStorage.getItem(storageKey));
    return {activities: Array.isArray(state?.activities) ? state.activities : [], goal: Number(state?.goal) || 8000};
  } catch {
    return {activities: [], goal: 8000};
  }
}

let journal = load();
let map;
let draft;
let recording;
let timer;
let toastTimer;
let wakeLock;
let gpsKind = 'walk';
let journalFilter = 'all';
let statsPeriod = 7;
let placement;
let lastView;
let routeTimer;
let routeRequest;
let lastRouteRequest = 0;

function commit(next) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
    journal = next;
    return true;
  } catch {
    toast('Не удалось сохранить данные. Проверьте свободное место и настройки Safari.');
    return false;
  }
}

function todayKey(value = new Date()) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toast(message) {
  clearTimeout(toastTimer);
  notice.textContent = message;
  notice.hidden = false;
  toastTimer = setTimeout(() => { notice.hidden = true; }, 4200);
}

function icon(name) {
  return `<svg aria-hidden="true"><use href="icons.svg#${name}"/></svg>`;
}

function control(name, label, action) {
  return `<button type="button" class="icon-button" data-action="${action}" aria-label="${label}" title="${label}">${icon(name)}</button>`;
}

function back(title, link, right = '') {
  return `<a class="icon-button" href="#${link}" aria-label="Назад">${icon('back')}</a><strong class="top-title">${title}</strong><span class="top-right">${right}</span>`;
}

function metric(label, value, unit = '') {
  return `<div class="metric"><span>${label}</span><strong>${value}${unit ? `<small> ${unit}</small>` : ''}</strong></div>`;
}

function heading(text, extra = '') {
  return `<div class="section-title"><h2>${text}</h2>${extra}</div>`;
}

function dateText(value) {
  const date = new Date(value);
  return `${dateFormat.format(date)}, ${timeFormat.format(date)}`;
}

function sumActivities(activities) {
  return activities.reduce((total, a) => ({steps: total.steps + a.steps, meters: total.meters + a.meters,
    seconds: total.seconds + a.seconds, calories: total.calories + a.calories}), {steps: 0, meters: 0, seconds: 0, calories: 0});
}

function days(count) {
  const now = new Date();
  return Array.from({length: count}, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + index + 1 - count);
    return {date, ...sumActivities(journal.activities.filter(a => todayKey(a.startedAt) === todayKey(date)))};
  });
}

function bars(data, field = 'steps') {
  const max = Math.max(1, ...data.map(day => day[field]));
  return `<div class="bars ${data.length > 7 ? 'dense' : ''}" aria-label="${field === 'steps' ? 'Шаги' : 'Дистанция'} по дням">
    ${data.map((day, index) => `<div class="bar-day ${index === data.length - 1 ? 'current' : ''}" title="${dayFormat.format(day.date)} — ${field === 'steps' ? number(day.steps) + ' шагов' : number(day.meters / 1000, 2) + ' км'}"><div class="bar-track"><i style="--bar:${day[field] / max * 100}%"></i></div><span>${data.length <= 7 ? weekday.format(day.date) : (index % 7 === 0 || index === data.length - 1 ? day.date.getDate() : '&nbsp;')}</span></div>`).join('')}
  </div>`;
}

function activityCard(activity, compact = false) {
  return `<a class="activity-card ${compact ? 'compact' : ''}" href="#activity/${activity.id}">
    <div class="activity-head"><span class="activity-icon">${icon(activity.kind)}</span><div><strong>${kindName[activity.kind]}</strong><span>${dateText(activity.startedAt)}</span></div><span class="chevron">${icon('arrow')}</span></div>
    ${routeThumbnail(activity.points)}
    <div class="metrics card-metrics">${metric('Дистанция', number(activity.meters / 1000, 2), 'км')}${metric('Время', duration(activity.seconds))}${metric('Шаги ≈', number(activity.steps))}</div>
  </a>`;
}

function todayScreen() {
  const totals = sumActivities(journal.activities.filter(a => todayKey(a.startedAt) === todayKey()));
  const progress = Math.min(100, Math.round(totals.steps / journal.goal * 100));
  const activity = journal.activities[0];
  return `<div class="page-head"><h1>Сегодня</h1><span>${icon('calendar')}${dayFormat.format(new Date())}</span></div>
  <section class="panel daily"><div class="metrics daily-metrics">${metric('Калории ≈', number(totals.calories), 'ккал')}${metric('В движении', duration(totals.seconds).replace(/^00:/, ''))}${metric('Дистанция', number(totals.meters / 1000, 2), 'км')}</div>
  <div class="step-ring" aria-label="${progress}% дневной цели"><svg viewBox="0 0 220 220" aria-hidden="true"><circle class="ring-ticks" cx="110" cy="110" r="100"/><circle class="ring-track" cx="110" cy="110" r="88" pathLength="100"/>${progress ? `<circle class="ring-progress" cx="110" cy="110" r="88" pathLength="100" style="--progress:${progress}"/>` : ''}</svg><div class="ring-text"><span>Шаги ≈</span><strong>${number(totals.steps)}</strong><span>Цель ${number(journal.goal)}</span></div></div></section>
  <section class="panel week">${heading('Последние 7 дней', '<a class="text-link" href="#stats">Статистика</a>')}${bars(days(7))}</section>
  ${activity ? `<section class="activity-section">${heading('Последняя тренировка', '<a class="text-link" href="#journal">Журнал</a>')}${activityCard(activity, true)}</section>` : ''}`;
}

function statsScreen() {
  const data = days(statsPeriod);
  const totals = sumActivities(data);
  return `<div class="page-head"><h1>Статистика</h1></div>
  <div class="segments" aria-label="Период">${[7, 30].map(value => `<button type="button" data-period="${value}" aria-pressed="${statsPeriod === value}">${value} дней</button>`).join('')}</div>
  <section class="panel analysis">${heading('Шаги ≈')}<div class="metrics two">${metric('Всего', number(totals.steps))}${metric('В среднем за день', number(totals.steps / statsPeriod))}</div>${bars(data)}</section>
  <section class="panel analysis">${heading('Дистанция')}<div class="metrics two">${metric('Всего', number(totals.meters / 1000, 2), 'км')}${metric('В движении', duration(totals.seconds))}</div>${bars(data, 'meters')}</section>`;
}

function journalScreen() {
  const filtered = journal.activities.filter(activity => journalFilter === 'all' || journalFilter === activity.kind);
  const entries = filtered.length ? filtered.map(activity => activityCard(activity)).join('') : `<div class="empty panel">${icon('journal')}<strong>${journal.activities.length ? 'Нет тренировок этого типа' : 'История пока пуста'}</strong><a class="text-link" href="#gps">Начать тренировку</a></div>`;
  return `<div class="page-head"><h1>Журнал</h1><span>${number(journal.activities.length)} ${({one:'тренировка',few:'тренировки',many:'тренировок'})[plural.select(journal.activities.length)]}</span></div>
  <div class="segments" aria-label="Тип тренировки">${Object.entries({all:'Все', ...kindName}).map(([key, name]) => `<button type="button" data-filter="${key}" aria-pressed="${journalFilter === key}">${name}</button>`).join('')}</div>
  <div class="journal-list">${entries}</div>`;
}

function detailChart(activity) {
  const stride = activity.meters / Math.max(1, activity.steps);
  const raw = activity.samples.slice(1).map((point, index) => {
    const previous = activity.samples[index];
    return Math.min(260, 60 * (point.meters - previous.meters) / Math.max(0.1, point.seconds - previous.seconds) / stride);
  });
  if (raw.length < 2) return '';
  const average = activity.steps * 60 / activity.seconds;
  const lower = Math.max(0, Math.floor((Math.min(...raw) - 6) / 10) * 10);
  const upper = Math.ceil((Math.max(...raw) + 6) / 10) * 10;
  const series = raw.map((value, index) => `${(index * 310 / (raw.length - 1)).toFixed(1)},${(86 - (value - lower) / (upper - lower) * 76).toFixed(1)}`).join(' ');
  return `<section class="panel detail-chart">${heading('Частота шагов ≈', `<span class="muted">В среднем ${number(average)} шаг/мин</span>`)}
    <div class="graph"><div class="graph-scale"><span>${upper}</span><span>${lower}</span></div><svg viewBox="0 0 310 90" preserveAspectRatio="none" role="img" aria-label="Расчётная частота шагов по дистанции"><polygon points="0,90 ${series} 310,90" class="graph-fill"/><polyline points="${series}" class="graph-line"/></svg></div>
    <div class="graph-labels"><span>0 км</span><span>${number(activity.meters / 2000, 2)} км</span><span>${number(activity.meters / 1000, 2)} км</span></div>
  </section>`;
}

function activityScreen(activity) {
  const splitPaces = activity.splits.map(split => split.seconds * 1000 / split.meters);
  const slowest = Math.max(...splitPaces, 1);
  return `<section class="panel activity-detail"><div id="map" class="map activity-map" aria-label="Карта тренировки"></div><div class="detail-summary">
    <div class="activity-meta"><span>${icon(activity.kind)}${kindName[activity.kind]}</span><span>${dateText(activity.startedAt)}</span></div>
    <div class="main-distance">${number(activity.meters / 1000, 2)} <small>км</small></div>
    <div class="metrics detail-metrics">${metric('Средний темп', pace(activity.averagePace), '/км')}${metric('Время', duration(activity.seconds))}${metric('Калории ≈', number(activity.calories), 'ккал')}${metric('Шаги ≈', number(activity.steps))}${metric('Частота ≈', number(activity.steps * 60 / activity.seconds), 'шаг/мин')}${metric('Скорость', number(activity.meters / activity.seconds * 3.6, 1), 'км/ч')}</div>
  </div></section>
  <section class="panel splits">${heading('Отрезки', '<span class="muted">Темп / км</span>')}<div class="split-list">${activity.splits.map((split, index) => `<div class="split"><span>${split.meters >= 999.9 ? `${index + 1} км` : `${number(split.meters / 1000, 2)} км`}</span><div class="split-track"><i style="--bar:${Math.max(8, splitPaces[index] / slowest * 100)}%"></i></div><strong>${pace(splitPaces[index])}</strong></div>`).join('')}</div></section>
  ${detailChart(activity)}`;
}

function kinds(selected, action) {
  return `<div class="segments" aria-label="Тип тренировки">${Object.entries(kindName).map(([type, label]) => `<button type="button" data-action="${action}" data-kind="${type}" aria-pressed="${selected === type}">${icon(type)}${label}</button>`).join('')}</div>`;
}

function gpsScreen() {
  return `<div class="page-head"><h1>Тренировка</h1></div>
    ${recording ? '' : kinds(gpsKind, 'gps-kind')}
    <div class="panel gps-panel"><div class="map gps-map" id="map" aria-label="Карта GPS"></div><div class="map-tools">${control('locate', 'Моё местоположение', 'locate')}</div></div>
    <div class="panel gps-performance"><div class="metrics detail-metrics">${metric('Дистанция', `<span id="gps-distance">${number((recording?.meters || 0) / 1000, 2)}</span>`, 'км')}${metric('Время', `<span id="gps-time">${duration(recording ? elapsed() : 0)}</span>`)}${metric('Темп', `<span id="gps-pace">${recording?.meters > 0 ? pace(elapsed() * 1000 / recording.meters) : '—'}</span>`, '/км')}</div>
    <button class="primary ${recording ? 'stop' : ''}" data-action="${recording ? 'stop' : 'start'}">${icon(recording ? 'stop' : 'play')}${recording ? 'Завершить' : 'Начать'}</button>
    <p class="helper" id="gps-status">${recording?.status || 'Для записи GPS держите приложение открытым.'}</p></div>`;
}

function manualScreen() {
  return `<form id="manual-form"><section class="panel compose-map"><div id="map" class="map draft-map" aria-label="Карта для добавления точек"></div>
  <div class="map-tools">${control('locate', 'Моё местоположение', 'locate')}</div><div class="compose-tools"><div><strong id="draft-distance">—</strong><span id="point-count"></span></div>${control('undo', 'Убрать последнюю точку', 'undo')}${control('pin', 'Перейти к координатам', 'coords')}</div>
  <div class="route-status" id="route-status" hidden><span id="route-message" role="status"></span><button type="button" class="secondary" data-action="retry-route" hidden>Повторить</button></div>
  <div class="coords" id="coords" hidden><label for="coordinate">Координаты центра карты</label><div><input id="coordinate" placeholder="56.8391, 60.6135" autocomplete="off"><button type="button" class="secondary" data-action="move">Перейти</button></div></div></section>
  <section class="panel compose-fields">${kinds(draft.kind, 'draft-kind')}<div class="field-grid"><label>Дата<input name="date" type="date" required></label><label>Время старта<input name="time" type="time" required></label><label>Примерный темп<input name="pace" type="text" required placeholder="10:30" autocomplete="off" aria-describedby="pace-hint"></label></div>
  <p class="helper" id="pace-hint">Темп в минутах и секундах на километр</p><p class="form-error" id="manual-error" role="alert" hidden></p><button type="submit" class="primary">Сохранить тренировку</button></section></form>`;
}

function settingsScreen() {
  return `<div class="page-head"><h1>Настройки</h1></div><form class="panel settings" id="goal-form"><label>Дневная цель по шагам<input name="goal" type="number" required min="100" max="100000" step="1" value="${journal.goal}"></label><button class="primary">Сохранить цель</button></form>
  <section class="panel settings">${heading('Перенос журнала')}<button type="button" class="secondary" data-action="export-journal">Скачать журнал</button><button type="button" class="secondary" data-action="import-journal">Загрузить журнал</button><input id="journal-file" type="file" accept="application/json,.json" aria-label="Файл журнала" hidden></section>
  <section class="panel settings">${heading('Установка на iPhone')}<p>В Safari нажмите «Поделиться», затем «На экран Домой». Включите «Открывать как веб-приложение», если Safari покажет этот переключатель.</p><p>Журнал хранится на этом устройстве. Шаги и калории рассчитываются по тренировкам.</p></section>`;
}

function newDraft() {
  const now = new Date();
  return {points: [], route: null, routeState: 'idle', kind: gpsKind, date: todayKey(now), time: timeFormat.format(now), pace: gpsKind === 'walk' ? '10:30' : '6:00'};
}

function currentScreen() {
  return location.hash.slice(1) || 'today';
}

function render(keepPosition = false) {
  const view = currentScreen();
  const [screen, id] = view.split('/');
  if (lastView === 'manual' && draft && map) placement = {center: map.center(), zoom: map.zoom()};
  map?.remove();
  map = null;
  header.innerHTML = mainHeader;
  header.classList.remove('subpage');
  tabs.hidden = screen === 'activity' || screen === 'manual';
  for (const tab of tabs.querySelectorAll('a')) {
    if (tab.dataset.tab === screen) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  if (screen === 'manual') {
    draft ||= newDraft();
    header.innerHTML = back('Новая тренировка', 'gps');
    header.classList.add('subpage');
    content.innerHTML = manualScreen();
    const fields = document.querySelector('#manual-form').elements;
    for (const name of ['date', 'time', 'pace']) fields[name].value = draft[name];
    map = openMap(document.querySelector('#map'), {...placement, onPoint: addPoint});
    refreshDraft();
  } else if (screen === 'activity') {
    const activity = journal.activities.find(a => a.id === id);
    header.innerHTML = back('Тренировка', 'journal', activity ? control('more', 'Действия с тренировкой', 'activity-menu') : '');
    header.classList.add('subpage');
    content.innerHTML = activity ? activityScreen(activity) : '<div class="empty panel"><strong>Тренировка не найдена</strong><a href="#journal">Открыть журнал</a></div>';
    if (activity) map = openMap(document.querySelector('#map'), {points: activity.points});
  } else if (screen === 'gps') {
    content.innerHTML = gpsScreen();
    const points = recording?.points || [];
    map = openMap(document.querySelector('#map'), {center: points.at(-1) || defaultCenter, zoom: points.length ? 16 : 14});
    map?.draw(points);
  } else {
    const page = {today: todayScreen, journal: journalScreen, stats: statsScreen, settings: settingsScreen};
    content.innerHTML = (page[screen] || todayScreen)();
    if (screen === 'settings') {
      header.innerHTML = back('Маршрут', 'today');
      header.classList.add('subpage');
    }
  }
  if (!keepPosition && lastView !== view) {
    window.scrollTo(0, 0);
    content.focus({preventScroll: true});
  }
  lastView = view;
}

function addPoint(point) {
  if (draft.points.length >= 50) return toast('В одном маршруте можно поставить до 50 точек.');
  if (draft.points.length && distance(draft.points.at(-1), point) < 2) return;
  draft.points.push(point);
  planRoute();
}

function refreshDraft() {
  const form = document.querySelector('#manual-form');
  if (!form) return;
  const count = draft.points.length;
  const route = draft.route;
  map?.draw(route?.points || [], {markers: draft.points});
  document.querySelector('#draft-distance').textContent = route ? `${number(route.meters / 1000, 2)} км` : '—';
  document.querySelector('#point-count').textContent = count ? `${count} ${({one:'точка',few:'точки',many:'точек'})[plural.select(count)]}` : 'Нажмите на карту, чтобы добавить точку';
  document.querySelector('[data-action="undo"]').disabled = !count;
  form.querySelector('[type="submit"]').disabled = !route;
  const messages = {
    loading: 'Строим пешеходный маршрут…',
    unreachable: 'Не удалось найти путь между точками. Поставьте точки ближе к пешеходной дорожке.',
    short: 'Путь короче 10 м. Добавьте ещё точку.',
    error: 'Сервис прокладки недоступен. Проверьте интернет и повторите попытку.',
  };
  document.querySelector('#route-status').hidden = !messages[draft.routeState];
  document.querySelector('#route-message').textContent = messages[draft.routeState] || '';
  document.querySelector('[data-action="retry-route"]').hidden = draft.routeState !== 'error';
}

function planRoute() {
  clearTimeout(routeTimer);
  routeRequest?.abort();
  routeRequest = null;
  const currentDraft = draft;
  const points = draft.points.slice();
  draft.route = null;
  draft.routeState = points.length < 2 ? 'idle' : 'loading';
  document.querySelector('#manual-error').hidden = true;
  refreshDraft();
  if (points.length < 2) return;

  // Debounce point edits and leave at least a second between public routing requests.
  routeTimer = setTimeout(async () => {
    const request = new AbortController();
    routeRequest = request;
    lastRouteRequest = Date.now();
    const timeout = setTimeout(() => request.abort(), 12000);
    try {
      const path = await fetchWalkingRoute(points, request.signal);
      if (routeRequest !== request) return;
      const meters = path ? routeDistance(path) : 0;
      if (!path) currentDraft.routeState = 'unreachable';
      else if (meters < 10) currentDraft.routeState = 'short';
      else {
        currentDraft.route = {points: path, meters};
        currentDraft.routeState = 'ready';
      }
    } catch {
      if (routeRequest !== request) return;
      currentDraft.routeState = 'error';
    } finally {
      clearTimeout(timeout);
      if (routeRequest === request) {
        routeRequest = null;
        refreshDraft();
      }
    }
  }, Math.max(500, lastRouteRequest + 1100 - Date.now()));
}

function showError(message, field) {
  const error = document.querySelector('#manual-error');
  error.textContent = message;
  error.hidden = false;
  field?.focus();
}

function appendActivity(activity) {
  const activities = [...journal.activities, activity].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  return commit({...journal, activities});
}

function exportJournal() {
  const backup = JSON.stringify({format: 'marshrut-journal', version: 1, activities: journal.activities});
  const download = document.createElement('a');
  download.href = URL.createObjectURL(new Blob([backup], {type: 'application/json'}));
  download.download = `marshrut-${todayKey()}.json`;
  document.body.appendChild(download);
  download.click();
  download.remove();
  setTimeout(() => URL.revokeObjectURL(download.href), 30000);
}

function validBackupActivity(activity) {
  if (!activity || typeof activity.id !== 'string' || !/^[a-f0-9-]{32,36}$/.test(activity.id)) return false;
  if (!['walk', 'run'].includes(activity.kind) || !['gps', 'manual'].includes(activity.source)) return false;
  if (typeof activity.startedAt !== 'string' || !Number.isFinite(Date.parse(activity.startedAt))) return false;
  const validNumber = value => Number.isFinite(value) && value >= 0;
  return ['meters', 'seconds', 'averagePace'].every(key => validNumber(activity[key]) && activity[key] > 0)
    && ['steps', 'calories'].every(key => Number.isSafeInteger(activity[key]) && activity[key] >= 0)
    && Array.isArray(activity.points) && activity.points.length >= 2 && activity.points.length <= 20000
    && activity.points.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
      && Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180)
    && Array.isArray(activity.samples) && activity.samples.length >= 2 && activity.samples.length <= 20000
    && Array.isArray(activity.splits) && activity.splits.length >= 1 && activity.splits.length <= 1000
    && [...activity.samples, ...activity.splits].every(sample => sample && validNumber(sample.seconds) && validNumber(sample.meters));
}

async function importJournal(file) {
  let backup;
  try {
    if (file.size > 4 * 1024 * 1024) throw new Error('File too large');
    backup = JSON.parse(await file.text());
    if (backup?.format !== 'marshrut-journal' || backup.version !== 1 || !Array.isArray(backup.activities)
      || !backup.activities.every(validBackupActivity)) throw new Error('Invalid journal');
  } catch {
    toast('Выберите файл журнала, скачанный из приложения «Маршрут».');
    return;
  }
  const activitiesById = new Map(journal.activities.map(activity => [activity.id, activity]));
  for (const activity of backup.activities) {
    if (!activitiesById.has(activity.id)) activitiesById.set(activity.id, activity);
  }
  const added = activitiesById.size - journal.activities.length;
  if (!added) return toast('В файле нет новых тренировок.');
  const activities = [...activitiesById.values()].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  if (commit({...journal, activities})) toast(`Добавлено тренировок: ${number(added)}.`);
}

function locate() {
  if (!navigator.geolocation || !isSecureContext) return toast('Для геолокации откройте приложение по HTTPS.');
  const targetMap = map;
  navigator.geolocation.getCurrentPosition(({coords}) => {
    if (targetMap === map) map?.move([coords.latitude, coords.longitude]);
  }, gpsError => toast(gpsError.code === 1 ? 'Разрешите геолокацию для этого сайта в Safari.' : 'Не удалось определить местоположение.'), {enableHighAccuracy: true, timeout: 10000});
}

function elapsed() {
  return recording ? Math.max(0, (Date.now() - recording.startMillis) / 1000) : 0;
}

function updateGPS() {
  if (!recording || currentScreen() !== 'gps') return;
  document.querySelector('#gps-distance').textContent = number(recording.meters / 1000, 2);
  document.querySelector('#gps-time').textContent = duration(elapsed());
  document.querySelector('#gps-pace').textContent = recording.meters >= 10 ? pace(elapsed() * 1000 / recording.meters) : '—';
  document.querySelector('#gps-status').textContent = recording.status;
}

async function keepAwake() {
  if (!recording || document.hidden || !navigator.wakeLock || (wakeLock && !wakeLock.released)) return;
  const active = recording;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (recording === active) wakeLock = lock;
    else await lock.release();
  } catch { /* Screen wake lock is optional. */ }
}

function receivePosition(position) {
  if (!recording || position.timestamp < recording.startMillis) return;
  const {latitude, longitude, accuracy} = position.coords;
  if (accuracy > 42) {
    recording.status = 'Слабый сигнал GPS. Подождите на открытом месте.';
    updateGPS();
    return;
  }
  const point = [latitude, longitude];
  const previous = recording.points.at(-1);
  const seconds = Math.max(0, (position.timestamp - recording.startMillis) / 1000);
  if (previous) {
    const segment = distance(previous, point);
    const interval = seconds - recording.times.at(-1);
    if (segment < Math.max(4, Math.min(accuracy * 0.55, 13)) || interval <= 0 || segment / interval > 13) return;
    recording.meters += segment;
  }
  recording.points.push(point);
  recording.times.push(recording.times.length ? seconds : 0);
  recording.status = 'GPS активен. Держите приложение открытым.';
  if (currentScreen() === 'gps') {
    map?.move(point);
    map?.draw(recording.points);
  }
  updateGPS();
}

function stopWatch() {
  navigator.geolocation.clearWatch(recording.watchId);
  clearInterval(timer);
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  recording = null;
}

function startGPS() {
  if (!navigator.geolocation || !isSecureContext) return toast('Для записи GPS откройте приложение по HTTPS.');
  recording = {kind: gpsKind, startMillis: Date.now(), points: [], times: [], meters: 0, status: 'Ищем сигнал GPS…'};
  recording.watchId = navigator.geolocation.watchPosition(receivePosition, error => {
    if (!recording) return;
    if (error.code === 1) {
      stopWatch();
      render(true);
      toast('Разрешите геолокацию для этого сайта в Safari.');
      return;
    }
    recording.status = 'Сигнал GPS недоступен. Ищем снова…';
    updateGPS();
  }, {enableHighAccuracy: true, maximumAge: 0, timeout: 15000});
  timer = setInterval(updateGPS, 1000);
  render(true);
  void keepAwake();
}

function finishGPS() {
  if (!recording) return;
  if (recording.meters < 10) {
    if (!confirm('GPS ещё не записал маршрут. Завершить тренировку без сохранения?')) return;
    stopWatch();
    render(true);
    return;
  }
  const seconds = Math.max(1, Math.ceil(elapsed()));
  const track = recording.times.slice();
  track[track.length - 1] = seconds;
  const activity = buildActivity({points: recording.points.slice(), startedAt: new Date(recording.startMillis).toISOString(),
    kind: recording.kind, source: 'gps', track, elapsed: seconds});
  if (!appendActivity(activity)) return;
  stopWatch();
  location.hash = `activity/${activity.id}`;
}

function openDraft() {
  if (recording) return toast('Сначала завершите запись GPS.');
  location.hash = 'manual';
}

const gpsTab = document.querySelector('#gps-tab');
let hold;
let pointerStart;
let suppressTapUntil = 0;
function stopHold() { clearTimeout(hold); pointerStart = null; }
function holdDraft() {
  if (suppressTapUntil > Date.now()) return;
  suppressTapUntil = Date.now() + 1000;
  openDraft();
}
gpsTab.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  pointerStart = [event.clientX, event.clientY];
  hold = setTimeout(holdDraft, 650);
});
gpsTab.addEventListener('pointermove', event => {
  if (pointerStart && Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 10) stopHold();
});
for (const event of ['pointerup', 'pointercancel', 'pointerleave']) gpsTab.addEventListener(event, stopHold);
gpsTab.addEventListener('click', event => { if (suppressTapUntil > Date.now()) event.preventDefault(); });
gpsTab.addEventListener('contextmenu', event => { event.preventDefault(); stopHold(); holdDraft(); });
gpsTab.addEventListener('keydown', event => {
  if (event.shiftKey && event.key === 'Enter') { event.preventDefault(); openDraft(); }
});

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.filter) { journalFilter = button.dataset.filter; render(true); return; }
  if (button.dataset.period) { statsPeriod = Number(button.dataset.period); render(true); return; }
  switch (button.dataset.action) {
    case 'export-journal': exportJournal(); break;
    case 'import-journal': document.querySelector('#journal-file').click(); break;
    case 'locate': locate(); break;
    case 'start': startGPS(); break;
    case 'stop': finishGPS(); break;
    case 'undo': draft.points.pop(); planRoute(); break;
    case 'retry-route': planRoute(); break;
    case 'coords': {
      const row = document.querySelector('#coords');
      row.hidden = !row.hidden;
      if (!row.hidden) document.querySelector('#coordinate').focus();
      break;
    }
    case 'move': {
      const input = document.querySelector('#coordinate');
      const pair = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(input.value);
      if (!pair || Math.abs(Number(pair[1])) > 85 || Math.abs(Number(pair[2])) > 180) return toast('Введите широту и долготу через запятую.');
      map?.move([Number(pair[1]), Number(pair[2])]);
      document.querySelector('#coords').hidden = true;
      break;
    }
    case 'gps-kind': gpsKind = button.dataset.kind; render(true); break;
    case 'draft-kind': {
      const oldDefault = draft.kind === 'walk' ? '10:30' : '6:00';
      draft.kind = button.dataset.kind;
      if (draft.pace === oldDefault) draft.pace = draft.kind === 'walk' ? '10:30' : '6:00';
      render(true);
      break;
    }
    case 'activity-menu': {
      const activityId = currentScreen().split('/')[1];
      if (confirm('Удалить эту тренировку из журнала?') && commit({...journal, activities: journal.activities.filter(a => a.id !== activityId)})) location.hash = 'journal';
      break;
    }
  }
});

document.addEventListener('change', event => {
  if (event.target.id !== 'journal-file' || !event.target.files.length) return;
  void importJournal(event.target.files[0]);
  event.target.value = '';
});

document.addEventListener('input', event => {
  if (event.target.form?.id === 'manual-form' && ['date','time','pace'].includes(event.target.name)) {
    draft[event.target.name] = event.target.value;
    document.querySelector('#manual-error').hidden = true;
  }
});

document.addEventListener('submit', event => {
  const form = event.target;
  event.preventDefault();
  if (form.id === 'manual-form') {
    if (!draft.route) return;
    const values = new FormData(form);
    const targetPace = parsePace(String(values.get('pace')));
    if (!targetPace) return showError('Введите темп в формате 10:30, от 2:00 до 60:00 мин/км.', form.elements.pace);
    const start = new Date(`${values.get('date')}T${values.get('time')}`);
    if (!Number.isFinite(start.getTime()) || start.getTime() > Date.now()) return showError('Укажите дату и время в прошлом или настоящем.', form.elements.date);
    const activity = buildActivity({points: draft.route.points, kind: draft.kind, source: 'manual', startedAt: start.toISOString(), targetPace});
    if (!appendActivity(activity)) return;
    draft = null;
    placement = null;
    location.hash = `activity/${activity.id}`;
  }
  if (form.id === 'goal-form') {
    const goal = Number(new FormData(form).get('goal'));
    if (commit({...journal, goal})) toast('Дневная цель сохранена.');
  }
});

window.addEventListener('hashchange', () => render());
document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateGPS(); void keepAwake(); } });
window.addEventListener('pagehide', event => { if (recording && !event.persisted) stopWatch(); });
window.addEventListener('beforeunload', event => { if (recording) event.preventDefault(); });
window.addEventListener('storage', event => {
  if (event.key === storageKey) { journal = load(); render(true); }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
render();
