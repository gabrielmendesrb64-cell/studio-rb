'use strict';
let bookings=[], adminConfig=null, currentFilter='all', calendarCursor=new Date(), selectedCalendarDate='';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const dayNames=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

async function api(url,opts={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  const options={...opts,signal:controller.signal,cache:'no-store',credentials:'same-origin',headers:{'X-Requested-With':'XMLHttpRequest',...(opts.headers||{})}};
  if(opts.body && !options.headers['Content-Type']) options.headers['Content-Type']='application/json';
  try{
    const r=await fetch(url,options); let d={}; try{d=await r.json();}catch{}
    if(!r.ok) throw new Error(d.error||`Erro ${r.status}`);
    return d;
  }catch(e){
    if(e.name==='AbortError') throw new Error('A operação demorou demais. Tente novamente.');
    throw e;
  }finally{clearTimeout(timer);}
}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
function fmtDate(d){const [y,m,day]=String(d||'').split('-');return y&&m&&day?`${day}/${m}/${y}`:d;}
function money(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
function todayISO(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function dateToISO(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function monthLabel(d){return d.toLocaleDateString('pt-BR',{month:'long',year:'numeric'}).replace(/^./,t=>t.toUpperCase());}
function toast(msg,type='ok'){const el=$('#adminToast');if(!el)return;el.textContent=msg;el.className=`admin-toast show ${type}`;clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.className='admin-toast',4200);}
function setBusy(btn,busy,text){if(!btn)return;if(busy){btn.dataset.oldText=btn.textContent;btn.disabled=true;btn.textContent=text||'SALVANDO...';}else{btn.disabled=false;btn.textContent=btn.dataset.oldText||btn.textContent;}}

async function clearLegacyCaches(){
  try{if('serviceWorker'in navigator){const regs=await navigator.serviceWorker.getRegistrations();await Promise.all(regs.map(r=>r.unregister()));}if('caches'in window){const keys=await caches.keys();await Promise.all(keys.map(k=>caches.delete(k)));}}catch{}
}
clearLegacyCaches();

$('#loginForm')?.addEventListener('submit',async e=>{e.preventDefault();const btn=e.currentTarget.querySelector('button');setBusy(btn,true,'ENTRANDO...');try{await api('/api/admin/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});await showDash();}catch(err){$('#loginMsg').textContent=err.message||'Usuário ou senha incorretos.';}finally{setBusy(btn,false);}});
$('#logoutBtn')?.addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST'});}finally{location.reload();}});
async function check(){try{await api('/api/admin/me');await showDash();}catch{}}
async function showDash(){$('#loginView')?.classList.add('hidden');$('#dashboard')?.classList.remove('hidden');$('#logoutBtn')?.classList.remove('hidden');selectedCalendarDate=todayISO();await refresh();}
async function refresh(){
  const [b,c,s]=await Promise.all([
    api('/api/admin/bookings'),
    api('/api/admin/config'),
    api('/api/admin/services')
  ]);
  bookings=b.bookings||[];
  adminConfig=c.config||{};
  adminConfig.weeklyHours=adminConfig.weeklyHours||{};
  adminConfig.dateHours=adminConfig.dateHours||{};
  adminConfig.services=s.services||[];
  renderStats();renderCalendar();renderDayManager();renderList();renderBlocks();renderSchedule();renderServices();renderGallery();renderPaymentSettings();renderClientSearch();renderFinance();
}
function renderStats(){const rows=[['Pendentes',bookings.filter(b=>b.status==='Pendente').length],['Confirmados',bookings.filter(b=>b.status==='Confirmado').length],['Hoje',bookings.filter(b=>b.date===todayISO()&&b.status!=='Cancelado').length],['Total',bookings.length]];$('#stats').innerHTML=rows.map(([l,n])=>`<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');}

function renderCalendar(){
  const grid=$('#calendarGrid'),label=$('#calendarMonthLabel');if(!grid||!label)return;const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth();label.textContent=monthLabel(calendarCursor);
  const start=new Date(y,m,1).getDay(),total=new Date(y,m+1,0).getDate(),today=todayISO();const counts={},dateHours=adminConfig?.dateHours||{},weekly=adminConfig?.weeklyHours||{};
  bookings.filter(b=>b.status!=='Cancelado').forEach(b=>counts[b.date]=(counts[b.date]||0)+1);
  let html='';for(let i=0;i<start;i++)html+='<span class="calendar-empty"></span>';
  for(let day=1;day<=total;day++){
    const d=new Date(y,m,day),iso=dateToISO(d),custom=Object.prototype.hasOwnProperty.call(dateHours,iso),open=custom?(dateHours[iso]||[]).length>0:(weekly[String(d.getDay())]||[]).length>0,count=counts[iso]||0;
    html+=`<button class="calendar-day ${selectedCalendarDate===iso?'active':''} ${today===iso?'today':''} ${open?'open-day':''}" type="button" data-date="${iso}"><span class="num">${day}</span><span class="calendar-flags">${custom?'<i title="Agenda específica">★</i>':''}${count?`<span class="dot">${count}</span>`:''}</span></button>`;
  }
  grid.innerHTML=html;
}
$('#calendarGrid')?.addEventListener('click',e=>{const btn=e.target.closest('.calendar-day');if(!btn)return;selectedCalendarDate=btn.dataset.date;$('#filterDate').value=selectedCalendarDate;renderCalendar();renderDayManager();renderList();});
$('#prevMonth')?.addEventListener('click',()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1);renderCalendar();});
$('#nextMonth')?.addEventListener('click',()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1);renderCalendar();});
$('#todayBtn')?.addEventListener('click',()=>{const n=new Date();calendarCursor=new Date(n.getFullYear(),n.getMonth(),1);selectedCalendarDate=todayISO();$('#filterDate').value=selectedCalendarDate;renderCalendar();renderDayManager();renderList();});
$('#clearDateBtn')?.addEventListener('click',()=>{$('#filterDate').value='';renderList();});

function effectiveTimesForDate(date){const specific=adminConfig?.dateHours||{};if(Object.prototype.hasOwnProperty.call(specific,date))return{times:specific[date]||[],specific:true};const d=new Date(date+'T12:00:00');return{times:(adminConfig?.weeklyHours||{})[String(d.getDay())]||[],specific:false};}
function renderDayManager(){
  const date=selectedCalendarDate||todayISO();selectedCalendarDate=date;const {times,specific}=effectiveTimesForDate(date);$('#calendarSelectedDate').textContent=fmtDate(date);$('#calendarScheduleSource').textContent=specific?'Horários específicos deste dia. Eles substituem o padrão semanal.':'Este dia está usando os horários padrão da semana.';
  $('#dateTimesList').innerHTML=times.length?times.map(t=>`<button class="time-chip date-time-chip" type="button" data-time="${t}" ${specific?'':'disabled'}>${t}${specific?'<span>×</span>':''}</button>`).join(''):'<span class="no-time">Nenhum horário liberado.</span>';
  $('#clearDateScheduleBtn').disabled=!specific;
  const list=bookings.filter(b=>b.date===date&&!['Cancelado','Concluído'].includes(b.status)).sort((a,b)=>a.time.localeCompare(b.time));$('#calendarDayBookings').innerHTML=list.length?list.map(b=>`<div class="day-booking-mini"><b>${esc(b.time)}</b><span>${esc(b.name)}</span><small>${esc((b.services||[]).map(s=>s.name).join(' + ')||b.status)}</small></div>`).join(''):'<small class="muted">Nenhum agendamento neste dia.</small>';
}
async function saveDateTimes(times){const date=selectedCalendarDate||todayISO();await api('/api/admin/date-schedule',{method:'PUT',body:JSON.stringify({date,times})});adminConfig.dateHours[date]=[...new Set(times)].sort();renderCalendar();renderDayManager();toast(`Horários de ${fmtDate(date)} salvos.`);}
$('#addDateTimeBtn')?.addEventListener('click',async()=>{const input=$('#dateTimeInput'),t=input.value;if(!t){toast('Escolha um horário.','error');return;}const date=selectedCalendarDate||todayISO();const current=Object.prototype.hasOwnProperty.call(adminConfig.dateHours,date)?[...(adminConfig.dateHours[date]||[])]:[...effectiveTimesForDate(date).times];if(!current.includes(t))current.push(t);try{await saveDateTimes(current);input.value='';}catch(e){toast(e.message,'error');}});
$('#dateTimesList')?.addEventListener('click',async e=>{const chip=e.target.closest('.date-time-chip');if(!chip||chip.disabled)return;const date=selectedCalendarDate,current=[...(adminConfig.dateHours[date]||[])].filter(t=>t!==chip.dataset.time);try{await saveDateTimes(current);}catch(err){toast(err.message,'error');}});
$('#clearDateScheduleBtn')?.addEventListener('click',async()=>{const date=selectedCalendarDate;if(!date)return;try{await api('/api/admin/date-schedule/'+encodeURIComponent(date),{method:'DELETE'});delete adminConfig.dateHours[date];renderCalendar();renderDayManager();toast('Este dia voltou a usar o padrão semanal.');}catch(e){toast(e.message,'error');}});

$$('.segmented button').forEach(btn=>btn.addEventListener('click',()=>{$$('.segmented button').forEach(x=>x.classList.remove('active'));btn.classList.add('active');currentFilter=btn.dataset.filter;renderList();}));
$('#filterDate')?.addEventListener('change',()=>{if($('#filterDate').value){selectedCalendarDate=$('#filterDate').value;const d=new Date(selectedCalendarDate+'T12:00:00');calendarCursor=new Date(d.getFullYear(),d.getMonth(),1);renderCalendar();renderDayManager();}renderList();});
function renderList(){const date=$('#filterDate').value;$('#selectedDateLabel').textContent=date?fmtDate(date):'Todos os dias';const list=bookings.filter(b=>((currentFilter==='all'&&b.status!=='Concluído')||b.status===currentFilter)&&(!date||b.date===date)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));$('#bookingList').innerHTML=list.length?list.map(b=>{const services=(b.services||[]).map(s=>s.name).join(' + ')||'Sem procedimento informado';const msg=`Olá, ${b.name}! 💗 Seu agendamento no Studio RB foi confirmado para ${fmtDate(b.date)} às ${b.time}. Procedimento(s): ${services}. Total: ${money(b.total)}.`;const proof=b.proofUploadedAt?`<a class="mini-btn proof-btn" target="_blank" href="/api/admin/bookings/${encodeURIComponent(b.id)}/proof">Ver comprovante</a>`:'';const payment=b.paymentStatus?`<small class="payment-badge">PIX: ${esc(b.paymentStatus)} • sinal ${money(b.depositAmount||20)}</small>`:'';return `<article class="booking-card booking-card-v15" data-booking-id="${esc(b.id)}"><div class="booking-main"><b>${esc(b.name)}</b><small>${esc(b.phone)}${b.email?` • ${esc(b.email)}`:''}</small><p>${esc(services)}</p>${payment}</div><div class="booking-meta"><div><b>Data:</b> ${fmtDate(b.date)}</div><div><b>Horário:</b> ${esc(b.time)}</div><div><b>Total:</b> ${money(b.total)}</div></div><div class="booking-status"><span class="status status-${esc(b.status.toLowerCase().replace(/\s+/g,'-'))}">${esc(b.status)}</span></div><div class="booking-actions">${proof}<button class="mini-btn pink js-status" data-status="Confirmado" type="button">Aprovar / Confirmar</button><button class="mini-btn danger js-status" data-status="Pagamento recusado" type="button">Recusar PIX</button><button class="mini-btn js-status" data-status="Concluído" type="button">Concluir</button><button class="mini-btn danger js-status" data-status="Cancelado" type="button">Cancelar</button><a class="mini-btn" target="_blank" rel="noopener" href="https://wa.me/${String(b.phone).replace(/\D/g,'')}?text=${encodeURIComponent(msg)}">WhatsApp</a></div></article>`;}).join(''):'<div class="empty-state">Nenhum agendamento encontrado.</div>';}

$('#bookingList')?.addEventListener('click',async e=>{const card=e.target.closest('[data-booking-id]');if(!card)return;const id=card.dataset.bookingId;const st=e.target.closest('.js-status');if(st){setBusy(st,true,'SALVANDO...');try{const d=await api('/api/admin/bookings/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status:st.dataset.status})});if(st.dataset.status==='Confirmado'){toast('Agendamento confirmado ✓','ok');}else if(st.dataset.status==='Concluído'){toast('Atendimento concluído ✓ Removido da agenda ativa.','ok');}else toast('Status atualizado.');await refresh();}catch(err){toast(err.message,'error');}finally{setBusy(st,false);}return;}});

$('#blockBtn')?.addEventListener('click',async()=>{const date=$('#blockDate').value,time=$('#blockTime').value;if(!date||!time){toast('Escolha data e horário.','error');return;}try{await api('/api/admin/blocks',{method:'POST',body:JSON.stringify({date,time})});$('#blockTime').value='';await refresh();toast('Horário bloqueado.');}catch(e){toast(e.message,'error');}});
function renderBlocks(){$('#blocksList').innerHTML=(adminConfig?.blockedSlots||[]).map((x,i)=>`<div class="block-item" data-block-index="${i}"><span>${fmtDate(x.date)} • ${x.time}</span><button class="mini-btn js-remove-block" type="button">Liberar</button></div>`).join('')||'<div class="empty-state">Nenhum horário bloqueado.</div>';}
$('#blocksList')?.addEventListener('click',async e=>{const row=e.target.closest('[data-block-index]');if(!row||!e.target.closest('.js-remove-block'))return;try{await api('/api/admin/blocks/'+row.dataset.blockIndex,{method:'DELETE'});await refresh();toast('Horário liberado.');}catch(err){toast(err.message,'error');}});

function renderSchedule(){const weekly=adminConfig?.weeklyHours||{};$('#scheduleEditor').innerHTML=dayNames.map((name,day)=>`<div class="schedule-day" data-day="${day}"><div class="schedule-day-head"><div><b>${name}</b><small>${(weekly[String(day)]||[]).length?`${(weekly[String(day)]||[]).length} horário(s)`:'Fechado / sem horários'}</small></div><div class="schedule-add"><input type="time" class="day-time-input"><button type="button" class="mini-btn pink js-add-week-time">＋ Horário</button></div></div><div class="schedule-times">${(weekly[String(day)]||[]).map(t=>`<button type="button" class="time-chip js-remove-week-time" data-time="${t}">${t}<span>×</span></button>`).join('')||'<span class="no-time">Nenhum horário liberado.</span>'}</div></div>`).join('');}
async function saveWeekly(){const state=$('#scheduleSaveState');state.textContent='Salvando...';state.classList.add('saving');try{const d=await api('/api/admin/schedule',{method:'PUT',body:JSON.stringify({weeklyHours:adminConfig.weeklyHours})});adminConfig.weeklyHours=d.weeklyHours;state.textContent='Salvo ✓';state.classList.remove('saving');renderSchedule();renderCalendar();renderDayManager();return true;}catch(e){state.textContent='Erro ao salvar';state.classList.remove('saving');toast(e.message,'error');return false;}}
$('#scheduleEditor')?.addEventListener('click',async e=>{const row=e.target.closest('[data-day]');if(!row)return;const day=row.dataset.day;const add=e.target.closest('.js-add-week-time');if(add){const input=row.querySelector('.day-time-input'),t=input.value;if(!t){toast('Escolha um horário.','error');return;}const before=[...(adminConfig.weeklyHours[day]||[])],arr=[...before];if(!arr.includes(t))arr.push(t);adminConfig.weeklyHours[day]=arr.sort();input.value='';const ok=await saveWeekly();if(ok)toast('Horário adicionado e salvo.');else adminConfig.weeklyHours[day]=before;return;}const remove=e.target.closest('.js-remove-week-time');if(remove){const before=[...(adminConfig.weeklyHours[day]||[])];adminConfig.weeklyHours[day]=before.filter(t=>t!==remove.dataset.time);const ok=await saveWeekly();if(ok)toast('Horário removido e salvo.');else adminConfig.weeklyHours[day]=before;}});


function isMaintenanceServiceAdmin(s){
  return /^manut/i.test(String(s?.id||'')) || /^manuten[cç][aã]o\b/i.test(String(s?.name||'').trim());
}
function normalizeServiceNameAdmin(v){
  return String(v||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/^manutencao\s*[-—:]?\s*/,'')
    .replace(/[^a-z0-9]+/g,' ')
    .trim();
}
function findMaintenanceAdmin(base, all){
  const baseId=String(base.id||'').toLowerCase();
  const baseName=normalizeServiceNameAdmin(base.name);
  return (all||[]).find(m=>{
    if(!isMaintenanceServiceAdmin(m))return false;
    const mid=String(m.id||'').toLowerCase();
    const mn=normalizeServiceNameAdmin(m.name);
    return mid===`manut-${baseId}` || mid.replace(/^manut-/,'')===baseId ||
           mn===baseName || mn.includes(baseName) || baseName.includes(mn);
  }) || null;
}

function renderServices(){
  const all=adminConfig?.services||[];
  const bases=all.filter(s=>!isMaintenanceServiceAdmin(s));
  $('#servicesEditor').innerHTML=bases.length?bases.map((s,i)=>{
    const maintenance=findMaintenanceAdmin(s,all);
    return `<div class="service-edit-row service-edit-v23" data-i="${i}" data-id="${esc(s.id)}" data-maint-id="${esc(maintenance?.id||'')}">
      <div class="service-image-admin">
        <img src="${esc(s.image||'assets/service-placeholder.svg')}" alt="${esc(s.name||'Procedimento')}">
        <label class="mini-btn service-image-pick"><span>Trocar imagem</span><input class="service-image-file" type="file" accept="image/*,.heic,.heif"></label>
        ${s.image?'<button type="button" class="mini-btn danger js-remove-service-image">Remover imagem</button>':''}
        <small class="service-image-help">Foto da galeria ou câmera do celular • até 40 MB</small>
      </div>
      <div class="service-fields-admin">
        <input class="service-name" value="${esc(s.name)}" placeholder="Nome do procedimento">
        <textarea class="service-description" maxlength="220" placeholder="Descrição curta que aparece no catálogo">${esc(s.description||'')}</textarea>

        <div class="service-inline-fields service-values-grid">
          <label><span>Valor do procedimento (R$)</span><input class="service-price" type="number" min="0" step="0.01" value="${s.price===null?'':Number(s.price)}"></label>
          <label><span>Valor da manutenção (R$)</span><input class="service-maint-price" type="number" min="0" step="0.01" value="${maintenance?.price===null||maintenance?.price===undefined?'':Number(maintenance.price)}"></label>
        </div>

        <div class="service-inline-fields service-values-grid">
          <label><span>Duração procedimento (min)</span><input class="service-duration" type="number" min="15" step="15" value="${Number(s.duration||60)}"></label>
          <label><span>Duração manutenção (min)</span><input class="service-maint-duration" type="number" min="15" step="15" value="${Number(maintenance?.duration||90)}"></label>
        </div>

        <div class="booking-visibility-box">
          <b>Onde aparece no agendamento</b>
          <label class="service-toggle"><input class="service-booking-complete" type="checkbox" ${s.bookingComplete!==false?'checked':''}><span>Procedimento completo</span></label>
          <label class="service-toggle"><input class="service-booking-maintenance" type="checkbox" ${s.bookingMaintenance!==false?'checked':''}><span>Manutenção</span></label>
        </div>
        <label class="service-toggle"><input class="service-active" type="checkbox" ${s.active!==false?'checked':''}><span>Visível no site</span></label>
        <button type="button" class="mini-btn danger js-remove-service">Excluir procedimento</button>
      </div>
    </div>`;
  }).join(''):'<div class="empty-state">Nenhum procedimento cadastrado.</div>';
}

function collectServices(){
  const oldAll=adminConfig?.services||[];
  const result=[];
  $$('.service-edit-row').forEach((row,i)=>{
    const oldBase=oldAll.find(s=>String(s.id)===String(row.dataset.id))||{};
    const name=row.querySelector('.service-name').value.trim();
    const active=row.querySelector('.service-active').checked;
    const base={
      ...oldBase,
      id:oldBase.id||`servico-${Date.now()}-${i}`,
      name,
      description:row.querySelector('.service-description').value.trim(),
      image:oldBase.image||'',
      price:row.querySelector('.service-price').value===''?null:Number(row.querySelector('.service-price').value),
      duration:Number(row.querySelector('.service-duration').value||60),
      active,
      bookingComplete: !!row.querySelector('.service-booking-complete')?.checked,
      bookingMaintenance: !!row.querySelector('.service-booking-maintenance')?.checked
    };
    result.push(base);

    const maintValue=row.querySelector('.service-maint-price').value;
    if(maintValue!==''){
      const oldMaint=findMaintenanceAdmin(oldBase,oldAll) || {};
      result.push({
        ...oldMaint,
        id:oldMaint.id||`manut-${base.id}`,
        name:`Manutenção — ${name}`,
        description:`Manutenção de ${name}`,
        image:'',
        price:Number(maintValue),
        duration:Number(row.querySelector('.service-maint-duration').value||90),
        active,
        bookingComplete:false,
        bookingMaintenance:true
      });
    }
  });
  return result;
}

$('#servicesEditor')?.addEventListener('click',async e=>{
  const row=e.target.closest('.service-edit-row'); if(!row)return;
  const i=adminConfig.services.findIndex(s=>String(s.id)===String(row.dataset.id));
  const remove=e.target.closest('.js-remove-service');
  if(remove){
      adminConfig.services=collectServices();
      const baseId=row.dataset.id;
      const base=adminConfig.services.find(s=>String(s.id)===String(baseId));
      const maintenance=findMaintenanceAdmin(base,adminConfig.services);
      adminConfig.services=adminConfig.services.filter(s=>String(s.id)!==String(baseId)&&String(s.id)!==String(maintenance?.id||''));
      renderServices();return;
    }
  const removeImage=e.target.closest('.js-remove-service-image');
  if(removeImage){try{await api('/api/admin/services/'+encodeURIComponent(row.dataset.id)+'/image',{method:'DELETE'});adminConfig.services[i].image='';renderServices();toast('Imagem removida.');}catch(err){toast(err.message,'error');}}
});
$('#servicesEditor')?.addEventListener('change',async e=>{
  const input=e.target.closest('.service-image-file'); if(!input)return;
  const row=input.closest('.service-edit-row'),file=input.files?.[0]; if(!file)return;
  const i=adminConfig.services.findIndex(s=>String(s.id)===String(row.dataset.id)),id=row.dataset.id;
  const btn=row.querySelector('.service-image-pick');
  if(file.size>40*1024*1024){toast('A imagem passou de 40 MB. Escolha outra foto.','error');input.value='';return;}
  setBusy(btn,true,'ENVIANDO FOTO...');
  try{
    const fd=new FormData(); fd.append('image',file);
    let r=await fetch('/api/admin/services/'+encodeURIComponent(id)+'/image',{method:'POST',body:fd,credentials:'same-origin',cache:'no-store'});
    let j={}; try{j=await r.json();}catch{}
    if(r.status===404){
      throw new Error('Salve o procedimento primeiro e depois troque a imagem.');
    }
    if(!r.ok)throw new Error(j.error||`Erro ${r.status}`);
    adminConfig.services[i].image=j.image;
    const img=row.querySelector('.service-image-admin img'); if(img)img.src=j.image;
    input.value='';
    toast('Imagem atualizada com sucesso.');
    setTimeout(()=>refresh().catch(()=>{}),250);
  }catch(err){toast(err.message||'Não foi possível trocar a imagem.','error');input.value='';}
  finally{setBusy(btn,false);}
});
$('#saveServicesBtn')?.addEventListener('click',async()=>{const btn=$('#saveServicesBtn');setBusy(btn,true,'SALVANDO...');try{
  const services=collectServices();
  const bases=services.filter(s=>!isMaintenanceServiceAdmin(s));
  for(const s of bases){
    if(String(s.name||'').trim().length<2)throw new Error('Preencha o nome do novo procedimento.');
    if(s.active&&(s.price===null||!Number.isFinite(s.price)||s.price<0))throw new Error(`Defina o valor de “${s.name||'novo procedimento'}”.`);
  }
  const d=await api('/api/admin/services',{method:'PUT',body:JSON.stringify({services})});
  adminConfig.services=d.services;
  renderServices();
  await refresh();
  toast('Procedimentos salvos.');
}catch(e){toast(e.message,'error');}finally{setBusy(btn,false);}});

$('#backupBtn')?.addEventListener('click',async()=>{const btn=$('#backupBtn');setBusy(btn,true,'GERANDO...');try{const r=await fetch('/api/admin/backup',{credentials:'same-origin',cache:'no-store'});if(!r.ok){let d={};try{d=await r.json();}catch{}throw new Error(d.error||'Falha ao gerar backup.');}const blob=await r.blob(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`studio-rb-backup-${todayISO()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Backup baixado.');}catch(e){toast(e.message,'error');}finally{setBusy(btn,false);}});

const dlg=$('#manualDialog');$('#manualBtn')?.addEventListener('click',()=>dlg?.showModal());$('#cancelManual')?.addEventListener('click',()=>dlg?.close());$('#manualForm')?.addEventListener('submit',async e=>{e.preventDefault();if(!e.currentTarget.reportValidity())return;const btn=$('#saveManual');setBusy(btn,true,'SALVANDO...');try{const d=Object.fromEntries(new FormData(e.currentTarget));await api('/api/admin/bookings',{method:'POST',body:JSON.stringify(d)});dlg.close();e.currentTarget.reset();await refresh();toast('Agendamento manual criado.');}catch(err){toast(err.message,'error');}finally{setBusy(btn,false);}});

function renderPaymentSettings(){if(!adminConfig)return;$('#depositAmount').value=Number(adminConfig.depositAmount||20);$('#pixKey').value=adminConfig.pixKey||'';$('#pixRecipient').value=adminConfig.pixRecipient||'Emilly Ribeiro';$('#pixCity').value=adminConfig.pixCity||'';$('#paymentInstructions').value=adminConfig.paymentInstructions||'';}
$('#savePaymentBtn')?.addEventListener('click',async()=>{const btn=$('#savePaymentBtn');setBusy(btn,true,'SALVANDO...');try{const payload={depositAmount:Number($('#depositAmount').value||20),pixKey:$('#pixKey').value.trim(),pixRecipient:$('#pixRecipient').value.trim(),pixCity:$('#pixCity').value.trim(),paymentInstructions:$('#paymentInstructions').value.trim()};const d=await api('/api/admin/payment-settings',{method:'PUT',body:JSON.stringify(payload)});Object.assign(adminConfig,d.payment);toast('PIX e valor do sinal salvos.');}catch(e){toast(e.message,'error');}finally{setBusy(btn,false);}});

function renderGallery(){
  const box=$('#galleryEditor'),catBox=$('#galleryCategoriesEditor'),select=$('#galleryCategory');if(!adminConfig)return;const cats=Array.isArray(adminConfig.galleryCategories)?adminConfig.galleryCategories:[],items=Array.isArray(adminConfig.gallery)?adminConfig.gallery:[],catName=id=>cats.find(c=>c.id===id)?.name||'Sem categoria';
  if(select){const value=select.value;select.innerHTML='<option value="">Escolha a categoria</option>'+cats.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');if(cats.some(c=>c.id===value))select.value=value;}
  if(catBox)catBox.innerHTML=cats.map(c=>`<div class="gallery-category-row" data-category-id="${esc(c.id)}"><input value="${esc(c.name)}" maxlength="50"><button type="button" class="mini-btn js-category-rename">Salvar nome</button><button type="button" class="mini-btn danger js-category-delete">Excluir aba</button></div>`).join('')||'<div class="empty-state">Nenhuma categoria.</div>';
  if(box)box.innerHTML=items.length?items.map(x=>`<article class="gallery-admin-item" data-gallery-id="${esc(x.id)}"><img src="${esc(x.src)}" alt="${esc(x.title||'Foto')}"><div><b>${esc(x.title||'Resultado')}</b><small>${esc(x.caption||'')}</small><span class="gallery-admin-category">${esc(catName(x.categoryId))}</span></div><label class="gallery-move-label"><span>Mover para</span><select class="gallery-move-select">${cats.map(c=>`<option value="${esc(c.id)}" ${c.id===x.categoryId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><div class="gallery-admin-actions"><button type="button" class="mini-btn js-gallery-move">Mover foto</button><button type="button" class="mini-btn danger js-gallery-delete">Excluir foto</button></div></article>`).join(''):'<div class="empty-state">Nenhuma foto cadastrada.</div>';
}
$('#addGalleryCategoryForm')?.addEventListener('submit',async e=>{e.preventDefault();const input=$('#newGalleryCategoryName'),name=input.value.trim();if(name.length<2){toast('Digite o nome da nova aba.','error');return;}try{await api('/api/admin/gallery-categories',{method:'POST',body:JSON.stringify({name})});input.value='';await refresh();toast('Nova aba criada.');}catch(err){toast(err.message,'error');}});
document.addEventListener('click',async e=>{
  const rename=e.target.closest('.js-category-rename');if(rename){const row=rename.closest('.gallery-category-row');try{await api('/api/admin/gallery-categories/'+encodeURIComponent(row.dataset.categoryId),{method:'PUT',body:JSON.stringify({name:row.querySelector('input').value.trim()})});await refresh();toast('Nome atualizado.');}catch(err){toast(err.message,'error');}return;}
  const delCat=e.target.closest('.js-category-delete');if(delCat){const row=delCat.closest('.gallery-category-row');if(!confirm('Excluir esta aba? As fotos serão movidas para outra categoria.'))return;try{await api('/api/admin/gallery-categories/'+encodeURIComponent(row.dataset.categoryId),{method:'DELETE'});await refresh();toast('Aba excluída.');}catch(err){toast(err.message,'error');}return;}
  const move=e.target.closest('.js-gallery-move');if(move){const card=move.closest('.gallery-admin-item'),select=card.querySelector('.gallery-move-select');setBusy(move,true,'MOVENDO...');try{await api('/api/admin/gallery/'+encodeURIComponent(card.dataset.galleryId),{method:'PUT',body:JSON.stringify({categoryId:select.value})});await refresh();toast('Foto movida.');}catch(err){toast(err.message,'error');}finally{setBusy(move,false);}return;}
  const del=e.target.closest('.js-gallery-delete');if(del){const card=del.closest('.gallery-admin-item');if(!confirm('Excluir esta foto do portfólio?'))return;setBusy(del,true,'EXCLUINDO...');try{await api('/api/admin/gallery/'+encodeURIComponent(card.dataset.galleryId),{method:'DELETE'});await refresh();toast('Foto excluída.');}catch(err){toast(err.message,'error');}finally{setBusy(del,false);}}
});
$('#galleryUploadForm')?.addEventListener('submit',async e=>{e.preventDefault();const file=$('#galleryPhoto')?.files?.[0],categoryId=$('#galleryCategory')?.value;if(!file){toast('Escolha uma foto.','error');return;}if(!categoryId){toast('Escolha a categoria.','error');return;}const btn=e.currentTarget.querySelector('button[type="submit"]');setBusy(btn,true,'ENVIANDO...');try{const fd=new FormData();fd.append('photo',file);fd.append('categoryId',categoryId);fd.append('title',$('#galleryTitle').value||'');fd.append('caption',$('#galleryCaption').value||'');const r=await fetch('/api/admin/gallery',{method:'POST',body:fd,credentials:'same-origin'});let d={};try{d=await r.json();}catch{}if(!r.ok)throw new Error(d.error||`Erro ${r.status}`);e.currentTarget.reset();await refresh();toast('Foto adicionada e otimizada automaticamente.');}catch(err){toast(err.message,'error');}finally{setBusy(btn,false);}});

check();


// V41 — navegação real por seções no painel

function normalizePhoneValue(v){return String(v||'').replace(/\D/g,'')}
function normalizeSearchValue(v){
  return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()
}
function bookingServiceNames(b){
  return (b.services||[]).map(s=>typeof s==='string'?s:(s?.name||'')).filter(Boolean)
}
function bookingIsRealized(b){return b.status==='Concluído'}
function currentMonthValue(){
  const d=new Date(),m=String(d.getMonth()+1).padStart(2,'0');return `${d.getFullYear()}-${m}`
}
function clientKey(b){
  const p=normalizePhoneValue(b.phone);
  return p?`p:${p}`:`n:${normalizeSearchValue(b.name)}`
}
function clientMatchesQuery(b,q){
  const term=normalizeSearchValue(q),digits=normalizePhoneValue(q);
  if(!term&&!digits)return false;
  const name=normalizeSearchValue(b.name),phone=normalizePhoneValue(b.phone);
  return (term&&name.includes(term)) || (digits&&phone.includes(digits));
}
function uniqueClientsFromBookings(rows){
  const map=new Map();
  rows.forEach(b=>{
    const key=clientKey(b);
    if(!map.has(key))map.set(key,{key,name:b.name||'Cliente',phone:b.phone||'',email:b.email||''});
  });
  return [...map.values()].sort((x,y)=>String(x.name).localeCompare(String(y.name),'pt-BR'));
}

function renderClientSearch(){
  const input=$('#clientSearchInput'),month=$('#clientMonthFilter');
  if(!input||!month)return;
  if(!month.value)month.value=currentMonthValue();
  const q=input.value.trim();
  if(!q){
    $('#clientSearchResults').innerHTML='';
    if(!selectedClientKey)$('#clientHistoryView').innerHTML='<div class="empty-state">Digite o nome ou telefone da cliente.</div>';
    return;
  }
  const matches=uniqueClientsFromBookings(bookings.filter(b=>clientMatchesQuery(b,q))).slice(0,12);
  $('#clientSearchResults').innerHTML=matches.length?matches.map(c=>`
    <button type="button" class="client-result ${selectedClientKey===c.key?'active':''}" data-client-key="${esc(c.key)}">
      <span><b>${esc(c.name)}</b><small>${esc(c.phone||'Sem telefone')}</small></span>
      <span>Ver histórico ›</span>
    </button>`).join(''):'<div class="empty-state small-empty">Nenhuma cliente encontrada.</div>';
  if(selectedClientKey)renderClientHistory();
}

function renderClientHistory(){
  const box=$('#clientHistoryView'),month=$('#clientMonthFilter');
  if(!box||!selectedClientKey)return;
  const all=bookings.filter(b=>clientKey(b)===selectedClientKey).sort((x,y)=>(y.date+y.time).localeCompare(x.date+x.time));
  if(!all.length){box.innerHTML='<div class="empty-state">Nenhum atendimento encontrado.</div>';return}
  const client=all[0];
  const monthValue=month?.value||currentMonthValue();
  const monthly=all.filter(b=>String(b.date||'').startsWith(monthValue));
  const realizedAll=all.filter(bookingIsRealized);
  const spent=realizedAll.reduce((sum,b)=>sum+Number(b.total||0),0);

  box.innerHTML=`
    <div class="client-profile-card">
      <div><span class="eyebrow">CLIENTE</span><h3>${esc(client.name||'Cliente')}</h3>
      <p>${esc(client.phone||'')}${client.email?` • ${esc(client.email)}`:''}</p></div>
      <div class="client-profile-stats">
        <span><b>${realizedAll.length}</b><small>realizados</small></span>
        <span><b>${money(spent)}</b><small>total realizado</small></span>
      </div>
    </div>
    <div class="client-month-title"><b>Atendimentos de ${esc(monthValue)}</b><span>${monthly.length} registro(s)</span></div>
    <div class="client-booking-history">
      ${monthly.length?monthly.map(b=>{
        const names=bookingServiceNames(b).join(' + ')||'Sem procedimento';
        return `<article class="client-history-row">
          <div><b>${esc(names)}</b><small>${fmtDate(b.date)} às ${esc(b.time||'')}</small></div>
          <div><strong>${money(b.total)}</strong><span class="status status-${esc(String(b.status||'').toLowerCase().replace(/\s+/g,'-'))}">${esc(b.status||'')}</span></div>
        </article>`;
      }).join(''):'<div class="empty-state small-empty">Nenhum agendamento dessa cliente neste mês.</div>'}
    </div>
    <details class="client-all-history">
      <summary>Ver histórico completo (${all.length})</summary>
      <div class="client-booking-history">${all.map(b=>{
        const names=bookingServiceNames(b).join(' + ')||'Sem procedimento';
        return `<article class="client-history-row">
          <div><b>${esc(names)}</b><small>${fmtDate(b.date)} às ${esc(b.time||'')}</small></div>
          <div><strong>${money(b.total)}</strong><span>${esc(b.status||'')}</span></div>
        </article>`;
      }).join('')}</div>
    </details>`;
}

function financeRange(reference,period){
  const [y,m]=String(reference||currentMonthValue()).split('-').map(Number);
  if(period==='year')return {start:`${y}-01-01`,end:`${y}-12-31`,label:`Ano ${y}`};
  if(period==='quarter'){
    const q=Math.floor((m-1)/3),sm=q*3+1,em=sm+2;
    const last=new Date(y,em,0).getDate();
    return {start:`${y}-${String(sm).padStart(2,'0')}-01`,end:`${y}-${String(em).padStart(2,'0')}-${String(last).padStart(2,'0')}`,label:`${q+1}º trimestre de ${y}`};
  }
  const last=new Date(y,m,0).getDate();
  return {start:`${y}-${String(m).padStart(2,'0')}-01`,end:`${y}-${String(m).padStart(2,'0')}-${String(last).padStart(2,'0')}`,label:`${String(m).padStart(2,'0')}/${y}`};
}
function renderFinance(){
  const ref=$('#financeReference');
  if(!ref)return;
  if(!ref.value)ref.value=currentMonthValue();
  const range=financeRange(ref.value,financePeriod);
  const rows=bookings.filter(b=>bookingIsRealized(b)&&b.date>=range.start&&b.date<=range.end);
  const revenue=rows.reduce((s,b)=>s+Number(b.total||0),0);
  const ticket=rows.length?revenue/rows.length:0;
  const clients=new Set(rows.map(clientKey)).size;

  $('#financeSummary').innerHTML=`
    <div class="finance-stat"><small>Período</small><b>${esc(range.label)}</b></div>
    <div class="finance-stat main"><small>Ganhos</small><b>${money(revenue)}</b></div>
    <div class="finance-stat"><small>Atendimentos</small><b>${rows.length}</b></div>
    <div class="finance-stat"><small>Clientes</small><b>${clients}</b></div>
    <div class="finance-stat"><small>Ticket médio</small><b>${money(ticket)}</b></div>`;

  const byService=new Map();
  rows.forEach(b=>{
    const names=bookingServiceNames(b);
    const share=names.length?Number(b.total||0)/names.length:Number(b.total||0);
    (names.length?names:['Sem procedimento']).forEach(name=>{
      const cur=byService.get(name)||{count:0,total:0};
      cur.count++;cur.total+=share;byService.set(name,cur);
    });
  });
  const breakdown=[...byService.entries()].sort((a,b)=>b[1].total-a[1].total);
  $('#financeBreakdown').innerHTML=breakdown.length?breakdown.map(([name,v])=>`
    <div class="finance-service-row"><span><b>${esc(name)}</b><small>${v.count} atendimento(s)</small></span><strong>${money(v.total)}</strong></div>`
  ).join(''):'<div class="empty-state small-empty">Nenhum procedimento concluído neste período.</div>';

  $('#financeBookings').innerHTML=rows.length?rows.sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)).map(b=>`
    <div class="finance-booking-row">
      <span><b>${esc(b.name||'Cliente')}</b><small>${fmtDate(b.date)} • ${esc(bookingServiceNames(b).join(' + ')||'Sem procedimento')}</small></span>
      <strong>${money(b.total)}</strong>
    </div>`).join(''):'<div class="empty-state small-empty">Nenhum atendimento concluído neste período.</div>';
}

$('#clientSearchInput')?.addEventListener('input',()=>{selectedClientKey='';renderClientSearch()});
$('#clientMonthFilter')?.addEventListener('change',()=>{if(selectedClientKey)renderClientHistory()});
$('#clientSearchResults')?.addEventListener('click',e=>{
  const btn=e.target.closest('[data-client-key]');if(!btn)return;
  selectedClientKey=btn.dataset.clientKey;renderClientSearch();renderClientHistory();
});
document.querySelector('.finance-period-tabs')?.addEventListener('click',e=>{
  const btn=e.target.closest('[data-finance-period]');if(!btn)return;
  financePeriod=btn.dataset.financePeriod;
  document.querySelectorAll('[data-finance-period]').forEach(x=>x.classList.toggle('active',x===btn));
  renderFinance();
});
$('#financeReference')?.addEventListener('change',renderFinance);

function showAdminSection(name){
  document.querySelectorAll('.admin-section-view').forEach(el=>{
    el.classList.toggle('admin-view-hidden', el.dataset.adminView!==name);
  });
  document.querySelectorAll('.admin-section-menu [data-admin-section]').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.adminSection===name);
  });
  if(name==='clientes')renderClientSearch();
  if(name==='financeiro')renderFinance();
  window.scrollTo({top:0,behavior:'smooth'});
}
document.querySelector('.admin-section-menu')?.addEventListener('click',e=>{
  const btn=e.target.closest('[data-admin-section]');
  if(!btn)return;
  showAdminSection(btn.dataset.adminSection);
});


// V42 — criar novo procedimento de forma confiável, inclusive no celular
document.addEventListener('click',e=>{
  const btn=e.target.closest('#addServiceBtn');
  if(!btn)return;
  e.preventDefault();

  if(!adminConfig) adminConfig={};
  adminConfig.services=collectServices();

  const id=`servico-${Date.now()}`;
  adminConfig.services.push({
    id,
    name:'',
    description:'',
    image:'',
    price:null,
    duration:60,
    active:true,
    bookingComplete:true,
    bookingMaintenance:false
  });

  renderServices();

  const row=document.querySelector(`.service-edit-row[data-id="${id}"]`);
  row?.scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(()=>row?.querySelector('.service-name')?.focus(),250);
  toast('Novo procedimento criado. Preencha os dados e clique em Salvar procedimentos.');
});
