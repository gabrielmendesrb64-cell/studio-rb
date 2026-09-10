
let bookings = [], currentFilter = 'all';
let calendarCursor = new Date();
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

async function api(url, opts = {}){
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  let d = {};
  try { d = await r.json(); } catch {}
  if(!r.ok) throw new Error(d.error || 'Erro');
  return d;
}

function esc(s){
  return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
function fmtDate(d){
  const [y,m,day] = String(d).split('-');
  return `${day}/${m}/${y}`;
}
function todayISO(){
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${d.getFullYear()}-${m}-${day}`;
}
function monthLabel(d){
  return d.toLocaleDateString('pt-BR', { month:'long', year:'numeric' }).replace(/^./, t => t.toUpperCase());
}
function dateToISO(dateObj){
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2,'0');
  const d = String(dateObj.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function selectedDateText(value){
  return value ? fmtDate(value) : 'Todos os dias';
}

async function check(){
  try{
    await api('/api/admin/me');
    showDash();
  }catch{}
}

$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  try{
    await api('/api/admin/login', { method:'POST', body: JSON.stringify(d) });
    showDash();
  }catch(err){
    $('#loginMsg').textContent = 'Usuário ou senha incorretos.';
  }
};

async function showDash(){
  $('#loginView').classList.add('hidden');
  $('#dashboard').classList.remove('hidden');
  $('#logoutBtn').classList.remove('hidden');
  await refresh();
}

$('#logoutBtn').onclick = async () => {
  await api('/api/admin/logout', { method:'POST' });
  location.reload();
};

async function refresh(){
  bookings = (await api('/api/admin/bookings')).bookings || [];
  renderStats();
  renderBlocks();
  renderCalendar();
  renderList();
}

function renderStats(){
  const counts = {
    Pendente: bookings.filter(b => b.status === 'Pendente').length,
    Confirmado: bookings.filter(b => b.status === 'Confirmado').length,
    Concluído: bookings.filter(b => b.status === 'Concluído').length,
    Total: bookings.length
  };
  $('#stats').innerHTML = [
    ['Pendentes', counts.Pendente],
    ['Confirmados', counts.Confirmado],
    ['Concluídos', counts.Concluído],
    ['Total', counts.Total]
  ].map(([label, num]) => `<div class="stat"><b>${num}</b><span>${label}</span></div>`).join('');
}

function renderList(){
  const date = $('#filterDate').value;
  $('#selectedDateLabel').textContent = selectedDateText(date);

  const list = bookings
    .filter(b => (currentFilter === 'all' || b.status === currentFilter) && (!date || b.date === date))
    .sort((a,b) => (a.date + a.time).localeCompare(b.date + b.time));

  $('#bookingList').innerHTML = list.length
    ? list.map(b => `
      <div class="booking-card">
        <div class="booking-main">
          <b>${esc(b.name)}</b>
          <small>${esc(b.phone)}</small>
        </div>

        <div class="booking-meta">
          <div><b>Data:</b> ${fmtDate(b.date)}</div>
          <div><b>Horário:</b> ${b.time}</div>
        </div>

        <div class="booking-status">
          <span class="status">${b.status}</span>
        </div>

        <div class="booking-actions">
          <button class="mini-btn" onclick="setStatus('${b.id}','Confirmado')">Confirmar</button>
          <button class="mini-btn" onclick="setStatus('${b.id}','Concluído')">Concluir</button>
          <button class="mini-btn" onclick="setStatus('${b.id}','Cancelado')">Cancelar</button>
          <a class="mini-btn" target="_blank" href="https://wa.me/${String(b.phone).replace(/\D/g,'')}">WhatsApp</a>
        </div>
      </div>
    `).join('')
    : '<div class="empty-state">Nenhum agendamento encontrado para esse filtro.</div>';
}

function renderCalendar(){
  const grid = $('#calendarGrid');
  const label = $('#calendarMonthLabel');
  if(!grid || !label) return;

  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  label.textContent = monthLabel(calendarCursor);

  const firstDay = new Date(year, month, 1);
  const start = firstDay.getDay();
  const total = new Date(year, month + 1, 0).getDate();
  const selected = $('#filterDate').value;
  const today = todayISO();

  const counts = {};
  bookings.forEach(b => {
    counts[b.date] = (counts[b.date] || 0) + 1;
  });

  let html = '';
  for(let i = 0; i < start; i++){
    html += '<span class="calendar-empty"></span>';
  }

  for(let day = 1; day <= total; day++){
    const dateObj = new Date(year, month, day);
    const iso = dateToISO(dateObj);
    const active = selected === iso ? 'active' : '';
    const isToday = today === iso ? 'today' : '';
    const count = counts[iso] || 0;

    html += `
      <button class="calendar-day ${active} ${isToday}" type="button" data-date="${iso}">
        <span class="num">${day}</span>
        ${count ? `<span class="dot">${count}</span>` : ''}
      </button>
    `;
  }

  grid.innerHTML = html;

  $$('#calendarGrid .calendar-day').forEach(btn => {
    btn.onclick = () => {
      $('#filterDate').value = btn.dataset.date;
      renderCalendar();
      renderList();
    };
  });
}

window.setStatus = async (id, status) => {
  await api('/api/admin/bookings/' + id, {
    method:'PATCH',
    body: JSON.stringify({ status })
  });
  refresh();
};

$$('.segmented button').forEach(btn => {
  btn.onclick = () => {
    $$('.segmented button').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderList();
  };
});

$('#filterDate').onchange = () => {
  renderCalendar();
  renderList();
};

$('#prevMonth').onclick = () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
  renderCalendar();
};
$('#nextMonth').onclick = () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
  renderCalendar();
};
$('#todayBtn').onclick = () => {
  const now = new Date();
  calendarCursor = new Date(now.getFullYear(), now.getMonth(), 1);
  $('#filterDate').value = todayISO();
  renderCalendar();
  renderList();
};
$('#clearDateBtn').onclick = () => {
  $('#filterDate').value = '';
  renderCalendar();
  renderList();
};

$('#blockBtn').onclick = async () => {
  const date = $('#blockDate').value;
  const time = $('#blockTime').value;
  if(!date || !time) return;
  await api('/api/admin/blocks', {
    method:'POST',
    body: JSON.stringify({ date, time })
  });
  $('#blockTime').value = '';
  renderBlocks();
};

async function renderBlocks(){
  const d = await api('/api/admin/config');
  $('#blocksList').innerHTML = (d.config.blockedSlots || []).map((x, i) => `
    <div class="block-item">
      <span>${fmtDate(x.date)} • ${x.time}</span>
      <button class="mini-btn" onclick="removeBlock(${i})">Liberar</button>
    </div>
  `).join('') || '<div class="empty-state">Nenhum horário bloqueado.</div>';
}
window.removeBlock = async (i) => {
  await api('/api/admin/blocks/' + i, { method:'DELETE' });
  renderBlocks();
};

const dlg = $('#manualDialog');
$('#manualBtn').onclick = () => dlg.showModal();
$('#saveManual').onclick = async e => {
  e.preventDefault();
  const form = $('#manualForm');
  if(!form.reportValidity()) return;
  const d = Object.fromEntries(new FormData(form));
  await api('/api/admin/bookings', {
    method:'POST',
    body: JSON.stringify(d)
  });
  dlg.close();
  form.reset();
  refresh();
};

check();
