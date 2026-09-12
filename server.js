require('dotenv').config();

const express = require('express');
require('express-async-errors');
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
const multer = require('multer');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data');
const cfgPath = path.join(DATA, 'config.json');
const bookingsPath = path.join(DATA, 'bookings.json');
const MemoryStore = MemoryStoreFactory(session);

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
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

const bookingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const lookupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
app.use('/api/bookings', bookingLimiter);
app.use('/api/my-bookings', lookupLimiter);
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag:true }));

function sameOriginWrite(req, res, next) {
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    const o = new URL(origin);
    if (o.host !== req.get('host')) return res.status(403).json({ error:'Origem não permitida' });
  } catch { return res.status(403).json({ error:'Origem inválida' }); }
  next();
}

app.use('/api/admin', sameOriginWrite);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const name = String(file.originalname || '').toLowerCase();
    const extOk = /\.(jpe?g|png|webp|heic|heif)$/i.test(name);
    const mimeOk = /^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(mime);
    // iPhone/Safari can send HEIC as application/octet-stream or with an empty MIME.
    const mobileFallback = (!mime || mime === 'application/octet-stream') && extOk;
    const ok = mimeOk || extOk || mobileFallback;
    cb(ok ? null : new Error('Envie uma foto JPG, PNG, WEBP, HEIC ou HEIF.'), ok);
  }
});

async function optimizeImage(buffer, { max=1800, quality=82 } = {}) {
  try {
    return await sharp(buffer, { failOn:'none' })
      .rotate()
      .resize({ width:max, height:max, fit:'inside', withoutEnlargement:true })
      .webp({ quality, effort:4 })
      .toBuffer();
  } catch (e) {
    const err = new Error('Não consegui processar essa imagem. Tente enviar uma captura de tela ou JPG/PNG.');
    err.code = 'IMAGE_PROCESSING';
    throw err;
  }
}


const pgPool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 8,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
}) : null;

let dbReady = false;

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

async function dbTableExists(client, name) {
  const r = await client.query('SELECT to_regclass($1) AS table_name', [name]);
  return !!r.rows[0]?.table_name;
}

async function readRelationalConfig(client = pgPool) {
  const defaults = normalizeGalleryConfig(readJson(cfgPath, {}));
  const cfg = { ...defaults };

  const settings = await client.query('SELECT key, value FROM lsh_settings');
  for (const row of settings.rows) cfg[row.key] = row.value;

  const services = await client.query(
    'SELECT id,name,description,image,price,duration,active,booking_complete,booking_maintenance FROM lsh_services ORDER BY position,id'
  );
  cfg.services = services.rows.map(x => ({
    id: String(x.id),
    name: x.name,
    description: x.description || '',
    image: x.image || '',
    price: x.price === null ? null : Number(x.price),
    duration: Number(x.duration || 60),
    active: x.active !== false,
    bookingComplete: x.booking_complete !== false,
    bookingMaintenance: x.booking_maintenance !== false
  }));

  cfg.weeklyHours = { '0':[], '1':[], '2':[], '3':[], '4':[], '5':[], '6':[] };
  const weekly = await client.query('SELECT weekday,time_value FROM lsh_weekly_hours ORDER BY weekday,time_value');
  for (const row of weekly.rows) cfg.weeklyHours[String(row.weekday)].push(row.time_value);

  cfg.dateHours = {};
  const dates = await client.query("SELECT date_value::text AS date_value,time_value FROM lsh_date_hours ORDER BY date_value,time_value");
  for (const row of dates.rows) (cfg.dateHours[row.date_value] ||= []).push(row.time_value);

  const blockedDates = await client.query("SELECT date_value::text AS date_value FROM lsh_blocked_dates ORDER BY date_value");
  cfg.blockedDates = blockedDates.rows.map(x => x.date_value);

  const blockedSlots = await client.query("SELECT date_value::text AS date_value,time_value FROM lsh_blocked_slots ORDER BY date_value,time_value");
  cfg.blockedSlots = blockedSlots.rows.map(x => ({ date:x.date_value, time:x.time_value }));

  const categories = await client.query('SELECT id,name,active FROM lsh_gallery_categories ORDER BY position,id');
  cfg.galleryCategories = categories.rows.map(x => ({ id:String(x.id), name:x.name, active:x.active !== false }));

  const gallery = await client.query('SELECT id,src,title,caption,category_id,active FROM lsh_gallery ORDER BY position,id');
  cfg.gallery = gallery.rows.map(x => ({
    id:String(x.id), src:x.src, title:x.title || '', caption:x.caption || '',
    categoryId:x.category_id || '', active:x.active !== false
  }));

  return normalizeGalleryConfig(cfg);
}

async function writeRelationalConfig(cfg, client = pgPool) {
  const ownClient = client === pgPool ? await pgPool.connect() : null;
  const c = ownClient || client;
  const normalized = normalizeGalleryConfig({ ...cfg });

  try {
    if (ownClient) await c.query('BEGIN');

    const settingsKeys = ['businessName','whatsapp','email','instagram','tiktok','address','openingHours','depositAmount','pixKey','pixRecipient','pixCity','paymentInstructions'];
    for (const key of settingsKeys) {
      await c.query(
        `INSERT INTO lsh_settings(key,value,updated_at) VALUES($1,$2::jsonb,NOW())
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,
        [key, JSON.stringify(normalized[key] ?? '')]
      );
    }

    await c.query('DELETE FROM lsh_services');
    for (let i=0; i<(normalized.services || []).length; i++) {
      const s = normalized.services[i];
      await c.query(
        `INSERT INTO lsh_services(id,name,description,image,price,duration,active,position,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [String(s.id), String(s.name), String(s.description || '').slice(0,220), String(s.image || ''), s.price === null || s.price === '' ? null : Number(s.price),
         Math.max(15, Number(s.duration || 60)), s.active !== false, i]
      );
    }

    await c.query('DELETE FROM lsh_weekly_hours');
    for (let day=0; day<7; day++) {
      const times = [...new Set(((normalized.weeklyHours || {})[String(day)] || []).map(String).filter(validTime))].sort();
      for (const time of times) await c.query('INSERT INTO lsh_weekly_hours(weekday,time_value) VALUES($1,$2)', [day,time]);
    }

    await c.query('DELETE FROM lsh_date_hours');
    for (const [date, times] of Object.entries(normalized.dateHours || {})) {
      if (!validDate(date)) continue;
      for (const time of [...new Set((times || []).map(String).filter(validTime))].sort()) {
        await c.query('INSERT INTO lsh_date_hours(date_value,time_value) VALUES($1,$2)', [date,time]);
      }
    }

    await c.query('DELETE FROM lsh_blocked_dates');
    for (const date of [...new Set((normalized.blockedDates || []).map(String).filter(validDate))]) {
      await c.query('INSERT INTO lsh_blocked_dates(date_value) VALUES($1)', [date]);
    }

    await c.query('DELETE FROM lsh_blocked_slots');
    for (const slot of normalized.blockedSlots || []) {
      if (!validDate(String(slot.date)) || !validTime(String(slot.time))) continue;
      await c.query(
        'INSERT INTO lsh_blocked_slots(date_value,time_value) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [slot.date, slot.time]
      );
    }

    // gallery first because categories can be renamed/deleted.
    await c.query('DELETE FROM lsh_gallery');
    await c.query('DELETE FROM lsh_gallery_categories');
    for (let i=0; i<(normalized.galleryCategories || []).length; i++) {
      const cat = normalized.galleryCategories[i];
      await c.query(
        `INSERT INTO lsh_gallery_categories(id,name,active,position,updated_at)
         VALUES($1,$2,$3,$4,NOW())`,
        [String(cat.id), String(cat.name), cat.active !== false, i]
      );
    }
    for (let i=0; i<(normalized.gallery || []).length; i++) {
      const item = normalized.gallery[i];
      await c.query(
        `INSERT INTO lsh_gallery(id,src,title,caption,category_id,active,position,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [String(item.id), String(item.src), String(item.title || ''), String(item.caption || ''),
         String(item.categoryId || ''), item.active !== false, i]
      );
    }

    if (ownClient) await c.query('COMMIT');
  } catch (err) {
    if (ownClient) await c.query('ROLLBACK').catch(()=>{});
    throw err;
  } finally {
    ownClient?.release();
  }
}

async function readRelationalBookings(client = pgPool) {
  const br = await client.query(`
    SELECT id,name,phone,email,date_value::text AS date,time_value AS time,total,duration,status,source,
           deposit_amount,payment_status,proof_uploaded_at,payment_reviewed_at,
           created_at,updated_at,cancelled_at,cancelled_by,notifications
    FROM lsh_bookings
    ORDER BY created_at ASC
  `);
  const sr = await client.query(`
    SELECT booking_id,service_id,name,price,duration,position
    FROM lsh_booking_services
    ORDER BY booking_id,position
  `);
  const servicesByBooking = new Map();
  for (const row of sr.rows) {
    if (!servicesByBooking.has(row.booking_id)) servicesByBooking.set(row.booking_id, []);
    servicesByBooking.get(row.booking_id).push({
      id: row.service_id || '',
      name: row.name,
      price: Number(row.price || 0),
      duration: Number(row.duration || 60)
    });
  }
  return br.rows.map(row => ({
    id:String(row.id),
    name:row.name,
    phone:row.phone,
    email:row.email || '',
    date:row.date,
    time:row.time,
    services:servicesByBooking.get(row.id) || [],
    total:Number(row.total || 0),
    duration:Number(row.duration || 60),
    status:row.status,
    source:row.source,
    depositAmount:Number(row.deposit_amount || 20),
    paymentStatus:row.payment_status || 'Aguardando pagamento',
    proofUploadedAt:row.proof_uploaded_at ? new Date(row.proof_uploaded_at).toISOString() : null,
    paymentReviewedAt:row.payment_reviewed_at ? new Date(row.payment_reviewed_at).toISOString() : null,
    createdAt:row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    ...(row.updated_at ? { updatedAt:new Date(row.updated_at).toISOString() } : {}),
    ...(row.cancelled_at ? { cancelledAt:new Date(row.cancelled_at).toISOString() } : {}),
    ...(row.cancelled_by ? { cancelledBy:row.cancelled_by } : {}),
    notifications:row.notifications || {}
  }));
}

async function upsertRelationalBookings(bookings, client = pgPool) {
  const ownClient = client === pgPool ? await pgPool.connect() : null;
  const c = ownClient || client;
  try {
    if (ownClient) await c.query('BEGIN');

    for (const b of bookings || []) {
      await c.query(`
        INSERT INTO lsh_bookings(
          id,name,phone,email,date_value,time_value,total,duration,status,source,
          deposit_amount,payment_status,proof_uploaded_at,payment_reviewed_at,
          created_at,updated_at,cancelled_at,cancelled_by,notifications
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
        ON CONFLICT(id) DO UPDATE SET
          name=EXCLUDED.name,phone=EXCLUDED.phone,email=EXCLUDED.email,
          date_value=EXCLUDED.date_value,time_value=EXCLUDED.time_value,
          total=EXCLUDED.total,duration=EXCLUDED.duration,status=EXCLUDED.status,
          source=EXCLUDED.source,deposit_amount=EXCLUDED.deposit_amount,payment_status=EXCLUDED.payment_status,
          proof_uploaded_at=EXCLUDED.proof_uploaded_at,payment_reviewed_at=EXCLUDED.payment_reviewed_at,
          updated_at=EXCLUDED.updated_at,cancelled_at=EXCLUDED.cancelled_at,cancelled_by=EXCLUDED.cancelled_by,
          notifications=EXCLUDED.notifications
      `, [
        String(b.id), String(b.name || ''), String(b.phone || ''), String(b.email || ''),
        String(b.date), String(b.time), Number(b.total || 0), Math.max(15,Number(b.duration || 60)),
        String(b.status || 'Aguardando pagamento'), String(b.source || 'site'),
        Number(b.depositAmount || 20), String(b.paymentStatus || 'Aguardando pagamento'),
        b.proofUploadedAt || null, b.paymentReviewedAt || null,
        b.createdAt || new Date().toISOString(), b.updatedAt || null, b.cancelledAt || null,
        b.cancelledBy || null, JSON.stringify(b.notifications || {})
      ]);

      await c.query('DELETE FROM lsh_booking_services WHERE booking_id=$1', [String(b.id)]);
      for (let i=0; i<(b.services || []).length; i++) {
        const s = b.services[i];
        await c.query(`
          INSERT INTO lsh_booking_services(booking_id,service_id,name,price,duration,position)
          VALUES($1,$2,$3,$4,$5,$6)
        `, [
          String(b.id), String(s.id || ''), String(s.name || 'Procedimento'),
          Number(s.price || 0), Math.max(15,Number(s.duration || 60)), i
        ]);
      }
    }

    if (ownClient) await c.query('COMMIT');
  } catch (err) {
    if (ownClient) await c.query('ROLLBACK').catch(()=>{});
    throw err;
  } finally {
    ownClient?.release();
  }
}

async function migrateLegacyData(client) {
  const already = await client.query("SELECT 1 FROM lsh_migrations WHERE name='v17_relational_import'");
  if (already.rowCount) return;

  const count = await client.query('SELECT COUNT(*)::int AS count FROM lsh_bookings');
  const serviceCount = await client.query('SELECT COUNT(*)::int AS count FROM lsh_services');

  let legacyConfig = null;
  let legacyBookings = null;

  if (await dbTableExists(client, 'lsh_state')) {
    const old = await client.query("SELECT key,value FROM lsh_state WHERE key IN ('config','bookings')");
    for (const row of old.rows) {
      if (row.key === 'config') legacyConfig = row.value;
      if (row.key === 'bookings') legacyBookings = row.value;
    }
  }

  if (!legacyConfig) legacyConfig = readJson(cfgPath, {});
  if (!legacyBookings) legacyBookings = readJson(bookingsPath, []);

  if (Number(serviceCount.rows[0].count) === 0) await writeRelationalConfig(normalizeGalleryConfig(legacyConfig || {}), client);
  if (Number(count.rows[0].count) === 0 && Array.isArray(legacyBookings) && legacyBookings.length) {
    await upsertRelationalBookings(legacyBookings, client);
  }

  await client.query("INSERT INTO lsh_migrations(name) VALUES('v17_relational_import') ON CONFLICT DO NOTHING");
}

async function migrateV18Catalog(client) {
  const already = await client.query("SELECT 1 FROM lsh_migrations WHERE name='v18_pdf_catalog'");
  if (already.rowCount) return;
  const current = await client.query('SELECT id,name,price FROM lsh_services ORDER BY position,id');
  const looksLikeOldStarter = current.rows.length <= 5 && current.rows.every(r => r.price === null || Number(r.price) === 0);
  if (looksLikeOldStarter) {
    const local = normalizeGalleryConfig(readJson(cfgPath, {}));
    await client.query('DELETE FROM lsh_services');
    for (let i=0;i<(local.services||[]).length;i++) {
      const x=local.services[i];
      await client.query(`INSERT INTO lsh_services(id,name,description,image,price,duration,active,position,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [String(x.id),String(x.name),String(x.description||''),String(x.image||''),Number(x.price||0),Math.max(15,Number(x.duration||60)),x.active!==false,i]);
    }
  }
  await client.query("INSERT INTO lsh_migrations(name) VALUES('v18_pdf_catalog') ON CONFLICT DO NOTHING");
}

async function migrateV23ServiceMedia(client) {
  const already = await client.query("SELECT 1 FROM lsh_migrations WHERE name='v23_service_media'");
  if (already.rowCount) return;
  const local = normalizeGalleryConfig(readJson(cfgPath, {}));
  for (const s of (local.services || [])) {
    await client.query(
      `UPDATE lsh_services
       SET description=CASE WHEN COALESCE(description,'')='' THEN $2 ELSE description END,
           image=CASE WHEN COALESCE(image,'')='' THEN $3 ELSE image END,
           updated_at=NOW()
       WHERE id=$1`,
      [String(s.id), String(s.description || ''), String(s.image || '')]
    );
  }
  await client.query("INSERT INTO lsh_migrations(name) VALUES('v23_service_media') ON CONFLICT DO NOTHING");
}

async function migrateV32Maintenance(client) {
  const already = await client.query("SELECT 1 FROM lsh_migrations WHERE name='v32_maintenance_seed'");
  if (already.rowCount) return;

  const local = normalizeGalleryConfig(readJson(cfgPath, {}));
  const maintenance = (local.services || []).filter(x =>
    /^manut/i.test(String(x.id || '')) ||
    /^manuten[cç][aã]o\b/i.test(String(x.name || '').trim())
  );

  for (const x of maintenance) {
    await client.query(
      `INSERT INTO lsh_services(id,name,description,image,price,duration,active,position,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,999,NOW())
       ON CONFLICT(id) DO UPDATE SET
         price=CASE WHEN lsh_services.price IS NULL OR lsh_services.price=0 THEN EXCLUDED.price ELSE lsh_services.price END,
         duration=CASE WHEN lsh_services.duration IS NULL OR lsh_services.duration=60 THEN EXCLUDED.duration ELSE lsh_services.duration END,
         active=TRUE,
         updated_at=NOW()`,
      [
        String(x.id), String(x.name), String(x.description || ''), String(x.image || ''),
        x.price === null || x.price === '' ? null : Number(x.price),
        Math.max(15, Number(x.duration || 60)), x.active !== false
      ]
    );
  }

  await client.query("INSERT INTO lsh_migrations(name) VALUES('v32_maintenance_seed') ON CONFLICT DO NOTHING");
}


async function migrateV40BusinessInfo(client) {
  const already = await client.query("SELECT 1 FROM lsh_migrations WHERE name='v40_business_info'");
  if (already.rowCount) return;

  const values = {
    businessName:'Studio RB',
    whatsapp:'5512997940880',
    email:'emilly.vivi124@icloud.com',
    instagram:'@studio.__rb',
    tiktok:'',
    address:'Rua Tereza de Oliveira Prado, 145 — Dom Pedro II',
    openingHours:'Horários definidos pela proprietária no painel'
  };

  for (const [key,value] of Object.entries(values)) {
    await client.query(
      `INSERT INTO lsh_settings(key,value,updated_at)
       VALUES($1,$2::jsonb,NOW())
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,
      [key, JSON.stringify(value)]
    );
  }

  await client.query("INSERT INTO lsh_migrations(name) VALUES('v40_business_info') ON CONFLICT DO NOTHING");
}

async function initDb() {
  if (!pgPool) {
    console.warn('[DATABASE] DATABASE_URL não configurada. Em produção, alterações não serão aceitas até conectar o PostgreSQL.');
    return;
  }
  const client = await pgPool.connect();
  try {
    await client.query('SELECT 1');
    const ddl = fs.readFileSync(path.join(__dirname, 'database.sql'), 'utf8');
    await client.query(ddl);
    await migrateLegacyData(client);
    await migrateV18Catalog(client);
    await migrateV23ServiceMedia(client);
    await migrateV32Maintenance(client);
    await migrateV40BusinessInfo(client);
    dbReady = true;
    console.log('[DATABASE] PostgreSQL conectado e pronto.');
  } finally {
    client.release();
  }
}

async function getState(key) {
  if (pgPool && dbReady) {
    if (key === 'config') return readRelationalConfig();
    if (key === 'bookings') return readRelationalBookings();
  }
  return key === 'config' ? normalizeGalleryConfig(readJson(cfgPath, {})) : readJson(bookingsPath, []);
}

async function setState(key, value) {
  if (pgPool && dbReady) {
    if (key === 'config') return writeRelationalConfig(value);
    if (key === 'bookings') return upsertRelationalBookings(value);
    throw new Error('Estado desconhecido.');
  }

  if (process.env.NODE_ENV === 'production') {
    const err = new Error('O banco de dados não está conectado. Nenhuma alteração foi salva. Configure DATABASE_URL no Render.');
    err.code = 'DB_REQUIRED';
    throw err;
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
function galleryDefaults() { return [
  { id:'cilios', name:'Cílios', active:true },
  { id:'sobrancelhas', name:'Sobrancelhas', active:true },
  { id:'labios', name:'Lábios', active:true },
  { id:'epilacao', name:'Epilação', active:true }
]; }
function normalizeGalleryConfig(c) {
  c.depositAmount = Number.isFinite(Number(c.depositAmount)) ? Math.max(0, Number(c.depositAmount)) : 20;
  c.pixKey = String(c.pixKey || '').trim().slice(0,180);
  c.pixRecipient = String(c.pixRecipient || 'Emilly Ribeiro').trim().slice(0,120);
  c.pixCity = String(c.pixCity || '').trim().slice(0,80);
  c.paymentInstructions = String(c.paymentInstructions || 'O horário só é confirmado após o envio e aprovação do comprovante do sinal.').trim().slice(0,300);
  c.dateHours = c.dateHours && typeof c.dateHours === 'object' && !Array.isArray(c.dateHours) ? c.dateHours : {};
  for (const [date, times] of Object.entries(c.dateHours)) {
    if (!validDate(date) || !Array.isArray(times)) { delete c.dateHours[date]; continue; }
    c.dateHours[date] = [...new Set(times.map(String).filter(validTime))].sort();
  }
  c.galleryCategories = Array.isArray(c.galleryCategories) && c.galleryCategories.length ? c.galleryCategories : galleryDefaults();
  c.galleryCategories = c.galleryCategories.slice(0,12).map((x,i)=>({
    id:String(x.id || `categoria-${i+1}`).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,50) || `categoria-${i+1}`,
    name:String(x.name || `Categoria ${i+1}`).trim().slice(0,50),
    active:x.active !== false
  })).filter(x=>x.name.length>=2);
  if(!c.galleryCategories.length) c.galleryCategories = galleryDefaults();
  const ids = new Set(c.galleryCategories.map(x=>x.id));
  const fallback = ids.has('sobrancelhas') ? 'sobrancelhas' : c.galleryCategories[0].id;
  c.gallery = Array.isArray(c.gallery) ? c.gallery : [];
  c.gallery.forEach(x=>{ if(!ids.has(String(x.categoryId||''))) x.categoryId=fallback; });
  return c;
}
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
    createdAt: b.createdAt,
    depositAmount:Number(b.depositAmount || 20),
    paymentStatus:b.paymentStatus || 'Aguardando pagamento',
    proofUploadedAt:b.proofUploadedAt || null
  };
}

function emailTransport() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  const opts = {
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000
  };
  if (process.env.SMTP_SERVICE) opts.service = process.env.SMTP_SERVICE;
  else opts.host = process.env.SMTP_HOST || 'smtp.gmail.com';
  return nodemailer.createTransport(opts);
}
async function sendMail({ to, subject, html, verify = false }) {
  const transporter = emailTransport();
  if (!transporter || !to) return { sent:false, reason:'SMTP não configurado' };
  if (verify) await transporter.verify();
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    html
  });
  return { sent:true };
}
function withTimeout(promise, ms, label = 'Operação') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} demorou demais e foi interrompida.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function processConfirmationNotification(bookingId) {
  try {
    const current = await getState('bookings');
    const booking = current.find(x => x.id === bookingId);
    if (!booking || booking.status !== 'Confirmado') return;
    const notifications = await withTimeout(notifyCustomerConfirmed(booking), 15000, 'Envio da confirmação');
    const latest = await getState('bookings');
    const target = latest.find(x => x.id === bookingId);
    if (!target) return;
    target.notifications = { ...(target.notifications || {}), confirmation: notifications, confirmedAt: target.notifications?.confirmedAt || new Date().toISOString(), notificationFinishedAt:new Date().toISOString() };
    await setState('bookings', latest);
  } catch (e) {
    console.error('[confirmation-notification]', bookingId, e && e.message ? e.message : e);
    try {
      const latest = await getState('bookings');
      const target = latest.find(x => x.id === bookingId);
      if (target) {
        target.notifications = { ...(target.notifications || {}), confirmation: { email:false, whatsapp:false, errors:[String(e && e.message || e)] }, notificationFinishedAt:new Date().toISOString() };
        await setState('bookings', latest);
      }
    } catch (persistErr) {
      console.error('[confirmation-notification-persist]', persistErr);
    }
  }
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
    subject: 'NOVO AGENDAMENTO — LASH STUDIO RB',
    html: `
      <div style="font-family:Arial;background:#0b0b0b;color:#fff;padding:28px;border-radius:16px">
        <h2 style="color:#ff5b9e">NOVO AGENDAMENTO — LASH STUDIO RB</h2>
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
  const text = `Olá, ${b.name}! 💗 Seu agendamento no Studio RB foi CONFIRMADO. Data: ${b.date} • Horário: ${b.time} • Procedimento(s): ${serviceText} • Total: ${moneyBRL(b.total)}. Até lá!`;
  const results = { email:false, whatsapp:false, errors:[] };
  try {
    const r = await sendMail({
      to: b.email,
      subject: 'Agendamento confirmado — Studio RB',
      html: `
        <div style="font-family:Arial;background:#0b0b0b;color:#fff;padding:28px;border-radius:16px">
          <h2 style="color:#ff5b9e">Seu agendamento foi confirmado 💗</h2>
          <p>Olá, <b>${escapeHtml(b.name)}</b>!</p>
          <p>Seu horário no <b>Studio RB</b> está confirmado.</p>
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
  return bookings.some(b => {
    if (b.id === excludeId || b.date !== date || b.status === 'Cancelado' || b.status === 'Concluído') return false;
    return String(b.time) === String(time);
  });
}
async function getAvailability(date, duration = 60) {
  const cfg = await getState('config');
  const bookings = await getState('bookings');
  const d = new Date(date + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return [];
  const day = String(d.getDay());
  const hasSpecificDate = cfg.dateHours && Object.prototype.hasOwnProperty.call(cfg.dateHours, date);
  const base = hasSpecificDate ? (cfg.dateHours[date] || []) : ((cfg.weeklyHours && cfg.weeklyHours[day]) || []);
  if ((cfg.blockedDates || []).includes(date)) return [];
  return [...new Set(base)].sort().map(time => {
    const occupied = bookings.some(b =>
      b.date === date &&
      b.status !== 'Cancelado' &&
      b.status !== 'Concluído' &&
      String(b.time) === String(time)
    );
    const blocked = (cfg.blockedSlots || []).some(x => x.date === date && x.time === time);
    return { time, available: !occupied && !blocked };
  });
}

app.get('/api/config', async (req, res) => {
  const c = normalizeGalleryConfig(await getState('config'));
  res.json({
    businessName: c.businessName,
    whatsapp: process.env.OWNER_WHATSAPP || c.whatsapp,
    email: process.env.OWNER_EMAIL || c.email,
    instagram: c.instagram,
    tiktok: c.tiktok,
    address: c.address,
    openingHours: c.openingHours,
    depositAmount: Number(c.depositAmount || 20),
    pixKey: c.pixKey || '',
    pixRecipient: c.pixRecipient || 'Emilly Ribeiro',
    pixCity: c.pixCity || '',
    paymentInstructions: c.paymentInstructions || '',
    services: (c.services || []).filter(s => s.active !== false).map(s => ({
      id:s.id,
      name:s.name,
      description:s.description || '',
      image:s.image || '',
      price:s.price,
      duration:s.duration,
      bookingComplete:s.bookingComplete !== false,
      bookingMaintenance:s.bookingMaintenance !== false
    })),
    galleryCategories: (c.galleryCategories || []).filter(x => x.active !== false).map(x => ({ id:x.id, name:x.name })),
    gallery: (c.gallery || []).filter(x => x.active !== false).slice(0,100).map(x => ({
      id:x.id, src:x.src, title:x.title, caption:x.caption, categoryId:x.categoryId
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
  if (!slot || !slot.available) return res.status(409).json({ error:'Esse horário já está ocupado.' });
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
    status: 'Aguardando pagamento',
    source: 'site',
    depositAmount:Number((await getState('config')).depositAmount || 20),
    paymentStatus:'Aguardando pagamento',
    createdAt: new Date().toISOString(),
    notifications: {}
  };
  bookings.push(b);
  await setState('bookings', bookings);
  res.status(201).json({ ok:true, id:b.id, status:b.status });
});

app.post('/api/bookings/:id/proof', upload.single('proof'), async (req,res) => {
  if (!pgPool || !dbReady) return res.status(503).json({ error:'Banco de dados indisponível.' });
  if (!req.file) return res.status(400).json({ error:'Selecione a foto do comprovante.' });
  const phone = cleanPhone(req.body.phone || '');
  const bookings = await getState('bookings');
  const b = bookings.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error:'Agendamento não encontrado.' });
  if (phone.length < 8 || !cleanPhone(b.phone).endsWith(phone)) return res.status(403).json({ error:'WhatsApp não confere com o agendamento.' });
  const optimized = await optimizeImage(req.file.buffer, { max:1800, quality:86 });
  await pgPool.query(`INSERT INTO lsh_payment_proofs(booking_id,mime_type,original_name,data,created_at)
    VALUES($1,'image/webp',$2,$3,NOW()) ON CONFLICT(booking_id) DO UPDATE SET mime_type=EXCLUDED.mime_type,original_name=EXCLUDED.original_name,data=EXCLUDED.data,created_at=NOW()`,
    [b.id, String(req.file.originalname || 'comprovante').slice(0,160), optimized]);
  b.paymentStatus='Comprovante enviado';
  b.status='Comprovante enviado';
  b.proofUploadedAt=new Date().toISOString();
  await setState('bookings', bookings);
  res.json({ ok:true, status:b.status });
});

app.get('/api/admin/bookings/:id/proof', auth, async (req,res) => {
  if (!pgPool || !dbReady) return res.status(503).end();
  const r=await pgPool.query('SELECT mime_type,data FROM lsh_payment_proofs WHERE booking_id=$1',[req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error:'Comprovante ainda não enviado.' });
  res.setHeader('Content-Type', r.rows[0].mime_type || 'image/webp');
  res.setHeader('Cache-Control','private, no-store');
  res.send(r.rows[0].data);
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
  const qPhone = cleanPhone(q);
  if (qPhone.length < 8 || !cleanPhone(b.phone).endsWith(qPhone)) return res.status(403).json({ error:'Para desmarcar, confirme o WhatsApp usado no agendamento.' });
  if (b.status === 'Concluído') return res.status(409).json({ error:'Esse atendimento já foi concluído.' });
  b.status = 'Cancelado';
  b.cancelledAt = new Date().toISOString();
  b.cancelledBy = 'cliente';
  await setState('bookings', bookings);
  res.json({ ok:true, booking: publicBooking(b) });
});

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const user = String(req.body.username || '');
  const pass = String(req.body.password || '');
  const eu = process.env.ADMIN_USER || 'admin';
  const ep = process.env.ADMIN_PASSWORD || 'troque-esta-senha';
  const safeEqual = (a,b) => {
    const A=Buffer.from(String(a)), B=Buffer.from(String(b));
    return A.length === B.length && crypto.timingSafeEqual(A,B);
  };
  if (safeEqual(user, eu) && safeEqual(pass, ep)) {
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error:'Falha ao iniciar sessão' });
      req.session.admin = true;
      res.json({ ok:true });
    });
    return;
  }
  res.status(401).json({ error:'Credenciais inválidas' });
});
app.post('/api/admin/logout', auth, (req,res) => req.session.destroy(() => res.json({ ok:true })));
app.get('/api/admin/me', auth, (req,res) => res.json({ ok:true }));

function bookingFinancialTotal(b){
  const direct = Number(b?.total || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const serviceSum = (b?.services || []).reduce((sum,x)=>{
    if (typeof x === 'object' && x) {
      const p = Number(x.price || 0);
      return sum + (Number.isFinite(p) ? p : 0);
    }
    return sum;
  },0);
  if (serviceSum > 0) return serviceSum;

  const legacy = Number(b?.amount || b?.value || b?.price || 0);
  return Number.isFinite(legacy) && legacy > 0 ? legacy : 0;
}
function bookingServiceLabelList(b){
  return (b?.services || []).map(x => typeof x === 'string' ? x : (x?.name || '')).filter(Boolean);
}


app.get('/api/admin/clients/search', auth, async (req,res) => {
  const q=String(req.query.q||'').trim();
  const month=String(req.query.month||'').trim();
  if(q.length<2)return res.json({clients:[]});

  const digits=cleanPhone(q);
  const nq=normalizeName(q);
  const bookings=await getState('bookings');
  const matched=bookings.filter(b=>{
    const byPhone=digits && cleanPhone(b.phone).includes(digits);
    const byName=nq && normalizeName(b.name).includes(nq);
    return byPhone || byName;
  });

  const groups=new Map();
  for(const b of matched){
    const key=cleanPhone(b.phone) ? `p:${cleanPhone(b.phone)}` : `n:${normalizeName(b.name)}`;
    if(!groups.has(key))groups.set(key,{
      key,name:b.name||'Cliente',phone:b.phone||'',email:b.email||'',bookings:[]
    });
    groups.get(key).bookings.push(b);
  }

  const clients=[...groups.values()].map(c=>{
    const all=c.bookings.sort((a,b)=>(String(b.date)+String(b.time)).localeCompare(String(a.date)+String(a.time)));
    const monthly=month ? all.filter(b=>String(b.date||'').startsWith(month)) : all;
    const completed=all.filter(b=>b.status==='Concluído');
    return {
      key:c.key,name:c.name,phone:c.phone,email:c.email,
      completedCount:completed.length,
      completedValue:completed.reduce((sum,b)=>sum+bookingFinancialTotal(b),0),
      monthly:monthly.map(b=>({
        id:b.id,date:b.date,time:b.time,status:b.status,
        total:bookingFinancialTotal(b),
        services:bookingServiceLabelList(b)
      })),
      all:all.map(b=>({
        id:b.id,date:b.date,time:b.time,status:b.status,
        total:bookingFinancialTotal(b),
        services:bookingServiceLabelList(b)
      }))
    };
  }).sort((a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR')).slice(0,20);

  res.json({clients});
});

app.get('/api/admin/finance', auth, async (req,res) => {
  const period=['month','quarter','year'].includes(String(req.query.period))?String(req.query.period):'month';
  const ref=String(req.query.reference||'');
  const now=new Date();
  let y=now.getFullYear(),m=now.getMonth()+1;
  if(/^\d{4}-\d{2}$/.test(ref)){const parts=ref.split('-').map(Number);y=parts[0];m=parts[1];}

  let start,end,label;
  if(period==='year'){
    start=`${y}-01-01`; end=`${y}-12-31`; label=`Ano ${y}`;
  }else if(period==='quarter'){
    const q=Math.floor((m-1)/3),sm=q*3+1,em=sm+2,last=new Date(y,em,0).getDate();
    start=`${y}-${String(sm).padStart(2,'0')}-01`;
    end=`${y}-${String(em).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
    label=`${q+1}º trimestre de ${y}`;
  }else{
    const last=new Date(y,m,0).getDate();
    start=`${y}-${String(m).padStart(2,'0')}-01`;
    end=`${y}-${String(m).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
    label=`${String(m).padStart(2,'0')}/${y}`;
  }

  const bookings=(await getState('bookings')).filter(b=>b.status==='Concluído' && b.date>=start && b.date<=end);
  const revenue=bookings.reduce((sum,b)=>sum+bookingFinancialTotal(b),0);
  const clients=new Set(bookings.map(b=>cleanPhone(b.phone)||normalizeName(b.name))).size;
  const ticket=bookings.length?revenue/bookings.length:0;

  const byService=new Map();
  for(const b of bookings){
    const names=bookingServiceLabelList(b);
    const total=bookingFinancialTotal(b);
    const services=(b.services||[]).filter(x=>typeof x!=='string');
    if(services.length && services.some(x=>Number(x.price||0)>0)){
      for(const x of services){
        const name=x.name||'Procedimento';
        const cur=byService.get(name)||{count:0,total:0};
        cur.count++;cur.total+=Number(x.price||0);byService.set(name,cur);
      }
    }else{
      const share=names.length?total/names.length:total;
      for(const name of (names.length?names:['Sem procedimento'])){
        const cur=byService.get(name)||{count:0,total:0};
        cur.count++;cur.total+=share;byService.set(name,cur);
      }
    }
  }

  res.json({
    period,label,start,end,revenue,clients,ticket,count:bookings.length,
    services:[...byService.entries()].map(([name,v])=>({name,...v})).sort((a,b)=>b.total-a.total),
    bookings:bookings.sort((a,b)=>(String(b.date)+String(b.time)).localeCompare(String(a.date)+String(a.time))).map(b=>({
      id:b.id,name:b.name,date:b.date,time:b.time,total:bookingFinancialTotal(b),services:bookingServiceLabelList(b)
    }))
  });
});

app.get('/api/admin/bookings', auth, async (req,res) => res.json({ bookings: await getState('bookings') }));
app.get('/api/admin/config', auth, async (req,res) => {
  const config = normalizeGalleryConfig(await getState('config'));
  delete config.services;
  res.json({ config });
});

app.get('/api/admin/services', auth, async (req,res) => {
  if (pgPool && dbReady) {
    const r = await pgPool.query(
      'SELECT id,name,description,image,price,duration,active,booking_complete,booking_maintenance FROM lsh_services ORDER BY position,id'
    );
    return res.json({ services:r.rows.map(x=>({
      id:String(x.id), name:x.name, description:x.description||'', image:x.image||'',
      price:x.price===null?null:Number(x.price), duration:Number(x.duration||60), active:x.active!==false,
      bookingComplete:x.booking_complete!==false, bookingMaintenance:x.booking_maintenance!==false
    }))});
  }
  const cfg = normalizeGalleryConfig(await getState('config'));
  res.json({ services:cfg.services||[] });
});

app.patch('/api/admin/bookings/:id', auth, async (req,res) => {
  const allowed = ['Aguardando pagamento','Comprovante enviado','Pagamento recusado','Pendente','Confirmado','Concluído','Cancelado'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error:'Status inválido' });
  const arr = await getState('bookings');
  const b = arr.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error:'Não encontrado' });
  b.status = req.body.status;
  if (req.body.status === 'Confirmado') { b.paymentStatus='Aprovado'; b.paymentReviewedAt=new Date().toISOString(); }
  if (req.body.status === 'Pagamento recusado') { b.paymentStatus='Recusado'; b.paymentReviewedAt=new Date().toISOString(); }
  if (req.body.status === 'Concluído' && Number(b.total||0) <= 0) {
    const recalculated = bookingFinancialTotal(b);
    if (recalculated > 0) b.total = recalculated;
  }
  b.updatedAt = new Date().toISOString();

  await setState('bookings', arr);
  res.json({ booking:b });
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

  if (pgPool && dbReady) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM lsh_weekly_hours');
      for (let day=0; day<7; day++) {
        for (const time of normalized[String(day)]) {
          await client.query('INSERT INTO lsh_weekly_hours(weekday,time_value) VALUES($1,$2)', [day,time]);
        }
      }
      await client.query(
        `INSERT INTO lsh_settings(key,value,updated_at) VALUES('openingHours',$1::jsonb,NOW())
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,
        [JSON.stringify('Horários definidos pela proprietária no painel')]
      );
      await client.query('COMMIT');
      return res.json({ ok:true, weeklyHours:normalized });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[SCHEDULE]', e);
      return res.status(500).json({ error:'Não foi possível salvar os horários.' });
    } finally { client.release(); }
  }

  const c = await getState('config');
  c.weeklyHours = normalized;
  c.openingHours = 'Horários definidos pela proprietária no painel';
  await setState('config', c);
  res.json({ ok:true, weeklyHours:normalized });
});

app.put('/api/admin/date-schedule', auth, async (req,res) => {
  const date = String(req.body.date || '');
  const times = Array.isArray(req.body.times) ? req.body.times : null;
  if (!validDate(date) || !times) return res.status(400).json({ error:'Data ou horários inválidos.' });
  const normalized = [...new Set(times.map(String).filter(validTime))].sort();

  if (pgPool && dbReady) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM lsh_date_hours WHERE date_value=$1', [date]);
      for (const time of normalized) {
        await client.query('INSERT INTO lsh_date_hours(date_value,time_value) VALUES($1,$2)', [date,time]);
      }
      await client.query('COMMIT');
      return res.json({ ok:true, date, times:normalized });
    } catch(e) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error:'Não foi possível salvar os horários desse dia.' });
    } finally { client.release(); }
  }

  const c = normalizeGalleryConfig(await getState('config'));
  c.dateHours = c.dateHours || {};
  c.dateHours[date] = normalized;
  await setState('config', c);
  res.json({ ok:true, date, times:normalized });
});
app.delete('/api/admin/date-schedule/:date', auth, async (req,res) => {
  const date = String(req.params.date || '');
  if (!validDate(date)) return res.status(400).json({ error:'Data inválida.' });
  if (pgPool && dbReady) {
    await pgPool.query('DELETE FROM lsh_date_hours WHERE date_value=$1', [date]);
    return res.json({ ok:true });
  }
  const c = normalizeGalleryConfig(await getState('config'));
  delete c.dateHours[date];
  await setState('config', c);
  res.json({ ok:true });
});

app.put('/api/admin/services', auth, async (req,res) => {
  const services = Array.isArray(req.body.services) ? req.body.services : null;
  if (!services) return res.status(400).json({ error:'Procedimentos inválidos' });

  const cleaned = [];
  for (let i=0; i<Math.min(services.length,40); i++) {
    const raw=services[i]||{};
    const name=String(raw.name||'').trim().slice(0,80);
    if(name.length<2) return res.status(400).json({error:`Preencha o nome do procedimento ${i+1}.`});
    const active=raw.active!==false;
    const price=raw.price===null||raw.price===''?null:Number(raw.price);
    if(active&&(price===null||!Number.isFinite(price)||price<0))
      return res.status(400).json({error:`Defina um valor válido para “${name}”.`});
    const duration=Math.max(15,Math.min(480,Math.round(Number(raw.duration||60))));
    cleaned.push({
      id:String(raw.id||crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60)||crypto.randomUUID(),
      name, description:String(raw.description||'').trim().slice(0,220),
      image:String(raw.image||'').trim().slice(0,2200000),
      price:price===null?null:Math.round(price*100)/100,
      duration, active,
      bookingComplete: raw.bookingComplete !== false,
      bookingMaintenance: raw.bookingMaintenance !== false
    });
  }

  const ids=new Set();
  for(const item of cleaned){if(ids.has(item.id))item.id=crypto.randomUUID();ids.add(item.id);}

  if(pgPool&&dbReady){
    const client=await pgPool.connect();
    try{
      await client.query('BEGIN');
      const incoming=cleaned.map(x=>x.id);
      if(incoming.length) await client.query('DELETE FROM lsh_services WHERE NOT (id = ANY($1::text[]))',[incoming]);
      else await client.query('DELETE FROM lsh_services');
      for(let i=0;i<cleaned.length;i++){
        const x=cleaned[i];
        await client.query(
          `INSERT INTO lsh_services(id,name,description,image,price,duration,active,booking_complete,booking_maintenance,position,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
           ON CONFLICT(id) DO UPDATE SET
             name=EXCLUDED.name,description=EXCLUDED.description,
             image=CASE WHEN EXCLUDED.image='' THEN lsh_services.image ELSE EXCLUDED.image END,
             price=EXCLUDED.price,duration=EXCLUDED.duration,active=EXCLUDED.active,
             booking_complete=EXCLUDED.booking_complete,booking_maintenance=EXCLUDED.booking_maintenance,
             position=EXCLUDED.position,updated_at=NOW()`,
          [x.id,x.name,x.description,x.image,x.price,x.duration,x.active,x.bookingComplete,x.bookingMaintenance,i]
        );
      }
      await client.query('COMMIT');
      const r=await pgPool.query('SELECT id,name,description,image,price,duration,active,booking_complete,booking_maintenance FROM lsh_services ORDER BY position,id');
      return res.json({ok:true,services:r.rows.map(x=>({...x,price:x.price===null?null:Number(x.price),duration:Number(x.duration||60)}))});
    }catch(e){
      await client.query('ROLLBACK');
      console.error('[SERVICES SAVE]',e);
      return res.status(500).json({error:'Não foi possível salvar os procedimentos.'});
    }finally{client.release();}
  }

  const c=normalizeGalleryConfig(await getState('config'));c.services=cleaned;await setState('config',c);
  res.json({ok:true,services:cleaned});
});

app.post('/api/admin/services/:id/image', auth, upload.single('image'), async (req,res) => {
  if(!req.file)return res.status(400).json({error:'Escolha uma imagem.'});
  const id=String(req.params.id||'');
  const optimized=await optimizeImage(req.file.buffer,{max:1200,quality:82});
  const image=`data:image/webp;base64,${optimized.toString('base64')}`;
  if(pgPool&&dbReady){
    const r=await pgPool.query('UPDATE lsh_services SET image=$2,updated_at=NOW() WHERE id=$1 RETURNING id',[id,image]);
    if(!r.rowCount)return res.status(404).json({error:'Procedimento não encontrado. Salve primeiro.'});
    return res.json({ok:true,image});
  }
  const cfg=normalizeGalleryConfig(await getState('config'));
  const service=(cfg.services||[]).find(x=>String(x.id)===id);
  if(!service)return res.status(404).json({error:'Procedimento não encontrado. Salve primeiro.'});
  service.image=image;await setState('config',cfg);res.json({ok:true,image});
});

app.delete('/api/admin/services/:id/image', auth, async (req,res) => {
  const id=String(req.params.id||'');
  if(pgPool&&dbReady){
    const r=await pgPool.query("UPDATE lsh_services SET image='',updated_at=NOW() WHERE id=$1 RETURNING id",[id]);
    if(!r.rowCount)return res.status(404).json({error:'Procedimento não encontrado.'});
    return res.json({ok:true});
  }
  const cfg=normalizeGalleryConfig(await getState('config'));
  const service=(cfg.services||[]).find(x=>String(x.id)===id);
  if(!service)return res.status(404).json({error:'Procedimento não encontrado.'});
  service.image='';await setState('config',cfg);res.json({ok:true});
});


app.put('/api/admin/payment-settings', auth, async (req,res) => {
  const cfg = normalizeGalleryConfig(await getState('config'));
  const amount = Number(req.body.depositAmount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000) return res.status(400).json({ error:'Valor do sinal inválido.' });
  cfg.depositAmount = Math.round(amount * 100) / 100;
  cfg.pixKey = String(req.body.pixKey || '').trim().slice(0,180);
  cfg.pixRecipient = String(req.body.pixRecipient || 'Emilly Ribeiro').trim().slice(0,120);
  cfg.pixCity = String(req.body.pixCity || '').trim().slice(0,80);
  cfg.paymentInstructions = String(req.body.paymentInstructions || '').trim().slice(0,300);
  await setState('config', cfg);
  res.json({ ok:true, payment:{ depositAmount:cfg.depositAmount,pixKey:cfg.pixKey,pixRecipient:cfg.pixRecipient,pixCity:cfg.pixCity,paymentInstructions:cfg.paymentInstructions } });
});

app.post('/api/admin/gallery-categories', auth, async (req,res) => {
  const cfg = normalizeGalleryConfig(await getState('config'));
  if (cfg.galleryCategories.length >= 12) return res.status(409).json({ error:'Limite de 12 categorias atingido.' });
  const name = String(req.body.name || '').trim().slice(0,50);
  if (name.length < 2) return res.status(400).json({ error:'Digite um nome para a categoria.' });
  if (cfg.galleryCategories.some(x => x.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) return res.status(409).json({ error:'Essa categoria já existe.' });
  const base = name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,32) || 'categoria';
  let id=base, n=2; while(cfg.galleryCategories.some(x=>x.id===id)) id=`${base}-${n++}`;
  const item={ id, name, active:true };
  cfg.galleryCategories.push(item);
  await setState('config', cfg);
  res.status(201).json({ ok:true, item });
});

app.put('/api/admin/gallery-categories/:id', auth, async (req,res) => {
  const cfg = normalizeGalleryConfig(await getState('config'));
  const item = cfg.galleryCategories.find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error:'Categoria não encontrada.' });
  const name = String(req.body.name || '').trim().slice(0,50);
  if (name.length < 2) return res.status(400).json({ error:'Nome inválido.' });
  item.name=name;
  await setState('config', cfg);
  res.json({ ok:true, item });
});

app.delete('/api/admin/gallery-categories/:id', auth, async (req,res) => {
  const cfg = normalizeGalleryConfig(await getState('config'));
  if (cfg.galleryCategories.length <= 1) return res.status(409).json({ error:'Mantenha pelo menos uma categoria.' });
  const idx=cfg.galleryCategories.findIndex(x=>x.id===req.params.id);
  if(idx<0) return res.status(404).json({ error:'Categoria não encontrada.' });
  const removed=cfg.galleryCategories[idx];
  const fallback=cfg.galleryCategories.find(x=>x.id!==removed.id);
  cfg.galleryCategories.splice(idx,1);
  (cfg.gallery||[]).forEach(x=>{ if(x.categoryId===removed.id) x.categoryId=fallback.id; });
  await setState('config', cfg);
  res.json({ ok:true, movedTo:fallback.id });
});

app.post('/api/admin/gallery', auth, upload.single('photo'), async (req,res) => {
  if (!req.file) return res.status(400).json({ error:'Escolha uma imagem.' });
  const cfg = normalizeGalleryConfig(await getState('config'));
  cfg.gallery = Array.isArray(cfg.gallery) ? cfg.gallery : [];
  if (cfg.gallery.length >= 100) return res.status(409).json({ error:'Limite de 100 fotos atingido.' });
  const categoryId = String(req.body.categoryId || '').trim();
  if (!cfg.galleryCategories.some(x => x.id === categoryId)) return res.status(400).json({ error:'Escolha uma categoria válida.' });
  const optimized = await optimizeImage(req.file.buffer, { max:1600, quality:84 });
  const src = `data:image/webp;base64,${optimized.toString('base64')}`;
  const item = {
    id: crypto.randomUUID(), src,
    title: String(req.body.title || `Resultado ${cfg.gallery.length + 1}`).trim().slice(0,80),
    caption: String(req.body.caption || 'Trabalho realizado pela Emilly').trim().slice(0,180),
    categoryId, active:true
  };
  cfg.gallery.push(item);
  await setState('config', cfg);
  res.status(201).json({ ok:true, item });
});

app.delete('/api/admin/gallery/:id', auth, async (req,res) => {
  const cfg = normalizeGalleryConfig(await getState('config'));
  cfg.gallery = Array.isArray(cfg.gallery) ? cfg.gallery : [];
  const before = cfg.gallery.length;
  cfg.gallery = cfg.gallery.filter(x => String(x.id) !== String(req.params.id));
  if (cfg.gallery.length === before) return res.status(404).json({ error:'Foto não encontrada.' });
  await setState('config', cfg);
  res.json({ ok:true });
});

app.put('/api/admin/gallery/:id', auth, async (req,res) => {
  const cfg = normalizeGalleryConfig(await getState('config'));
  cfg.gallery = Array.isArray(cfg.gallery) ? cfg.gallery : [];
  const item = cfg.gallery.find(x => String(x.id) === String(req.params.id));
  if (!item) return res.status(404).json({ error:'Foto não encontrada.' });
  item.title = String(req.body.title || item.title || '').trim().slice(0,80);
  item.caption = String(req.body.caption || item.caption || '').trim().slice(0,180);
  if (req.body.categoryId !== undefined) {
    const categoryId = String(req.body.categoryId || '').trim();
    if (!cfg.galleryCategories.some(x => x.id === categoryId)) return res.status(400).json({ error:'Categoria inválida.' });
    item.categoryId = categoryId;
  }
  item.active = req.body.active !== false;
  await setState('config', cfg);
  res.json({ ok:true, item });
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


app.get('/api/admin/backup', auth, async (req,res) => {
  const payload = {
    exportedAt: new Date().toISOString(),
    config: normalizeGalleryConfig(await getState('config')),
    bookings: await getState('bookings')
  };
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename=studio-rb-backup-${new Date().toISOString().slice(0,10)}.json`);
  res.send(JSON.stringify(payload, null, 2));
});

app.use((err, req, res, next) => {
  console.error('Erro:', err.stack || err.message);
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error:'A imagem passou de 20 MB. Escolha uma foto menor.' });
  if (err.code === 'IMAGE_PROCESSING') return res.status(400).json({ error:err.message });
  if (err.code === 'DB_REQUIRED') return res.status(503).json({ error:err.message });
  if (err.code === '23505') return res.status(409).json({ error:'Esse registro já existe.' });
  if (err.code === '22P02') return res.status(400).json({ error:'Algum dado enviado é inválido.' });
  res.status(500).json({ error:'Não foi possível concluir esta ação. Tente novamente.' });
});

app.get('/api/health', async (req,res) => res.json({ ok:true, database:!!(pgPool && dbReady) }));

initDb()
  .catch(err => {
    dbReady = false;
    console.error('[DATABASE] Falha ao iniciar PostgreSQL:', err.stack || err.message);
  })
  .finally(() => app.listen(PORT, () => console.log(`Studio RB disponível em http://localhost:${PORT}`)));
