const STORAGE_KEY = 'trama-clientes-v1';
const AUTH_SESSION_KEY = 'trama-authenticated-v1';
const PASSWORD_STORAGE_KEY = 'trama-page-password-v1';
const PAGE_PASSWORD = '123456';
const EXAMPLE_CLIENT_IDS = new Set(['c-lucia', 'c-marcos', 'c-amina', 'c-diego', 'c-sofia']);
const SERVICE_OPTIONS = ['Limpieza profunda', 'Bote de agua', 'Reparación tarjeta electrónica', 'Instalación de aires'];
const ZONE_OPTIONS = ['Sin zona', 'Norte', 'Centro', 'Sur', 'Este', 'Oeste'];

const $ = (selector) => document.querySelector(selector);
const clientList = $('#client-list');
const detailPanel = $('#detail-panel');
const dialog = $('#client-dialog');
const clientForm = $('#client-form');
const serviceDialog = $('#service-dialog');
const serviceForm = $('#service-form');
const toast = $('#toast');
const loginScreen = $('#login-screen');
const loginForm = $('#login-form');
const loginError = $('#login-error');
const appShell = $('#app-shell');
const passwordDialog = $('#password-dialog');
const passwordForm = $('#password-form');
const passwordError = $('#password-error');

const state = {
  clients: [],
  services: [],
  selectedId: null,
  view: 'clients',
  calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  searchTerm: '',
  serviceFilter: 'all',
  zoneFilter: 'all',
  toastTimer: null,
};

function dateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeClient(client) {
  return {
    ...client,
    name: String(client.name ?? '').trim(),
    company: String(client.company ?? '').trim(),
    email: String(client.email ?? '').trim(),
    phone: String(client.phone ?? '').trim(),
    locationUrl: String(client.locationUrl ?? '').trim(),
    zone: ZONE_OPTIONS.includes(client.zone) ? client.zone : 'Sin zona',
    notes: Array.isArray(client.notes) ? client.notes : [],
    createdAt: client.createdAt || dateOffset(0),
  };
}

function loadData() {
  let parsed = null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    parsed = saved ? JSON.parse(saved) : [];
  } catch (error) {
    console.warn('No se pudieron leer los datos guardados.', error);
    return { clients: [], services: [] };
  }

  const clientsSource = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.clients) ? parsed.clients : [];
  const servicesSource = !Array.isArray(parsed) && Array.isArray(parsed?.services) ? parsed.services : [];

  const sanitized = clientsSource.filter((client) => client && typeof client === 'object' && !EXAMPLE_CLIENT_IDS.has(client.id));
  const cleaned = sanitized.map((client) => normalizeClient(client));
  const services = servicesSource
    .filter((service) => service && typeof service.id === 'string' && typeof service.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(service.date))
    .map((service) => ({
      ...service,
      time: typeof service.time === 'string' ? service.time : '09:00',
      type: SERVICE_OPTIONS.includes(service.type) ? service.type : 'Servicio',
      quantity: Number.isFinite(Number(service.quantity)) ? Math.max(0, Number(service.quantity)) : 0,
    }));

  const upgraded = Array.isArray(parsed)
    || cleaned.length !== clientsSource.length
    || services.length !== servicesSource.length
    || sanitized.some((client) => Object.prototype.hasOwnProperty.call(client, 'status'));

  if (upgraded) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ clients: cleaned, services }));
    } catch (error) {
      console.warn('No se pudieron actualizar los datos guardados.', error);
    }
  }

  return { clients: cleaned, services };
}

// ---- Sincronización con la base de datos (Neon, vía /api/data) ----
const CLIENTES_URL = '/api/clientes';
const SERVICIOS_URL = '/api/servicios';
const SYNC_FLAG = 'trama-sync-state-v1'; // 'ok' = sincronizado, 'dirty' = cambios sin subir
let remotePushTimer = null;

function getSyncState() {
  try { return localStorage.getItem(SYNC_FLAG); } catch (error) { return null; }
}

function setSyncState(value) {
  try { localStorage.setItem(SYNC_FLAG, value); } catch (error) { /* sin acceso a localStorage */ }
}

function mergeById(remoteItems = [], localItems = []) {
  const merged = new Map();
  remoteItems.forEach((item) => { if (item && item.id) merged.set(item.id, item); });
  localItems.forEach((item) => { if (item && item.id) merged.set(item.id, item); }); // lo local gana
  return [...merged.values()];
}

function sanitizeRemoteClients(list) {
  return list
    .filter((client) => client && typeof client === 'object' && !EXAMPLE_CLIENT_IDS.has(client.id))
    .map((client) => normalizeClient(client));
}

function sanitizeRemoteServices(list) {
  return list
    .filter((service) => service && typeof service.id === 'string' && typeof service.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(service.date))
    .map((service) => ({
      ...service,
      time: typeof service.time === 'string' ? service.time : '09:00',
      type: SERVICE_OPTIONS.includes(service.type) ? service.type : 'Servicio',
      quantity: Number.isFinite(Number(service.quantity)) ? Math.max(0, Number(service.quantity)) : 0,
    }));
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
}

async function getJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function pushRemote() {
  try {
    await Promise.all([
      postJson(CLIENTES_URL, state.clients),
      postJson(SERVICIOS_URL, state.services),
    ]);
    setSyncState('ok');
  } catch (error) {
    console.warn('No se pudo sincronizar con la base de datos.', error);
    showToast('Guardado en este dispositivo; falta sincronizar con la base de datos.');
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ clients: state.clients, services: state.services }));
  } catch (error) {
    showToast('No se pudieron guardar los cambios en este dispositivo.');
    console.warn('No se pudieron guardar los datos.', error);
  }

  setSyncState('dirty');
  clearTimeout(remotePushTimer);
  remotePushTimer = setTimeout(pushRemote, 600);
}

async function loadRemote() {
  try {
    const [rawClients, rawServices] = await Promise.all([getJson(CLIENTES_URL), getJson(SERVICIOS_URL)]);

    const remoteClients = sanitizeRemoteClients(Array.isArray(rawClients) ? rawClients : []);
    const remoteServices = sanitizeRemoteServices(Array.isArray(rawServices) ? rawServices : []);

    // Si hay cambios locales sin subir (o es la primera vez), se mezclan con lo de la base.
    // Si ya estaba sincronizado, manda la base de datos.
    const mustMerge = getSyncState() !== 'ok';
    const remoteIsEmpty = !remoteClients.length && !remoteServices.length;

    if (mustMerge || remoteIsEmpty) {
      state.clients = mergeById(remoteClients, state.clients);
      state.services = mergeById(remoteServices, state.services);
    } else {
      state.clients = remoteClients;
      state.services = remoteServices;
    }

    if (!state.clients.some((client) => client.id === state.selectedId)) {
      state.selectedId = state.clients[0]?.id ?? null;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ clients: state.clients, services: state.services }));
    } catch (error) { /* sin acceso a localStorage */ }

    render();

    if (mustMerge || remoteIsEmpty) {
      await pushRemote(); // sube lo mezclado para que la base quede al día
    } else {
      setSyncState('ok');
    }
  } catch (error) {
    console.warn('No se pudo leer la base de datos; se usan los datos de este dispositivo.', error);
  }
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function initials(name = '') {
  return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase();
}

function normalizeSearch(value = '') {
  return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');
}

function toneFor(name = '') {
  return [...String(name)].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 5;
}

function formatDate(value, options = { day: 'numeric', month: 'short' }) {
  if (!value) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-ES', options).format(new Date(`${value}T12:00:00`));
}

function formatTime(value) {
  if (!value) return 'Sin horario';
  const [hours, minutes] = String(value).split(':');
  const date = new Date();
  date.setHours(Number(hours) || 0, Number(minutes) || 0, 0, 0);
  return new Intl.DateTimeFormat('es-ES', { hour: 'numeric', minute: '2-digit' }).format(date);
}

function getServiceMatchesFilter(client) {
  const clientServices = state.services.filter((service) => service.clientId === client.id);

  if (state.serviceFilter === 'today') {
    return clientServices.some((service) => service.date === dateOffset(0));
  }

  if (state.serviceFilter === 'scheduled') {
    return clientServices.length > 0;
  }

  return true;
}

function visibleClients() {
  const normalizedSearchTerm = normalizeSearch(state.searchTerm);
  return state.clients
    .filter((client) => {
      const matchesSearch = normalizeSearch(`${client.name} ${client.company} ${client.email} ${client.zone}`).includes(normalizedSearchTerm);
      const matchesZone = state.zoneFilter === 'all' || (client.zone || 'Sin zona') === state.zoneFilter;
      return matchesSearch && matchesZone && getServiceMatchesFilter(client);
    })
    .sort((first, second) => first.name.localeCompare(second.name, 'es'));
}

function getSelectedClient() {
  return state.clients.find((client) => client.id === state.selectedId) ?? null;
}

function updateStats() {
  $('#stat-total').textContent = state.clients.length;
  $('#nav-client-count').textContent = state.clients.length;
}

function getGoogleCalendarUrl(client, service) {
  const start = new Date(`${service.date}T${service.time || '09:00'}:00`);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const formatGoogleDate = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const details = [
    `Cliente: ${client.name}`,
    `Servicio: ${service.type}`,
    client.company ? `Dirección: ${client.company}` : '',
    client.locationUrl ? `Ubicación: ${client.locationUrl}` : '',
    `Zona: ${client.zone || 'Sin zona'}`,
  ].filter(Boolean).join('\n');

  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', `${client.name} - ${service.type}`);
  url.searchParams.set('dates', `${formatGoogleDate(start)}/${formatGoogleDate(end)}`);
  url.searchParams.set('details', details);
  url.searchParams.set('location', client.locationUrl || client.company || client.name);
  return url.toString();
}

function renderClientServices(client) {
  const services = state.services
    .filter((service) => service.clientId === client.id)
    .sort((first, second) => {
      const firstKey = `${first.date}T${first.time || '00:00'}`;
      const secondKey = `${second.date}T${second.time || '00:00'}`;
      return firstKey.localeCompare(secondKey);
    });

  const rows = services.length ? services.map((service) => {
    const quantityValue = Number(service.quantity) || 0;
    const quantityLabel = quantityValue > 0
      ? `<span class="service-quantity">${quantityValue} ${quantityValue === 1 ? 'aire' : 'aires'}</span>`
      : '';

    return `
    <div class="service-card">
      <div class="service-card-main">
        <div class="service-title-wrap">
          <span class="service-type">${escapeHTML(service.type || 'Servicio')}</span>
          ${quantityLabel}
        </div>
        <time>${escapeHTML(formatDate(service.date, { day: 'numeric', month: 'short', year: 'numeric' }))} · ${escapeHTML(formatTime(service.time))}</time>
      </div>
      <div class="service-card-actions">
        <a class="calendar-link" href="${escapeHTML(getGoogleCalendarUrl(client, service))}" target="_blank" rel="noopener noreferrer">Google Calendar</a>
        <button class="text-action danger" type="button" data-action="delete-service" data-service-id="${escapeHTML(service.id)}">Eliminar</button>
      </div>
    </div>`;
  }).join('') : '<div class="empty-section">Aún no hay servicios registrados para este cliente.</div>';

  return `
    <section class="detail-section">
      <div class="section-heading">
        <h3>Servicios agendados <span class="section-count">${services.length}</span></h3>
        <button class="text-action" type="button" data-action="register-service">+ Añadir</button>
      </div>
      <div class="service-date-list">${rows}</div>
    </section>`;
}

function renderClientRows() {
  const listResultCount = $('#list-result-count');
  const listHeading = $('#list-heading');
  const filterKey = state.serviceFilter === 'today' ? 'SERVICIOS DE HOY' : state.serviceFilter === 'scheduled' ? 'SERVICIOS AGENDADOS' : 'CLIENTES';

  listHeading.textContent = filterKey;
  const list = visibleClients();
  listResultCount.textContent = `${list.length} ${list.length === 1 ? 'resultado' : 'resultados'}`;

  if (!list.length) {
    clientList.innerHTML = `<div class="empty-state"><strong>${state.clients.length ? 'Sin coincidencias' : 'Empieza con un cliente'}</strong><span>${state.clients.length ? 'Prueba otro nombre o cambia el filtro.' : 'Añade una ficha para tener aquí tus relaciones.'}</span></div>`;
    return;
  }

  clientList.innerHTML = list.map((client) => `
    <button class="client-row ${client.id === state.selectedId ? 'is-selected' : ''}" type="button" data-client-id="${escapeHTML(client.id)}">
      <span class="client-avatar tone-${toneFor(client.name)}">${escapeHTML(initials(client.name))}</span>
      <span class="client-row-main">
        <span class="client-row-name">${escapeHTML(client.name)}</span>
        <span class="client-row-company">${escapeHTML(client.company || client.email || client.zone || 'Sin empresa')}</span>
      </span>
    </button>`).join('');
}

function calendarDateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function renderAgenda() {
  const year = state.calendarMonth.getFullYear();
  const month = state.calendarMonth.getMonth();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const firstOfMonth = new Date(year, month, 1);
  const firstVisibleDate = new Date(year, month, 1 - ((firstOfMonth.getDay() + 6) % 7));
  const dayCount = new Date(year, month + 1, 0).getDate();
  const weekCount = Math.max(5, Math.ceil((((firstOfMonth.getDay() + 6) % 7) + dayCount) / 7));
  const today = dateOffset(0);
  const servicesByDate = new Map();

  state.services.forEach((service) => {
    if (!service.date.startsWith(monthPrefix)) return;
    const dayServices = servicesByDate.get(service.date) ?? [];
    dayServices.push(service);
    servicesByDate.set(service.date, dayServices);
  });

  const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
    .map((day) => `<div class="calendar-weekday">${day}</div>`).join('');
  const days = Array.from({ length: weekCount * 7 }, (_, index) => {
    const date = new Date(firstVisibleDate);
    date.setDate(firstVisibleDate.getDate() + index);
    const dateKey = calendarDateKey(date);
    const dayServices = (servicesByDate.get(dateKey) ?? [])
      .sort((first, second) => (first.time || '').localeCompare(second.time || ''));
    const events = dayServices.map((service) => {
      const client = state.clients.find((item) => item.id === service.clientId);
      const clientName = client?.name || 'Cliente no disponible';
      return `<button class="calendar-event" type="button" data-calendar-service="${escapeHTML(service.id)}" aria-label="${escapeHTML(`${formatTime(service.time)}: ${service.type}, ${clientName}`)}">
        <time>${escapeHTML(formatTime(service.time))}</time>
        <span>${escapeHTML(service.type || 'Servicio')}</span>
        <small>${escapeHTML(clientName)}</small>
      </button>`;
    }).join('');

    return `<div class="calendar-day ${date.getMonth() !== month ? 'is-outside-month' : ''} ${dateKey === today ? 'is-today' : ''}" aria-label="${escapeHTML(formatDate(dateKey, { day: 'numeric', month: 'long', year: 'numeric' }))}">
      <span class="calendar-day-number">${date.getDate()}</span>
      <div class="calendar-day-events">${events}</div>
    </div>`;
  }).join('');

  const monthLabel = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(firstOfMonth);
  const monthServices = state.services
    .filter((service) => service.date.startsWith(monthPrefix))
    .sort((first, second) => `${first.date}T${first.time || '00:00'}`.localeCompare(`${second.date}T${second.time || '00:00'}`));
  $('#calendar-month-label').textContent = monthLabel;
  $('#calendar-service-count').textContent = `${monthServices.length} ${monthServices.length === 1 ? 'servicio este mes' : 'servicios este mes'}`;
  $('#calendar-month-filter').value = monthPrefix.slice(0, -1);
  $('#calendar-grid').innerHTML = `${weekdays}${days}`;
  $('#calendar-mobile-events').innerHTML = monthServices.map((service) => {
    const client = state.clients.find((item) => item.id === service.clientId);
    return `<button class="calendar-mobile-event" type="button" data-calendar-service="${escapeHTML(service.id)}">
      <time>${escapeHTML(formatDate(service.date, { day: 'numeric', month: 'short' }))} · ${escapeHTML(formatTime(service.time))}</time>
      <span>${escapeHTML(service.type || 'Servicio')}</span>
      <small>${escapeHTML(client?.name || 'Cliente no disponible')}</small>
    </button>`;
  }).join('');
  const emptyMessage = $('#calendar-empty');
  emptyMessage.textContent = monthServices.length
    ? ''
    : 'No hay servicios agendados para este mes.';
  emptyMessage.hidden = monthServices.length > 0;
}

function renderContactIcon(kind) {
  const icons = {
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    phone: '<path d="M21 16.5v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.65-3.08 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.07 3.74 2 2 0 0 1 3.06 1.5h3a2 2 0 0 1 2 1.72c.12.96.35 1.91.69 2.82a2 2 0 0 1-.45 2.11L7.03 9.42a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.86.57 2.82.69A2 2 0 0 1 21 16.5Z"/>',
    location: '<path d="M12 22s7-5.2 7-12a7 7 0 0 0-14 0c0 6.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[kind]}</svg>`;
}

function renderDetail() {
  const client = getSelectedClient();
  if (!client) {
    detailPanel.innerHTML = '<div class="detail-empty"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm10 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg><strong>Elige una relación</strong><p>Selecciona un cliente para ver sus datos y notas.</p></div>';
    return;
  }

  const notes = [...client.notes].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  const zoneText = client.zone || 'Sin zona';
  const locationText = client.company || 'Sin dirección';
  const locationUrl = client.locationUrl && client.locationUrl.trim();

  detailPanel.innerHTML = `
    <div class="detail-topline">
      <div class="detail-identity">
        <span class="detail-avatar tone-${toneFor(client.name)}">${escapeHTML(initials(client.name))}</span>
        <div>
          <h2 class="detail-name">${escapeHTML(client.name)}</h2>
          <p class="detail-company">${escapeHTML(locationText)}</p>
        </div>
      </div>
      <div class="detail-menu">
        <button class="icon-button" type="button" data-action="edit-client" aria-label="Editar cliente" title="Editar cliente"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 4 4 4M4 20l4-.8L19.4 7.8a2.1 2.1 0 0 0-3-3L5 16.2 4 20Z"/></svg></button>
        <button class="icon-button" type="button" data-action="delete-client" aria-label="Eliminar cliente" title="Eliminar cliente"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg></button>
      </div>
    </div>
    <div class="detail-meta-row">
      <span class="zone-badge">${escapeHTML(zoneText)}</span>
      ${locationUrl ? `<a class="location-link" href="${escapeHTML(locationUrl)}" target="_blank" rel="noopener noreferrer">Ver ubicación</a>` : '<span class="location-link is-disabled">Sin URL</span>'}
    </div>
    <div class="contact-list">
      <div class="contact-item">${renderContactIcon('mail')}<span class="${client.email ? '' : 'contact-empty'}">${escapeHTML(client.email || 'Sin correo')}</span></div>
      <div class="contact-item">${renderContactIcon('phone')}<span class="${client.phone ? '' : 'contact-empty'}">${escapeHTML(client.phone || 'Sin teléfono')}</span></div>
      <div class="contact-item contact-item-full">${renderContactIcon('location')}<span>${escapeHTML(locationText)}</span></div>
    </div>
    <section class="detail-section">
      <div class="section-heading">
        <h3>Notas <span class="section-count">${notes.length}</span></h3>
        <button class="text-action" type="button" data-action="show-note-form">+ Añadir</button>
      </div>
      <div class="note-list">${notes.length ? notes.map((note) => `<article class="note-item"><p class="note-text">${escapeHTML(note.text)}</p><span class="note-date">${escapeHTML(formatDate(note.createdAt, { day: 'numeric', month: 'short', year: 'numeric' }))}</span></article>`).join('') : '<div class="empty-section">Aún no hay notas para este cliente.</div>'}</div>
      <form class="inline-form inline-form-note" id="note-form" hidden>
        <textarea name="text" required maxlength="600" placeholder="Escribe una nota breve…" aria-label="Nueva nota"></textarea>
        <button class="button button-primary" type="submit">Guardar nota</button>
      </form>
    </section>
    ${renderClientServices(client)}
    <div class="detail-footer">
      <span>Cliente desde <strong>${escapeHTML(formatDate(client.createdAt, { day: 'numeric', month: 'long', year: 'numeric' }))}</strong></span>
      <span>${client.notes.length} ${client.notes.length === 1 ? 'nota' : 'notas'}</span>
    </div>`;
}

function updatePageText() {
  const isAgenda = state.view === 'agenda';
  $('#page-crumb').textContent = isAgenda ? 'Agenda' : 'Clientes';
  $('#page-title').textContent = isAgenda ? 'Agenda' : 'Clientes';
  $('#page-eyebrow').textContent = isAgenda ? 'SERVICIOS' : 'RELACIONES';
  $('#agenda-panel').hidden = !isAgenda;
  $('#clients-workspace').hidden = isAgenda;
  $('#client-stats').hidden = isAgenda;
  document.querySelectorAll('[data-view]').forEach((button) => {
    const isActive = button.dataset.view === state.view;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function render() {
  updateStats();
  updatePageText();
  $('#service-filter').value = state.serviceFilter;
  $('#zone-filter').value = state.zoneFilter;
  renderClientRows();
  renderDetail();
  renderAgenda();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2400);
}

function openClientDialog(client) {
  clientForm.reset();
  clientForm.elements.id.value = client?.id ?? '';
  clientForm.elements.name.value = client?.name ?? '';
  clientForm.elements.company.value = client?.company ?? '';
  clientForm.elements.locationUrl.value = client?.locationUrl ?? '';
  clientForm.elements.zone.value = client?.zone ?? 'Sin zona';
  clientForm.elements.email.value = client?.email ?? '';
  clientForm.elements.phone.value = client?.phone ?? '';
  $('#dialog-title').textContent = client ? 'Editar cliente' : 'Nuevo cliente';
  dialog.showModal();
  clientForm.elements.name.focus();
}

function closeClientDialog() {
  dialog.close();
}

$('#today-label').textContent = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
$('#add-client-button').addEventListener('click', () => openClientDialog());
document.querySelector('.primary-nav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (!button) return;
  state.view = button.dataset.view;
  render();
});
$('#search-input').addEventListener('input', (event) => {
  state.searchTerm = event.target.value.trim();
  renderClientRows();
  renderDetail();
});
$('#service-filter').addEventListener('change', (event) => {
  state.serviceFilter = event.target.value;
  render();
});
$('#zone-filter').addEventListener('change', (event) => {
  state.zoneFilter = event.target.value;
  render();
});

clientList.addEventListener('click', (event) => {
  const row = event.target.closest('[data-client-id]');
  if (!row) return;
  state.selectedId = row.dataset.clientId;
  render();
});

document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', closeClientDialog));
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) closeClientDialog();
});

document.querySelectorAll('[data-close-service-dialog]').forEach((button) => button.addEventListener('click', () => serviceDialog.close()));
serviceDialog.addEventListener('click', (event) => {
  if (event.target === serviceDialog) serviceDialog.close();
});

serviceForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const client = getSelectedClient();
  if (!client) return;

  const formData = new FormData(serviceForm);
  const date = String(formData.get('date'));
  const time = String(formData.get('time'));
  const serviceType = String(formData.get('serviceType'));
  const quantity = Number(formData.get('quantity')) || 0;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || !serviceType) return;

  state.services.push({
    id: makeId(),
    clientId: client.id,
    date,
    time,
    type: serviceType,
    quantity: Math.max(0, Math.floor(quantity)),
  });
  saveData();
  serviceDialog.close();
  render();
  showToast('Servicio registrado.');
});

clientForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const formData = new FormData(clientForm);
  const id = formData.get('id');
  const values = {
    name: String(formData.get('name')).trim(),
    company: String(formData.get('company')).trim(),
    email: String(formData.get('email')).trim(),
    phone: String(formData.get('phone')).trim(),
    locationUrl: String(formData.get('locationUrl')).trim(),
    zone: String(formData.get('zone') || 'Sin zona').trim() || 'Sin zona',
  };

  if (!values.name) {
    showToast('El nombre del cliente es obligatorio.');
    return;
  }

  if (id) {
    state.clients = state.clients.map((client) => (client.id === id ? { ...client, ...values } : client));
    showToast('Ficha de cliente actualizada.');
  } else {
    const client = { id: makeId(), ...values, createdAt: dateOffset(0), notes: [] };
    state.clients = [client, ...state.clients];
    state.selectedId = client.id;
    showToast('Cliente añadido a tu espacio.');
  }

  saveData();
  closeClientDialog();
  render();
});

detailPanel.addEventListener('click', (event) => {
  const control = event.target.closest('[data-action]');
  if (!control) return;

  const client = getSelectedClient();
  if (!client) return;

  const action = control.dataset.action;

  if (action === 'edit-client') {
    openClientDialog(client);
    return;
  }

  if (action === 'delete-client') {
    const confirmText = `¿Eliminar la ficha de ${client.name}? También se borrarán sus notas y datos asociados.`;
    if (window.confirm(confirmText)) {
      state.clients = state.clients.filter((item) => item.id !== client.id);
      state.services = state.services.filter((service) => service.clientId !== client.id);
      state.selectedId = state.clients[0]?.id ?? null;
      saveData();
      render();
      showToast('Cliente eliminado.');
    }
    return;
  }

  if (action === 'delete-service') {
    const serviceId = control.dataset.serviceId;
    state.services = state.services.filter((service) => service.id !== serviceId);
    saveData();
    render();
    showToast('Servicio eliminado.');
    return;
  }

  if (action === 'register-service') {
    serviceForm.reset();
    serviceForm.elements.date.value = dateOffset(0);
    serviceForm.elements.time.value = '09:00';
    serviceForm.elements.serviceType.value = SERVICE_OPTIONS[0];
    serviceForm.elements.quantity.value = '';
    serviceDialog.showModal();
    serviceForm.elements.date.focus();
    return;
  }

  if (action === 'show-note-form') {
    const form = detailPanel.querySelector('#note-form');
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector('input, textarea').focus();
  }
});

detailPanel.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  event.preventDefault();

  const client = getSelectedClient();
  if (!client) return;

  const formData = new FormData(form);
  if (form.id === 'note-form') {
    const text = String(formData.get('text')).trim();
    if (!text) return;
    client.notes.push({ id: makeId(), text, createdAt: dateOffset(0) });
    showToast('Nota guardada.');
  } else {
    return;
  }

  saveData();
  render();
});

$('#agenda-panel').addEventListener('click', (event) => {
  const monthButton = event.target.closest('[data-calendar-month]');
  if (monthButton) {
    state.calendarMonth.setDate(1);
    state.calendarMonth.setMonth(state.calendarMonth.getMonth() + Number(monthButton.dataset.calendarMonth));
    renderAgenda();
    return;
  }

  if (event.target.closest('[data-calendar-today]')) {
    const now = new Date();
    state.calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    renderAgenda();
    return;
  }

  if (event.target.closest('#reset-calendar-month')) {
    const now = new Date();
    state.calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    renderAgenda();
    return;
  }

  const serviceButton = event.target.closest('[data-calendar-service]');
  if (serviceButton) {
    const service = state.services.find((item) => item.id === serviceButton.dataset.calendarService);
    if (!service || !state.clients.some((client) => client.id === service.clientId)) return;
    state.selectedId = service.clientId;
    state.view = 'clients';
    render();
  }
});

$('#agenda-panel').addEventListener('change', (event) => {
  if (event.target.id === 'calendar-month-filter') {
    const selectedMonth = event.target.value;
    if (selectedMonth) {
      const [year, month] = selectedMonth.split('-').map(Number);
      state.calendarMonth = new Date(year, month - 1, 1);
    }
    renderAgenda();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !dialog.open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    $('#search-input').focus();
  }
});

function openApp() {
  loginScreen.hidden = true;
  appShell.hidden = false;

  const savedData = loadData();
  state.clients = savedData.clients;
  state.services = savedData.services;
  state.selectedId = state.clients[0]?.id ?? null;
  render();
  loadRemote();
}

function hasActiveSession() {
  try {
    return sessionStorage.getItem(AUTH_SESSION_KEY) === 'true';
  } catch (error) {
    console.warn('No se pudo recuperar la sesión de acceso.', error);
    return false;
  }
}

function getPagePassword() {
  return localStorage.getItem(PASSWORD_STORAGE_KEY) || PAGE_PASSWORD;
}

$('#change-password-button').addEventListener('click', () => {
  passwordForm.reset();
  passwordError.hidden = true;
  passwordDialog.showModal();
  passwordForm.elements.currentPassword.focus();
});

document.querySelectorAll('[data-close-password-dialog]').forEach((button) => {
  button.addEventListener('click', () => passwordDialog.close());
});
passwordDialog.addEventListener('click', (event) => {
  if (event.target === passwordDialog) passwordDialog.close();
});

passwordForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(passwordForm);
  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  passwordError.hidden = true;
  if (newPassword !== confirmPassword) {
    passwordError.textContent = 'La confirmación no coincide con la nueva contraseña.';
    passwordError.hidden = false;
    passwordForm.elements.confirmPassword.focus();
    return;
  }

  let savedPassword;
  try {
    savedPassword = getPagePassword();
  } catch (error) {
    console.warn('No se pudo leer la contraseña guardada.', error);
    passwordError.textContent = 'No se pudo comprobar la contraseña actual en este dispositivo.';
    passwordError.hidden = false;
    return;
  }

  if (currentPassword !== savedPassword) {
    passwordError.textContent = 'La contraseña actual no es correcta.';
    passwordError.hidden = false;
    passwordForm.elements.currentPassword.focus();
    return;
  }

  try {
    localStorage.setItem(PASSWORD_STORAGE_KEY, newPassword);
  } catch (error) {
    console.warn('No se pudo guardar la nueva contraseña.', error);
    passwordError.textContent = 'No se pudo guardar la nueva contraseña en este dispositivo.';
    passwordError.hidden = false;
    return;
  }

  passwordDialog.close();
  showToast('Contraseña actualizada.');
});

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const password = String(new FormData(loginForm).get('password') ?? '');

  let savedPassword;
  try {
    savedPassword = getPagePassword();
  } catch (error) {
    console.warn('No se pudo leer la contraseña guardada.', error);
    loginError.textContent = 'No se pudo comprobar la contraseña en este dispositivo.';
    loginError.hidden = false;
    return;
  }

  if (password !== savedPassword) {
    loginError.textContent = 'La contraseña no es correcta.';
    loginError.hidden = false;
    loginForm.elements.password.setAttribute('aria-invalid', 'true');
    loginForm.elements.password.select();
    return;
  }

  loginError.hidden = true;
  loginForm.elements.password.removeAttribute('aria-invalid');
  try {
    sessionStorage.setItem(AUTH_SESSION_KEY, 'true');
  } catch (error) {
    console.warn('No se pudo guardar la sesión de acceso; se solicitará la contraseña al recargar.', error);
  }
  openApp();
});

if (hasActiveSession()) openApp();
