from __future__ import annotations

import json
import hashlib
import hmac
import re
import os
import secrets
import mimetypes
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

try:
    import bcrypt as py_bcrypt
except ImportError:
    py_bcrypt = None


ROOT = Path(__file__).resolve().parent
configured_data_file = str(os.environ.get('DATA_FILE_PATH', '')).strip()


def env_int(names: tuple[str, ...], default: int) -> int:
    for name in names:
        value = os.environ.get(name)
        if value:
            try:
                return int(value)
            except ValueError:
                continue
    return default


DATA_FILE = Path(configured_data_file).expanduser() if configured_data_file else ROOT / 'data.json'
PORT = int(os.environ.get('PORT', '3000'))
IS_PRODUCTION = os.environ.get('NODE_ENV', '').lower() == 'production'
NOTIFICATION_DEDUP_WINDOW_MS = max(0, int(os.environ.get('NOTIFICATION_DEDUP_WINDOW_MS', '30000')))
SESSION_TTL_MS = max(60000, env_int(('SESSION_TTL_MS', 'TOKEN_TTL_MS'), 1000 * 60 * 60 * 24 * 7))
BCRYPT_ROUNDS = min(14, max(10, env_int(('BCRYPT_ROUNDS',), 12)))
CONFIGURED_ALLOWED_ORIGINS = {
    item.strip()
    for item in os.environ.get('ALLOWED_ORIGINS', '').split(',')
    if item.strip()
}
DEFAULT_ALLOWED_ORIGINS = {'https://ticket-exchange.onrender.com'}
PUBLIC_STATIC_FILES = {'index.html', 'register.html', 'app.js', 'config.js'}

def build_security_headers(csp_nonce: str = '') -> dict[str, str]:
    nonce_source = f" 'nonce-{csp_nonce}'" if csp_nonce else ''
    headers = {
        'Content-Security-Policy': (
        "default-src 'self'; base-uri 'self'; object-src 'none'; "
        "frame-ancestors 'none'; img-src 'self' data: https:; "
        f"style-src 'self'{nonce_source}; script-src 'self'{nonce_source}; "
        "connect-src 'self' https://ticket-exchange.onrender.com "
        "http://localhost:3000 http://127.0.0.1:3000; form-action 'self'"
        ),
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Cross-Origin-Opener-Policy': 'same-origin',
    }
    if IS_PRODUCTION:
        headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return headers


DEFAULT_PASSWORDS = {
    '星海管理员': 'admin123',
    '星海同好': 'member123',
    '审稿小组': 'review123',
    '官方样例': 'sample123'
}


def make_sha256_password_record(password: str) -> dict:
    salt = secrets.token_hex(8)
    digest = hashlib.sha256(f'{salt}:{password}'.encode('utf-8')).hexdigest()
    return {'passwordAlgo': 'sha256', 'passwordSalt': salt, 'passwordHash': digest}


def make_password_record(password: str) -> dict:
    if py_bcrypt:
        digest = py_bcrypt.hashpw(password.encode('utf-8'), py_bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode('utf-8')
        return {'passwordAlgo': 'bcrypt', 'passwordSalt': '', 'passwordHash': digest}
    return make_sha256_password_record(password)


def is_bcrypt_hash(value: str) -> bool:
    return bool(re.match(r'^\$2[aby]\$\d{2}\$', str(value or '')))


def password_algorithm(user: dict) -> str:
    explicit = str(user.get('passwordAlgo') or '').strip().lower()
    if explicit:
        return explicit
    return 'bcrypt' if is_bcrypt_hash(str(user.get('passwordHash') or '')) else 'sha256'


def apply_password_record(user: dict, record: dict) -> None:
    user['passwordAlgo'] = record.get('passwordAlgo', 'sha256')
    user['passwordHash'] = record.get('passwordHash', '')
    if record.get('passwordSalt'):
        user['passwordSalt'] = record.get('passwordSalt')
    else:
        user.pop('passwordSalt', None)


def verify_sha256_password(password: str, salt: str, password_hash: str) -> bool:
    digest = hashlib.sha256(f'{salt}:{password}'.encode('utf-8')).hexdigest()
    return hmac.compare_digest(digest, password_hash)


def verify_password_record(password: str, user: dict) -> tuple[bool, bool]:
    algo = password_algorithm(user)
    if algo == 'bcrypt':
        if not py_bcrypt:
            return False, False
        try:
            return py_bcrypt.checkpw(password.encode('utf-8'), str(user.get('passwordHash') or '').encode('utf-8')), False
        except ValueError:
            return False, False

    valid = verify_sha256_password(password, str(user.get('passwordSalt') or ''), str(user.get('passwordHash') or ''))
    return valid, bool(valid and py_bcrypt)


def public_user(user: dict | None) -> dict | None:
    if not user:
        return None
    return {
        'id': user.get('id'),
        'name': str(user.get('name') or '')[:40],
        'role': user.get('role'),
    }


def is_ascii_credential(value: str) -> bool:
    return bool(re.fullmatch(r'[\x21-\x7E]+', value))


def current_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def today_key() -> str:
    return datetime.now().date().isoformat()


def is_expired_listing(listing: dict) -> bool:
    listing_date = str(listing.get('date') or '').strip()
    return bool(listing_date and listing_date < today_key())


def prune_expired_listings(data: dict) -> bool:
    listings = data.get('listings', [])
    kept = [listing for listing in listings if not is_expired_listing(listing)]
    if len(kept) == len(listings):
        return False
    data['listings'] = kept
    return True


def require_valid_listing_date(date_value: str) -> bool:
    return bool(date_value and str(date_value).strip() >= today_key())


def default_data() -> dict:
    return {
        'users': [
            {'id': 'u1', 'name': 'admin', 'role': 'admin'},
        ],
        'tokens': {},
        'nextUserId': 4,
        'nextListingId': 9,
        'nextNotificationId': 1,
        'listings': [
            {
                'id': 1,
                'franchise': 'bangdream',
                'franchiseLabel': 'Bang Dream',
                'kind': 'transfer',
                'kindLabel': '出票',
                'title': 'MyGO!!!!! 现场票转让',
                'subtitle': '想出一张二层看台票，临近开演前确认即可。',
                'city': '东京',
                'venue': '武道馆',
                'date': '2026-08-15',
                'price': '原价 9800 日元',
                'contact': 'X / @mygo_ticket_01',
                'note': '优先能快速确认的同好，支持站内预留。',
                'tags': ['二层', '快速确认', '同好优先'],
                'accent': '#ff6aa2',
                'ownerId': 'u1',
                'ownerName': 'admin',
                'status': 'approved',
                'favoritesBy': ['u2'],
                'reviewLog': [{'at': '2026-06-24T10:00:00.000Z', 'action': 'approved', 'by': '系统', 'note': '样例数据'}]
            },
            {
                'id': 2,
                'franchise': 'lovelive',
                'franchiseLabel': 'LoveLive',
                'kind': 'seeking',
                'kindLabel': '收票',
                'title': 'Aqours Final 含泪收票',
                'subtitle': '求一张能现场见证最终场的门票，价格可协商。',
                'city': '大阪',
                'venue': '京瓷巨蛋',
                'date': '2026-09-02',
                'price': '预算 15000 日元内',
                'contact': 'Telegram / @ll_buyer88',
                'note': '可接受电子票或纸票，先沟通座位和票型。',
                'tags': ['最终场', '可协商', '电子票'],
                'accent': '#6de2ff',
                'ownerId': 'u2',
                'ownerName': '星海同好',
                'status': 'reviewing',
                'favoritesBy': [],
                'reviewLog': [{'at': '2026-06-24T10:05:00.000Z', 'action': 'approved', 'by': '系统', 'note': '样例数据'}]
            },
            {
                'id': 3,
                'franchise': 'bangdream',
                'franchiseLabel': 'Bang Dream',
                'kind': 'swap',
                'kindLabel': '换票',
                'title': 'Roselia 双日互换',
                'subtitle': 'A 日看台换 B 日更近位置，想互补票档。',
                'city': '名古屋',
                'venue': '爱知天空竞技场',
                'date': '2026-07-21',
                'price': '等值互换',
                'contact': 'QQ / 2345xxxx',
                'note': '希望同样是 Roselia 粉，互相确认后交换。',
                'tags': ['双日', '等值互换', 'Roselia'],
                'accent': '#ffd36e',
                'ownerId': 'u2',
                'ownerName': '星海同好',
                'status': 'approved',
                'favoritesBy': [],
                'reviewLog': [{'at': '2026-06-24T10:08:00.000Z', 'action': 'approved', 'by': '系统', 'note': '样例数据'}]
            },
            {
                'id': 4,
                'franchise': 'lovelive',
                'franchiseLabel': 'LoveLive',
                'kind': 'transfer',
                'kindLabel': '出票',
                'title': 'Liella! 城市巡演单票',
                'subtitle': '单张转出，适合临时补位的同好。',
                'city': '横滨',
                'venue': 'Pacifico Yokohama',
                'date': '2026-10-06',
                'price': '面议',
                'contact': '微博私信 / @ll_kkk',
                'note': '可优先给能当日确认的买家。',
                'tags': ['单票', '可面议', '临近场次'],
                'accent': '#9a7bff',
                'ownerId': 'u3',
                'ownerName': '审稿小组',
                'status': 'approved',
                'favoritesBy': [],
                'reviewLog': [{'at': '2026-06-24T10:12:00.000Z', 'action': 'approved', 'by': '系统', 'note': '样例数据'}]
            },
            {
                'id': 5,
                'franchise': 'bangdream',
                'franchiseLabel': 'Bang Dream',
                'kind': 'seeking',
                'kindLabel': '收票',
                'title': "Poppin'Party 想补一张内场",
                'subtitle': '求内场或前排，预算弹性较大。',
                'city': '东京',
                'venue': '代代木竞技场',
                'date': '2026-11-12',
                'price': '预算 20000 日元内',
                'contact': 'Discord / hana#2211',
                'note': '如果有退票也可以第一时间联系。',
                'tags': ['内场', '前排', '弹性预算'],
                'accent': '#77f0b3',
                'ownerId': 'u3',
                'ownerName': '审稿小组',
                'status': 'approved',
                'favoritesBy': [],
                'reviewLog': [{'at': '2026-06-24T10:15:00.000Z', 'action': 'approved', 'by': '系统', 'note': '样例数据'}]
            },
            {
                'id': 6,
                'franchise': 'lovelive',
                'franchiseLabel': 'LoveLive',
                'kind': 'swap',
                'kindLabel': '换票',
                'title': '虹咲演唱会互换座位',
                'subtitle': '想用偏后排换更稳定的同行位置。',
                'city': '京都',
                'venue': 'Kyoto Pulse Plaza',
                'date': '2026-12-01',
                'price': '可补差价',
                'contact': '站内消息 / niji_swap',
                'note': '希望同样是虹咲粉，方便后续沟通。',
                'tags': ['同行', '补差价', '站内消息'],
                'accent': '#ff9b6a',
                'ownerId': 'u3',
                'ownerName': '审稿小组',
                'status': 'approved',
                'favoritesBy': [],
                'reviewLog': [{'at': '2026-06-24T10:18:00.000Z', 'action': 'approved', 'by': '系统', 'note': '样例数据'}]
            },
            {
                'id': 7,
                'franchise': 'imas',
                'franchiseLabel': 'IM@S',
                'kind': 'transfer',
                'kindLabel': '出票',
                'title': 'THE IDOLM@STER 765 票转让',
                'subtitle': 'IM@S 场次出票，想给能快速确认的同好。',
                'city': '福冈',
                'venue': 'Marine Messe',
                'date': '2026-11-28',
                'price': '原价 10500 日元',
                'contact': '站内消息 / imas_765',
                'note': '优先老粉，确认快可直接联系。',
                'tags': ['IM@S', '765', '快速确认'],
                'accent': '#ff8f70',
                'ownerId': 'u1',
                'ownerName': '星海管理员',
                'status': 'approved',
                'favoritesBy': [],
                'reviewLog': [{'at': '2026-06-25T09:00:00.000Z', 'action': 'published', 'by': '星海管理员', 'note': '直接发布'}]
            },
            {
                'id': 8,
                'franchise': 'other',
                'franchiseLabel': '其他',
                'kind': 'transfer',
                'kindLabel': '出票',
                'title': 'Vocaloid Live 余票',
                'subtitle': '其他企划的余票，适合临时补位。',
                'city': '大阪',
                'venue': '大阪城 Hall',
                'date': '2026-12-14',
                'price': '12000 日元',
                'contact': '微博私信 / @vocaloid_live',
                'note': '接受现场交接，票面信息可先看图。',
                'tags': ['其他', '现场交接', '补位'],
                'accent': '#8bd3ff',
                'ownerId': 'u2',
                'ownerName': '星海同好',
                'status': 'rejected',
                'favoritesBy': [],
                'reviewLog': [{'at': '2026-06-25T09:10:00.000Z', 'action': 'rejected', 'by': '审稿小组', 'note': '示例拒绝原因：信息不完整'}]
            }
        ],
        'notifications': [],
        'reviews': [],
        'sessions': []
    }


def normalize_store(data: dict) -> dict:
    data.setdefault('users', [])
    data.setdefault('tokens', {})
    data.setdefault('listings', [])
    data.setdefault('notifications', [])
    data.setdefault('reviews', [])
    data.setdefault('sessions', [])
    data['nextUserId'] = int(data.get('nextUserId', 4))
    data['nextListingId'] = int(data.get('nextListingId', 1))
    data['nextNotificationId'] = int(data.get('nextNotificationId', 1))

    known_ids = {
        'admin': 'u1',
    }
    for user in data['users']:
        if not user.get('id'):
            user['id'] = known_ids.get(user.get('name'), f'u{data["nextUserId"]}')
            if user['id'] == f'u{data["nextUserId"]}':
                data['nextUserId'] += 1
        if user.get('name') == 'admin':
            user['role'] = 'admin'
        algo = password_algorithm(user)
        if not user.get('passwordHash') or (algo == 'sha256' and not user.get('passwordSalt')):
            default_password = DEFAULT_PASSWORDS.get(user.get('name'), '123456')
            apply_password_record(user, make_password_record(default_password))
        elif not user.get('passwordAlgo'):
            user['passwordAlgo'] = algo

    for listing in data['listings']:
        owner_name = listing.get('ownerName')
        if not owner_name or owner_name == '匿名发布':
            owner_name = listing.get('owner')
        if owner_name and owner_name in known_ids and not listing.get('ownerId'):
            listing['ownerId'] = known_ids[owner_name]
        if owner_name and (not listing.get('ownerName') or listing.get('ownerName') == '匿名发布'):
            listing['ownerName'] = owner_name
        if not listing.get('ownerId') and listing.get('ownerName') in known_ids:
            listing['ownerId'] = known_ids[listing['ownerName']]
        if not listing.get('ownerName'):
            listing['ownerName'] = next((user['name'] for user in data['users'] if user.get('id') == listing.get('ownerId')), '匿名发布')
        if not isinstance(listing.get('comments'), list):
            listing['comments'] = []

    for notification in data['notifications']:
        if not notification.get('createdByRole'):
            notification['createdByRole'] = 'admin'

    return data


def load_data() -> dict:
    if not DATA_FILE.exists():
        data = normalize_store(default_data())
        prune_expired_listings(data)
        prune_expired_sessions(data)
        save_data(data)
        return data
    try:
        data = normalize_store(json.loads(DATA_FILE.read_text(encoding='utf-8')))
    except Exception:
        data = normalize_store(default_data())
    changed = any([
        prune_expired_listings(data),
        prune_expired_sessions(data),
    ])
    if changed:
        save_data(data)
    return data


def save_data(data: dict) -> None:
    DATA_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def slugify(text: str) -> str:
    slug = ''.join(ch.lower() if ch.isalnum() else '-' for ch in text.strip())
    while '--' in slug:
        slug = slug.replace('--', '-')
    return slug.strip('-') or 'user'


def get_token(headers) -> str:
    auth = headers.get('Authorization', '')
    return auth[7:].strip() if auth.startswith('Bearer ') else ''


def session_timestamp(value) -> float:
    text = str(value or '').strip()
    if not text or text == 'now':
        return 0
    try:
        return datetime.fromisoformat(text.replace('Z', '+00:00')).timestamp()
    except ValueError:
        return 0


def iso_from_timestamp(seconds: float) -> str:
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace('+00:00', 'Z')


def build_session_record(user_id: str, token: str | None = None, now: float | None = None) -> dict:
    now_seconds = now if now is not None else datetime.now(timezone.utc).timestamp()
    return {
        'token': token or secrets.token_hex(16),
        'userId': user_id,
        'createdAt': iso_from_timestamp(now_seconds),
        'expiresAt': iso_from_timestamp(now_seconds + (SESSION_TTL_MS / 1000)),
    }


def remove_session(data: dict, token: str) -> bool:
    if not token:
        return False
    changed = False
    if token in data.get('tokens', {}):
        del data['tokens'][token]
        changed = True
    before = len(data.get('sessions', []))
    data['sessions'] = [session for session in data.get('sessions', []) if session.get('token') != token]
    return changed or len(data['sessions']) != before


def normalize_session_token(data: dict, token: str) -> tuple[dict | None, bool]:
    tokens = data.setdefault('tokens', {})
    sessions = data.setdefault('sessions', [])
    token_value = tokens.get(token)
    existing_session = next((item for item in sessions if item.get('token') == token), {})
    changed = False
    user_id = ''
    created_at = ''
    expires_at = ''

    if isinstance(token_value, str):
        user_id = token_value
        changed = True
    elif isinstance(token_value, dict):
        user_id = token_value.get('userId') or ''
        created_at = token_value.get('createdAt') or ''
        expires_at = token_value.get('expiresAt') or ''

    user_id = user_id or existing_session.get('userId') or ''
    created_at = created_at or existing_session.get('createdAt') or ''
    expires_at = expires_at or existing_session.get('expiresAt') or ''
    if not user_id:
        return None, remove_session(data, token) or changed

    now = datetime.now(timezone.utc).timestamp()
    created_seconds = session_timestamp(created_at)
    normalized_created_at = iso_from_timestamp(created_seconds if created_seconds > 0 else now)
    expires_seconds = session_timestamp(expires_at)
    normalized_expires_at = iso_from_timestamp(expires_seconds if expires_seconds > 0 else (created_seconds if created_seconds > 0 else now) + (SESSION_TTL_MS / 1000))
    record = {'token': token, 'userId': user_id, 'createdAt': normalized_created_at, 'expiresAt': normalized_expires_at}

    if not isinstance(token_value, dict) or token_value.get('userId') != record['userId'] or token_value.get('createdAt') != record['createdAt'] or token_value.get('expiresAt') != record['expiresAt']:
        tokens[token] = {'userId': record['userId'], 'createdAt': record['createdAt'], 'expiresAt': record['expiresAt']}
        changed = True

    session_index = next((index for index, item in enumerate(sessions) if item.get('token') == token), -1)
    if session_index >= 0:
        current = sessions[session_index]
        if current.get('userId') != record['userId'] or current.get('createdAt') != record['createdAt'] or current.get('expiresAt') != record['expiresAt']:
            sessions[session_index] = record
            changed = True
    else:
        sessions.append(record)
        changed = True

    return record, changed


def is_session_expired(record: dict | None) -> bool:
    expires_seconds = session_timestamp((record or {}).get('expiresAt'))
    return bool(expires_seconds > 0 and expires_seconds <= datetime.now(timezone.utc).timestamp())


def prune_expired_sessions(data: dict) -> bool:
    changed = False
    data.setdefault('tokens', {})
    data.setdefault('sessions', [])
    user_ids = {user.get('id') for user in data.get('users', [])}
    for token in list(data.get('tokens', {}).keys()):
        record, normalized = normalize_session_token(data, token)
        changed = normalized or changed
        if not record or is_session_expired(record) or record.get('userId') not in user_ids:
            changed = remove_session(data, token) or changed
    before = len(data.get('sessions', []))
    data['sessions'] = [session for session in data.get('sessions', []) if session.get('token') in data.get('tokens', {})]
    return changed or len(data['sessions']) != before


def create_session(data: dict, user_id: str) -> dict:
    record = build_session_record(user_id)
    data.setdefault('tokens', {})[record['token']] = {
        'userId': record['userId'],
        'createdAt': record['createdAt'],
        'expiresAt': record['expiresAt'],
    }
    data['sessions'] = [session for session in data.get('sessions', []) if session.get('token') != record['token']]
    data.setdefault('sessions', []).append(record)
    return record


def current_session(data: dict, handler: BaseHTTPRequestHandler) -> dict:
    token = get_token(handler.headers)
    if not token:
        return {'user': None, 'token': '', 'expiresAt': None, 'changed': False, 'expired': False}
    record, changed = normalize_session_token(data, token)
    if not record:
        return {'user': None, 'token': token, 'expiresAt': None, 'changed': changed, 'expired': False}
    if is_session_expired(record):
        changed = remove_session(data, token) or changed
        return {'user': None, 'token': token, 'expiresAt': None, 'changed': changed, 'expired': True}
    user = next((item for item in data.get('users', []) if item.get('id') == record.get('userId')), None)
    if not user:
        changed = remove_session(data, token) or changed
        return {'user': None, 'token': token, 'expiresAt': None, 'changed': changed, 'expired': False}
    return {'user': user, 'token': token, 'expiresAt': record.get('expiresAt'), 'changed': changed, 'expired': False}


def current_user(data: dict, handler: BaseHTTPRequestHandler):
    return current_session(data, handler).get('user')


def visible_to_user(user: dict | None, listing: dict) -> bool:
    if not user:
        return listing.get('status') == 'approved'
    if user.get('role') == 'admin':
        return True
    return listing.get('status') == 'approved' or listing.get('ownerId') == user.get('id')


def is_management_notification(notification: dict) -> bool:
    text = str(notification.get('text', ''))
    return (
        notification.get('type') == 'review'
        or any(keyword in text for keyword in ['票务已下架', '票务已通过', '票务被驳回', '等待审核', '审核', '上架', '发布'])
    )


def notification_timestamp(value) -> float:
    text = str(value or '').strip()
    if not text or text == 'now':
        return 0
    try:
        return datetime.fromisoformat(text.replace('Z', '+00:00')).timestamp()
    except ValueError:
        return 0


def notification_dedupe_key(notification: dict) -> str:
    return '\x1f'.join(str(notification.get(key, '') or '') for key in [
        'audience',
        'createdByRole',
        'createdById',
        'type',
        'targetUserId',
        'listingId',
        'text',
    ])


def add_notification(data: dict, payload: dict) -> dict:
    notifications = data.setdefault('notifications', [])
    notification = {
        **payload,
        'at': payload.get('at') or current_iso(),
        'text': str(payload.get('text') or '').strip(),
    }
    dedupe_key = notification_dedupe_key(notification)
    now = notification_timestamp(notification.get('at'))
    if NOTIFICATION_DEDUP_WINDOW_MS > 0 and now > 0:
        for item in notifications:
            item_timestamp = notification_timestamp(item.get('at'))
            if (
                item_timestamp > 0
                and notification_dedupe_key(item) == dedupe_key
                and abs(now - item_timestamp) * 1000 <= NOTIFICATION_DEDUP_WINDOW_MS
            ):
                return item

    notification['id'] = data.get('nextNotificationId', 1)
    notifications.insert(0, notification)
    data['nextNotificationId'] = int(data.get('nextNotificationId', 1)) + 1
    data['notifications'] = notifications[:50]
    return notification


def enrich_listing(listing: dict, user: dict | None) -> dict:
    favorites = listing.get('favoritesBy', [])
    comments = listing.get('comments', []) if isinstance(listing.get('comments', []), list) else []
    return {
        **listing,
        'favoriteCount': len(favorites),
        'favorited': bool(user and user.get('id') in favorites),
        'visibleToMe': visible_to_user(user, listing),
        'quantity': int(listing.get('quantity', 1) or 1),
        'canSerial': bool(listing.get('canSerial', False)),
        'commentCount': len(comments)
    }


def normalize_origin(origin: str) -> str:
    parsed = urlparse(origin)
    if not parsed.scheme or not parsed.netloc:
        return ''
    return f'{parsed.scheme}://{parsed.netloc}'


def is_allowed_cors_origin(origin: str) -> bool:
    if origin == 'null':
        return not IS_PRODUCTION
    normalized = normalize_origin(origin)
    if not normalized:
        return False
    if normalized in CONFIGURED_ALLOWED_ORIGINS or normalized in DEFAULT_ALLOWED_ORIGINS:
        return True
    return not IS_PRODUCTION and re.match(r'^https?://(?:localhost|127\.0\.0\.1)(?::\d+)?$', normalized, re.I)


def cors_headers(handler: BaseHTTPRequestHandler) -> dict[str, str]:
    origin = handler.headers.get('Origin', '').strip()
    if not origin:
        return {}
    if not is_allowed_cors_origin(origin):
        return {'Vary': 'Origin'}
    return {
        'Access-Control-Allow-Origin': 'null' if origin == 'null' else normalize_origin(origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Vary': 'Origin'
    }


def send_headers(handler: BaseHTTPRequestHandler, headers: dict[str, str], csp_nonce: str = ''):
    merged = {**build_security_headers(csp_nonce), **headers}
    for key, value in merged.items():
        handler.send_header(key, value)


def add_csp_nonce_to_html(content: bytes, nonce: str) -> bytes:
    html = content.decode('utf-8')
    html = re.sub(
        r'<style\b(?![^>]*\bnonce=)([^>]*)>',
        lambda match: f'<style nonce="{nonce}"{match.group(1)}>',
        html,
        flags=re.I,
    )
    html = re.sub(
        r'<script\b(?![^>]*\bnonce=)([^>]*)>',
        lambda match: f'<script nonce="{nonce}"{match.group(1)}>',
        html,
        flags=re.I,
    )
    return html.encode('utf-8')


def resolve_static_path(request_path: str) -> Path | None:
    decoded = unquote(request_path or '/').replace('\\', '/')
    if decoded in ('', '/', '/票务互助.html', '/绁ㄥ姟浜掑姪.html'):
        file_name = 'index.html'
    else:
        file_name = decoded.lstrip('/')
    if '/' in file_name or '\x00' in file_name or file_name not in PUBLIC_STATIC_FILES:
        return None
    return (ROOT / file_name).resolve()


def json_response(handler: BaseHTTPRequestHandler, code: int, payload: dict):
    raw = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    handler.send_response(code)
    send_headers(handler, {
        **cors_headers(handler),
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': str(len(raw))
    })
    handler.end_headers()
    handler.wfile.write(raw)


def read_json_body(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get('Content-Length', '0'))
    if length <= 0:
                return {}
    raw = handler.rfile.read(length).decode('utf-8')
    return json.loads(raw) if raw else {}


def static_response(handler: BaseHTTPRequestHandler, file_path: Path):
    try:
        file_path.relative_to(ROOT)
    except ValueError:
        json_response(handler, 403, {'error': 'forbidden'})
        return
    if file_path.name not in PUBLIC_STATIC_FILES or not file_path.exists() or not file_path.is_file():
        json_response(handler, 404, {'error': 'not found'})
        return
    mime = mimetypes.guess_type(str(file_path))[0] or 'application/octet-stream'
    content = file_path.read_bytes()
    csp_nonce = ''
    if mime.startswith('text/html'):
        csp_nonce = secrets.token_urlsafe(16)
        content = add_csp_nonce_to_html(content, csp_nonce)
    handler.send_response(200)
    send_headers(handler, {
        **cors_headers(handler),
        'Content-Type': mime,
        'Content-Length': str(len(content))
    }, csp_nonce)
    handler.end_headers()
    handler.wfile.write(content)


class Handler(BaseHTTPRequestHandler):
    server_version = 'StarSeaHTTP/1.0'

    def log_message(self, format, *args):
        return

    def do_OPTIONS(self):
        headers = cors_headers(self)
        allowed = not self.headers.get('Origin') or 'Access-Control-Allow-Origin' in headers
        self.send_response(204 if allowed else 403)
        send_headers(self, {**headers, 'Content-Length': '0'})
        self.end_headers()

    def do_GET(self):
        self.route()

    def do_POST(self):
        self.route()

    def do_PUT(self):
        self.route()

    def do_DELETE(self):
        self.route()

    def route(self):
        data = load_data()
        session = current_session(data, self)
        if session.get('changed'):
            save_data(data)
        user = session.get('user')
        url = urlparse(self.path)
        path = url.path

        if path == '/api/session' or path == '/api/bootstrap':
            json_response(self, 200, {'user': public_user(user), 'currentUser': public_user(user), 'expiresAt': session.get('expiresAt') if user else None, 'tokenExpired': bool(session.get('expired'))})
            return

        if path == '/api/session/login' and self.command == 'POST':
            try:
                body = read_json_body(self)
            except Exception:
                json_response(self, 400, {'error': 'invalid json'})
                return
            username = str(body.get('username') or body.get('nickname') or body.get('name') or '').strip()
            password = str(body.get('password') or '').strip()
            if not username or not password:
                json_response(self, 400, {'error': 'username and password are required'})
                return
            existing = next((item for item in data['users'] if item['name'] == username), None)
            if not existing:
                json_response(self, 401, {'error': 'invalid credentials'})
                return
            valid, needs_upgrade = verify_password_record(password, existing)
            if not valid:
                json_response(self, 401, {'error': 'invalid credentials'})
                return
            if needs_upgrade:
                apply_password_record(existing, make_password_record(password))
            session_record = create_session(data, existing['id'])
            save_data(data)
            json_response(self, 200, {'token': session_record['token'], 'expiresAt': session_record['expiresAt'], 'user': public_user(existing)})
            return

        if path == '/api/session/register' and self.command == 'POST':
            try:
                body = read_json_body(self)
            except Exception:
                json_response(self, 400, {'error': 'invalid json'})
                return
            username = str(body.get('username') or body.get('nickname') or '').strip()
            password = str(body.get('password') or '').strip()
            if not username or not password:
                json_response(self, 400, {'error': 'username and password are required'})
                return
            if not is_ascii_credential(username) or not is_ascii_credential(password):
                json_response(self, 400, {'error': 'username and password can only contain english letters, numbers, and symbols'})
                return
            if len(password) < 6:
                json_response(self, 400, {'error': 'password must be at least 6 characters'})
                return
            if next((item for item in data['users'] if item['name'] == username), None):
                json_response(self, 409, {'error': 'username already exists'})
                return
            user = {
                'id': f'u{data.get("nextUserId", 4)}',
                'name': username,
                'role': 'member',
            }
            apply_password_record(user, make_password_record(password))
            data['nextUserId'] = int(data.get('nextUserId', 4)) + 1
            data['users'].append(user)
            session_record = create_session(data, user['id'])
            save_data(data)
            json_response(self, 201, {'token': session_record['token'], 'expiresAt': session_record['expiresAt'], 'user': public_user(user)})
            return

        if path == '/api/session/logout' and self.command == 'POST':
            token = get_token(self.headers)
            if remove_session(data, token):
                save_data(data)
            json_response(self, 200, {'ok': True})
            return

        if path == '/api/me' or path == '/api/session/me':
            json_response(self, 200, {'user': public_user(user)})
            return

        if path == '/api/listings' and self.command == 'GET':
            q = (url.query or '')
            params = {key: values[-1] for key, values in parse_qs(q).items()}
            listings = [enrich_listing(item, user) for item in data.get('listings', []) if visible_to_user(user, item)]
            franchise = params.get('franchise', 'all')
            kind = params.get('kind', 'all')
            status = params.get('status', 'all')
            favorites_only = params.get('favorites') == '1'
            mine_only = params.get('mine') == '1'
            query = (params.get('q') or '').lower()

            if franchise != 'all':
                listings = [item for item in listings if item.get('franchise') == franchise]
            if kind != 'all':
                listings = [item for item in listings if item.get('kind') == kind]
            if status != 'all':
                listings = [item for item in listings if item.get('status') == status]
            if favorites_only and user:
                listings = [item for item in listings if item.get('favorited')]
            if mine_only and user:
                listings = [item for item in listings if item.get('ownerName') == user['name']]
            if query:
                listings = [
                    item for item in listings
                    if query in ' '.join(str(item.get(key, '')) for key in ['title', 'subtitle', 'city', 'venue', 'price', 'contact', 'note']).lower()
                ]
            json_response(self, 200, {'listings': listings})
            return

        if path.startswith('/api/listings/') and self.command == 'GET' and not path.endswith('/comments'):
            listing_id = int(path.split('/')[-1])
            listing = next((item for item in data.get('listings', []) if item['id'] == listing_id), None)
            if not listing or not visible_to_user(user, listing):
                json_response(self, 404, {'error': 'not found'})
                return
            listing['views'] = int(listing.get('views', 0)) + 1
            save_data(data)
            json_response(self, 200, {'listing': enrich_listing(listing, user)})
            return

        if path.startswith('/api/listings/') and path.endswith('/comments') and self.command == 'GET':
            listing_id = int(path.split('/')[-2])
            listing = next((item for item in data.get('listings', []) if item['id'] == listing_id), None)
            if not listing or not visible_to_user(user, listing):
                json_response(self, 404, {'error': 'not found'})
                return
            comments = listing.get('comments', []) if isinstance(listing.get('comments', []), list) else []
            json_response(self, 200, {'comments': comments})
            return

        if path == '/api/listings' and self.command == 'POST':
            if not user:
                json_response(self, 401, {'error': 'login required'})
                return
            try:
                body = read_json_body(self)
            except Exception:
                json_response(self, 400, {'error': 'invalid json'})
                return
            if not require_valid_listing_date(str(body.get('date', '')).strip()):
                json_response(self, 400, {'error': 'listing date cannot be before today'})
                return
            listing = {
                'id': data.get('nextListingId', 1),
                'franchise': body.get('franchise'),
                'franchiseLabel': body.get('franchiseLabel'),
                'kind': body.get('kind'),
                'kindLabel': body.get('kindLabel'),
                'title': body.get('title'),
                'subtitle': body.get('subtitle', ''),
                'city': body.get('city'),
                'venue': body.get('venue'),
                'date': body.get('date'),
                'price': body.get('price'),
                'contact': body.get('contact', '站内发布 / 待补充'),
                'note': body.get('note'),
                'quantity': int(body.get('quantity', 1) or 1),
                'canSerial': bool(body.get('canSerial', False)),
                'isPremium': bool(body.get('isPremium', False)),
                'accent': body.get('accent'),
                'ownerId': user['id'],
                'ownerName': user['name'],
                'status': 'approved',
                'favoritesBy': [],
                'createdAt': current_iso(),
                'updatedAt': current_iso(),
                'reviewLog': [{'at': current_iso(), 'action': 'published', 'by': user['name'], 'note': '直接发布'}],
                'views': 0,
                'notifications': 0,
                'reviewNote': '已直接发布。'
            }
            data['nextListingId'] = int(data.get('nextListingId', 1)) + 1
            data['listings'].insert(0, listing)
            if user['role'] != 'admin':
                add_notification(data, {'audience': 'admin', 'createdByRole': 'admin', 'createdById': user.get('id'), 'text': f'有新票务已发布：{listing["title"]}', 'type': 'system', 'listingId': listing['id']})
            save_data(data)
            json_response(self, 201, {'listing': enrich_listing(listing, user)})
            return

        if path.startswith('/api/listings/') and self.command == 'PUT':
            if not user:
                json_response(self, 401, {'error': 'login required'})
                return
            listing_id = int(path.split('/')[-1])
            listing = next((item for item in data.get('listings', []) if item['id'] == listing_id), None)
            if not listing:
                json_response(self, 404, {'error': 'not found'})
                return
            if not (user['role'] == 'admin' or listing['ownerId'] == user['id']):
                json_response(self, 403, {'error': 'forbidden'})
                return
            try:
                body = read_json_body(self)
            except Exception:
                json_response(self, 400, {'error': 'invalid json'})
                return
            if not require_valid_listing_date(str(body.get('date', listing['date'])).strip()):
                json_response(self, 400, {'error': 'listing date cannot be before today'})
                return
            listing.update({
                'franchise': body.get('franchise', listing['franchise']),
                'franchiseLabel': body.get('franchiseLabel', listing['franchiseLabel']),
                'kind': body.get('kind', listing['kind']),
                'kindLabel': body.get('kindLabel', listing['kindLabel']),
                'title': body.get('title', listing['title']),
                'subtitle': body.get('subtitle', listing['subtitle']),
                'city': body.get('city', listing['city']),
                'venue': body.get('venue', listing['venue']),
                'date': body.get('date', listing['date']),
                'price': body.get('price', listing['price']),
                'contact': body.get('contact', listing['contact']),
                'note': body.get('note', listing['note']),
                'quantity': int(body.get('quantity', listing.get('quantity', 1)) or 1),
                'canSerial': bool(body.get('canSerial', listing.get('canSerial', False))),
                'isPremium': bool(body.get('isPremium', listing.get('isPremium', False))),
                'accent': body.get('accent', listing.get('accent')),
            })
            listing['status'] = 'approved'
            listing['updatedAt'] = current_iso()
            listing.setdefault('createdAt', listing['updatedAt'])
            listing.setdefault('reviewLog', []).insert(0, {'at': current_iso(), 'action': 'published', 'by': user['name'], 'note': '直接保存并发布'})
            if user['role'] != 'admin':
                add_notification(data, {'audience': 'admin', 'createdByRole': 'admin', 'createdById': user.get('id'), 'text': f'有票务已更新：{listing["title"]}', 'type': 'system', 'listingId': listing['id']})
            save_data(data)
            json_response(self, 200, {'listing': enrich_listing(listing, user)})
            return

        if path.startswith('/api/listings/') and path.endswith('/comments') and self.command == 'POST':
            if not user:
                json_response(self, 401, {'error': 'login required'})
                return
            listing_id = int(path.split('/')[-2])
            listing = next((item for item in data.get('listings', []) if item['id'] == listing_id), None)
            if not listing or not visible_to_user(user, listing):
                json_response(self, 404, {'error': 'not found'})
                return
            try:
                body = read_json_body(self)
            except Exception:
                json_response(self, 400, {'error': 'invalid json'})
                return
            text = str(body.get('text') or body.get('comment') or '').strip()
            if not text:
                json_response(self, 400, {'error': 'comment is required'})
                return
            comment = {
                'id': secrets.randbits(31),
                'listingId': listing_id,
                'text': text,
                'authorId': user['id'],
                'authorName': user['name'],
                'authorRole': user.get('role', 'member'),
                'createdAt': current_iso()
            }
            listing.setdefault('comments', []).insert(0, comment)
            if str(user['id']) != str(listing.get('ownerId')):
                add_notification(data, {
                    'audience': 'private',
                    'createdByRole': 'admin',
                    'createdById': user.get('id'),
                    'text': f'你的票务有新评论：{listing["title"]}',
                    'type': 'comment',
                    'targetUserId': listing.get('ownerId'),
                    'listingId': listing_id,
                    'commentId': comment['id']
                })
            save_data(data)
            json_response(self, 200, {'comment': comment})
            return

        if path.startswith('/api/listings/') and '/comments/' in path and self.command == 'DELETE':
            if not user:
                json_response(self, 401, {'error': 'login required'})
                return
            parts = path.strip('/').split('/')
            if len(parts) != 5 or parts[0] != 'api' or parts[1] != 'listings' or parts[3] != 'comments':
                json_response(self, 404, {'error': 'not found'})
                return
            try:
                listing_id = int(parts[2])
            except ValueError:
                json_response(self, 404, {'error': 'not found'})
                return
            comment_id = parts[4]
            listing = next((item for item in data.get('listings', []) if item['id'] == listing_id), None)
            if not listing or not visible_to_user(user, listing):
                json_response(self, 404, {'error': 'not found'})
                return
            comments = listing.get('comments', []) if isinstance(listing.get('comments', []), list) else []
            comment_index = next((idx for idx, item in enumerate(comments) if str(item.get('id')) == comment_id), None)
            if comment_index is None:
                json_response(self, 404, {'error': 'not found'})
                return
            comment = comments[comment_index]
            if not (user.get('role') == 'admin' or str(comment.get('authorId')) == str(user.get('id'))):
                json_response(self, 403, {'error': 'forbidden'})
                return
            comments.pop(comment_index)
            listing['comments'] = comments
            save_data(data)
            json_response(self, 200, {'ok': True})
            return

        if path.startswith('/api/listings/') and self.command == 'DELETE':
            if not user:
                json_response(self, 401, {'error': 'login required'})
                return
            listing_id = int(path.split('/')[-1])
            index = next((idx for idx, item in enumerate(data.get('listings', [])) if item['id'] == listing_id), None)
            if index is None:
                json_response(self, 404, {'error': 'not found'})
                return
            listing = data['listings'][index]
            if not (user['role'] == 'admin' or listing['ownerId'] == user['id']):
                json_response(self, 403, {'error': 'forbidden'})
                return
            del data['listings'][index]
            data.setdefault('reviews', []).insert(0, {'id': secrets.randbits(31), 'listingId': listing_id, 'action': 'delete', 'status': 'done', 'note': '已删除', 'createdAt': 'now', 'operator': user['name']})
            add_notification(data, {'audience': 'all', 'createdByRole': 'admin', 'createdById': user.get('id'), 'text': f'票务已下架：{listing["title"]}', 'type': 'system', 'listingId': listing_id})
            save_data(data)
            json_response(self, 200, {'ok': True})
            return

        if path.startswith('/api/listings/') and path.endswith('/favorite') and self.command == 'POST':
            if not user:
                json_response(self, 401, {'error': 'login required'})
                return
            listing_id = int(path.split('/')[3])
            listing = next((item for item in data.get('listings', []) if item['id'] == listing_id), None)
            if not listing or not visible_to_user(user, listing):
                json_response(self, 404, {'error': 'not found'})
                return
            favorites = set(listing.get('favoritesBy', []))
            if user['id'] in favorites:
                favorites.remove(user['id'])
            else:
                favorites.add(user['id'])
            listing['favoritesBy'] = list(favorites)
            save_data(data)
            json_response(self, 200, {'listing': enrich_listing(listing, user)})
            return

        if path.startswith('/api/listings/') and path.endswith('/review') and self.command == 'POST':
            if not user or user.get('role') != 'admin':
                json_response(self, 403, {'error': 'admin only'})
                return
            listing_id = int(path.split('/')[3])
            listing = next((item for item in data.get('listings', []) if item['id'] == listing_id), None)
            if not listing:
                json_response(self, 404, {'error': 'not found'})
                return
            try:
                body = read_json_body(self)
            except Exception:
                json_response(self, 400, {'error': 'invalid json'})
                return
            action = body.get('action')
            if action not in {'approve', 'reject'}:
                json_response(self, 400, {'error': 'invalid review action'})
                return
            listing['status'] = 'approved' if action == 'approve' else 'rejected'
            note = body.get('note') or ('审核通过' if action == 'approve' else '审核驳回')
            listing.setdefault('reviewLog', []).insert(0, {'at': 'now', 'action': action, 'by': user['name'], 'note': note})
            data.setdefault('reviews', []).insert(0, {'id': secrets.randbits(31), 'listingId': listing_id, 'action': action, 'status': listing['status'], 'note': note, 'createdAt': 'now', 'operator': user['name']})
            add_notification(data, {'audience': 'all', 'createdByRole': 'admin', 'createdById': user.get('id'), 'text': f'票务{"已通过" if action == "approve" else "被驳回"}：{listing["title"]}', 'type': 'review', 'targetUserId': listing['ownerId'], 'listingId': listing_id})
            save_data(data)
            json_response(self, 200, {'listing': enrich_listing(listing, user)})
            return

        if path == '/api/notifications' and self.command == 'GET':
            items = [item for item in data.get('notifications', []) if item.get('createdByRole') == 'admin']
            if user and user.get('role') == 'admin':
                visible = items[:12]
            elif user:
                visible = [
                    item for item in items
                    if (item.get('audience') == 'all' or item.get('targetUserId') == user.get('id'))
                    and not is_management_notification(item)
                ][:12]
            else:
                visible = [item for item in items if item.get('audience') == 'all' and not is_management_notification(item)][:12]
            json_response(self, 200, {'notifications': visible})
            return

        if path == '/api/notifications' and self.command == 'POST':
            if not user or user.get('role') != 'admin':
                json_response(self, 403, {'error': 'admin only'})
                return
            try:
                body = read_json_body(self)
            except Exception:
                json_response(self, 400, {'error': 'invalid json'})
                return
            text = str(body.get('text', '')).strip()
            if not text:
                json_response(self, 400, {'error': 'text required'})
                return
            payload = {
                'audience': body.get('audience', 'all'),
                'createdByRole': 'admin',
                'createdById': user.get('id'),
                'text': text,
                'type': body.get('type', 'system')
            }
            if body.get('targetUserId'):
                payload['targetUserId'] = body.get('targetUserId')
            notification = add_notification(data, payload)
            save_data(data)
            json_response(self, 201, {'notification': notification})
            return

        if path.startswith('/api/notifications/') and self.command == 'DELETE':
            if not user or user.get('role') != 'admin':
                json_response(self, 403, {'error': 'admin only'})
                return
            notification_id = str(path.split('/')[-1])
            index = next((idx for idx, item in enumerate(data.get('notifications', [])) if str(item.get('id')) == notification_id), None)
            if index is None:
                json_response(self, 404, {'error': 'not found'})
                return
            del data['notifications'][index]
            save_data(data)
            json_response(self, 200, {'ok': True})
            return

        if path == '/api/reviews' and self.command == 'GET':
            json_response(self, 200, {'reviews': data.get('reviews', [])[:50]})
            return

        if path == '/api/reviews/submit' and self.command == 'POST':
            if not user:
                json_response(self, 401, {'error': 'login required'})
                return
            try:
                body = read_json_body(self)
            except Exception:
                json_response(self, 400, {'error': 'invalid json'})
                return
            listing_id = int(body.get('listingId', 0))
            listing = next((item for item in data.get('listings', []) if item['id'] == listing_id), None)
            if not listing:
                json_response(self, 404, {'error': 'not found'})
                return
            review = {
                'id': secrets.randbits(31),
                'listingId': listing_id,
                'action': body.get('action', 'review'),
                'status': body.get('status', 'reviewing'),
                'note': body.get('note', ''),
                'createdAt': 'now',
                'operator': user['name']
            }
            data.setdefault('reviews', []).insert(0, review)
            listing['status'] = review['status']
            listing['reviewNote'] = review['note'] or listing.get('reviewNote', '')
            save_data(data)
            json_response(self, 200, {'review': review})
            return

        file_path = resolve_static_path(path)
        if not file_path:
            json_response(self, 404, {'error': 'not found'})
            return
        static_response(self, file_path)
        return


def main():
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print(f'StarSea backend running on http://0.0.0.0:{PORT}')
    server.serve_forever()


if __name__ == '__main__':
    main()
