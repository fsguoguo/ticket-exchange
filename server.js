const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { load: loadHtml } = require('cheerio');
const { Pool } = require('pg');

const rootDir = __dirname;
const configuredStoreFile = String(process.env.DATA_FILE_PATH || '').trim();
const storeFile = configuredStoreFile || path.join(rootDir, 'data', 'store.json');
const dataDir = path.dirname(storeFile);
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const allowLocalStore = ['1', 'true', 'yes'].includes(String(process.env.ALLOW_LOCAL_STORE || '').trim().toLowerCase());
const dbConnectTimeoutMs = Math.max(1000, Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000));
const dbQueryTimeoutMs = Math.max(1000, Number(process.env.DB_QUERY_TIMEOUT_MS || 10000));
const notificationDedupWindowMs = Math.max(0, Number(process.env.NOTIFICATION_DEDUP_WINDOW_MS || 30000));
const bcryptRounds = Math.min(14, Math.max(10, finiteNumber(process.env.BCRYPT_ROUNDS, 12)));
const sessionTtlMs = Math.max(60000, finiteNumber(process.env.SESSION_TTL_MS || process.env.TOKEN_TTL_MS, 1000 * 60 * 60 * 24 * 7));
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: dbConnectTimeoutMs,
      query_timeout: dbQueryTimeoutMs,
      keepAlive: true,
      ssl: { rejectUnauthorized: false }
    })
  : null;
const port = Number(process.env.PORT || 3000);
const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const configuredAllowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);
const defaultAllowedOrigins = ['https://ticket-exchange.onrender.com'];
const localOriginPattern = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i;
let databaseReady = null;

if (!pool && !allowLocalStore) {
  throw new Error('DATABASE_URL is required; set ALLOW_LOCAL_STORE=true only for local development');
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

const publicStaticFiles = new Set([
  'index.html',
  'register.html',
  'app.js',
  'config.js'
]);

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const cspConnectSources = [...new Set([
  "'self'",
  ...defaultAllowedOrigins,
  ...configuredAllowedOrigins,
  ...(isProduction ? [] : ['http://localhost:3000', 'http://127.0.0.1:3000'])
])].join(' ');

function buildSecurityHeaders(cspNonce = '') {
  const nonceSource = cspNonce ? ` 'nonce-${cspNonce}'` : '';
  const headers = {
    'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data: https:",
    `style-src 'self'${nonceSource}`,
    `script-src 'self'${nonceSource}`,
    `connect-src ${cspConnectSources}`,
    "form-action 'self'"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin'
  };

  if (isProduction) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }

  return headers;
}

const LIVE_REFRESH_INTERVAL_MS = Number(process.env.LIVE_REFRESH_INTERVAL_MS || 1000 * 60 * 60 * 6);
const LIVE_FETCH_TIMEOUT_MS = Number(process.env.LIVE_FETCH_TIMEOUT_MS || 12000);
const LIVE_MAX_PAGES_PER_SOURCE = Number(process.env.LIVE_MAX_PAGES_PER_SOURCE || 16);
const LIVE_MAX_LOVELIVE_DETAIL_FETCH = Number(process.env.LIVE_MAX_LOVELIVE_DETAIL_FETCH || 24);

const FRANCHISE_LABELS = {
  bangdream: 'Bang Dream',
  lovelive: 'LoveLive',
  imas: 'IM@S',
  other: '其他'
};

const KIND_LABELS = {
  transfer: '出票',
  seeking: '收票',
  swap: '换票'
};

const ACCENT_BY_FRANCHISE = {
  bangdream: '#ff6aa2',
  lovelive: '#6de2ff',
  imas: '#ff8f70',
  other: '#8bd3ff'
};

const LIVE_SOURCES = [
  {
    franchise: 'bangdream',
    franchiseLabel: 'Bang Dream',
    startUrl: 'https://bang-dream.com/events/',
    pagePattern: /^https:\/\/bang-dream\.com\/events(?:\/page\/\d+\/?)?$/i,
    parser: parseBangDreamPage,
    crawler: crawlBangDreamUntilPast
  },
  {
    franchise: 'lovelive',
    franchiseLabel: 'LoveLive',
    startUrl: 'https://www.lovelive-anime.jp/hasunosora/live-event/',
    pagePattern: /^https:\/\/www\.lovelive-anime\.jp\/hasunosora\/live-event\/?$/i,
    parser: parseLoveLiveHasunosoraPage
  },
  {
    franchise: 'lovelive',
    franchiseLabel: 'LoveLive',
    startUrl: 'https://www.lovelive-anime.jp/yuigaoka/live/',
    pagePattern: /^https:\/\/www\.lovelive-anime\.jp\/yuigaoka\/live\/?$/i,
    parser: parseLoveLiveYuigaokaPage
  },
  {
    franchise: 'lovelive',
    franchiseLabel: 'LoveLive',
    startUrl: 'https://www.lovelive-anime.jp/nijigasaki/live.php',
    pagePattern: /^https:\/\/www\.lovelive-anime\.jp\/nijigasaki\/live\.php$/i,
    parser: parseLoveLiveNijigasakiPage
  },
  {
    franchise: 'lovelive',
    franchiseLabel: 'LoveLive',
    startUrl: 'https://www.lovelive-anime.jp/uranohoshi/live.php',
    pagePattern: /^https:\/\/www\.lovelive-anime\.jp\/uranohoshi\/live\.php$/i,
    parser: parseLoveLiveUranohoshiPage
  },
  {
    franchise: 'lovelive',
    franchiseLabel: 'LoveLive',
    startUrl: 'https://www.lovelive-anime.jp/lovehigh/live/',
    pagePattern: /^https:\/\/www\.lovelive-anime\.jp\/lovehigh\/live\/?$/i,
    parser: parseLoveLiveBluebirdPage
  },
  {
    franchise: 'imas',
    franchiseLabel: 'IM@S',
    startUrl: 'https://idolmaster-official.jp/live_event',
    pagePattern: /^https:\/\/idolmaster-official\.jp\/live_event(?:\/page\/\d+\/?)?$/i,
    parser: parseImasPage
  }
];

let liveRefreshPromise = null;

const USER_RESET_PASSWORD = '123456';

const DEFAULT_PASSWORDS = {
  admin: 'admin123'
};

function seedStore() {
  return {
    nextUserId: 4,
    nextListingId: 9,
    nextNotificationId: 1,
    users: [
      { id: 'u1', name: 'admin', role: 'admin' },
    ],
    tokens: {},
    listings: [
      {
        id: 1,
        franchise: 'bangdream',
        franchiseLabel: 'Bang Dream',
        kind: 'transfer',
        kindLabel: '出票',
        title: 'MyGO!!!!! 现场票转让',
        subtitle: '想出一张二层看台票，临近开演前确认即可。',
        city: '东京',
        venue: '武道馆',
        date: '2026-08-15',
        price: '原价 9800 日元',
        contact: 'X / @mygo_ticket_01',
        note: '优先能快速确认的同好，支持站内预留。',
        tags: ['二层', '快速确认', '同好优先'],
        accent: '#ff6aa2',
        ownerId: 'u1',
        ownerName: '星海管理员',
        status: 'approved',
        favoritesBy: ['u2'],
        reviewLog: [{ at: '2026-06-24T10:00:00.000Z', action: 'approved', by: '系统', note: '样例数据' }]
      },
      {
        id: 2,
        franchise: 'lovelive',
        franchiseLabel: 'LoveLive',
        kind: 'seeking',
        kindLabel: '收票',
        title: 'Aqours Final 含泪收票',
        subtitle: '求一张能现场见证最终场的门票，价格可协商。',
        city: '大阪',
        venue: '京瓷巨蛋',
        date: '2026-09-02',
        price: '预算 15000 日元内',
        contact: 'Telegram / @ll_buyer88',
        note: '可接受电子票或纸票，先沟通座位和票型。',
        tags: ['最终场', '可协商', '电子票'],
        accent: '#6de2ff',
        ownerId: 'u2',
        ownerName: '星海同好',
        status: 'approved',
        favoritesBy: [],
        reviewLog: [{ at: '2026-06-24T10:05:00.000Z', action: 'approved', by: '系统', note: '样例数据' }]
      },
      {
        id: 3,
        franchise: 'bangdream',
        franchiseLabel: 'Bang Dream',
        kind: 'swap',
        kindLabel: '换票',
        title: 'Roselia 双日互换',
        subtitle: 'A 日看台换 B 日更近位置，想互补票档。',
        city: '名古屋',
        venue: '爱知天空竞技场',
        date: '2026-07-21',
        price: '等值互换',
        contact: 'QQ / 2345xxxx',
        note: '希望同样是 Roselia 粉，互相确认后交换。',
        tags: ['双日', '等值互换', 'Roselia'],
        accent: '#ffd36e',
        ownerId: 'u2',
        ownerName: '星海同好',
        status: 'approved',
        favoritesBy: [],
        reviewLog: [{ at: '2026-06-24T10:08:00.000Z', action: 'approved', by: '系统', note: '样例数据' }]
      },
      {
        id: 4,
        franchise: 'lovelive',
        franchiseLabel: 'LoveLive',
        kind: 'transfer',
        kindLabel: '出票',
        title: 'Liella! 城市巡演单票',
        subtitle: '单张转出，适合临时补位的同好。',
        city: '横滨',
        venue: 'Pacifico Yokohama',
        date: '2026-10-06',
        price: '面议',
        contact: '微博私信 / @ll_kkk',
        note: '可优先给能当日确认的买家。',
        tags: ['单票', '可面议', '临近场次'],
        accent: '#9a7bff',
        ownerId: 'u3',
        ownerName: '审稿小组',
        status: 'approved',
        favoritesBy: [],
        reviewLog: [{ at: '2026-06-24T10:12:00.000Z', action: 'approved', by: '系统', note: '样例数据' }]
      },
      {
        id: 5,
        franchise: 'bangdream',
        franchiseLabel: 'Bang Dream',
        kind: 'seeking',
        kindLabel: '收票',
        title: "Poppin'Party 想补一张内场",
        subtitle: '求内场或前排，预算弹性较大。',
        city: '东京',
        venue: '代代木竞技场',
        date: '2026-11-12',
        price: '预算 20000 日元内',
        contact: 'Discord / hana#2211',
        note: '如果有退票也可以第一时间联系。',
        tags: ['内场', '前排', '弹性预算'],
        accent: '#77f0b3',
        ownerId: 'u3',
        ownerName: '审稿小组',
        status: 'approved',
        favoritesBy: [],
        reviewLog: [{ at: '2026-06-24T10:15:00.000Z', action: 'approved', by: '系统', note: '样例数据' }]
      },
      {
        id: 6,
        franchise: 'lovelive',
        franchiseLabel: 'LoveLive',
        kind: 'swap',
        kindLabel: '换票',
        title: '虹咲演唱会互换座位',
        subtitle: '想用偏后排换更稳定的同行位置。',
        city: '京都',
        venue: 'Kyoto Pulse Plaza',
        date: '2026-12-01',
        price: '可补差价',
        contact: '站内消息 / niji_swap',
        note: '希望同样是虹咲粉，方便后续沟通。',
        tags: ['同行', '补差价', '站内消息'],
        accent: '#ff9b6a',
        ownerId: 'u3',
        ownerName: '审稿小组',
        status: 'approved',
        favoritesBy: [],
        reviewLog: [{ at: '2026-06-24T10:18:00.000Z', action: 'approved', by: '系统', note: '样例数据' }]
      },
      {
        id: 7,
        franchise: 'imas',
        franchiseLabel: 'IM@S',
        kind: 'transfer',
        kindLabel: '出票',
        title: 'THE IDOLM@STER 765 票转让',
        subtitle: 'IM@S 场次出票，想给能快速确认的同好。',
        city: '福冈',
        venue: 'Marine Messe',
        date: '2026-11-28',
        price: '原价 10500 日元',
        contact: '站内消息 / imas_765',
        note: '优先老粉，确认快可直接联系。',
        tags: ['IM@S', '765', '快速确认'],
        accent: '#ff8f70',
        ownerId: 'u1',
        ownerName: '星海管理员',
        status: 'approved',
        favoritesBy: [],
        reviewLog: [{ at: '2026-06-25T09:00:00.000Z', action: 'published', by: '星海管理员', note: '直接发布' }]
      },
      {
        id: 8,
        franchise: 'other',
        franchiseLabel: '其他',
        kind: 'transfer',
        kindLabel: '出票',
        title: 'Vocaloid Live 余票',
        subtitle: '其他企划的余票，适合临时补位。',
        city: '大阪',
        venue: '大阪城 Hall',
        date: '2026-12-14',
        price: '12000 日元',
        contact: '微博私信 / @vocaloid_live',
        note: '接受现场交接，票面信息可先看图。',
        tags: ['其他', '现场交接', '补位'],
        accent: '#8bd3ff',
        ownerId: 'u2',
        ownerName: '星海同好',
        status: 'rejected',
        favoritesBy: [],
        reviewLog: [{ at: '2026-06-25T09:10:00.000Z', action: 'rejected', by: '审稿小组', note: '示例拒绝原因：信息不完整' }]
      }
    ],
    notifications: [],
    liveOptions: [],
    liveOptionsUpdatedAt: null
  };
}

function normalizeStore(store) {
  const normalized = store && typeof store === 'object' ? store : {};
  normalized.users = Array.isArray(normalized.users) ? normalized.users : [];
  normalized.tokens = normalized.tokens && typeof normalized.tokens === 'object' ? normalized.tokens : {};
  normalized.listings = Array.isArray(normalized.listings) ? normalized.listings : [];
  normalized.notifications = Array.isArray(normalized.notifications) ? normalized.notifications : [];
  normalized.reviews = Array.isArray(normalized.reviews) ? normalized.reviews : [];
  normalized.sessions = Array.isArray(normalized.sessions) ? normalized.sessions : [];
  normalized.liveOptions = Array.isArray(normalized.liveOptions) ? normalized.liveOptions : [];
  normalized.liveOptionsUpdatedAt = normalized.liveOptionsUpdatedAt || null;
  normalized.nextUserId = Number.isFinite(Number(normalized.nextUserId)) ? Number(normalized.nextUserId) : 4;
  normalized.nextListingId = Number.isFinite(Number(normalized.nextListingId)) ? Number(normalized.nextListingId) : 1;
  normalized.nextNotificationId = Number.isFinite(Number(normalized.nextNotificationId)) ? Number(normalized.nextNotificationId) : 1;

  for (const user of normalized.users) {
    if (!user.id) {
      user.id = user.name === 'admin' ? 'u1' : `u${normalized.nextUserId++}`;
    }
    if (user.name === 'admin') {
      user.role = 'admin';
    }
    const algo = passwordAlgorithm(user);
    if (!user.passwordHash || (algo === 'sha256' && !user.passwordSalt)) {
      const defaultPassword = DEFAULT_PASSWORDS[user.name] || USER_RESET_PASSWORD;
      const passwordRecord = makePasswordRecord(defaultPassword);
      applyPasswordRecord(user, passwordRecord);
    } else if (!user.passwordAlgo) {
      user.passwordAlgo = algo;
    }
  }

  for (const listing of normalized.listings) {
    if (!Array.isArray(listing.comments)) {
      listing.comments = [];
    }
    if (!Array.isArray(listing.reviewLog)) {
      listing.reviewLog = [];
    }
    if (!Array.isArray(listing.favoritesBy)) {
      listing.favoritesBy = [];
    }
    listing.eventDates = normalizeEventDates(listing.eventDates, listing.date);
  }

  normalized.liveOptions = normalized.liveOptions
    .map(normalizeLiveOption)
    .filter(Boolean);
  pruneExpiredLiveOptions(normalized);

  return normalized;
}

async function ensureStore() {
  if (pool) {
    if (!databaseReady) {
      databaseReady = (async () => {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS app_state (
            id integer PRIMARY KEY DEFAULT 1,
            data jsonb NOT NULL
          )
        `);
      })();
    }
    await databaseReady;
    const result = await pool.query('SELECT data FROM app_state WHERE id = 1');
    if (!result.rowCount) {
      const store = normalizeStore(seedStore());
      pruneExpiredListings(store);
      pruneExpiredSessions(store);
      await saveStore(store);
      return store;
    }
    const store = normalizeStore(result.rows[0].data || seedStore());
    const changed = [
      pruneExpiredListings(store),
      pruneExpiredLiveOptions(store),
      pruneExpiredSessions(store)
    ].some(Boolean);
    if (changed) {
      await saveStore(store);
    }
    return store;
  }

  await fsp.mkdir(dataDir, { recursive: true });
  try {
    const raw = await fsp.readFile(storeFile, 'utf8');
    const store = normalizeStore(JSON.parse(raw));
    const changed = [
      pruneExpiredListings(store),
      pruneExpiredLiveOptions(store),
      pruneExpiredSessions(store)
    ].some(Boolean);
    if (changed) {
      await saveStore(store);
    }
    return store;
  } catch (error) {
    const store = normalizeStore(seedStore());
    pruneExpiredListings(store);
    pruneExpiredLiveOptions(store);
    pruneExpiredSessions(store);
    await saveStore(store);
    return store;
  }
}

async function saveStore(store) {
  if (pool) {
    if (!databaseReady) {
      databaseReady = (async () => {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS app_state (
            id integer PRIMARY KEY DEFAULT 1,
            data jsonb NOT NULL
          )
        `);
      })();
    }
    await databaseReady;
    await pool.query(
      'INSERT INTO app_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
      [store]
    );
    return;
  }

  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(storeFile, JSON.stringify(store, null, 2), 'utf8');
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeEventDates(dates, fallbackDate) {
  const list = Array.isArray(dates) ? dates : [];
  const normalized = list
    .map(item => normalizeSpace(item))
    .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item));
  const fallback = normalizeSpace(fallbackDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fallback)) {
    normalized.push(fallback);
  }
  return [...new Set(normalized)].sort();
}

function normalizeLiveDates(option, fallbackDate) {
  const explicitDates = [
    ...(Array.isArray(option?.dates) ? option.dates : []),
    ...(Array.isArray(option?.eventDates) ? option.eventDates : [])
  ];
  return normalizeEventDates(explicitDates, fallbackDate);
}

function latestEventDate(dates, fallbackDate) {
  const normalized = normalizeEventDates(dates, fallbackDate);
  if (!normalized.length) return normalizeSpace(fallbackDate);
  return normalized[normalized.length - 1];
}

function isExpiredListing(listing) {
  const lastDate = latestEventDate(listing?.eventDates, listing?.date);
  return !!lastDate && lastDate < todayKey();
}

function pruneExpiredListings(store) {
  const listings = Array.isArray(store.listings) ? store.listings : [];
  const kept = listings.filter(item => !isExpiredListing(item));
  if (kept.length === listings.length) return false;
  store.listings = kept;
  return true;
}

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeText(value, options = {}) {
  const maxLength = Number.isFinite(Number(options.maxLength)) ? Number(options.maxLength) : 200;
  const preserveNewlines = options.preserveNewlines === true;
  let text = String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  text = text.replace(/\r\n?/g, '\n').trim();
  if (!preserveNewlines) {
    text = normalizeSpace(text);
  }
  if (!text) return '';
  if (text.length > maxLength) {
    text = text.slice(0, maxLength);
  }
  return escapeHtml(text);
}

function normalizeFranchise(value) {
  const key = normalizeSpace(value).toLowerCase();
  return FRANCHISE_LABELS[key] ? key : 'other';
}

function normalizeKind(value) {
  const key = normalizeSpace(value).toLowerCase();
  return KIND_LABELS[key] ? key : 'transfer';
}

function normalizeAccent(accent, franchise) {
  const normalized = normalizeSpace(accent);
  if (/^#[0-9a-f]{6}$/i.test(normalized) || /^#[0-9a-f]{3}$/i.test(normalized)) {
    return normalized;
  }
  return ACCENT_BY_FRANCHISE[franchise] || ACCENT_BY_FRANCHISE.other;
}

function sanitizeTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : [])
    .map(item => sanitizeText(item, { maxLength: 24 }))
    .filter(Boolean))]
    .slice(0, 8);
}

function sanitizeComment(comment) {
  return {
    ...comment,
    text: sanitizeText(comment?.text, { maxLength: 300, preserveNewlines: true }),
    authorName: sanitizeText(comment?.authorName, { maxLength: 40 }) || '匿名用户'
  };
}

function sanitizeListingForResponse(listing) {
  const comments = Array.isArray(listing?.comments) ? listing.comments.map(sanitizeComment) : [];
  return {
    ...listing,
    title: sanitizeText(listing?.title, { maxLength: 80 }),
    subtitle: sanitizeText(listing?.subtitle, { maxLength: 120 }),
    city: sanitizeText(listing?.city, { maxLength: 40 }),
    venue: sanitizeText(listing?.venue, { maxLength: 120 }),
    price: sanitizeText(listing?.price, { maxLength: 80 }),
    contact: sanitizeText(listing?.contact, { maxLength: 120 }),
    note: sanitizeText(listing?.note, { maxLength: 500, preserveNewlines: true }),
    franchiseLabel: sanitizeText(listing?.franchiseLabel, { maxLength: 24 }),
    kindLabel: sanitizeText(listing?.kindLabel, { maxLength: 24 }),
    ownerName: sanitizeText(listing?.ownerName, { maxLength: 40 }) || '匿名发布',
    tags: sanitizeTags(listing?.tags),
    comments
  };
}

function isAsciiCredential(value) {
  return /^[\x21-\x7E]+$/.test(String(value || ''));
}

function isSafeUsername(value) {
  return /^[A-Za-z0-9_-]{3,32}$/.test(String(value || ''));
}

function makeSha256PasswordRecord(password) {
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
  return { passwordAlgo: 'sha256', passwordSalt: salt, passwordHash: hash };
}

function makePasswordRecord(password) {
  return {
    passwordAlgo: 'bcrypt',
    passwordSalt: '',
    passwordHash: bcrypt.hashSync(password, bcryptRounds)
  };
}

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ''));
}

function passwordAlgorithm(user) {
  const explicit = String(user?.passwordAlgo || '').trim().toLowerCase();
  if (explicit) return explicit;
  return isBcryptHash(user?.passwordHash) ? 'bcrypt' : 'sha256';
}

function applyPasswordRecord(user, record) {
  user.passwordAlgo = record.passwordAlgo;
  user.passwordHash = record.passwordHash;
  if (record.passwordSalt) {
    user.passwordSalt = record.passwordSalt;
  } else {
    delete user.passwordSalt;
  }
}

function verifySha256Password(password, salt, expectedHash) {
  const actualHash = crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
  if (actualHash.length !== String(expectedHash || '').length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(actualHash, 'utf8'), Buffer.from(String(expectedHash || ''), 'utf8'));
  } catch (error) {
    return false;
  }
}

function verifyPasswordRecord(password, user) {
  const algo = passwordAlgorithm(user);
  if (algo === 'bcrypt') {
    try {
      return {
        valid: bcrypt.compareSync(password, String(user?.passwordHash || '')),
        needsUpgrade: false
      };
    } catch (error) {
      return { valid: false, needsUpgrade: false };
    }
  }

  const valid = verifySha256Password(password, user?.passwordSalt || '', user?.passwordHash || '');
  return { valid, needsUpgrade: valid };
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: sanitizeText(user.name, { maxLength: 40 }),
    role: user.role
  };
}

function activeSessionCountForUser(store, userId) {
  const id = String(userId || '');
  if (!id) return 0;
  const sessionTokens = new Set();
  const tokens = store.tokens && typeof store.tokens === 'object' ? store.tokens : {};
  for (const [token, value] of Object.entries(tokens)) {
    const recordUserId = typeof value === 'string' ? value : value?.userId;
    if (String(recordUserId || '') === id) sessionTokens.add(token);
  }
  for (const item of Array.isArray(store.sessions) ? store.sessions : []) {
    if (String(item?.userId || '') === id && item?.token) sessionTokens.add(item.token);
  }
  return sessionTokens.size;
}

function adminUserSummary(store, user) {
  const summary = publicUser(user);
  if (!summary) return null;
  return {
    ...summary,
    activeSessionCount: activeSessionCountForUser(store, user.id),
    passwordResetAt: user.passwordResetAt || null,
    passwordResetBy: user.passwordResetBy || null
  };
}

function toAbsoluteUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch (error) {
    return '';
  }
}

function cleanLabel(text, labels) {
  let output = String(text || '');
  for (const label of labels) {
    output = output.replace(new RegExp(label, 'gi'), ' ');
  }
  return normalizeSpace(output);
}

function dateFromParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function extractAllDates(text) {
  const dates = [];
  const source = String(text || '').replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  const tokenRegex = /(?:(20\d{2})\s*年)?\s*(?:(\d{1,2})\s*月)?\s*(\d{1,2})\s*日/g;

  let currentYear = null;
  let currentMonth = null;
  let match = tokenRegex.exec(source);

  while (match) {
    if (match[1]) currentYear = Number(match[1]);
    if (match[2]) currentMonth = Number(match[2]);

    const day = Number(match[3]);
    const year = Number.isFinite(currentYear) ? currentYear : null;
    const month = Number.isFinite(currentMonth) ? currentMonth : null;

    if (year && month && Number.isFinite(day)) {
      const formatted = dateFromParts(year, month, day);
      if (formatted) dates.push(formatted);
    }

    match = tokenRegex.exec(source);
  }

  if (!dates.length) {
    // Fallback parser for compact date text like "2026年9月19日(土)・20(日)・21(月)".
    const segments = source.split(/[・、,\/]/).map(item => normalizeSpace(item)).filter(Boolean);
    let fallbackYear = null;
    let fallbackMonth = null;
    for (const segment of segments) {
      const full = segment.match(/(20\d{2})\s*[年.\/-]\s*(\d{1,2})\s*[月.\/-]\s*(\d{1,2})(?:\s*日)?/);
      if (full) {
        fallbackYear = Number(full[1]);
        fallbackMonth = Number(full[2]);
        const formatted = dateFromParts(fallbackYear, fallbackMonth, full[3]);
        if (formatted) dates.push(formatted);
        continue;
      }

      const monthDay = segment.match(/(\d{1,2})\s*[月.\/-]\s*(\d{1,2})(?:\s*日)?/);
      if (monthDay && Number.isFinite(fallbackYear)) {
        fallbackMonth = Number(monthDay[1]);
        const formatted = dateFromParts(fallbackYear, fallbackMonth, monthDay[2]);
        if (formatted) dates.push(formatted);
        continue;
      }

      const dayOnly = segment.match(/(?:^|\D)(\d{1,2})(?:\s*日)?(?:\D|$)/);
      if (dayOnly && Number.isFinite(fallbackYear) && Number.isFinite(fallbackMonth)) {
        const formatted = dateFromParts(fallbackYear, fallbackMonth, dayOnly[1]);
        if (formatted) dates.push(formatted);
      }
    }
  }

  return [...new Set(dates)].sort();
}

function pickUpcomingDate(text) {
  const today = todayKey();
  const dates = extractAllDates(text);
  for (const date of dates) {
    if (date >= today) return date;
  }
  return '';
}

function buildLiveOptionId(franchise, date, url, title) {
  const raw = `${franchise}|${date}|${url}|${title}`;
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 18);
}

function guessCityFromVenue(venue) {
  const text = normalizeSpace(venue);
  if (!text) return '未填写 live 地点';
  const match = text.match(/(東京|大阪|名古屋|横浜|京都|福岡|札幌|千葉|埼玉|神奈川|沖縄|仙台|幕張|有明|台北|Seoul|Osaka|Tokyo|Yokohama|Nagoya)/i);
  if (match) return match[1];
  const token = text.split(/[、,・\s/]/).find(Boolean);
  return token || '未填写 live 地点';
}

function looksLikeDateText(value) {
  const text = normalizeSpace(value);
  if (!text) return false;
  return /\d{4}\s*年|\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}\/\d{1,2}/.test(text);
}

function isGenericOfficialLiveTag(tag) {
  const text = normalizeSpace(tag).toLowerCase();
  if (!text) return false;
  const compact = text
    .replace(/[／]/g, '/')
    .replace(/[\s·・._-]+/g, '')
    .replace(/\//g, '');
  return compact === '官方'
    || compact === 'ライブ'
    || compact === 'ライブイベント'
    || compact === 'live'
    || compact === 'event'
    || compact === 'liveevent';
}

function sanitizeOfficialLiveTag(tag) {
  const text = normalizeSpace(tag);
  if (!text) return '';
  return normalizeSpace(
    text
      .replace(/ライブ\s*[\/／]\s*イベント/ig, ' ')
      .replace(/live\s*[\/／]\s*event/ig, ' ')
      .replace(/live\s*[·・._-]?\s*event/ig, ' ')
      .replace(/ライブイベント/ig, ' ')
      .replace(/\b(?:official|live|event)\b/ig, ' ')
      .replace(/官方/ig, ' ')
      .replace(/ライブ/ig, ' ')
      .replace(/[\s·・._\-/]+/g, ' ')
  );
}

function normalizeLiveOption(option) {
  if (!option || typeof option !== 'object') return null;
  const franchise = normalizeSpace(option.franchise || '').toLowerCase();
  const title = normalizeSpace(option.title);
  const date = normalizeSpace(option.date);
  const venue = normalizeSpace(option.venue);
  const url = normalizeSpace(option.url);
  const isManual = normalizeSpace(option.source) === 'manual';
  if (!franchise || !title || !date || !venue) return null;
  if (!url && !isManual) return null;
  const dates = normalizeLiveDates(option, date);
  if (!dates.length) return null;
  const city = normalizeSpace(option.city) || guessCityFromVenue(venue);
  const tags = Array.isArray(option.tags)
    ? option.tags
      .map(item => sanitizeOfficialLiveTag(item))
      .filter(Boolean)
      .filter(item => !isGenericOfficialLiveTag(item))
      .slice(0, 8)
    : [];
  return {
    id: normalizeSpace(option.id) || buildLiveOptionId(franchise, date, url || `manual:${title}`, title),
    franchise,
    franchiseLabel: normalizeSpace(option.franchiseLabel),
    title,
    date: dates[0],
    dates,
    city,
    venue,
    tags,
    url,
    source: normalizeSpace(option.source || 'official')
  };
}

function buildLiveOptionLatestDateMap(liveOptions) {
  const latestMap = new Map();
  for (const rawItem of Array.isArray(liveOptions) ? liveOptions : []) {
    const item = normalizeLiveOption(rawItem);
    if (!item) continue;
    const key = `${item.franchise}|${item.title}|${item.venue}`;
    const latestDate = latestEventDate(item.dates, item.date);
    const existing = latestMap.get(key);
    if (!existing || String(latestDate) > String(existing)) {
      latestMap.set(key, latestDate);
    }
  }
  return latestMap;
}

function pruneExpiredLiveOptions(store) {
  const list = Array.isArray(store.liveOptions) ? store.liveOptions : [];
  const today = todayKey();
  const latestMap = buildLiveOptionLatestDateMap(list);
  const kept = list.filter(item => {
    const normalized = normalizeLiveOption(item);
    if (!normalized) return false;
    const key = `${normalized.franchise}|${normalized.title}|${normalized.venue}`;
    const latest = latestMap.get(key) || normalized.date;
    return latest >= today;
  });
  if (kept.length === list.length) return false;
  store.liveOptions = kept;
  return true;
}

function shouldRefreshLiveOptions(store, force) {
  if (force) return true;
  if (!store.liveOptionsUpdatedAt) return true;
  const last = Date.parse(store.liveOptionsUpdatedAt);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= LIVE_REFRESH_INTERVAL_MS;
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_FETCH_TIMEOUT_MS);
  const referer = (() => {
    try {
      const target = new URL(url);
      return `${target.origin}/`;
    } catch (error) {
      return 'https://www.lovelive-anime.jp/';
    }
  })();
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8,zh-CN;q=0.7',
        'Referer': referer
      }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function collectPageLinks($, currentUrl, pattern) {
  const links = new Set();
  $('a[href]').each((_, element) => {
    const href = normalizeSpace($(element).attr('href'));
    if (!href) return;
    const absolute = toAbsoluteUrl(currentUrl, href);
    if (absolute && pattern.test(absolute)) {
      links.add(absolute);
    }
  });
  return [...links];
}

function parseBangDreamPage($, pageUrl, source) {
  const options = [];
  const seen = new Set();
  $('a[href]').each((_, element) => {
    const href = normalizeSpace($(element).attr('href'));
    if (!href) return;
    const text = normalizeSpace($(element).text());
    if (!text.includes('開催日') || !text.includes('場所')) return;
    const titleRaw = normalizeSpace(text.split('開催日')[0]);
    const title = titleRaw.replace(/^(.*?)\s+\1$/, '$1').trim();
    const dateBlockMatch = text.match(/開催日\s*([\s\S]*?)\s*場所\s*/i);
    const dateText = normalizeSpace(dateBlockMatch?.[1] || text);
    const card = $(element).closest('article.p-live-event-list__item, article, li, div');
    const description = card.find('.p-live-event-list__item-description').first();
    let venueNodeText = '';
    description.find('h2').each((__, heading) => {
      if (venueNodeText) return;
      const label = normalizeSpace($(heading).text());
      if (/^場所$/i.test(label)) {
        venueNodeText = normalizeSpace($(heading).next('p').first().text());
      }
    });
    if (!venueNodeText) {
      venueNodeText = normalizeSpace(
        card.find('.p-live-event-list__item-place + p').first().text()
        || card.find('.p-live-event-list__item-description p').eq(1).text()
      );
    }
    const venueBlockMatch = text.match(/場所\s*([\s\S]*?)(?:\s*概要\s*|$)/i);
    const venueFromBlock = normalizeSpace(venueBlockMatch?.[1] || '');
    const venue = normalizeSpace(
      (venueNodeText && !looksLikeDateText(venueNodeText) ? venueNodeText : '')
      || (venueFromBlock && !looksLikeDateText(venueFromBlock) ? venueFromBlock : '')
      || '未公布场馆'
    );
    const dates = extractAllDates(dateText).filter(item => item >= todayKey());
    if (!dates.length || !title) return;
    const artistTags = card.find('.p-live-event-list__item-artist-item').map((__, node) => normalizeSpace($(node).text())).get().filter(Boolean);
    const url = toAbsoluteUrl(pageUrl, href);
    if (!url) return;
    for (const date of dates) {
      const uniqueKey = `${date}|${title}|${venue}`;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      options.push(normalizeLiveOption({
        franchise: source.franchise,
        franchiseLabel: source.franchiseLabel,
        title,
        date,
        city: guessCityFromVenue(venue),
        venue,
        tags: artistTags.slice(0, 8),
        url,
        source: source.startUrl
      }));
    }
  });
  return options.filter(Boolean);
}

function parseImasPage($, pageUrl, source) {
  const options = [];
  const seen = new Set();
  $('h3').each((_, heading) => {
    const title = normalizeSpace($(heading).text());
    if (!title || title.includes('LIVE・EVENT')) return;
    const card = $(heading).closest('article, section, li, div');
    const text = normalizeSpace(card.text());
    const dateMatch = text.match(/(?:日時|日程)\s*([\s\S]*?)(?:場所|会場)/i);
    const venueMatch = text.match(/(?:場所|会場)\s*([\s\S]*?)(?:詳細|チケット|お問い合わせ|$)/i);
    const date = pickUpcomingDate(dateMatch?.[1] || text);
    if (!date) return;
    const venue = normalizeSpace(venueMatch?.[1] || '未公布场馆');
    const linkElement = card.find('a[href*="/live_event/"]').first();
    const href = normalizeSpace(linkElement.attr('href') || '/live_event');
    const url = toAbsoluteUrl(pageUrl, href);
    if (!url) return;
    const uniqueKey = `${date}|${title}|${venue}`;
    if (seen.has(uniqueKey)) return;
    seen.add(uniqueKey);
    options.push(normalizeLiveOption({
      franchise: source.franchise,
      franchiseLabel: source.franchiseLabel,
      title,
      date,
      city: guessCityFromVenue(venue),
      venue,
      tags: ['官方', 'LIVE・EVENT'],
      url,
      source: source.startUrl
    }));
  });
  return options.filter(Boolean);
}

function parseLoveLiveHasunosoraPage($, pageUrl, source) {
  return parseLoveLiveCardPage($, pageUrl, source, {
    fallbackPath: '/hasunosora/live-event/',
    fixedTags: ['官方', '蓮ノ空', 'ライブ/イベント']
  });
}

function parseLoveLiveYuigaokaPage($, pageUrl, source) {
  return parseLoveLiveCardPage($, pageUrl, source, {
    fallbackPath: '/yuigaoka/live/',
    fixedTags: ['官方', 'Liella!', 'ライブ/イベント']
  });
}

function parseLoveLiveNijigasakiPage($, pageUrl, source) {
  return parseLoveLiveCardPage($, pageUrl, source, {
    fallbackPath: '/nijigasaki/live.php',
    fixedTags: ['官方', '虹ヶ咲学園', 'ライブ/イベント']
  });
}

function parseLoveLiveUranohoshiPage($, pageUrl, source) {
  return parseLoveLiveCardPage($, pageUrl, source, {
    fallbackPath: '/uranohoshi/live.php',
    fixedTags: ['官方', 'Aqours', 'ライブ/イベント']
  });
}

function buildLiveTitleMatchKey(title) {
  let text = normalizeSpace(title);
  if (!text) return '';
  // Normalize full-width/half-width differences when available.
  if (typeof text.normalize === 'function') {
    text = text.normalize('NFKC');
  }
  // Remove spaces and common punctuation to make cross-site title matching tolerant.
  return text
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[!！?？:：;；,，.。·・、~〜〜"'“”‘’`´^\-—―_()（）\[\]［］{}｛｝<>＜＞\/\\|]+/g, '');
}

async function parseLoveLiveBluebirdPage($, pageUrl, source) {
  const links = [];
  const seenLinks = new Set();
  const skipTitleSet = source && source.skipDetailTitleSet instanceof Set ? source.skipDetailTitleSet : new Set();
  const overlapTitleSet = source && source.overlapTitleSet instanceof Set ? source.overlapTitleSet : new Set();
  $('a[href]').each((_, node) => {
    const anchor = $(node);
    const href = normalizeSpace(anchor.attr('href'));
    if (!href || !/live_detail\.php/i.test(href)) return;
    const url = toAbsoluteUrl(pageUrl, href);
    if (!url || seenLinks.has(url)) return;
    const title = normalizeSpace(anchor.find('h2').first().text() || anchor.text());
    if (!title) return;
    seenLinks.add(url);
    links.push({ title, url });
  });

  const parsedOptions = [];
  const seen = new Set();
  for (const item of links.slice(0, LIVE_MAX_LOVELIVE_DETAIL_FETCH)) {
    const titleKey = buildLiveTitleMatchKey(item.title);
    if (titleKey && skipTitleSet.has(titleKey)) {
      overlapTitleSet.add(titleKey);
      continue;
    }
    try {
      const detailHtml = await fetchHtml(item.url);
      const detail$ = loadHtml(detailHtml);
      const textBlocks = detail$('[data-textbody]').map((_, node) => normalizeSpace(detail$(node).text())).get().filter(Boolean);
      const scheduleBlock = textBlocks.find(text => /日程|開催日時|会場|開催場所/.test(text));
      const detailText = normalizeSpace(scheduleBlock || textBlocks.join(' ') || detail$('main, article, body').text());
      if (!detailText) continue;
      const dates = extractAllDates(detailText).filter(date => date >= todayKey());
      if (!dates.length) continue;
      const venueMatch = detailText.match(/(?:【\s*会場\s*】|開催場所|会場|場所)\s*[:：]?\s*([\s\S]{2,160}?)(?:\s*(?:【|日程|日時|出演|チケット|料金|お問い合わせ|主催|$))/i);
      const venue = normalizeSpace(venueMatch?.[1] || '未公布场馆');
      const tags = ['官方', 'BlueBird', 'ライブ/イベント'];
      for (const date of dates) {
        const uniqueKey = `${date}|${item.title}|${venue}`;
        if (seen.has(uniqueKey)) continue;
        seen.add(uniqueKey);
        parsedOptions.push(normalizeLiveOption({
          franchise: source.franchise,
          franchiseLabel: source.franchiseLabel,
          title: item.title,
          date,
          city: guessCityFromVenue(venue),
          venue,
          tags,
          url: item.url,
          source: source.startUrl
        }));
      }
    } catch (error) {
      // Ignore single detail page failures so one bad page does not block all options.
    }
  }

  return parsedOptions.filter(Boolean);
}

function parseLoveLiveCardPage($, pageUrl, source, options = {}) {
  const fallbackPath = normalizeSpace(options.fallbackPath || '/');
  const fixedTags = Array.isArray(options.fixedTags) ? options.fixedTags.map(normalizeSpace).filter(Boolean) : [];
  const parsedOptions = [];
  const seen = new Set();
  $('li').each((_, node) => {
    const card = $(node);
    const title = normalizeSpace(card.find('.live_title p, .live_title').first().text());
    const dateText = normalizeSpace(card.find('.live_date').first().text());
    const venue = normalizeSpace(card.find('.live_place').first().text() || '未公布场馆');
    if (!title || !dateText) return;
    const anchor = card.find('a[href]').first();
    const href = normalizeSpace(anchor.attr('href'));
    const url = toAbsoluteUrl(pageUrl, href || fallbackPath);
    if (!url) return;
    const dates = extractAllDates(dateText).filter(item => item >= todayKey());
    if (!dates.length) return;
    const seriesTag = normalizeSpace(card.find('.live_ico .series').first().text());
    const baseTags = [...fixedTags];
    if (seriesTag) baseTags.push(seriesTag);
    const tags = [...new Set(baseTags)].slice(0, 8);
    for (const date of dates) {
      const uniqueKey = `${date}|${title}|${venue}`;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      parsedOptions.push(normalizeLiveOption({
        franchise: source.franchise,
        franchiseLabel: source.franchiseLabel,
        title,
        date,
        city: guessCityFromVenue(venue),
        venue,
        tags,
        url,
        source: source.startUrl
      }));
    }
  });
  return parsedOptions.filter(Boolean);
}

function buildLiveMergeKey(item) {
  const normalized = normalizeLiveOption(item);
  if (!normalized) return '';
  const title = normalizeSpace(normalized.title).toLowerCase();
  const venue = normalizeSpace(normalized.venue).toLowerCase();
  return `${normalized.franchise}|${normalized.date}|${title}|${venue}`;
}

function buildLiveRefreshKey(item) {
  const normalized = normalizeLiveOption(item);
  if (!normalized) return '';
  if (normalized.source === 'manual') return `manual:${normalized.id}`;
  const titleKey = buildLiveTitleMatchKey(normalized.title);
  const url = normalizeSpace(normalized.url);
  if (normalized.franchise && url && titleKey) {
    return `official:${normalized.franchise}|${url}|${titleKey}`;
  }
  return `official:${normalized.id}`;
}

function mergeLiveOption(existing, incoming) {
  if (!existing) return incoming;
  const incomingTags = Array.isArray(incoming.tags) ? incoming.tags.map(normalizeSpace).filter(Boolean) : [];
  const existingTags = Array.isArray(existing.tags) ? existing.tags.map(normalizeSpace).filter(Boolean) : [];
  const preferredTags = incomingTags.length ? incomingTags : existingTags;
  const dates = normalizeEventDates([
    ...(Array.isArray(existing.dates) ? existing.dates : []),
    ...(Array.isArray(incoming.dates) ? incoming.dates : [])
  ], incoming.date || existing.date);
  return {
    ...existing,
    ...incoming,
    date: dates[0] || incoming.date || existing.date,
    dates,
    tags: preferredTags.slice(0, 8)
  };
}

function appendTag(list, tag) {
  const current = Array.isArray(list) ? list : [];
  const normalizedTag = normalizeSpace(tag);
  if (!normalizedTag) return current.slice(0, 8);
  const merged = [...new Set([...current, normalizedTag].map(normalizeSpace).filter(Boolean))];
  return merged.slice(0, 8);
}

function buildBangDreamPageUrl(startUrl, pageNumber) {
  const base = String(startUrl || '').replace(/\/+$/, '');
  if (pageNumber <= 1) return `${base}/`;
  return `${base}/page/${pageNumber}/`;
}

async function crawlBangDreamUntilPast(source) {
  const collected = [];
  for (let pageNumber = 1; pageNumber <= LIVE_MAX_PAGES_PER_SOURCE; pageNumber += 1) {
    const pageUrl = buildBangDreamPageUrl(source.startUrl, pageNumber);
    try {
      const html = await fetchHtml(pageUrl);
      const $ = loadHtml(html);
      const parsed = await source.parser($, pageUrl, source);
      const pageItems = Array.isArray(parsed) ? parsed.filter(Boolean) : [];
      if (!pageItems.length) {
        // Stop as soon as this page no longer has events on/after today.
        break;
      }
      collected.push(...pageItems);
    } catch (error) {
      console.error(`[live-crawl] ${source.franchise} ${pageUrl}`, error.message || error);
      break;
    }
  }
  return collected;
}

async function crawlSource(source) {
  if (typeof source.crawler === 'function') {
    const items = await source.crawler(source);
    const unique = new Map();
    for (const item of items || []) {
      const normalized = normalizeLiveOption(item);
      if (!normalized) continue;
      const key = `${normalized.franchise}|${normalized.date}|${normalized.title}|${normalized.venue}`;
      if (!unique.has(key)) {
        unique.set(key, normalized);
      }
    }
    return [...unique.values()]
      .filter(item => item.date >= todayKey())
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.title).localeCompare(String(b.title)));
  }

  const queue = [source.startUrl];
  const visited = new Set();
  const collected = [];

  while (queue.length && visited.size < LIVE_MAX_PAGES_PER_SOURCE) {
    const currentUrl = queue.shift();
    if (!currentUrl || visited.has(currentUrl)) continue;
    visited.add(currentUrl);
    try {
      const html = await fetchHtml(currentUrl);
      const $ = loadHtml(html);
      const parsed = await source.parser($, currentUrl, source);
      if (Array.isArray(parsed)) {
        collected.push(...parsed.filter(Boolean));
      }
      const pageLinks = collectPageLinks($, currentUrl, source.pagePattern);
      for (const nextUrl of pageLinks) {
        if (!visited.has(nextUrl) && !queue.includes(nextUrl)) {
          queue.push(nextUrl);
        }
      }
    } catch (error) {
      console.error(`[live-crawl] ${source.franchise} ${currentUrl}`, error.message || error);
    }
  }

  const unique = new Map();
  for (const item of collected) {
    const normalized = normalizeLiveOption(item);
    if (!normalized) continue;
    const key = `${normalized.franchise}|${normalized.date}|${normalized.title}|${normalized.venue}`;
    if (!unique.has(key)) {
      unique.set(key, normalized);
    }
  }
  return [...unique.values()]
    .filter(item => item.date >= todayKey())
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.title).localeCompare(String(b.title)));
}

function buildLiveTitleSet(items, franchise) {
  const titleSet = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const normalized = normalizeLiveOption(item);
    if (!normalized) continue;
    if (franchise && normalized.franchise !== franchise) continue;
    const key = buildLiveTitleMatchKey(normalized.title);
    if (key) titleSet.add(key);
  }
  return titleSet;
}

async function refreshLiveOptions(store, options = {}) {
  const force = options.force === true;
  if (!shouldRefreshLiveOptions(store, force)) {
    return { refreshed: false, liveOptions: store.liveOptions || [] };
  }
  if (liveRefreshPromise) {
    await liveRefreshPromise;
    return { refreshed: false, liveOptions: store.liveOptions || [] };
  }

  liveRefreshPromise = (async () => {
    const bluebirdSourceIndex = LIVE_SOURCES.findIndex(source => String(source.startUrl || '').includes('/lovehigh/live/'));
    const baseSources = bluebirdSourceIndex >= 0
      ? LIVE_SOURCES.filter((_, index) => index !== bluebirdSourceIndex)
      : LIVE_SOURCES;

    const baseResults = await Promise.all(baseSources.map(source => crawlSource(source)));
    const merged = baseResults.flat().map(normalizeLiveOption).filter(Boolean);

    if (bluebirdSourceIndex >= 0) {
      const bluebirdSource = LIVE_SOURCES[bluebirdSourceIndex];
      const skipDetailTitleSet = buildLiveTitleSet(merged, 'lovelive');
      const overlapTitleSet = new Set();
      const bluebirdItems = await crawlSource({
        ...bluebirdSource,
        skipDetailTitleSet,
        overlapTitleSet
      });
      merged.push(...bluebirdItems.map(normalizeLiveOption).filter(Boolean));

      if (overlapTitleSet.size) {
        for (const item of merged) {
          if (!item || item.franchise !== 'lovelive') continue;
          const titleKey = buildLiveTitleMatchKey(item.title);
          if (!titleKey || !overlapTitleSet.has(titleKey)) continue;
          item.tags = appendTag(item.tags, 'BlueBird');
        }
      }
    }

    const unique = new Map();
    for (const existingItem of (store.liveOptions || []).map(normalizeLiveOption).filter(Boolean)) {
      const key = buildLiveRefreshKey(existingItem) || buildLiveMergeKey(existingItem) || existingItem.id;
      const previous = unique.get(key);
      unique.set(key, mergeLiveOption(previous, existingItem));
    }
    for (const item of merged) {
      const key = buildLiveRefreshKey(item) || buildLiveMergeKey(item) || item.id;
      const previous = unique.get(key);
      unique.set(key, mergeLiveOption(previous, item));
    }
    const liveOptions = [...unique.values()]
      .filter(item => latestEventDate(item.dates, item.date) >= todayKey())
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.title).localeCompare(String(b.title)));
    store.liveOptions = liveOptions;
    store.liveOptionsUpdatedAt = new Date().toISOString();
    await saveStore(store);
  })();

  try {
    await liveRefreshPromise;
  } finally {
    liveRefreshPromise = null;
  }

  return { refreshed: true, liveOptions: store.liveOptions || [] };
}

function requireValidListingDate(dateValue) {
  const listingDate = latestEventDate([], dateValue);
  return !!listingDate && listingDate >= todayKey();
}

function parseJson(body) {
  try {
    return body ? JSON.parse(body) : {};
  } catch (error) {
    return null;
  }
}

function normalizeOrigin(origin) {
  try {
    return new URL(origin).origin;
  } catch (error) {
    return '';
  }
}

function isAllowedCorsOrigin(origin) {
  if (origin === 'null') {
    return !isProduction;
  }
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (configuredAllowedOrigins.includes(normalized)) return true;
  if (defaultAllowedOrigins.includes(normalized)) return true;
  return !isProduction && localOriginPattern.test(normalized);
}

function buildCorsHeaders(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return {};
  if (!isAllowedCorsOrigin(origin)) {
    return { Vary: 'Origin' };
  }
  return {
    'Access-Control-Allow-Origin': origin === 'null' ? 'null' : normalizeOrigin(origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    Vary: 'Origin'
  };
}

function responseHeaders(res, headers = {}, includeCors = false) {
  return {
    ...buildSecurityHeaders(res.__cspNonce || ''),
    ...(includeCors ? (res.__corsHeaders || {}) : {}),
    ...headers
  };
}

function createCspNonce() {
  return crypto.randomBytes(16).toString('base64url');
}

function addCspNonceToHtml(html, nonce) {
  return String(html || '')
    .replace(/<style\b(?![^>]*\bnonce=)([^>]*)>/gi, (_match, attrs) => `<style nonce="${nonce}"${attrs}>`)
    .replace(/<script\b(?![^>]*\bnonce=)([^>]*)>/gi, (_match, attrs) => `<script nonce="${nonce}"${attrs}>`);
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, responseHeaders(res, {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders
  }, true));
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, content, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, responseHeaders(res, {
    'Content-Type': contentType
  }, true));
  res.end(content);
}

function getToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return '';
}

function sessionTimestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildSessionRecord(userId, token = crypto.randomBytes(16).toString('hex'), now = Date.now()) {
  return {
    token,
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + sessionTtlMs).toISOString()
  };
}

function removeSession(store, token) {
  if (!token) return false;
  let changed = false;
  if (store.tokens && Object.prototype.hasOwnProperty.call(store.tokens, token)) {
    delete store.tokens[token];
    changed = true;
  }
  const before = Array.isArray(store.sessions) ? store.sessions.length : 0;
  store.sessions = (Array.isArray(store.sessions) ? store.sessions : []).filter(item => item?.token !== token);
  return changed || store.sessions.length !== before;
}

function removeSessionsForUser(store, userId, keepToken = '') {
  const id = String(userId || '');
  if (!id) return 0;
  const tokensToRemove = new Set();
  const tokens = store.tokens && typeof store.tokens === 'object' ? store.tokens : {};
  for (const [token, value] of Object.entries(tokens)) {
    const recordUserId = typeof value === 'string' ? value : value?.userId;
    if (String(recordUserId || '') === id) tokensToRemove.add(token);
  }
  for (const item of Array.isArray(store.sessions) ? store.sessions : []) {
    if (String(item?.userId || '') === id && item?.token) tokensToRemove.add(item.token);
  }
  if (keepToken) tokensToRemove.delete(keepToken);

  let removed = 0;
  for (const token of tokensToRemove) {
    if (removeSession(store, token)) removed += 1;
  }
  return removed;
}

function normalizeSessionToken(store, token) {
  const tokenValue = store.tokens?.[token];
  const sessions = Array.isArray(store.sessions) ? store.sessions : [];
  const existingSession = sessions.find(item => item?.token === token) || {};
  let changed = false;
  let userId = '';
  let createdAt = '';
  let expiresAt = '';

  if (typeof tokenValue === 'string') {
    userId = tokenValue;
    changed = true;
  } else if (tokenValue && typeof tokenValue === 'object') {
    userId = tokenValue.userId || '';
    createdAt = tokenValue.createdAt || '';
    expiresAt = tokenValue.expiresAt || '';
  }

  userId = userId || existingSession.userId || '';
  createdAt = createdAt || existingSession.createdAt || '';
  expiresAt = expiresAt || existingSession.expiresAt || '';
  if (!userId) {
    changed = removeSession(store, token) || changed;
    return { record: null, changed };
  }

  const now = Date.now();
  const createdMs = createdAt && createdAt !== 'now' ? sessionTimestamp(createdAt) : 0;
  const normalizedCreatedAt = createdMs > 0 ? new Date(createdMs).toISOString() : new Date(now).toISOString();
  const expiresMs = expiresAt && expiresAt !== 'now' ? sessionTimestamp(expiresAt) : 0;
  const normalizedExpiresAt = expiresMs > 0
    ? new Date(expiresMs).toISOString()
    : new Date((createdMs > 0 ? createdMs : now) + sessionTtlMs).toISOString();
  const record = { token, userId, createdAt: normalizedCreatedAt, expiresAt: normalizedExpiresAt };

  const currentTokenValue = store.tokens?.[token];
  if (typeof currentTokenValue !== 'object'
    || currentTokenValue.userId !== record.userId
    || currentTokenValue.createdAt !== record.createdAt
    || currentTokenValue.expiresAt !== record.expiresAt) {
    store.tokens[token] = {
      userId: record.userId,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt
    };
    changed = true;
  }

  const sessionIndex = sessions.findIndex(item => item?.token === token);
  if (sessionIndex >= 0) {
    const current = sessions[sessionIndex];
    if (current.userId !== record.userId || current.createdAt !== record.createdAt || current.expiresAt !== record.expiresAt) {
      sessions[sessionIndex] = record;
      changed = true;
    }
  } else {
    sessions.push(record);
    changed = true;
  }
  store.sessions = sessions;
  return { record, changed };
}

function isSessionExpired(record) {
  const expiresMs = sessionTimestamp(record?.expiresAt);
  return expiresMs > 0 && expiresMs <= Date.now();
}

function pruneExpiredSessions(store) {
  let changed = false;
  store.tokens = store.tokens && typeof store.tokens === 'object' ? store.tokens : {};
  store.sessions = Array.isArray(store.sessions) ? store.sessions : [];
  for (const token of Object.keys(store.tokens)) {
    const result = normalizeSessionToken(store, token);
    changed = result.changed || changed;
    if (!result.record || isSessionExpired(result.record)) {
      changed = removeSession(store, token) || changed;
      continue;
    }
    const hasUser = store.users.some(user => user.id === result.record.userId);
    if (!hasUser) {
      changed = removeSession(store, token) || changed;
    }
  }

  const before = store.sessions.length;
  store.sessions = store.sessions.filter(item => item?.token && store.tokens[item.token]);
  return changed || store.sessions.length !== before;
}

function createSession(store, userId) {
  const record = buildSessionRecord(userId);
  store.tokens[record.token] = {
    userId: record.userId,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt
  };
  store.sessions = (Array.isArray(store.sessions) ? store.sessions : []).filter(item => item?.token !== record.token);
  store.sessions.push(record);
  return record;
}

function getCurrentSession(store, req) {
  const token = getToken(req);
  if (!token) return { user: null, token: '', expiresAt: null, changed: false, expired: false };
  const result = normalizeSessionToken(store, token);
  if (!result.record) {
    return { user: null, token, expiresAt: null, changed: result.changed, expired: false };
  }
  if (isSessionExpired(result.record)) {
    const changed = removeSession(store, token) || result.changed;
    return { user: null, token, expiresAt: null, changed, expired: true };
  }
  const user = store.users.find(item => item.id === result.record.userId) || null;
  if (!user) {
    const changed = removeSession(store, token) || result.changed;
    return { user: null, token, expiresAt: null, changed, expired: false };
  }
  return { user, token, expiresAt: result.record.expiresAt, changed: result.changed, expired: false };
}

function visibleListingFor(user, listing) {
  if (!user) return listing.status === 'approved';
  if (user.role === 'admin') return true;
  return listing.status === 'approved' || listing.ownerId === user.id;
}

function visibleNotificationsFor(user, notifications) {
  return notifications.filter(item => {
    if (item.audience === 'all') return true;
    if (!user) return false;
    if (item.audience === 'admin') return user.role === 'admin';
    if (item.targetUserId) return item.targetUserId === user.id;
    return false;
  });
}

function enrichListing(listing, user) {
  const safeListing = sanitizeListingForResponse(listing);
  const favoriteCount = listing.favoritesBy ? listing.favoritesBy.length : 0;
  const favorited = !!(user && listing.favoritesBy && listing.favoritesBy.includes(user.id));
  const comments = Array.isArray(safeListing.comments) ? safeListing.comments : [];
  return {
    ...safeListing,
    favoriteCount,
    favorited,
    visibleToMe: visibleListingFor(user, listing),
    quantity: Number(listing.quantity || 1) || 1,
    canSerial: !!listing.canSerial,
    commentCount: comments.length
  };
}

function isOwnerOrAdmin(user, listing) {
  return !!user && (user.role === 'admin' || listing.ownerId === user.id);
}

function notificationTimestamp(value) {
  if (!value || value === 'now') return Date.now();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function notificationDedupeKey(notification) {
  return [
    notification?.audience || '',
    notification?.createdByRole || '',
    notification?.createdById || '',
    notification?.type || '',
    notification?.targetUserId || '',
    notification?.listingId || '',
    notification?.text || ''
  ].join('\u001f');
}

function addNotification(store, payload) {
  const notification = {
    ...payload,
    at: new Date().toISOString(),
    text: sanitizeText(payload?.text, { maxLength: 300, preserveNewlines: true })
  };
  const dedupeKey = notificationDedupeKey(notification);
  const now = notificationTimestamp(notification.at);
  const duplicate = notificationDedupWindowMs > 0
    ? store.notifications.find(item => notificationDedupeKey(item) === dedupeKey
      && Math.abs(now - notificationTimestamp(item.at)) <= notificationDedupWindowMs)
    : null;
  if (duplicate) return duplicate;

  notification.id = store.nextNotificationId++;
  store.notifications.unshift(notification);
  store.notifications = store.notifications.slice(0, 50);
  return notification;
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res, store, url) {
  const session = getCurrentSession(store, req);
  if (session.changed) {
    await saveStore(store);
  }
  const user = session.user;
  const pathName = url.pathname;

  if (req.method === 'GET' && pathName === '/api/live-options') {
    const forceRefresh = url.searchParams.get('refresh') === '1';
    const franchise = normalizeSpace(url.searchParams.get('franchise') || '').toLowerCase();
    await refreshLiveOptions(store, { force: forceRefresh });
    pruneExpiredLiveOptions(store);
    const latestMap = buildLiveOptionLatestDateMap(store.liveOptions || []);
    const options = (store.liveOptions || [])
      .map(normalizeLiveOption)
      .filter(Boolean)
      .filter(item => {
        const key = `${item.franchise}|${item.title}|${item.venue}`;
        const latest = latestMap.get(key) || latestEventDate(item.dates, item.date);
        return latest >= todayKey();
      })
      .filter(item => !franchise || item.franchise === franchise)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.title).localeCompare(String(b.title)));
    return sendJson(res, 200, {
      liveOptions: options,
      updatedAt: store.liveOptionsUpdatedAt || null
    });
  }

  if (req.method === 'POST' && pathName === '/api/live-options') {
    if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'admin only' });
    const body = parseJson(await readBody(req));
    if (!body) return sendJson(res, 400, { error: 'invalid json' });
    const option = normalizeLiveOption({ ...body, source: 'manual' });
    if (!option) return sendJson(res, 400, { error: 'franchise, title, date and venue are required' });
    store.liveOptions = store.liveOptions.filter(item => {
      const n = normalizeLiveOption(item);
      return !n || n.id !== option.id;
    });
    store.liveOptions.unshift({ ...option, source: 'manual' });
    await saveStore(store);
    return sendJson(res, 201, { option });
  }

  if (req.method === 'PUT' && pathName.startsWith('/api/live-options/') && pathName.length > '/api/live-options/'.length) {
    if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'admin only' });
    const id = decodeURIComponent(String(pathName.split('/').pop() || ''));
    const body = parseJson(await readBody(req));
    if (!body) return sendJson(res, 400, { error: 'invalid json' });
    const targetIndex = store.liveOptions.findIndex(item => {
      const n = normalizeLiveOption(item);
      return n && n.id === id;
    });
    if (targetIndex < 0) return sendJson(res, 404, { error: 'not found' });
    const existing = normalizeLiveOption(store.liveOptions[targetIndex]);
    if (!existing) return sendJson(res, 400, { error: 'invalid existing option' });
    const option = normalizeLiveOption({ ...existing, ...body, id, source: existing.source });
    if (!option) return sendJson(res, 400, { error: 'franchise, title, date and venue are required' });
    store.liveOptions[targetIndex] = { ...option, source: existing.source };
    await saveStore(store);
    return sendJson(res, 200, { option });
  }

  if (req.method === 'DELETE' && pathName.startsWith('/api/live-options/') && pathName.length > '/api/live-options/'.length) {
    if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'admin only' });
    const id = decodeURIComponent(String(pathName.split('/').pop() || ''));
    const before = store.liveOptions.length;
    store.liveOptions = store.liveOptions.filter(item => {
      const n = normalizeLiveOption(item);
      return !n || n.id !== id;
    });
    if (store.liveOptions.length === before) return sendJson(res, 404, { error: 'not found' });
    await saveStore(store);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathName === '/api/session') {
    return sendJson(res, 200, {
      user: publicUser(user),
      expiresAt: user ? session.expiresAt : null,
      tokenExpired: session.expired
    });
  }

  if (req.method === 'GET' && pathName === '/api/admin/users') {
    if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'admin only' });
    const users = store.users
      .map(item => adminUserSummary(store, item))
      .filter(Boolean)
      .sort((a, b) => (a.role === 'admin' ? 0 : 1) - (b.role === 'admin' ? 0 : 1)
        || String(a.name).localeCompare(String(b.name)));
    return sendJson(res, 200, { users });
  }

  if (req.method === 'POST' && pathName.startsWith('/api/admin/users/') && pathName.endsWith('/reset-password')) {
    if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'admin only' });
    const userId = decodeURIComponent(pathName.slice('/api/admin/users/'.length, -'/reset-password'.length));
    const targetUser = store.users.find(item => String(item.id) === userId);
    if (!targetUser) return sendJson(res, 404, { error: 'user not found' });

    applyPasswordRecord(targetUser, makePasswordRecord(USER_RESET_PASSWORD));
    targetUser.passwordResetAt = new Date().toISOString();
    targetUser.passwordResetBy = user.id;
    const sessionsRevoked = removeSessionsForUser(store, targetUser.id, targetUser.id === user.id ? session.token : '');
    await saveStore(store);
    return sendJson(res, 200, {
      ok: true,
      user: adminUserSummary(store, targetUser),
      sessionsRevoked
    });
  }

  if (req.method === 'POST' && pathName === '/api/session/register') {
    const body = parseJson(await readBody(req));
    if (!body) {
      return sendJson(res, 400, { error: 'invalid json' });
    }
    const username = String(body.username || body.nickname || '').trim();
    const password = String(body.password || '').trim();
    if (!username || !password) {
      return sendJson(res, 400, { error: 'username and password are required' });
    }
    if (!isSafeUsername(username)) {
      return sendJson(res, 400, { error: 'username must be 3-32 chars and only contain letters, numbers, _ or -' });
    }
    if (!isAsciiCredential(password)) {
      return sendJson(res, 400, { error: 'password can only contain english letters, numbers, and symbols' });
    }
    if (password.length < 6) {
      return sendJson(res, 400, { error: 'password must be at least 6 characters' });
    }
    const exists = store.users.some(item => item.name === username);
    if (exists) {
      return sendJson(res, 409, { error: 'username already exists' });
    }

    const createdUser = {
      id: `u${store.nextUserId++}`,
      name: username,
      role: 'member'
    };
    const passwordRecord = makePasswordRecord(password);
    applyPasswordRecord(createdUser, passwordRecord);
    store.users.push(createdUser);

    const sessionRecord = createSession(store, createdUser.id);
    await saveStore(store);
    return sendJson(res, 201, { token: sessionRecord.token, expiresAt: sessionRecord.expiresAt, user: publicUser(createdUser) });
  }

  if (req.method === 'POST' && pathName === '/api/session/login') {
    const body = parseJson(await readBody(req));
    const password = String(body?.password || '').trim();
    const nickname = String(body?.username || body?.nickname || body?.name || '').trim();
    if (!body || !nickname || !password) {
      return sendJson(res, 400, { error: 'username and password are required' });
    }
    const existing = store.users.find(item => item.name === nickname);
    if (!existing) {
      return sendJson(res, 401, { error: 'invalid username or password' });
    }
    const verification = verifyPasswordRecord(password, existing);
    if (!verification.valid) {
      return sendJson(res, 401, { error: 'invalid username or password' });
    }
    if (verification.needsUpgrade) {
      applyPasswordRecord(existing, makePasswordRecord(password));
    }
    const sessionRecord = createSession(store, existing.id);
    await saveStore(store);
    return sendJson(res, 200, { token: sessionRecord.token, expiresAt: sessionRecord.expiresAt, user: publicUser(existing) });
  }

  if (req.method === 'POST' && pathName === '/api/session/logout') {
    const token = getToken(req);
    if (removeSession(store, token)) {
      await saveStore(store);
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathName === '/api/session/password') {
    if (!user) {
      return sendJson(res, 401, { error: 'login required' });
    }
    const body = parseJson(await readBody(req));
    if (!body) {
      return sendJson(res, 400, { error: 'invalid json' });
    }
    const oldPassword = String(body.oldPassword || body.currentPassword || '').trim();
    const newPassword = String(body.newPassword || '').trim();
    if (!oldPassword || !newPassword) {
      return sendJson(res, 400, { error: 'oldPassword and newPassword are required' });
    }
    if (!isAsciiCredential(newPassword)) {
      return sendJson(res, 400, { error: 'new password can only contain english letters, numbers, and symbols' });
    }
    if (newPassword.length < 6) {
      return sendJson(res, 400, { error: 'new password must be at least 6 characters' });
    }
    if (oldPassword === newPassword) {
      return sendJson(res, 400, { error: 'new password must be different from old password' });
    }

    const targetUser = store.users.find(item => item.id === user.id);
    if (!targetUser) {
      return sendJson(res, 401, { error: 'login required' });
    }
    const oldPasswordVerification = verifyPasswordRecord(oldPassword, targetUser);
    if (!oldPasswordVerification.valid) {
      return sendJson(res, 401, { error: 'invalid old password' });
    }

    const passwordRecord = makePasswordRecord(newPassword);
    applyPasswordRecord(targetUser, passwordRecord);
    await saveStore(store);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathName === '/api/listings') {
    const visible = store.listings
      .filter(listing => visibleListingFor(user, listing))
      .map(listing => enrichListing(listing, user));
    return sendJson(res, 200, { listings: visible });
  }

  if (req.method === 'GET' && pathName === '/api/notifications') {
    const notifications = visibleNotificationsFor(user, store.notifications)
      .slice(0, 12)
      .map(item => ({
        ...item,
        text: sanitizeText(item?.text, { maxLength: 300, preserveNewlines: true })
      }));
    return sendJson(res, 200, { notifications });
  }

  if (req.method === 'POST' && pathName === '/api/feedback') {
    if (!user) {
      return sendJson(res, 401, { error: 'login required' });
    }
    const body = parseJson(await readBody(req));
    if (!body) return sendJson(res, 400, { error: 'invalid json' });
    const text = sanitizeText(body.text, { maxLength: 300, preserveNewlines: true });
    if (!text) return sendJson(res, 400, { error: 'text required' });

    addNotification(store, {
      audience: 'admin',
      createdByRole: user.role || 'member',
      createdById: user.id,
      text: `用户反馈（${sanitizeText(user.name, { maxLength: 40 }) || '匿名用户'}）：${text}`,
      type: 'feedback'
    });
    await saveStore(store);
    return sendJson(res, 201, { ok: true });
  }

  if (req.method === 'POST' && pathName === '/api/notifications') {
    if (!user || user.role !== 'admin') {
      return sendJson(res, 403, { error: 'admin only' });
    }
    const body = parseJson(await readBody(req));
    if (!body) return sendJson(res, 400, { error: 'invalid json' });
    const text = sanitizeText(body.text, { maxLength: 300, preserveNewlines: true });
    if (!text) return sendJson(res, 400, { error: 'text required' });
    const notification = addNotification(store, {
      audience: body.audience || 'all',
      createdByRole: 'admin',
      createdById: user.id,
      text,
      type: body.type || 'system',
      ...(body.targetUserId ? { targetUserId: body.targetUserId } : {})
    });
    await saveStore(store);
    return sendJson(res, 201, { notification });
  }

  if (req.method === 'DELETE' && pathName.startsWith('/api/notifications/')) {
    if (!user || user.role !== 'admin') {
      return sendJson(res, 403, { error: 'admin only' });
    }
    const id = String(pathName.split('/').pop() || '');
    const index = store.notifications.findIndex(item => String(item.id) === id);
    if (index < 0) {
      return sendJson(res, 404, { error: 'not found' });
    }
    store.notifications.splice(index, 1);
    await saveStore(store);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathName.startsWith('/api/listings/') && !pathName.endsWith('/comments')) {
    const id = Number(pathName.split('/').pop());
    const listing = store.listings.find(item => item.id === id);
    if (!listing || !visibleListingFor(user, listing)) {
      return sendJson(res, 404, { error: 'not found' });
    }
    return sendJson(res, 200, { listing: enrichListing(listing, user) });
  }

  if (req.method === 'GET' && pathName.startsWith('/api/listings/') && pathName.endsWith('/comments')) {
    const id = Number(pathName.split('/').slice(-2, -1)[0]);
    const listing = store.listings.find(item => item.id === id);
    if (!listing || !visibleListingFor(user, listing)) {
      return sendJson(res, 404, { error: 'not found' });
    }
    const comments = Array.isArray(listing.comments) ? listing.comments.map(sanitizeComment) : [];
    return sendJson(res, 200, { comments });
  }

  if (req.method === 'POST' && pathName === '/api/listings') {
    if (!user) return sendJson(res, 401, { error: 'login required' });
    const body = parseJson(await readBody(req));
    if (!body) return sendJson(res, 400, { error: 'invalid json' });
    const eventDates = normalizeEventDates(body.eventDates, body.date);
    if (!requireValidListingDate(latestEventDate(eventDates, body.date))) {
      return sendJson(res, 400, { error: 'listing date cannot be before today' });
    }

    const franchise = normalizeFranchise(body.franchise);
    const kind = normalizeKind(body.kind);
    const title = sanitizeText(body.title, { maxLength: 80 });
    const subtitle = sanitizeText(body.subtitle, { maxLength: 120 });
    const city = sanitizeText(body.city, { maxLength: 40 });
    const venue = sanitizeText(body.venue, { maxLength: 120 });
    const price = sanitizeText(body.price, { maxLength: 80 });
    const contact = sanitizeText(body.contact || '站内发布 / 待补充', { maxLength: 120 });
    const note = sanitizeText(body.note, { maxLength: 500, preserveNewlines: true });
    const tags = sanitizeTags(body.tags);
    if (!title || !venue || !price || !contact) {
      return sendJson(res, 400, { error: 'title, venue, price and contact are required' });
    }

    const listing = {
      id: store.nextListingId++,
      franchise,
      franchiseLabel: FRANCHISE_LABELS[franchise],
      kind,
      kindLabel: KIND_LABELS[kind],
      title,
      subtitle,
      city,
      venue,
      date: body.date,
      eventDates,
      price,
      contact,
      note,
      tags,
      quantity: Number(body.quantity || 1) || 1,
      canSerial: !!body.canSerial,
      isPremium: !!body.isPremium,
      accent: normalizeAccent(body.accent, franchise),
      ownerId: user.id,
      ownerName: user.name,
      status: 'approved',
      favoritesBy: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reviewLog: [{ at: new Date().toISOString(), action: 'published', by: user.name, note: '直接发布' }]
    };

    store.listings.unshift(listing);
    if (user.role !== 'admin') {
      addNotification(store, {
        audience: 'admin',
        createdByRole: 'admin',
        createdById: user.id,
        type: 'system',
        listingId: listing.id,
        text: `有新票务已发布：${listing.title}`
      });
    }
    await saveStore(store);
    return sendJson(res, 200, { listing: enrichListing(listing, user) });
  }

  if (req.method === 'PUT' && pathName.startsWith('/api/listings/')) {
    if (!user) return sendJson(res, 401, { error: 'login required' });
    const id = Number(pathName.split('/').pop());
    const listing = store.listings.find(item => item.id === id);
    if (!listing) return sendJson(res, 404, { error: 'not found' });
    if (!isOwnerOrAdmin(user, listing)) return sendJson(res, 403, { error: 'forbidden' });

    const body = parseJson(await readBody(req));
    if (!body) return sendJson(res, 400, { error: 'invalid json' });
    const eventDates = normalizeEventDates(body.eventDates, body.date || listing.date);
    if (!requireValidListingDate(latestEventDate(eventDates, body.date || listing.date))) {
      return sendJson(res, 400, { error: 'listing date cannot be before today' });
    }

    const franchise = normalizeFranchise(body.franchise);
    const kind = normalizeKind(body.kind);
    const title = sanitizeText(body.title, { maxLength: 80 });
    const subtitle = sanitizeText(body.subtitle, { maxLength: 120 });
    const city = sanitizeText(body.city, { maxLength: 40 });
    const venue = sanitizeText(body.venue, { maxLength: 120 });
    const price = sanitizeText(body.price, { maxLength: 80 });
    const contact = sanitizeText(body.contact || listing.contact, { maxLength: 120 });
    const note = sanitizeText(body.note, { maxLength: 500, preserveNewlines: true });
    if (!title || !venue || !price || !contact) {
      return sendJson(res, 400, { error: 'title, venue, price and contact are required' });
    }

    listing.franchise = franchise;
    listing.franchiseLabel = FRANCHISE_LABELS[franchise];
    listing.kind = kind;
    listing.kindLabel = KIND_LABELS[kind];
    listing.title = title;
    listing.subtitle = subtitle;
    listing.city = city;
    listing.venue = venue;
    listing.date = body.date;
    listing.eventDates = eventDates;
    listing.price = price;
    listing.contact = contact;
    listing.note = note;
    listing.tags = sanitizeTags(Array.isArray(body.tags) ? body.tags : listing.tags);
    listing.quantity = Number(body.quantity || listing.quantity || 1) || 1;
    listing.canSerial = !!body.canSerial;
    listing.isPremium = !!body.isPremium;
    listing.accent = normalizeAccent(body.accent || listing.accent, franchise);
    listing.status = 'approved';
    listing.reviewLog = listing.reviewLog || [];
    listing.updatedAt = new Date().toISOString();
    listing.createdAt = listing.createdAt || listing.updatedAt;
    listing.reviewLog.unshift({ at: new Date().toISOString(), action: 'published', by: user.name, note: '直接保存并发布' });
    if (user.role !== 'admin') {
      addNotification(store, {
        audience: 'admin',
        createdByRole: 'admin',
        createdById: user.id,
        type: 'system',
        listingId: listing.id,
        text: `有票务已更新：${listing.title}`
      });
    }
    await saveStore(store);
    return sendJson(res, 200, { listing: enrichListing(listing, user) });
  }

  if (req.method === 'POST' && pathName.startsWith('/api/listings/') && pathName.endsWith('/comments')) {
    if (!user) return sendJson(res, 401, { error: 'login required' });
    const id = Number(pathName.split('/').slice(-2, -1)[0]);
    const listing = store.listings.find(item => item.id === id);
    if (!listing || !visibleListingFor(user, listing)) return sendJson(res, 404, { error: 'not found' });
    const body = parseJson(await readBody(req));
    if (!body) return sendJson(res, 400, { error: 'invalid json' });
    const text = sanitizeText(body.text || body.comment, { maxLength: 300, preserveNewlines: true });
    if (!text) return sendJson(res, 400, { error: 'comment is required' });
    listing.comments = Array.isArray(listing.comments) ? listing.comments : [];
    const comment = {
      id: crypto.randomBytes(6).toString('hex'),
      listingId: id,
      text,
      authorId: user.id,
      authorName: sanitizeText(user.name, { maxLength: 40 }) || '匿名用户',
      authorRole: user.role,
      createdAt: new Date().toISOString()
    };
    listing.comments.unshift(comment);
    if (String(user.id) !== String(listing.ownerId)) {
      addNotification(store, {
        audience: 'private',
        createdByRole: 'admin',
        createdById: user.id,
        type: 'comment',
        text: `你的票务有新评论：${listing.title}`,
        targetUserId: listing.ownerId,
        listingId: id,
        commentId: comment.id
      });
    }
    await saveStore(store);
    return sendJson(res, 200, { comment: sanitizeComment(comment) });
  }

  if (req.method === 'DELETE' && pathName.startsWith('/api/listings/') && pathName.includes('/comments/')) {
    if (!user) return sendJson(res, 401, { error: 'login required' });
    const parts = pathName.split('/').filter(Boolean);
    if (parts.length !== 5 || parts[0] !== 'api' || parts[1] !== 'listings' || parts[3] !== 'comments') {
      return sendJson(res, 404, { error: 'not found' });
    }
    const id = Number(parts[2]);
    const commentId = parts[4];
    const listing = store.listings.find(item => item.id === id);
    if (!listing || !visibleListingFor(user, listing)) return sendJson(res, 404, { error: 'not found' });
    listing.comments = Array.isArray(listing.comments) ? listing.comments : [];
    const commentIndex = listing.comments.findIndex(item => String(item.id) === commentId);
    if (commentIndex < 0) return sendJson(res, 404, { error: 'not found' });
    const comment = listing.comments[commentIndex];
    if (!(user.role === 'admin' || String(comment.authorId) === String(user.id))) {
      return sendJson(res, 403, { error: 'forbidden' });
    }
    listing.comments.splice(commentIndex, 1);
    await saveStore(store);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'DELETE' && pathName.startsWith('/api/listings/')) {
    if (!user) return sendJson(res, 401, { error: 'login required' });
    const id = Number(pathName.split('/').pop());
    const index = store.listings.findIndex(item => item.id === id);
    if (index < 0) return sendJson(res, 404, { error: 'not found' });
    const listing = store.listings[index];
    if (!isOwnerOrAdmin(user, listing)) return sendJson(res, 403, { error: 'forbidden' });
    store.listings.splice(index, 1);
    addNotification(store, {
      audience: 'all',
      createdByRole: 'admin',
      createdById: user.id,
      type: 'system',
      listingId: id,
      text: `票务已下架：${listing.title}`
    });
    await saveStore(store);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathName.endsWith('/favorite')) {
    if (!user) return sendJson(res, 401, { error: 'login required' });
    const id = Number(pathName.split('/')[3]);
    const listing = store.listings.find(item => item.id === id);
    if (!listing || !visibleListingFor(user, listing)) return sendJson(res, 404, { error: 'not found' });
    listing.favoritesBy = Array.isArray(listing.favoritesBy) ? listing.favoritesBy : [];
    const index = listing.favoritesBy.indexOf(user.id);
    let favorited = false;
    if (index >= 0) {
      listing.favoritesBy.splice(index, 1);
      favorited = false;
    } else {
      listing.favoritesBy.push(user.id);
      favorited = true;
    }
    await saveStore(store);
    return sendJson(res, 200, { favorited, favoriteCount: listing.favoritesBy.length });
  }

  if (req.method === 'POST' && pathName.endsWith('/review')) {
    if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'admin only' });
    const id = Number(pathName.split('/')[3]);
    const listing = store.listings.find(item => item.id === id);
    if (!listing) return sendJson(res, 404, { error: 'not found' });
    const body = parseJson(await readBody(req));
    if (!body || !['approve', 'reject'].includes(body.action)) {
      return sendJson(res, 400, { error: 'invalid review action' });
    }
    listing.status = body.action === 'approve' ? 'approved' : 'rejected';
    listing.reviewLog = listing.reviewLog || [];
    listing.reviewLog.unshift({
      at: new Date().toISOString(),
      action: body.action,
      by: user.name,
      note: body.note || (body.action === 'approve' ? '审核通过' : '审核驳回')
    });
    addNotification(store, {
      audience: 'all',
      createdByRole: 'admin',
      createdById: user.id,
      type: 'review',
      listingId: id,
      text: `票务${body.action === 'approve' ? '已通过' : '被驳回'}：${listing.title}`,
      targetUserId: listing.ownerId
    });
    await saveStore(store);
    return sendJson(res, 200, { listing: enrichListing(listing, user) });
  }

  return sendJson(res, 404, { error: 'not found' });
}

function resolvePublicStaticFile(pathname) {
  let decodedPathname = String(pathname || '/');
  try {
    decodedPathname = decodeURIComponent(decodedPathname);
  } catch (error) {
    return '';
  }
  decodedPathname = decodedPathname.replace(/\\/g, '/');
  if (decodedPathname === '/' || decodedPathname === '') {
    return 'index.html';
  }
  if (decodedPathname === '/票务互助.html' || decodedPathname === '/绁ㄥ姟浜掑姪.html') {
    return 'index.html';
  }
  const fileName = decodedPathname.replace(/^\/+/, '');
  if (fileName.includes('/') || fileName.includes('\0')) {
    return '';
  }
  return publicStaticFiles.has(fileName) ? fileName : '';
}

async function serveStatic(req, res, url) {
  const fileName = resolvePublicStaticFile(url.pathname);
  if (!fileName) {
    return sendText(res, 404, 'Not Found');
  }
  const rootPath = path.resolve(rootDir);
  const safePath = path.resolve(rootPath, fileName);
  if (safePath !== rootPath && !safePath.startsWith(`${rootPath}${path.sep}`)) {
    return sendText(res, 403, 'Forbidden');
  }
  try {
    const data = await fsp.readFile(safePath);
    const ext = path.extname(safePath).toLowerCase();
    const isHtml = ext === '.html';
    const cspNonce = isHtml ? createCspNonce() : '';
    const body = isHtml ? addCspNonceToHtml(data.toString('utf8'), cspNonce) : data;
    if (isHtml) {
      res.__cspNonce = cspNonce;
    }
    res.writeHead(200, responseHeaders(res, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream'
    }, true));
    res.end(body);
  } catch (error) {
    return sendText(res, 404, 'Not Found');
  }
}

async function main() {
  console.log('[boot] starting StarSea backend...');
  console.log(`[boot] env: port=${port}, db=${pool ? 'enabled' : 'disabled'}, localStore=${allowLocalStore}`);
  if (pool) {
    console.log(`[boot] db timeouts: connect=${dbConnectTimeoutMs}ms, query=${dbQueryTimeoutMs}ms`);
  }

  console.log('[boot] loading store...');
  let store = await ensureStore();
  console.log('[boot] store ready');
  refreshLiveOptions(store, { force: false }).catch(error => {
    console.error('[live-crawl] initial refresh failed', error.message || error);
  });

  setInterval(async () => {
    try {
      store = await ensureStore();
      await refreshLiveOptions(store, { force: false });
    } catch (error) {
      console.error('[live-crawl] scheduled refresh failed', error.message || error);
    }
  }, LIVE_REFRESH_INTERVAL_MS).unref();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || `localhost:${port}`}`);
    res.__corsHeaders = buildCorsHeaders(req);

    if (req.method === 'OPTIONS') {
      const allowed = !req.headers.origin || !!res.__corsHeaders['Access-Control-Allow-Origin'];
      res.writeHead(allowed ? 204 : 403, responseHeaders(res, {
        'Content-Length': '0'
      }, true));
      return res.end();
    }

    if (url.pathname.startsWith('/api/')) {
      store = await ensureStore();
      return handleApi(req, res, store, url).catch(async error => {
        console.error(error);
        sendJson(res, 500, { error: 'internal server error' });
      });
    }

    return serveStatic(req, res, url);
  });

  server.listen(port, () => {
    console.log(`[boot] StarSea backend running on http://0.0.0.0:${port}`);
  });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  if (pool) {
    await pool.end().catch(() => {});
  }
  process.exit(0);
});
