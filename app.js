const STORAGE_KEY = 'trama-clientes-v1';
const statuses = ['Activo', 'Prospecto', 'Inactivo'];
const EXAMPLE_CLIENT_IDS = new Set(['c-lucia', 'c-marcos', 'c-amina', 'c-diego', 'c-sofia']);
const clientList = document.querySelector('#client-list');
const detailPanel = document.querySelector('#detail-panel');
const dialog = document.querySelector('#client-dialog');
const clientForm = document.querySelector('#client-form');
const toast = document.querySelector('#toast');

function dateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}


function loadClients() {
  let parsed;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    parsed = saved ? JSON.parse(saved) : [];
  } catch (error) {
    console.warn('No se pudieron leer los datos guardados.', error);
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const clientsWithoutExamples = parsed.filter((client) => !EXAMPLE_CLIENT_IDS.has(client?.id));
  if (clientsWithoutExamples.length !== parsed.length) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clientsWithoutExamples));
    } catch (error) {
      console.warn('No se pudieron eliminar los clientes de ejemplo guardados.', error);
    }
  }
  return clientsWithoutExamples;
}

let clients = loadClients();
let selectedId = clients[0]?.id ?? null;
let currentView = 'clients';
let statusFilter = 'all';
let searchTerm = '';
let toastTimer;

function saveClients() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clients));
  } catch (error) {
    showToast('No se pudieron guardar los cambios en este dispositivo.');
    console.warn('No se pudieron guardar los datos.', error);
  }
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
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
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('es-ES', options).format(date);
}

function statusClass(status) {
  return status === 'Prospecto' ? 'status-prospecto' : status === 'Inactivo' ? 'status-inactivo' : '';
}

function pendingTasks() {
  return clients.flatMap((client) => client.tasks.filter((task) => !task.done).map((task) => ({ ...task, clientId: client.id, clientName: client.name, company: client.company })))
    .sort((first, second) => first.due.localeCompare(second.due));
}

function updateStats() {
  document.querySelector('#stat-total').textContent = clients.length;
  document.querySelector('#stat-active').textContent = clients.filter((client) => client.status === 'Activo').length;
  document.querySelector('#stat-prospects').textContent = clients.filter((client) => client.status === 'Prospecto').length;
  document.querySelector('#stat-due').textContent = pendingTasks().filter((task) => task.due <= dateOffset(7)).length;
  document.querySelector('#nav-client-count').textContent = clients.length;
  document.querySelector('#nav-reminder-count').textContent = pendingTasks().length;
}

function visibleClients() {
  const normalizedSearchTerm = normalizeSearch(searchTerm);
  return clients.filter((client) => {
    const matchesStatus = statusFilter === 'all' || client.status === statusFilter;
    const searchable = normalizeSearch(`${client.name} ${client.company} ${client.email}`);
    return matchesStatus && searchable.includes(normalizedSearchTerm);
  }).sort((first, second) => first.name.localeCompare(second.name, 'es'));
}

function renderClientRows() {
  document.querySelector('#list-heading').textContent = currentView === 'clients' ? 'CLIENTES' : 'PRÓXIMOS PASOS';
  if (currentView === 'reminders') {
    const tasks = pendingTasks();
    document.querySelector('#list-result-count').textContent = `${tasks.length} pendientes`;
    if (!tasks.length) {
      clientList.innerHTML = '<div class="empty-state"><strong>Todo al día</strong><span>No tienes recordatorios pendientes.</span></div>';
      return;
    }
    clientList.innerHTML = tasks.map((task) => `
      <button class="client-row reminder-row ${task.clientId === selectedId ? 'is-selected' : ''}" type="button" data-client-id="${escapeHTML(task.clientId)}">
        <span class="client-avatar tone-${toneFor(task.clientName)}">${escapeHTML(initials(task.clientName))}</span>
        <span class="client-row-main"><span class="client-row-name">${escapeHTML(task.title)}</span><span class="client-row-company">${escapeHTML(task.clientName)}${task.company ? ` · ${escapeHTML(task.company)}` : ''}</span></span>
        <span class="reminder-date ${task.due < dateOffset(0) ? 'is-overdue' : ''}">${task.due < dateOffset(0) ? 'Vencido' : ''} ${escapeHTML(formatDate(task.due))}</span>
      </button>`).join('');
    return;
  }

  const list = visibleClients();
  document.querySelector('#list-result-count').textContent = `${list.length} ${list.length === 1 ? 'resultado' : 'resultados'}`;
  if (!list.length) {
    clientList.innerHTML = `<div class="empty-state"><strong>${clients.length ? 'Sin coincidencias' : 'Empieza con un cliente'}</strong><span>${clients.length ? 'Prueba otro nombre o cambia el filtro.' : 'Añade una ficha para tener aquí tus relaciones.'}</span></div>`;
    return;
  }
  clientList.innerHTML = list.map((client) => `
    <button class="client-row ${client.id === selectedId ? 'is-selected' : ''}" type="button" data-client-id="${escapeHTML(client.id)}">
      <span class="client-avatar tone-${toneFor(client.name)}">${escapeHTML(initials(client.name))}</span>
      <span class="client-row-main"><span class="client-row-name">${escapeHTML(client.name)}</span><span class="client-row-company">${escapeHTML(client.company || client.email || 'Sin empresa')}</span></span>
      <span class="status-pill ${statusClass(client.status)}">${escapeHTML(client.status)}</span>
    </button>`).join('');
}

function renderContactIcon(kind) {
  const paths = {
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    phone: '<path d="M21 16.5v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.65-3.08 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.07 3.74 2 2 0 0 1 3.06 1.5h3a2 2 0 0 1 2 1.72c.12.96.35 1.91.69 2.82a2 2 0 0 1-.45 2.11L7.03 9.42a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.86.57 2.82.69A2 2 0 0 1 21 16.5Z"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[kind]}</svg>`;
}

function renderTask(task) {
  const overdue = !task.done && task.due < dateOffset(0);
  return `<div class="task-item ${task.done ? 'is-done' : ''}">
    <button class="task-check ${task.done ? 'is-done' : ''}" type="button" data-action="toggle-task" data-task-id="${escapeHTML(task.id)}" aria-label="${task.done ? 'Marcar pendiente' : 'Marcar como completada'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></button>
    <span class="task-copy"><span class="task-title">${escapeHTML(task.title)}</span><span class="task-date ${overdue ? 'is-overdue' : ''}">${overdue ? 'Vencido · ' : ''}${escapeHTML(formatDate(task.due, { day: 'numeric', month: 'long', year: 'numeric' }))}</span></span>
    <button class="task-remove" type="button" data-action="delete-task" data-task-id="${escapeHTML(task.id)}" aria-label="Eliminar recordatorio"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg></button>
  </div>`;
}

function renderDetail() {
  const client = clients.find((item) => item.id === selectedId);
  if (!client) {
    detailPanel.innerHTML = `<div class="detail-empty"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm10 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg><strong>Elige una relación</strong><p>Selecciona un cliente para ver sus datos, notas y próximos pasos.</p></div>`;
    return;
  }
  const tasks = [...client.tasks].sort((first, second) => Number(first.done) - Number(second.done) || first.due.localeCompare(second.due));
  const notes = [...client.notes].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  detailPanel.innerHTML = `
    <div class="detail-topline">
      <div class="detail-identity"><span class="detail-avatar tone-${toneFor(client.name)}">${escapeHTML(initials(client.name))}</span><div><h2 class="detail-name">${escapeHTML(client.name)}</h2><p class="detail-company">${escapeHTML(client.company || 'Sin empresa')}</p></div></div>
      <div class="detail-menu"><button class="icon-button" type="button" data-action="edit-client" aria-label="Editar cliente" title="Editar cliente"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 4 4 4M4 20l4-.8L19.4 7.8a2.1 2.1 0 0 0-3-3L5 16.2 4 20Z"/></svg></button><button class="icon-button" type="button" data-action="delete-client" aria-label="Eliminar cliente" title="Eliminar cliente"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg></button></div>
    </div>
    <div class="detail-status-row"><span class="detail-label">ESTADO</span><span class="status-pill ${statusClass(client.status)}">${escapeHTML(client.status)}</span></div>
    <div class="contact-list">
      <div class="contact-item">${renderContactIcon('mail')}<span class="${client.email ? '' : 'contact-empty'}">${escapeHTML(client.email || 'Sin correo')}</span></div>
      <div class="contact-item">${renderContactIcon('phone')}<span class="${client.phone ? '' : 'contact-empty'}">${escapeHTML(client.phone || 'Sin teléfono')}</span></div>
    </div>
    <section class="detail-section">
      <div class="section-heading"><h3>Próximos pasos <span class="section-count">${client.tasks.filter((task) => !task.done).length}</span></h3><button class="text-action" type="button" data-action="show-task-form">+ Añadir</button></div>
      <div class="task-list">${tasks.length ? tasks.map((task) => renderTask(task)).join('') : '<div class="empty-section">Sin recordatorios. Añade el siguiente paso para tenerlo presente.</div>'}</div>
      <form class="inline-form" id="task-form" hidden><input name="title" required maxlength="120" placeholder="¿Qué hay que hacer?" aria-label="Descripción del recordatorio"><input name="due" type="date" required aria-label="Fecha del recordatorio" value="${dateOffset(1)}"><button class="button button-primary" type="submit">Añadir</button></form>
    </section>
    <section class="detail-section">
      <div class="section-heading"><h3>Notas <span class="section-count">${notes.length}</span></h3><button class="text-action" type="button" data-action="show-note-form">+ Añadir</button></div>
      <div class="note-list">${notes.length ? notes.map((note) => `<article class="note-item"><p class="note-text">${escapeHTML(note.text)}</p><span class="note-date">${escapeHTML(formatDate(note.createdAt, { day: 'numeric', month: 'short', year: 'numeric' }))}</span></article>`).join('') : '<div class="empty-section">Aún no hay notas para este cliente.</div>'}</div>
      <form class="inline-form inline-form-note" id="note-form" hidden><textarea name="text" required maxlength="600" placeholder="Escribe una nota breve…" aria-label="Nueva nota"></textarea><button class="button button-primary" type="submit">Guardar nota</button></form>
    </section>
    <div class="detail-footer"><span>Cliente desde <strong>${escapeHTML(formatDate(client.createdAt, { day: 'numeric', month: 'long', year: 'numeric' }))}</strong></span><span>${client.notes.length} ${client.notes.length === 1 ? 'nota' : 'notas'}</span></div>`;
}

function updatePageText() {
  const reminders = currentView === 'reminders';
  document.querySelectorAll('.nav-link').forEach((button) => button.classList.toggle('is-active', button.dataset.view === currentView));
  document.querySelector('#page-crumb').textContent = reminders ? 'Recordatorios' : 'Clientes';
  document.querySelector('#page-title').textContent = reminders ? 'Próximos pasos' : 'Tus clientes';
  document.querySelector('#page-eyebrow').textContent = reminders ? 'SEGUIMIENTO' : 'RELACIONES';
  const pageDescription = document.querySelector('#page-description');
  if (pageDescription) {
    pageDescription.textContent = reminders ? 'Lo pendiente, ordenado por fecha para que nada se quede atrás.' : 'Un lugar claro para cada relación y su próximo paso.';
  }
  document.querySelector('#search-input').disabled = reminders;
  document.querySelector('#status-filter').disabled = reminders;
  document.querySelector('.search-box').classList.toggle('is-disabled', reminders);
  document.querySelector('.filter-select-wrap').classList.toggle('is-disabled', reminders);
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
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2400);
}

function openClientDialog(client) {
  clientForm.reset();
  clientForm.elements.id.value = client?.id ?? '';
  clientForm.elements.name.value = client?.name ?? '';
  clientForm.elements.company.value = client?.company ?? '';
  clientForm.elements.email.value = client?.email ?? '';
  clientForm.elements.phone.value = client?.phone ?? '';
  clientForm.elements.status.value = client?.status ?? 'Prospecto';
  document.querySelector('#dialog-title').textContent = client ? 'Editar cliente' : 'Nuevo cliente';
  dialog.showModal();
  clientForm.elements.name.focus();
}

function closeClientDialog() {
  dialog.close();
}

document.querySelector('#today-label').textContent = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
document.querySelector('#add-client-button').addEventListener('click', () => openClientDialog());
document.querySelector('#search-input').addEventListener('input', (event) => { searchTerm = event.target.value.trim(); renderClientRows(); });
document.querySelector('#status-filter').addEventListener('change', (event) => { statusFilter = event.target.value; renderClientRows(); });

document.querySelector('.primary-nav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (!button) return;
  currentView = button.dataset.view;
  render();
});

clientList.addEventListener('click', (event) => {
  const row = event.target.closest('[data-client-id]');
  if (!row) return;
  selectedId = row.dataset.clientId;
  render();
});

document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', closeClientDialog));
dialog.addEventListener('click', (event) => { if (event.target === dialog) closeClientDialog(); });

clientForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(clientForm);
  const id = formData.get('id');
  const values = {
    name: String(formData.get('name')).trim(),
    company: String(formData.get('company')).trim(),
    email: String(formData.get('email')).trim(),
    phone: String(formData.get('phone')).trim(),
    status: statuses.includes(formData.get('status')) ? formData.get('status') : 'Prospecto',
  };
  if (id) {
    clients = clients.map((client) => client.id === id ? { ...client, ...values } : client);
    showToast('Ficha de cliente actualizada.');
  } else {
    const client = { id: makeId(), ...values, createdAt: dateOffset(0), notes: [], tasks: [] };
    clients = [client, ...clients];
    selectedId = client.id;
    currentView = 'clients';
    statusFilter = 'all';
    document.querySelector('#status-filter').value = 'all';
    showToast('Cliente añadido a tu espacio.');
  }
  saveClients();
  closeClientDialog();
  render();
});

detailPanel.addEventListener('click', (event) => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const client = clients.find((item) => item.id === selectedId);
  if (!client) return;
  const action = control.dataset.action;
  if (action === 'edit-client') openClientDialog(client);
  if (action === 'delete-client' && window.confirm(`¿Eliminar la ficha de ${client.name}? También se borrarán sus notas y recordatorios.`)) {
    clients = clients.filter((item) => item.id !== client.id);
    selectedId = clients[0]?.id ?? null;
    saveClients();
    render();
    showToast('Cliente eliminado.');
  }
  if (action === 'show-task-form' || action === 'show-note-form') {
    const form = detailPanel.querySelector(action === 'show-task-form' ? '#task-form' : '#note-form');
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector('input, textarea').focus();
  }
  if (action === 'toggle-task') {
    const task = client.tasks.find((item) => item.id === control.dataset.taskId);
    if (task) task.done = !task.done;
    saveClients();
    render();
  }
  if (action === 'delete-task') {
    client.tasks = client.tasks.filter((item) => item.id !== control.dataset.taskId);
    saveClients();
    render();
    showToast('Recordatorio eliminado.');
  }
});

detailPanel.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const client = clients.find((item) => item.id === selectedId);
  if (!client) return;
  const formData = new FormData(form);
  if (form.id === 'task-form') {
    const title = String(formData.get('title')).trim();
    const due = String(formData.get('due'));
    if (!title || !due) return;
    client.tasks.push({ id: makeId(), title, due, done: false });
    showToast('Recordatorio añadido.');
  } else if (form.id === 'note-form') {
    const text = String(formData.get('text')).trim();
    if (!text) return;
    client.notes.push({ id: makeId(), text, createdAt: dateOffset(0) });
    showToast('Nota guardada.');
  } else return;
  saveClients();
  render();
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !dialog.open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    document.querySelector('#search-input').focus();
  }
});

render();