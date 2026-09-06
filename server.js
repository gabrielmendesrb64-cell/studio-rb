require('dotenv').config();

const express = require('express');
const session = require('express-session');
const MemoryStoreFactory = require('memorystore');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data');
const cfgPath = path.join(DATA, 'config.json');
const bookingsPath = path.join(DATA, 'bookings.json');
const MemoryStore = MemoryStoreFactory(session);

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(session({
  secret: process.env.SESSION_SECRET || 'troque-esta-chave-em-producao',
  resave: false,
  saveUninitialized: false,
  store: new MemoryStore({ checkPeriod: 86400000 }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use('/api/bookings', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));
app.use('/api/my-bookings', rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

const pgPool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
}) : null;
let dbReady = false;

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}
async function initDb() {
  if (!pgPool) return;
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS lsh_state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const defaults = {
    config: readJson(cfgPath, {}),
    bookings: readJson(bookingsPath, [])
  };
  for (const [key, value] of Object.entries(defaults)) {
    await pgPool.query(
      'INSERT INTO lsh_state(key,value) VALUES($1,$2::jsonb) ON CONFLICT (key) DO NOTHING',
      [key, JSON.stringify(value)]
    );
  }
  dbReady = true;
}
async function getState(key) {
  if (pgPool && dbReady) {
    const r = await pgPool.query('SELECT value FROM lsh_state WHERE key=$1', [key]);
    if (r.rows[0]) return r.rows[0].value;
  }
  return key === 'config' ? readJson(cfgPath, {}) : readJson(bookingsPath, []);
}
async function setState(key, value) {
  if (pgPool && dbReady) {
    await pgPool.query(
      `INSERT INTO lsh_state(key,value,updated_at) VALUES($1,$2::jsonb,NOW())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
      [key, JSON.stringify(value)]
    );
    return;
  }
  writeJson(key === 'config' ? cfgPath : bookingsPath, value);
}

function cleanPhone(v) { return String(v || '').replace(/\D/g, ''); }
function cleanEmail(v) { return String(v || '').trim().toLowerCase(); }
function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function validDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v); }
function validTime(v) { return /^\d{2}:\d{2}$/.test(v); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m])); }
function auth(req, res, next) { if (req.session.admin) return next(); res.status(401).json({ error: 'Não autorizado' }); }
function normalizeName(v) { return String(v || '').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' '); }
function moneyBRL(v) { return Number(v || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' }); }
function timeToMinutes(t) { const [h,m] = String(t).split(':').map(Number); return h * 60 + m; }
function bookingDuration(b) { return Math.max(15, Number(b.duration || 60)); }
function overlaps(aStart, aDur, bStart, bDur) { return aStart < bStart + bDur && bStart < aStart + aDur; }
function publicBooking(b) {
  return {
    id: b.id,
    name: b.name,
    date: b.date,
    time: b.time,
    status: b.status,
    services: b.services || [],
    total: Number(b.total || 0),
    duration: Number(b.duration || 0),
    createdAt: b.createdAt
  };
}

function emailTransport() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  const opts = {
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  };
  if (process.env.SMTP_SERVICE) opts.service = process.env.SMTP_SERVICE;
  else opts.host = process.env.SMTP_HOST || 'smtp.gmail.com';
  return nodemailer.createTransport(opts);
}
async function sendMail({ to, subject, html }) {
  const transporter = emailTransport();
  if (!transporter || !to) return { sent:false, reason:'SMTP não configurado' };
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    html
  });
  return { sent:true };
}
async function sendWhatsAppCloud(phone, message) {
  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { sent:false, reason:'WhatsApp Cloud API não configurada' };
  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v23.0';
  const template = String(process.env.WHATSAPP_TEMPLATE_NAME || '').trim();
  const payload = template ? {
    messaging_product: 'whatsapp',
    to: cleanPhone(phone),
    type: 'template',
    template: { name: template, language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR' } }
  } : {
    messaging_product: 'whatsapp',
    to: cleanPhone(phone),
    type: 'text',
    text: { preview_url:false, body: message }
  };
  const r = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type':'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`WhatsApp API HTTP ${r.status}`);
  return { sent:true };
}

async function notifyOwnerNewBooking(b) {
  const cfg = await getState('config');
  const owner = process.env.OWNER_EMAIL || cfg.email;
  const services = (b.services || []).map(s => `<li>${escapeHtml(s.name)} — ${moneyBRL(s.price)}</li>`).join('');
  return sendMail({
    to: owner,
    subject: 'NOVO AGENDAMENTO — LSH STUDIO RB',
    html: `
      <div style="font-family:Arial;background:#0b0b0b;color:#fff;padding:28px;border-radius:16px">
        <h2 style="color:#ff5b9e">NOVO AGENDAMENTO — LSH STUDIO RB</h2>
        <p><b>Cliente:</b> ${escapeHtml(b.name)}</p>
        <p><b>WhatsApp:</b> ${escapeHtml(b.phone)}</p>
        <p><b>E-mail:</b> ${escapeHtml(b.email)}</p>
        <p><b>Data:</b> ${escapeHtml(b.date)}</p>
        <p><b>Horário:</b> ${escapeHtml(b.time)}</p>
        <p><b>Procedimentos:</b></p><ul>${services}</ul>
        <p><b>Total:</b> ${moneyBRL(b.total)}</p>
        <p>Entre no painel para confirmar ou cancelar.</p>
      </div>`
  });
}
async function notifyCustomerConfirmed(b) {
  const serviceText = (b.services || []).map(s => s.name).join(', ') || 'Procedimento';
  const text = `Olá, ${b.name}! 💗 Seu agendamento no LSH Studio RB foi CONFIRMADO. Data: ${b.date} • Horário: ${b.time} • Procedimento(s): ${serviceText} • Total: ${moneyBRL(b.total)}. Até lá!`;
  const results = { email:false, whatsapp:false, errors:[] };
  try {
    const r = await sendMail({
      to: b.email,
      subject: 'Agendamento confirmado — LSH Studio RB',
      html: `
        <div style="font-family:Arial;background:#0b0b0b;color:#fff;padding:28px;border-radius:16px">
          <h2 style="color:#ff5b9e">Seu agendamento foi confirmado 💗</h2>
          <p>Olá, <b>${escapeHtml(b.name)}</b>!</p>
          <p>Seu horário no <b>LSH Studio RB</b> está confirmado.</p>
          <p><b>Data:</b> ${escapeHtml(b.date)}</p>
          <p><b>Horário:</b> ${escapeHtml(b.time)}</p>
          <p><b>Procedimento(s):</b> ${escapeHtml(serviceText)}</p>
          <p><b>Total:</b> ${moneyBRL(b.total)}</p>
          <p>Até lá! ✨</p>
        </div>`
    });
    results.email = r.sent;
  } catch (e) { results.errors.push('email: ' + e.message); }
  try {
    const r = await sendWhatsAppCloud(b.phone, text);
    results.whatsapp = r.sent;
  } catch (e) { results.errors.push('whatsapp: ' + e.message); }
  return results;
}

async function resolveSelectedServices(ids) {
  const cfg = await getState('config');
  const services = Array.isArray(cfg.services) ? cfg.services : [];
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
  const selected = wanted.map(id => services.find(s => String(s.id) === id && s.active !== false)).filter(Boolean);
  if (!selected.length || selected.length !== wanted.length) return null;
  if (selected.some(s => s.price === null || s.price === '' || Number(s.price) < 0)) return null;
  return selected.map(s => ({
    id: String(s.id), name: String(s.name), price: Number(s.price), duration: Math.max(15, Number(s.duration || 60))
  }));
}

async function slotTaken(date, time, duration, excludeId = null) {
  const bookings = await getState('bookings');
  const start = timeToMinutes(time);
  return bookings.some(b => {
    if (b.id === excludeId || b.date !== date || b.status === 'Cancelado') return false;
    return overlaps(start, duration, timeToMinutes(b.time), bookingDuration(b));
  });
}
async function getAvailability(date, duration = 60) {
  const cfg = await getState('config');
  const bookings = await getState('bookings');
  const d = new Date(date + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return [];
  const day = String(d.getDay());
  const base = (cfg.weeklyHours && cfg.weeklyHours[day]) || [];
  if ((cfg.blockedDates || []).includes(date)) return [];
  return [...new Set(base)].sort().map(time => {
    const start = timeToMinutes(time);
    const occupied = bookings.some(b => b.date === date && b.status !== 'Cancelado' && overlaps(start, duration, timeToMinutes(b.time), bookingDuration(b)));
    const blocked = (cfg.blockedSlots || []).some(x => x.date === date && x.time === time);
    return { time, available: !occupied && !blocked };
  });
}

app.get('/api/config', async (req, res) => {
  const c = await getState('config');
  res.json({
    businessName: c.businessName,
    whatsapp: process.env.OWNER_WHATSAPP || c.whatsapp,
    email: process.env.OWNER_EMAIL || c.email,
    instagram: c.instagram,
    tiktok: c.tiktok,
    address: c.address,
    openingHours: c.openingHours,
    services: (c.services || []).filter(s => s.active !== false).map(s => ({
      id:s.id, name:s.name, price:s.price, duration:s.duration
    }))
  });
});

app.get('/api/availability', async (req, res) => {
  const date = String(req.query.date || '');
  const duration = Math.max(15, Math.min(720, Number(req.query.duration || 60)));
  if (!validDate(date)) return res.status(400).json({ error:'Data inválida' });
  res.json({ date, slots: await getAvailability(date, duration) });
});

app.post('/api/bookings', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const email = cleanEmail(req.body.email);
  const date = String(req.body.date || '');
  const time = String(req.body.time || '');
  const selected = await resolveSelectedServices(req.body.services);
  if (name.length < 2 || cleanPhone(phone).length < 10 || !validEmail(email) || !validDate(date) || !validTime(time) || !selected) {
    return res.status(400).json({ error:'Confira nome, WhatsApp, e-mail, procedimentos, data e horário.' });
  }
  const duration = selected.reduce((sum, s) => sum + s.duration, 0);
  const total = selected.reduce((sum, s) => sum + s.price, 0);
  const slots = await getAvailability(date, duration);
  const slot = slots.find(s => s.time === time);
  if (!slot || !slot.available) return res.status(409).json({ error:'Horário indisponível para a duração dos procedimentos escolhidos.' });
  const bookings = await getState('bookings');
  const b = {
    id: crypto.randomUUID(),
    name: name.slice(0, 80),
    phone: phone.slice(0, 24),
    email: email.slice(0, 120),
    date, time,
    services: selected,
    total,
    duration,
    status: 'Pendente',
    source: 'site',
    createdAt: new Date().toISOString(),
    notifications: {}
  };
  bookings.push(b);
  await setState('bookings', bookings);
  try {
    const r = await notifyOwnerNewBooking(b);
    b.notifications.ownerEmail = !!r.sent;
    await setState('bookings', bookings);
  } catch (e) {
    b.notifications.ownerEmail = false;
    b.notifications.ownerEmailError = e.message;
    await setState('bookings', bookings);
    console.error('Falha ao enviar e-mail para proprietária:', e.message);
  }
  res.status(201).json({ ok:true, id:b.id, status:b.status });
});

app.get('/api/my-bookings', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const digits = cleanPhone(q);
  const nameQ = normalizeName(q);
  if ((digits && digits.length < 8) || (!digits && nameQ.length < 3)) return res.status(400).json({ error:'Digite seu WhatsApp ou nome completo.' });
  const bookings = await getState('bookings');
  const matches = bookings.filter(b => digits ? cleanPhone(b.phone).endsWith(digits) : normalizeName(b.name) === nameQ)
    .sort((a,b) => (b.date + b.time).localeCompare(a.date + a.time))
    .slice(0, 20)
    .map(publicBooking);
  res.json({ bookings: matches });
});

app.post('/api/my-bookings/:id/cancel', async (req, res) => {
  const q = String(req.body.q || '').trim();
  const bookings = await getState('bookings');
  const b = bookings.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error:'Agendamento não encontrado.' });
  const matches = cleanPhone(q) ? cleanPhone(b.phone).endsWith(cleanPhone(q)) : normalizeName(b.name) === normalizeName(q);
  if (!matches) return res.status(403).json({ error:'Dados não conferem.' });
  if (b.status === 'Concluído') return res.status(409).json({ error:'Esse atendimento já foi concluído.' });
  b.status = 'Cancelado';
  b.cancelledAt = new Date().toISOString();
  b.cancelledBy = 'cliente';
  await setState('bookings', bookings);
  res.json({ ok:true, booking: publicBooking(b) });
});

app.post('/api/admin/login', (req, res) => {
  const user = String(req.body.username || '');
  const pass = String(req.body.password || '');
  const eu = process.env.ADMIN_USER || 'admin';
  const ep = process.env.ADMIN_PASSWORD || 'troque-esta-senha';
  if (user === eu && pass === ep) { req.session.admin = true; return res.json({ ok:true }); }
  res.status(401).json({ error:'Credenciais inválidas' });
});
app.post('/api/admin/logout', auth, (req,res) => req.session.destroy(() => res.json({ ok:true })));
app.get('/api/admin/me', auth, (req,res) => res.json({ ok:true }));
app.get('/api/admin/bookings', auth, async (req,res) => res.json({ bookings: await getState('bookings') }));
app.get('/api/admin/config', auth, async (req,res) => res.json({ config: await getState('config') }));

app.patch('/api/admin/bookings/:id', auth, async (req,res) => {
  const allowed = ['Pendente','Confirmado','Concluído','Cancelado'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error:'Status inválido' });
  const arr = await getState('bookings');
  const b = arr.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error:'Não encontrado' });
  const previous = b.status;
  b.status = req.body.status;
  b.updatedAt = new Date().toISOString();
  let notifications = null;
  if (previous !== 'Confirmado' && b.status === 'Confirmado') {
    notifications = await notifyCustomerConfirmed(b);
    b.notifications = { ...(b.notifications || {}), confirmation: notifications, confirmedAt:new Date().toISOString() };
  }
  await setState('bookings', arr);
  res.json({ booking:b, notifications });
});

app.post('/api/admin/bookings', auth, async (req,res) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const email = cleanEmail(req.body.email || 'manual@lsh.local');
  const date = String(req.body.date || '');
  const time = String(req.body.time || '');
  const selected = Array.isArray(req.body.services) && req.body.services.length ? await resolveSelectedServices(req.body.services) : [];
  const duration = selected.length ? selected.reduce((s,x)=>s+x.duration,0) : 60;
  const total = selected.reduce((s,x)=>s+x.price,0);
  if (name.length < 2 || cleanPhone(phone).length < 10 || !validDate(date) || !validTime(time)) return res.status(400).json({ error:'Dados inválidos' });
  if (await slotTaken(date, time, duration)) return res.status(409).json({ error:'Horário ocupado' });
  const arr = await getState('bookings');
  const b = { id:crypto.randomUUID(), name, phone, email, date, time, services:selected, total, duration, status:'Confirmado', source:'manual', createdAt:new Date().toISOString() };
  arr.push(b);
  await setState('bookings', arr);
  res.status(201).json({ booking:b });
});

app.put('/api/admin/schedule', auth, async (req,res) => {
  const weeklyHours = req.body.weeklyHours;
  if (!weeklyHours || typeof weeklyHours !== 'object') return res.status(400).json({ error:'Agenda inválida' });
  const normalized = {};
  for (let day=0; day<7; day++) {
    const items = Array.isArray(weeklyHours[String(day)]) ? weeklyHours[String(day)] : [];
    normalized[String(day)] = [...new Set(items.map(String).filter(validTime))].sort();
  }
  const c = await getState('config');
  c.weeklyHours = normalized;
  c.openingHours = 'Horários definidos pela proprietária no painel';
  await setState('config', c);
  res.json({ ok:true, weeklyHours:normalized });
});

app.put('/api/admin/services', auth, async (req,res) => {
  const services = Array.isArray(req.body.services) ? req.body.services : null;
  if (!services) return res.status(400).json({ error:'Procedimentos inválidos' });
  const cleaned = services.slice(0, 30).map((s, i) => ({
    id: String(s.id || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60) || `servico-${i+1}`,
    name: String(s.name || '').trim().slice(0,80),
    price: s.price === null || s.price === '' ? null : Math.max(0, Number(s.price)),
    duration: Math.max(15, Math.min(480, Number(s.duration || 60))),
    active: s.active !== false
  })).filter(s => s.name.length >= 2);
  const c = await getState('config');
  c.services = cleaned;
  await setState('config', c);
  res.json({ ok:true, services:cleaned });
});

app.post('/api/admin/blocks', auth, async (req,res) => {
  const { date, time } = req.body;
  if (!validDate(String(date)) || !validTime(String(time))) return res.status(400).json({ error:'Dados inválidos' });
  const c = await getState('config');
  c.blockedSlots = c.blockedSlots || [];
  if (!c.blockedSlots.some(x => x.date === date && x.time === time)) c.blockedSlots.push({ date, time });
  await setState('config', c);
  res.json({ ok:true });
});
app.delete('/api/admin/blocks/:i', auth, async (req,res) => {
  const c = await getState('config');
  const i = Number(req.params.i);
  if (!Number.isInteger(i) || i < 0 || i >= (c.blockedSlots || []).length) return res.status(404).json({ error:'Bloqueio não encontrado' });
  c.blockedSlots.splice(i, 1);
  await setState('config', c);
  res.json({ ok:true });
});

app.get('/api/admin/notifications/status', auth, async (req,res) => {
  res.json({
    smtpConfigured: !!emailTransport(),
    ownerEmail: process.env.OWNER_EMAIL || (await getState('config')).email,
    whatsappCloudConfigured: !!(process.env.WHATSAPP_CLOUD_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    database: pgPool && dbReady ? 'postgres' : 'json'
  });
});
app.post('/api/admin/notifications/test-email', auth, async (req,res) => {
  const cfg = await getState('config');
  const to = process.env.OWNER_EMAIL || cfg.email;
  try {
    const result = await sendMail({ to, subject:'Teste de e-mail — LSH Studio RB', html:'<h2>LSH Studio RB</h2><p>Seu envio de e-mail está funcionando corretamente. 💗</p>' });
    if (!result.sent) return res.status(400).json({ error:result.reason });
    res.json({ ok:true, to });
  } catch (e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/health', async (req,res) => res.json({ ok:true, storage:pgPool && dbReady ? 'postgres' : 'json', email:!!emailTransport() }));

initDb()
  .catch(err => console.error('Falha ao iniciar PostgreSQL, usando JSON:', err.message))
  .finally(() => app.listen(PORT, () => console.log(`LSH Studio RB disponível em http://localhost:${PORT}`)));
