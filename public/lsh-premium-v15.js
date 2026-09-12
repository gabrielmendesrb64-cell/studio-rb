const $ = s => document.querySelector(s);

async function clearLegacyCaches(){
  try{
    if('serviceWorker' in navigator){const regs=await navigator.serviceWorker.getRegistrations();await Promise.all(regs.map(r=>r.unregister()));}
    if('caches' in window){const keys=await caches.keys();await Promise.all(keys.map(k=>caches.delete(k)));}
  }catch{}
}
clearLegacyCaches();
const $$ = s => [...document.querySelectorAll(s)];
let cfg = null;
let selectedServices = new Map();

function waLink(number, text){
  const n = String(number || '').replace(/\D/g, '');
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
function money(v){
  return Number(v || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}
function esc(s){
  return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
function fmtDate(d){
  const [y,m,day] = String(d || '').split('-');
  return y && m && day ? `${day}/${m}/${y}` : d;
}
function totalDuration(){
  return [...selectedServices.values()].reduce((sum,s) => sum + Number(s.duration || 60), 0) || 60;
}
function totalPrice(){
  return [...selectedServices.values()].reduce((sum,s) => sum + Number(s.price || 0), 0);
}
function selectedIds(){ return [...selectedServices.keys()]; }

async function loadConfig(){
  try{
    const r = await fetch('/api/config', { cache:'no-store' });
    cfg = await r.json();
    const mainMessage = 'Olá! Vim pelo site da Studio RB e gostaria de falar com vocês. 💗';
    const mainLink = waLink(cfg.whatsapp, mainMessage);
    ['#whatsappFloat','#heroWhatsappBtn','#topWhatsappBtn','#mobileWhatsappBtn','#whatsappLink'].forEach(sel => {
      const el = $(sel); if(el) el.href = mainLink;
    });
    const errorBtn = $('#errorWhatsapp');
    if(errorBtn) errorBtn.href = waLink(cfg.whatsapp, 'Olá! Tive um problema ao tentar realizar meu agendamento pelo site da Studio RB. Poderia me ajudar?');
    const cW = $('#contactWhatsapp'); if(cW) cW.textContent = cfg.whatsapp || 'Atualizar número';
    const cI = $('#contactInstagram'); if(cI) cI.textContent = cfg.instagram || '@lshstudiorb';
    const cA = $('#contactAddress'); if(cA) cA.textContent = cfg.address || 'Atualizar endereço';
    const cH = $('#contactHours'); if(cH) cH.textContent = cfg.openingHours || 'Horários pelo painel';
    const insta = $('#instagramLink'); if(insta) insta.href = cfg.instagram && cfg.instagram.startsWith('http') ? cfg.instagram : '#';
    renderProcedurePicker();
    renderDynamicGallery();
  }catch(e){
    console.error(e);
    const box = $('#procedureGrid');
    if(box) box.innerHTML = '<div class="booking-alert">Não foi possível carregar os procedimentos. Tente novamente.</div>';
  }
}

function renderProcedurePicker(){
  const grid = $('#procedureGrid');
  if(!grid) return;
  const services = Array.isArray(cfg?.services) ? cfg.services : [];
  if(!services.length){
    grid.innerHTML = '<div class="booking-alert">A proprietária ainda não liberou procedimentos para agendamento.</div>';
    updateSummary();
    return;
  }
  grid.innerHTML = services.map(s => {
    const defined = s.price !== null && s.price !== '' && Number.isFinite(Number(s.price));
    return `
      <button type="button" class="procedure-card ${defined ? '' : 'price-missing'}" data-service="${esc(s.id)}" ${defined ? '' : 'disabled'}>
        <span class="procedure-check">✓</span>
        <div class="procedure-copy">
          <b>${esc(s.name)}</b>
          <small>${Number(s.duration || 60)} min</small>
        </div>
        <strong>${defined ? money(s.price) : 'Valor a definir'}</strong>
      </button>`;
  }).join('');
  $$('.procedure-card:not([disabled])').forEach(btn => {
    btn.onclick = () => {
      const s = services.find(x => String(x.id) === btn.dataset.service);
      if(!s) return;
      if(selectedServices.has(String(s.id))){ selectedServices.delete(String(s.id)); btn.classList.remove('selected'); }
      else { selectedServices.set(String(s.id), s); btn.classList.add('selected'); }
      if($('#bookingDate')?.value) loadTimes();
      else updateSummary();
    };
  });
  updateSummary();
}

function updateSummary(){
  const list = $('#selectedProcedureList');
  const total = $('#bookingTotal');
  const duration = $('#bookingDuration');
  if(list){
    const items = [...selectedServices.values()];
    list.innerHTML = items.length
      ? items.map(s => `<span>${esc(s.name)} <b>${money(s.price)}</b></span>`).join('')
      : '<small>Nenhum procedimento selecionado.</small>';
  }
  if(total) total.textContent = money(totalPrice());
  if(duration) duration.textContent = `${totalDuration()} min aprox.`;
}

const menu = $('#mobileMenu');
$('#menuBtn')?.addEventListener('click', () => menu?.classList.add('open'));
$('#closeMenu')?.addEventListener('click', () => menu?.classList.remove('open'));
$$('#mobileMenu a').forEach(a => a.addEventListener('click', () => menu?.classList.remove('open')));

const io = new IntersectionObserver(entries => entries.forEach(e => e.isIntersecting && e.target.classList.add('in')), { threshold:.12 });
$$('.reveal').forEach(el => io.observe(el));

const dateInput = $('#bookingDate');
const timeGrid = $('#timeGrid');
const timeInput = $('#bookingTime');
if(dateInput){
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  dateInput.min = today.toISOString().split('T')[0];
}

async function loadTimes(){
  if(!dateInput || !timeGrid || !timeInput) return;
  timeInput.value = '';
  $$('.time-slot').forEach(x => x.classList.remove('selected'));
  updateSummary();
  if(!selectedServices.size){
    timeGrid.innerHTML = '<p class="muted">Escolha pelo menos um procedimento primeiro.</p>';
    return;
  }
  if(!dateInput.value){
    timeGrid.innerHTML = '<p class="muted">Selecione uma data para ver os horários.</p>';
    return;
  }
  timeGrid.innerHTML = '<p class="muted">Carregando horários...</p>';
  try{
    const r = await fetch(`/api/availability?date=${encodeURIComponent(dateInput.value)}&duration=${totalDuration()}`, { cache:'no-store' });
    const data = await r.json();
    if(!r.ok) throw new Error(data.error || 'Erro');
    timeGrid.innerHTML = '';
    if(!data.slots?.length){
      timeGrid.innerHTML = '<p class="muted">A proprietária não liberou horários para esta data.</p>';
      return;
    }
    const available = data.slots.filter(s => s.available);
    if(!available.length){
      timeGrid.innerHTML = '<p class="muted">Todos os horários desta data estão ocupados.</p>';
      return;
    }
    data.slots.forEach(slot => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'time-slot';
      b.textContent = slot.time;
      b.disabled = !slot.available;
      if(!slot.available) b.title = 'Horário indisponível';
      b.onclick = () => {
        $$('.time-slot').forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
        timeInput.value = slot.time;
      };
      timeGrid.appendChild(b);
    });
  }catch{
    timeGrid.innerHTML = '<p class="muted">Não foi possível carregar os horários.</p>';
  }
}
dateInput?.addEventListener('change', loadTimes);

$('#bookingForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  if(!selectedServices.size){ alert('Escolha pelo menos um procedimento.'); return; }
  if(!dateInput?.value){ alert('Escolha uma data.'); return; }
  if(!timeInput?.value){ alert('Escolha um horário disponível.'); return; }
  const fd = new FormData(e.currentTarget);
  const payload = Object.fromEntries(fd.entries());
  payload.date = dateInput.value;
  payload.time = timeInput.value;
  payload.services = selectedIds();
  const submit = e.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'ENVIANDO...';
  try{
    const r = await fetch('/api/bookings', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const data = await r.json();
    if(!r.ok) throw new Error(data.error || 'Erro');
    $('#bookingForm').classList.add('hidden');
    $('#successState')?.classList.remove('hidden');
    $('#errorState')?.classList.add('hidden');
  }catch(err){
    $('#bookingErrorText').textContent = err.message || 'Não conseguimos concluir o agendamento.';
    $('#bookingForm').classList.add('hidden');
    $('#errorState')?.classList.remove('hidden');
    $('#successState')?.classList.add('hidden');
  }finally{
    submit.disabled = false;
    submit.textContent = 'ENVIAR SOLICITAÇÃO';
  }
});
$('#newBooking')?.addEventListener('click', () => location.reload());

async function searchMyBookings(){
  const q = $('#myBookingQuery')?.value.trim();
  const out = $('#myBookingsResult');
  if(!out || !q) return;
  out.innerHTML = '<div class="booking-alert">Buscando...</div>';
  try{
    const r = await fetch('/api/my-bookings?q=' + encodeURIComponent(q));
    const data = await r.json();
    if(!r.ok) throw new Error(data.error || 'Erro');
    if(!data.bookings.length){
      out.innerHTML = '<div class="booking-alert">Nenhum agendamento encontrado com esses dados.</div>';
      return;
    }
    out.innerHTML = data.bookings.map(b => `
      <article class="my-booking-card ${b.status === 'Cancelado' ? 'cancelled' : ''}">
        <div class="my-booking-top"><b>${fmtDate(b.date)} • ${esc(b.time)}</b><span>${esc(b.status)}</span></div>
        <h3>${(b.services || []).map(s => esc(s.name)).join(' + ') || 'Procedimento'}</h3>
        <div class="my-booking-meta"><span>Total: <b>${money(b.total)}</b></span><span>Duração: ${Number(b.duration || 0)} min</span></div>
        ${!['Cancelado','Concluído'].includes(b.status) ? `<button type="button" class="btn btn-outline cancel-client-booking" data-id="${b.id}">DESMARCAR AGENDAMENTO</button>` : ''}
      </article>`).join('');
    $$('.cancel-client-booking').forEach(btn => btn.onclick = async () => {
      if(!confirm('Deseja realmente desmarcar este agendamento?')) return;
      let verify = q;
      if(!/\d{8,}/.test(String(q).replace(/\D/g,''))){
        verify = prompt('Por segurança, digite o WhatsApp usado no agendamento para confirmar o cancelamento:') || '';
        if(!verify) return;
      }
      btn.disabled = true;
      try{
        const rr = await fetch('/api/my-bookings/' + btn.dataset.id + '/cancel', {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ q: verify })
        });
        const dd = await rr.json();
        if(!rr.ok) throw new Error(dd.error || 'Erro');
        await searchMyBookings();
      }catch(err){ alert(err.message); btn.disabled = false; }
    });
  }catch(err){
    out.innerHTML = `<div class="booking-alert">${esc(err.message)}</div>`;
  }
}
$('#myBookingsSearchBtn')?.addEventListener('click', searchMyBookings);
$('#myBookingQuery')?.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); searchMyBookings(); } });

const year = $('#year'); if(year) year.textContent = new Date().getFullYear();
loadConfig();

/* ===== V11: portfólio por categorias gerenciado pela proprietária ===== */
let activeGalleryCategory = '';
function renderDynamicGallery(){
  const items = Array.isArray(cfg?.gallery) ? cfg.gallery : [];
  const categories = Array.isArray(cfg?.galleryCategories) ? cfg.galleryCategories : [];
  const tabs = $('#galleryCategoryTabs');
  const content = $('#galleryCategoryContent');
  if(!tabs || !content) return;

  const visibleCats = categories.filter(cat => items.some(item => item.categoryId === cat.id));
  const effectiveCats = visibleCats.length ? visibleCats : categories;
  if(!effectiveCats.length){
    tabs.innerHTML='';
    content.innerHTML='<div class="booking-alert">A Emilly ainda não criou categorias no portfólio.</div>';
    return;
  }
  if(!activeGalleryCategory || !effectiveCats.some(c=>c.id===activeGalleryCategory)) activeGalleryCategory=effectiveCats[0].id;

  tabs.innerHTML=effectiveCats.map(cat=>`<button type="button" class="gallery-tab ${cat.id===activeGalleryCategory?'active':''}" data-category="${esc(cat.id)}" role="tab" aria-selected="${cat.id===activeGalleryCategory}">${esc(cat.name)}</button>`).join('');

  const renderCategory = id => {
    activeGalleryCategory=id;
    const cat=effectiveCats.find(c=>c.id===id) || effectiveCats[0];
    const catItems=items.filter(item=>item.categoryId===cat.id);
    $$('#galleryCategoryTabs .gallery-tab').forEach(btn=>{
      const active=btn.dataset.category===cat.id;
      btn.classList.toggle('active',active); btn.setAttribute('aria-selected',active?'true':'false');
    });
    content.innerHTML=`
      <div class="gallery-category-head"><div><span>RESULTADOS</span><h3>${esc(cat.name)}</h3></div><small>${catItems.length} foto${catItems.length===1?'':'s'}</small></div>
      ${catItems.length?`<div class="category-photo-grid">${catItems.map((item,i)=>`<article class="category-photo-card">
        <button type="button" class="category-photo-open" data-src="${esc(item.src)}" data-title="${esc(item.title||cat.name)}" aria-label="Ampliar ${esc(item.title||cat.name)}">
          <img src="${esc(item.src)}" alt="${esc(item.title||`Resultado de ${cat.name}`)}" loading="lazy">
        </button>
        <div class="category-photo-copy"><b>${esc(item.title||cat.name)}</b>${item.caption?`<span>${esc(item.caption)}</span>`:''}</div>
      </article>`).join('')}</div>`:'<div class="gallery-empty-category">A Emilly ainda não adicionou fotos nesta categoria.</div>'}`;
    $$('.category-photo-open').forEach(btn=>btn.onclick=()=>openGalleryLightbox(btn.dataset.src,btn.dataset.title));
  };
  $$('#galleryCategoryTabs .gallery-tab').forEach(btn=>btn.onclick=()=>renderCategory(btn.dataset.category));
  renderCategory(activeGalleryCategory);
}

function openGalleryLightbox(src,title){
  let modal=$('#galleryLightbox');
  if(!modal){
    modal=document.createElement('div'); modal.id='galleryLightbox'; modal.className='gallery-lightbox';
    modal.innerHTML='<button class="gallery-lightbox-close" type="button" aria-label="Fechar">×</button><div class="gallery-lightbox-inner"><img alt=""><b></b></div>';
    document.body.appendChild(modal);
    modal.querySelector('.gallery-lightbox-close').onclick=()=>modal.classList.remove('open');
    modal.onclick=e=>{if(e.target===modal)modal.classList.remove('open');};
  }
  modal.querySelector('img').src=src; modal.querySelector('img').alt=title||'Resultado'; modal.querySelector('b').textContent=title||'Resultado'; modal.classList.add('open');
}
