const STORAGE_KEY = 'trama-clientes-v1';
const EXAMPLE_CLIENT_IDS = new Set(['c-lucia', 'c-marcos', 'c-amina', 'c-diego', 'c-sofia']);

const $ = (selector) => document.querySelector(selector);
const clientList = $('#client-list');
const detailPanel = $('#detail-panel');
const dialog = $('#client-dialog');
const clientForm = $('#client-form');
const toast = $('#toast');

const state = {
  clients: [],
  selectedId: null,
  searchTerm: '',
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

function loadClients() {
  let parsed = [];
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    parsed = saved ? JSON.parse(saved) : [];
  } catch (error) {
    console.warn('No se pudieron leer los datos guardados.', error);
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const sanitized = parsed.filter((client) => client && typeof client === 'object' && !EXAMPLE_CLIENT_IDS.has(client.id));
  const cleaned = sanitized.map(({ status, ...client }) => client);
  const upgraded = cleaned.length !== parsed.length || sanitized.some((client) => Object.prototype.hasOwnProperty.call(client, 'status'));

  if (upgraded) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    } catch (error) {
      console.warn('No se pudieron actualizar los datos guardados.', error);
    }
  }

  return cleaned;
}

function saveClients() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.clients));
  } catch (error) {
    showToast('No se pudieron guardar los cambios en este dispositivo.');
    console.warn('No se pudieron guardar los datos.', error);
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
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase();
}

function normalizeSearch(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
}

function toneFor(name = '') {
  return [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 5;
}

function formatDate(value, options = { day: 'numeric', month: 'short' }) {
  if (!value) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-ES', options).format(new Date(`${value}T12:00:00`));
}

function visibleClients() {
  const normalizedSearchTerm = normalizeSearch(state.searchTerm);
  return state.clients
    .filter((client) => normalizeSearch(`${client.name} ${client.company} ${client.email}`).includes(normalizedSearchTerm))
    .sort((first, second) => first.name.localeCompare(second.name, 'es'));
}

function getSelectedClient() {
  return state.clients.find((client) => client.id === state.selectedId) ?? null;
}

function updateStats() {
  $('#stat-total').textContent = state.clients.length;
  $('#nav-client-count').textContent = state.clients.length;
}

function renderClientRows() {
  const listResultCount = $('#list-result-count');

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
        <span class="client-row-company">${escapeHTML(client.company || client.email || 'Sin empresa')}</span>
      </span>
    </button>`).join('');
}

function renderContactIcon(kind) {
  const icons = {
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    phone: '<path d="M21 16.5v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.65-3.08 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.07 3.74 2 2 0 0 1 3.06 1.5h3a2 2 0 0 1 2 1.72c.12.96.35 1.91.69 2.82a2 2 0 0 1-.45 2.11L7.03 9.42a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.86.57 2.82.69A2 2 0 0 1 21 16.5Z"/>',
    aircon: '<rect x="3" y="4" width="18" height="8" rx="2"/><path d="M7 16c0 2 2 2 2 4m6-4c0 2 2 2 2 4M6 8h12"/>',
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
  const airConditionerQuantity = client.Quantity === '' || client.Quantity == null ? null : Number(client.Quantity);
  const hasAirConditionerQuantity = Number.isInteger(airConditionerQuantity) && airConditionerQuantity >= 0;

  detailPanel.innerHTML = `
    <div class="detail-topline">
      <div class="detail-identity">
        <span class="detail-avatar tone-${toneFor(client.name)}">${escapeHTML(initials(client.name))}</span>
        <div>
          <h2 class="detail-name">${escapeHTML(client.name)}</h2>
          <p class="detail-company">${escapeHTML(client.company || 'Sin empresa')}</p>
        </div>
      </div>
      <div class="detail-menu">
        <button class="icon-button" type="button" data-action="edit-client" aria-label="Editar cliente" title="Editar cliente"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 4 4 4M4 20l4-.8L19.4 7.8a2.1 2.1 0 0 0-3-3L5 16.2 4 20Z"/></svg></button>
        <button class="icon-button" type="button" data-action="delete-client" aria-label="Eliminar cliente" title="Eliminar cliente"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg></button>
      </div>
    </div>
    <div class="contact-list">
      <div class="contact-item">${renderContactIcon('mail')}<span class="${client.email ? '' : 'contact-empty'}">${escapeHTML(client.email || 'Sin correo')}</span></div>
      <div class="contact-item">${renderContactIcon('phone')}<span class="${client.phone ? '' : 'contact-empty'}">${escapeHTML(client.phone || 'Sin teléfono')}</span></div>
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
    <section class="detail-section">
      <div class="section-heading">
        <h3>Aires acondicionados</h3>
        <button class="text-action" type="button" data-action="show-quantity-form">+ Añadir</button>
      </div>
      ${hasAirConditionerQuantity ? `<div class="contact-item">${renderContactIcon('aircon')}<span>${airConditionerQuantity} ${airConditionerQuantity === 1 ? 'aire acondicionado' : 'aires acondicionados'}</span></div>` : '<div class="empty-section">Sin cantidad registrada.</div>'}
      <form class="inline-form" id="quantity-form" hidden>
        <input name="quantity" type="number" min="0" step="1" required value="${hasAirConditionerQuantity ? airConditionerQuantity : ''}" placeholder="Cantidad" aria-label="Cantidad de aires acondicionados">
        <button class="button button-primary" type="submit">${hasAirConditionerQuantity ? 'Guardar' : 'Añadir'}</button>
      </form>
    </section>
    <div class="detail-footer">
      <span>Cliente desde <strong>${escapeHTML(formatDate(client.createdAt, { day: 'numeric', month: 'long', year: 'numeric' }))}</strong></span>
      <span>${client.notes.length} ${client.notes.length === 1 ? 'nota' : 'notas'}</span>
    </div>`;
}

function updatePageText() {
  $('#page-crumb').textContent = 'Clientes';
  $('#page-title').textContent = 'Clientes';
  $('#page-eyebrow').textContent = 'RELACIONES';
}

function render() {
  updateStats();
  updatePageText();
  renderClientRows();
  renderDetail();
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
  clientForm.elements.email.value = client?.email ?? '';
  clientForm.elements.phone.value = client?.phone ?? '';
  clientForm.elements.Quantity.value = client?.Quantity ?? '';
  $('#dialog-title').textContent = client ? 'Editar cliente' : 'Nuevo cliente';
  dialog.showModal();
  clientForm.elements.name.focus();
}

function closeClientDialog() {
  dialog.close();
}

$('#today-label').textContent = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
$('#add-client-button').addEventListener('click', () => openClientDialog());
$('#search-input').addEventListener('input', (event) => {
  state.searchTerm = event.target.value.trim();
  renderClientRows();
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

clientForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const formData = new FormData(clientForm);
  const id = formData.get('id');
  const values = {
    name: String(formData.get('name')).trim(),
    company: String(formData.get('company')).trim(),
    email: String(formData.get('email')).trim(),
    phone: String(formData.get('phone')).trim(),
    Quantity: String(formData.get('Quantity')).trim(),
  };

  if (id) {
    state.clients = state.clients.map((client) => (client.id === id ? { ...client, ...values } : client));
    showToast('Ficha de cliente actualizada.');
  } else {
    const client = { id: makeId(), ...values, createdAt: dateOffset(0), notes: [] };
    state.clients = [client, ...state.clients];
    state.selectedId = client.id;
    showToast('Cliente añadido a tu espacio.');
  }

  saveClients();
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
      state.selectedId = state.clients[0]?.id ?? null;
      saveClients();
      render();
      showToast('Cliente eliminado.');
    }
    return;
  }

  if (action === 'show-note-form' || action === 'show-quantity-form') {
    const form = detailPanel.querySelector(action === 'show-note-form' ? '#note-form' : '#quantity-form');
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
  if (form.id === 'quantity-form') {
    const quantity = Number(formData.get('quantity'));
    if (!Number.isInteger(quantity) || quantity < 0) return;
    client.Quantity = String(quantity);
    showToast('Cantidad actualizada.');
  } else if (form.id === 'note-form') {
    const text = String(formData.get('text')).trim();
    if (!text) return;
    client.notes.push({ id: makeId(), text, createdAt: dateOffset(0) });
    showToast('Nota guardada.');
  } else {
    return;
  }

  saveClients();
  render();
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !dialog.open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    $('#search-input').focus();
  }
});

state.clients = loadClients();
state.selectedId = state.clients[0]?.id ?? null;
render();