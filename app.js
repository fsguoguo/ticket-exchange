(() => {
  const runtimeWindow = typeof window !== 'undefined' ? window : globalThis;
  const runtimeLocation = typeof location !== 'undefined' ? location : null;
  if (typeof document === 'undefined') return;
  const runtimeConfig = runtimeWindow.__STARSEA_CONFIG__ || {};
  const configuredApiBase = String(runtimeConfig.apiBase || runtimeWindow.__STARSEA_API_BASE__ || '').trim();
  const localApiBase = runtimeLocation && (runtimeLocation.protocol === 'file:' || runtimeLocation.hostname === 'localhost' || runtimeLocation.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : '';
  const apiBase = configuredApiBase || localApiBase;
  const tokenKey = 'starsea:token';
  const offlineSessionKey = 'starsea:offlineSession';
  const notificationReadKey = 'starsea:notificationReads';
  const notificationHiddenKey = 'starsea:notificationHidden';
  const notificationTrashKey = 'starsea:notificationTrash';
  const notificationArchivedKey = 'starsea:notificationArchived';
  const requestHeaders = { 'Content-Type': 'application/json' };
  const apiRequestTimeoutMs = 8000;

  const franchiseLabels = {
    all: '全部企划',
    bangdream: 'Bang Dream',
    lovelive: 'LoveLive',
    imas: 'IM@S',
    other: '其他'
  };

  const kindLabels = {
    all: '全部类型',
    transfer: '出票',
    seeking: '收票',
    swap: '换票'
  };

  const accentMap = {
    bangdream: '#ff6aa2',
    lovelive: '#6de2ff',
    imas: '#ff8f70',
    other: '#8bd3ff'
  };

  const priceUnitLabels = {
    jpy: '日元',
    cny: '人民币'
  };

  const contactTypeLabels = {
    qq: 'QQ',
    wechat: '微信',
    email: '邮箱',
    other: '其他'
  };

  const state = {
    currentUser: null,
    listings: [],
    notifications: [],
    page: 'home',
    franchise: 'all',
    kind: 'all',
    favoritesOnly: false,
    search: '',
    sort: 'dateDesc',
    editingId: null,
    selectedListingId: null,
    currentPage: 1,
    notificationPage: 1,
    adminLivePage: 1,
    loading: true,
    liveOptionsByFranchise: {
      bangdream: [],
      lovelive: [],
      imas: [],
      other: []
    },
    liveOptionsUpdatedAt: null
  };

  const listingPageSize = 4;
  const notificationPageSize = 5;
  const adminLivePageSize = 8;

  const refs = {};
  const liveOptionLookup = new Map();

  const pageLabels = {
    home: '首页',
    browse: '浏览',
    publish: '发布',
    center: '中心'
  };

  const pageTargets = {
    home: '.hero',
    browse: '.toolbar',
    publish: '#post',
    center: '#notificationPanel'
  };

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .topbar-actions { display: flex; align-items: center; gap: 16px; flex: 0 0 auto; }
      .notification-chip { display: inline-flex; align-items: center; gap: 8px; padding: 0; border-radius: 0; background: transparent; border: 0; box-shadow: none; backdrop-filter: none; color: var(--muted); white-space: nowrap; cursor: pointer; }
      .notification-chip strong { color: var(--text); }
      .broadcast-panel { margin-top: 14px; padding: 18px; border-radius: var(--radius-lg); border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow); }
      .broadcast-panel[hidden] { display: none !important; }
      .broadcast-form { display: grid; gap: 10px; margin-top: 12px; }
      .broadcast-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      .session-status .muted, .panel .muted { color: var(--muted-2); }
      .session-panel, .review-panel, .notification-panel { border-radius: var(--radius-lg); padding: 20px; border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow); backdrop-filter: none; }
      .session-head, .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .session-actions { display: flex; flex-wrap: wrap; gap: 10px; }
      .session-login, .session-logged { margin-top: 14px; }
      .session-logged { display: flex; justify-content: flex-start; gap: 14px; }
      #adminLiveManageButton { display: none; }
      body[data-page="center"] #adminLiveManageButton { display: inline-flex; }
      .session-feedback-box { margin-top: 12px; display: grid; gap: 8px; }
      .session-feedback-box[hidden] { display: none !important; }
      .session-feedback { margin: 10px 0 0; min-height: 1.4em; color: var(--muted); font-size: 0.88rem; line-height: 1.6; }
      .session-feedback.is-success { color: #17855f; }
      .session-feedback.is-error { color: #d44a4a; }
      .session-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
      .session-stat { padding: 12px; border-radius: 14px; background: var(--surface-strong); border: 1px solid var(--border); }
      .session-stat span { display: block; color: var(--muted-2); font-size: 0.8rem; margin-bottom: 6px; }
      .session-stat strong { font-size: 1.02rem; }
      .composer-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .composer-badge, .status-pill, .tiny-pill { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 999px; background: rgba(76, 141, 255, 0.08); border: 1px solid var(--border); color: var(--muted); font-size: 0.84rem; }
      .choice-grid { display: grid; grid-template-columns: 1fr; gap: 10px; }
      .choice-card { display: grid; gap: 8px; padding: 12px; border-radius: 14px; border: 1px solid rgba(76, 141, 255, 0.12); background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(248, 251, 255, 0.96)); box-shadow: 0 8px 18px rgba(58, 89, 133, 0.06); }
      .choice-label { color: var(--muted-2); font-size: 0.8rem; letter-spacing: 0.02em; }
      .choice-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .choice-btn { border: 1px solid rgba(27, 46, 73, 0.08); background: rgba(255, 255, 255, 0.82); color: var(--muted); padding: 11px 12px; border-radius: 12px; min-height: 46px; box-shadow: none; justify-content: center; font-weight: 600; min-width: 0; white-space: normal; text-align: center; line-height: 1.25; overflow-wrap: anywhere; }
      .choice-btn:hover { border-color: rgba(76, 141, 255, 0.22); background: rgba(76, 141, 255, 0.05); transform: translateY(-1px); }
      .choice-btn.is-active { color: var(--text); border-color: rgba(76, 141, 255, 0.24); background: linear-gradient(135deg, rgba(76, 141, 255, 0.12), rgba(111, 211, 255, 0.14)); box-shadow: 0 10px 18px rgba(76, 141, 255, 0.12); }
      .composer-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 0; }
      .composer-status { display: grid; gap: 14px; margin-top: 14px; }
      .composer-note { margin: 0; color: var(--muted-2); font-size: 0.84rem; line-height: 1.5; }
      .official-live-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; min-height: 30px; }
      .official-live-tag { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; border: 1px solid var(--border); background: rgba(255, 255, 255, 0.9); color: var(--text); font-size: 0.8rem; line-height: 1; }
      .official-live-tag.is-fixed { background: rgba(76, 141, 255, 0.08); border-color: rgba(76, 141, 255, 0.2); }
      .official-live-tag-remove { border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 0; font-size: 0.9rem; line-height: 1; }
      .official-live-tag-remove:hover { color: #cf4a4a; }
      .chip[data-favorites="1"] { border-style: dashed; }
      .chip[data-favorites="1"].is-active { border-style: solid; }
      .listing-card { position: relative; overflow: hidden; }
      .listing-card::before { content: ''; position: absolute; inset: 0 0 auto; height: 3px; background: linear-gradient(90deg, rgba(76, 141, 255, 0.16), var(--accent, #4c8dff)); }
      .listing-pager { display: none; align-items: center; justify-content: center; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
      .pager-button { min-width: 44px; justify-content: center; padding: 10px 14px; border: 1px solid var(--border); background: rgba(255, 255, 255, 0.86); color: var(--text); border-radius: 12px; box-shadow: 0 8px 16px rgba(58, 89, 133, 0.06); }
      .pager-button.is-active { border-color: rgba(76, 141, 255, 0.24); background: linear-gradient(135deg, rgba(76, 141, 255, 0.12), rgba(111, 211, 255, 0.14)); box-shadow: 0 10px 18px rgba(76, 141, 255, 0.12); font-weight: 700; }
      .pager-info { color: var(--muted); font-size: 0.84rem; padding: 0 4px; }
      .listing-card.is-owned { border-color: rgba(41, 184, 129, 0.18); box-shadow: var(--shadow), inset 0 0 0 1px rgba(41, 184, 129, 0.05); }
      .listing-owner { display: inline-flex; align-items: center; gap: 8px; margin-top: 10px; color: var(--muted-2); font-size: 0.84rem; }
      .listing-owner strong { color: var(--text); font-weight: 700; }
      .card-btn.danger { border-color: rgba(255, 120, 120, 0.22); background: rgba(255, 120, 120, 0.08); color: #cf4a4a; }
      .card-btn.secondary { border-color: rgba(76, 141, 255, 0.18); background: rgba(76, 141, 255, 0.08); }
      .detail-overlay { position: fixed; inset: 0; z-index: 80; display: none; align-items: center; justify-content: center; background: rgba(235, 242, 251, 0.78); backdrop-filter: blur(10px); padding: 28px; }
      .detail-overlay.is-open { display: flex; }
      .detail-sheet { width: min(980px, 100%); max-height: min(90vh, 920px); overflow: auto; border-radius: 24px; border: 1px solid var(--border); background: var(--surface); box-shadow: 0 24px 50px rgba(58, 89, 133, 0.16); }
      .detail-shell { padding: 30px; display: grid; gap: 18px; }
      .detail-top { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; flex-wrap: wrap; padding-bottom: 14px; }
      .detail-title { margin: 0 0 6px; font-size: clamp(1.5rem, 3vw, 2.4rem); }
      .detail-top .muted { display: block; margin-top: 8px !important; line-height: 1.7; }
      .detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 0; }
      .detail-card { padding: 18px; border-radius: 18px; background: var(--surface-strong); border: 1px solid var(--border); }
      .detail-card span { display: block; color: var(--muted-2); font-size: 0.8rem; margin-bottom: 8px; }
      .detail-card strong { font-size: 1rem; line-height: 1.7; }
      .detail-body { display: grid; gap: 16px; margin-top: 16px; }
      .detail-actions { display: flex; flex-wrap: wrap; gap: 12px; padding-top: 4px; }
      .detail-message { min-height: 1.4em; color: var(--muted); font-size: 0.88rem; line-height: 1.6; }
      .detail-message.is-success { color: #17855f; }
      .detail-message.is-error { color: #d44a4a; }
      .detail-history { display: grid; gap: 12px; }
      .history-item { padding: 14px; border-radius: 14px; background: #ffffff; border: 1px solid var(--border); color: var(--muted); line-height: 1.65; }
      .review-panel, .notification-panel { margin-top: 14px; }
      .review-list, .notification-list { display: grid; gap: 10px; margin-top: 12px; }
      .review-item, .notification-item { padding: 12px; border-radius: 14px; background: var(--surface-strong); border: 1px solid var(--border); }
      .notification-item { cursor: pointer; transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease; }
      .notification-item:hover { transform: translateY(-1px); border-color: rgba(76, 141, 255, 0.22); box-shadow: 0 10px 20px rgba(58, 89, 133, 0.08); }
      .notification-item.is-unread { background: linear-gradient(135deg, rgba(76, 141, 255, 0.12), rgba(111, 211, 255, 0.18)); border-color: rgba(76, 141, 255, 0.28); }
      .notification-item.is-unread .muted { color: var(--text); font-weight: 600; }
      .notification-item.is-read { opacity: 0.92; }
      .notification-unread-dot { display: inline-flex; align-items: center; margin-left: 8px; padding: 2px 8px; border-radius: 999px; background: #ff6a6a; color: #fff; font-size: 0.72rem; font-weight: 700; vertical-align: middle; }
      .notification-meta { margin-top: 4px; color: var(--muted-2); font-size: 0.78rem; }
      .notification-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 10px; }
      .review-item-head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
      .review-item-title { margin: 0; font-weight: 700; }
      .review-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
      .loading-note, .empty-note { padding: 24px; text-align: center; border-radius: 18px; border: 1px dashed rgba(76, 141, 255, 0.16); color: var(--muted); background: rgba(255,255,255,0.82); }
      .favorite-count { color: var(--muted-2); font-size: 0.84rem; }
      .detail-close { margin-left: auto; }
      .bookmark-on { background: rgba(76, 141, 255, 0.14) !important; border-color: rgba(76, 141, 255, 0.24) !important; color: #1d4f9c !important; }
      .page-rail { display: inline-flex; flex-wrap: nowrap; gap: 8px; align-items: center; justify-content: flex-start; white-space: nowrap; }
      .page-rail button { border: 1px solid var(--border); background: rgba(255, 255, 255, 0.9); color: var(--text); border-radius: 999px; padding: 9px 14px; box-shadow: 0 8px 16px rgba(58, 89, 133, 0.06); }
      .page-rail button.is-active { background: linear-gradient(135deg, rgba(76, 141, 255, 0.14), rgba(111, 211, 255, 0.16)); border-color: rgba(76, 141, 255, 0.24); font-weight: 700; }
      body:not([data-page="home"]) .topbar-inner { padding: 4px 0 2px !important; }
      body:not([data-page="home"]) .topbar-inner > .brand { visibility: hidden !important; }
      body:not([data-page="home"]) .topbar-actions > :not(.page-rail):not(.notification-chip):not(.session-chip) { display: none !important; }
      body:not([data-page="home"]) .topbar-actions { display: flex !important; width: auto !important; justify-content: flex-end !important; }
      body[data-page="home"] .toolbar,
      body[data-page="home"] .listings,
      body[data-page="home"] #post { display: none !important; }
      body[data-page="home"] .notification-panel { display: none !important; }
      body[data-page="browse"] .hero,
      body[data-page="browse"] .notice-disclaimer,
      body[data-page="browse"] #post,
      body[data-page="browse"] .notification-panel { display: none !important; }
      body[data-page="browse"] .listings-grid { grid-template-columns: 1fr; }
      body[data-page="browse"] .listings-grid,
      body[data-page="browse"] .listings-grid > div,
      body[data-page="browse"] .listing-list,
      body[data-page="browse"] .listing-card { width: 100%; min-width: 0; }
      body[data-page="publish"] .hero,
      body[data-page="publish"] .notice-disclaimer,
      body[data-page="publish"] .toolbar,
      body[data-page="publish"] .notification-panel { display: none !important; }
      body[data-page="publish"] .listings-grid { grid-template-columns: 1fr; }
      body[data-page="publish"] .listings-grid > :first-child { display: none; }
      body[data-page="center"] .toolbar,
      body[data-page="center"] .notice-disclaimer { display: none !important; }
      body[data-page="center"] .listings-grid { grid-template-columns: 1fr; }
      body[data-page="center"] .listings-grid > :first-child { display: none; }
      body[data-page="center"] #post .composer { display: none !important; }
      body[data-page="center"] #post { display: grid !important; }
      body[data-page="center"] .hero { margin-bottom: 4px; }
      @media (max-width: 760px) {
        body:not([data-page="home"]) .topbar-inner > .brand,
        body:not([data-page="home"]) .topbar-actions > :not(.page-rail) {
          display: none !important;
        }
        .topbar-actions { flex-wrap: wrap; width: 100%; gap: 8px; align-items: stretch; }
        .page-rail {
          position: fixed;
          z-index: 90;
          left: max(10px, env(safe-area-inset-left));
          right: max(10px, env(safe-area-inset-right));
          bottom: max(10px, env(safe-area-inset-bottom));
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 4px;
          width: auto;
          min-width: 0;
          padding: 6px;
          border: 1px solid rgba(27, 46, 73, 0.10);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.94);
          box-shadow: 0 16px 34px rgba(58, 89, 133, 0.16);
          backdrop-filter: blur(14px);
        }
        .page-rail button {
          min-width: 0;
          min-height: 44px;
          padding: 7px 4px;
          border-radius: 12px;
          box-shadow: none;
          font-size: 0.86rem;
          text-align: center;
        }
        .notification-chip { order: -2; }
        #adminBroadcastButton { order: -1; }
        #adminLiveRefreshButton { order: -1; }
        .session-chip { order: 0; }
        .notification-chip,
        .session-chip,
        #adminBroadcastButton,
        #adminLiveRefreshButton {
          flex: 1 1 calc(50% - 4px);
          justify-content: center;
          min-height: 38px;
          padding: 7px 9px;
          border-radius: 11px;
          border: 1px solid var(--border);
          background: rgba(255, 255, 255, 0.88);
          box-shadow: 0 8px 16px rgba(58, 89, 133, 0.06);
          white-space: normal;
          text-align: center;
          line-height: 1.25;
          font-size: 0.88rem;
        }
        .notification-chip span,
        .session-chip span { color: var(--muted); font-size: 0.76rem; }
        body[data-page="browse"] .listings-grid { margin-left: 0; width: 100%; }
        body[data-page="browse"] .listing-list,
        body[data-page="browse"] .listing-card,
        body[data-page="browse"] .card-top,
        body[data-page="browse"] .card-main,
        body[data-page="browse"] .badge-row,
        body[data-page="browse"] .meta-grid,
        body[data-page="browse"] .meta,
        body[data-page="browse"] .meta-value,
        body[data-page="browse"] .card-actions,
        body[data-page="browse"] .card-btn {
          min-width: 0;
          max-width: 100%;
        }
        body[data-page="browse"] .card-top { overflow: hidden; }
        body[data-page="browse"] .badge-row {
          flex-wrap: wrap;
          overflow-x: visible;
          width: 100%;
        }
        body[data-page="browse"] .badge,
        body[data-page="browse"] .tiny-pill,
        body[data-page="browse"] .meta-value,
        body[data-page="browse"] .card-btn {
          white-space: normal;
          word-break: break-word;
          overflow-wrap: anywhere;
        }
        body[data-page="browse"] .meta-grid,
        body[data-page="browse"] .card-actions { grid-template-columns: 1fr; }
        .detail-overlay {
          align-items: flex-end;
          justify-content: center;
          padding: 10px max(10px, env(safe-area-inset-right)) max(0px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left));
        }
        .detail-sheet {
          width: 100%;
          max-height: 92dvh;
          border-radius: 20px 20px 0 0;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
        }
        .detail-shell { padding: 12px; gap: 10px; }
        .detail-top { gap: 8px; padding-bottom: 8px; }
        .detail-title { font-size: 1.18rem; line-height: 1.22; overflow-wrap: anywhere; }
        .detail-top .muted { font-size: 0.8rem; line-height: 1.45; }
        .detail-grid,
        .session-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
        .detail-card { padding: 10px; border-radius: 12px; }
        .detail-card span { margin-bottom: 3px; font-size: 0.72rem; }
        .detail-card strong { font-size: 0.9rem; line-height: 1.4; }
        .detail-body { gap: 10px; margin-top: 8px; }
        .detail-card strong,
        .history-item,
        .notification-item,
        .review-item,
        .muted { overflow-wrap: anywhere; }
        .detail-actions,
        .broadcast-actions,
        .notification-actions,
        .review-actions,
        .panel-head-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
          width: 100%;
          justify-content: stretch;
        }
        .detail-actions .btn,
        .detail-actions .card-btn,
        .broadcast-actions .btn,
        .notification-actions .card-btn,
        .review-actions .card-btn,
        .panel-head-actions .btn {
          width: 100%;
          min-height: 38px;
          justify-content: center;
          text-align: center;
          padding: 7px 8px;
          font-size: 0.84rem;
        }
        .detail-close { margin-left: 0; width: 100%; justify-content: center; }
        .panel-head,
        .review-item-head,
        .comment-panel-head {
          align-items: stretch;
        }
        .notification-item,
        .review-item,
        .comment-panel,
        .broadcast-panel,
        .notification-panel,
        .review-panel {
          padding: 10px;
          border-radius: 12px;
        }
        .broadcast-panel,
        .review-panel,
        .notification-panel { margin-top: 8px; }
        .notification-meta { font-size: 0.72rem; line-height: 1.35; }
        .review-item-title { font-size: 0.9rem; line-height: 1.35; }
        .notification-item .muted,
        .review-item .muted { font-size: 0.84rem; line-height: 1.45; }
        .tiny-pill,
        .composer-badge,
        .status-pill {
          padding: 5px 8px;
          font-size: 0.74rem;
          line-height: 1.15;
        }
        .comment-form { gap: 8px; }
        .comment-message,
        .detail-message { font-size: 0.8rem; line-height: 1.4; }
        .notification-list,
        .review-list { gap: 6px; }
        .listing-pager { gap: 6px; margin-top: 10px; }
        .pager-button { min-height: 38px; padding: 7px 9px; font-size: 0.84rem; }
      }
      @media (max-width: 380px) {
        .notification-chip,
        .session-chip,
        #adminBroadcastButton,
        #adminLiveRefreshButton { flex-basis: 100%; }
        .detail-grid { grid-template-columns: 1fr; }
        .detail-actions,
        .broadcast-actions,
        .notification-actions,
        .review-actions,
        .panel-head-actions { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  function apiBaseUrl() {
    return apiBase;
  }

  function setPage(page, options = {}) {
    const nextPage = pageLabels[page] ? page : 'home';
    state.page = nextPage;
    syncPageNavigation();
    if (options.scroll !== false) {
      const target = document.querySelector(pageTargets[nextPage]);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function syncPageNavigation() {
    document.body.dataset.page = state.page || 'home';
    if (!refs.pageButtons) return;
    Object.entries(refs.pageButtons).forEach(([page, button]) => {
      if (button) button.classList.toggle('is-active', page === state.page);
    });
  }

  function normalizePriceUnit(unit) {
    return String(unit || 'jpy').toLowerCase() === 'cny' ? 'cny' : 'jpy';
  }

  function priceUnitLabel(unit) {
    return priceUnitLabels[normalizePriceUnit(unit)] || priceUnitLabels.jpy;
  }

  function parsePriceMeta(priceText, priceAmount, priceUnit) {
    const explicitAmount = String(priceAmount || '').trim();
    if (explicitAmount) {
      return {
        amount: explicitAmount,
        unit: normalizePriceUnit(priceUnit)
      };
    }
    const raw = String(priceText || '').trim();
    const match = raw.match(/^([\d.]+)\s*(日元|人民币|元|¥|￥)?$/i);
    if (match) {
      return {
        amount: match[1],
        unit: match[2] === '人民币' ? 'cny' : 'jpy'
      };
    }
    return {
      amount: raw,
      unit: normalizePriceUnit(priceUnit)
    };
  }

  function formatPriceDisplay(amount, unit) {
    const text = String(amount || '').trim();
    if (!text) return '面议';
    if (/面议|等值互换/.test(text)) return text;
    return `${text} ${priceUnitLabel(unit)}`;
  }

  function normalizeContactType(type) {
    const value = String(type || '').toLowerCase();
    if (value === 'qq' || value === 'wechat' || value === 'email') return value;
    return 'other';
  }

  function contactTypeLabel(type) {
    return contactTypeLabels[normalizeContactType(type)] || contactTypeLabels.other;
  }

  function parseContactMeta(contactText, contactType, contactValue) {
    const explicitValue = String(contactValue || '').trim();
    if (explicitValue) {
      return {
        type: normalizeContactType(contactType),
        value: explicitValue
      };
    }
    const raw = String(contactText || '').trim();
    const slashIndex = raw.indexOf(' / ');
    if (slashIndex > 0) {
      const label = raw.slice(0, slashIndex).trim().toLowerCase();
      const value = raw.slice(slashIndex + 3).trim();
      const type = Object.keys(contactTypeLabels).find(key => contactTypeLabels[key].toLowerCase() === label) || 'other';
      return { type, value: value || raw };
    }
    return {
      type: normalizeContactType(contactType),
      value: raw
    };
  }

  function formatContactDisplay(type, value, fallback = '站内发布 / 待补充') {
    const text = String(value || '').trim();
    if (!text) return fallback;
    return `${contactTypeLabel(type)} / ${text}`;
  }

  function loadOfflineSession() {
    try {
      const payload = JSON.parse(localStorage.getItem(offlineSessionKey) || 'null');
      if (!payload || !payload.user) return null;
      return payload.user;
    } catch {
      return null;
    }
  }

  function saveOfflineSession(user) {
    if (!user) return;
    localStorage.setItem(offlineSessionKey, JSON.stringify({ user }));
  }

  function clearOfflineSession() {
    localStorage.removeItem(offlineSessionKey);
  }

  function isBackendUnavailable(error) {
    return error && (error.status === 503 || error.status === 502 || error.status === 504 || /timeout|fetch|network/i.test(String(error.message || '')));
  }

  async function apiFetch(path, options = {}) {
    if (!apiBase) {
      throw new Error('未配置后端地址，请先在 config.js 中填写 API 地址。');
    }
    const token = localStorage.getItem(tokenKey) || '';
    const headers = { ...requestHeaders, ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? window.setTimeout(() => controller.abort(), apiRequestTimeoutMs) : null;
    let response;
    try {
      response = await fetch(`${apiBaseUrl()}${path}`, { ...options, headers, signal: controller ? controller.signal : undefined });
    } catch (error) {
      if (timer) window.clearTimeout(timer);
      throw error;
    }
    if (timer) window.clearTimeout(timer);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function normalizeListing(listing) {
    const canSerialRaw = listing.canSerial;
    const priceMeta = parsePriceMeta(listing.price, listing.priceAmount, listing.priceUnit);
    const contactMeta = parseContactMeta(listing.contact, listing.contactType, listing.contactValue);
    return {
      ...listing,
      favoriteCount: listing.favoriteCount ?? (Array.isArray(listing.favoritesBy) ? listing.favoritesBy.length : 0),
      favorited: !!listing.favorited,
      reviewLog: Array.isArray(listing.reviewLog) ? listing.reviewLog : [],
      quantity: Number(listing.quantity ?? 1) || 1,
      isPremium: listing.isPremium === true || listing.isPremium === 'true' || listing.isPremium === 'yes' || listing.isPremium === 1 || listing.isPremium === '1',
      canSerial: canSerialRaw === true || canSerialRaw === 'true' || canSerialRaw === 'yes' || canSerialRaw === 1 || canSerialRaw === '1',
      priceAmount: priceMeta.amount,
      priceUnit: priceMeta.unit,
      priceDisplay: formatPriceDisplay(priceMeta.amount, priceMeta.unit),
      contactType: contactMeta.type,
      contactValue: contactMeta.value,
      contactDisplay: formatContactDisplay(contactMeta.type, contactMeta.value, listing.contact || '站内发布 / 待补充'),
      comments: Array.isArray(listing.comments) ? listing.comments : [],
      commentCount: Number(listing.commentCount ?? (Array.isArray(listing.comments) ? listing.comments.length : 0)) || 0
    };
  }

  function getOwnerName(listing) {
    if (listing.ownerName && listing.ownerName !== '匿名发布') return listing.ownerName;
    return listing.owner || listing.ownerName || '匿名发布';
  }

  function canManageListing(listing) {
    if (!state.currentUser) return false;
    return state.currentUser.role === 'admin' || listing.ownerId === state.currentUser.id;
  }

  function isVisibleForCurrentUser(listing) {
    if (state.currentUser?.role === 'admin') return true;
    if (!state.currentUser) return listing.status === 'approved';
    return listing.status === 'approved' || listing.ownerId === state.currentUser.id;
  }

  function pickAccent(franchise, kind) {
    if (franchise === 'bangdream' && kind === 'transfer') return '#ff6aa2';
    if (franchise === 'bangdream' && kind === 'seeking') return '#77f0b3';
    if (franchise === 'bangdream' && kind === 'swap') return '#ffd36e';
    if (franchise === 'lovelive' && kind === 'transfer') return '#6de2ff';
    if (franchise === 'lovelive' && kind === 'seeking') return '#9a7bff';
    if (franchise === 'imas') return '#ff8f70';
    return '#8bd3ff';
  }

  function franchiseLabel(franchise) {
    return franchiseLabels[franchise] || '其他';
  }

  function kindLabel(kind) {
    return kindLabels[kind] || '其他';
  }

  function parseListingTimestamp(candidate) {
    if (!candidate) return 0;
    if (candidate === 'now') return Date.now();
    const text = String(candidate).trim();
    const dateMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (dateMatch) {
      const year = Number(dateMatch[1]);
      const month = Number(dateMatch[2]) - 1;
      const day = Number(dateMatch[3]);
      const hour = Number(dateMatch[4] || 0);
      const minute = Number(dateMatch[5] || 0);
      const second = Number(dateMatch[6] || 0);
      return Date.UTC(year, month, day, hour, minute, second);
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  function listingPublishedTimestamp(listing) {
    const candidates = [listing.updatedAt, listing.createdAt, listing.reviewLog?.[0]?.at];
    for (const candidate of candidates) {
      const timestamp = parseListingTimestamp(candidate);
      if (timestamp) return timestamp;
    }
    return 0;
  }

  function listingEventTimestamp(listing) {
    const candidates = [listing.date, listing.updatedAt, listing.createdAt, listing.reviewLog?.[0]?.at];
    for (const candidate of candidates) {
      const timestamp = parseListingTimestamp(candidate);
      if (timestamp) return timestamp;
    }
    return 0;
  }

  function buildPayloadFromForm(formData) {
    const franchise = String(formData.get('franchise') || 'other');
    const kind = String(formData.get('kind') || 'transfer');
    const meta = String(formData.get('meta') || '');
    const parts = meta.split('·').map(item => item.trim()).filter(Boolean);
    const city = parts[0] || '未填写 live 地点';
    const venue = parts[1] || parts[0] || '';
    const date = String(formData.get('date') || '') || new Date().toISOString().slice(0, 10);
    const title = String(formData.get('title') || '未命名票务');
    const note = String(formData.get('note') || '');
    const quantity = Math.max(1, Number(formData.get('quantity') || 1) || 1);
    const canSerial = quantity > 1 && String(formData.get('canSerial') || 'yes') === 'yes';
    const isPremium = String(formData.get('isPremium') || 'no') === 'yes';
    const officialLiveId = String(formData.get('officialLiveId') || '').trim();
    const selectedLiveOption = officialLiveId ? liveOptionLookup.get(officialLiveId) : null;
    const formLiveTags = parseOfficialLiveTags(formData.get('officialLiveTags'));
    const formLiveDates = parseOfficialLiveDates(formData.get('officialLiveDates'));
    const manualExtraDates = parseFlexibleDateList(formData.getAll('extraDates[]'));
    const legacyExtraDates = !manualExtraDates.length ? parseFlexibleDateList(formData.get('extraDates')) : [];
    const mergedDates = Array.from(new Set([
      ...formLiveDates,
      ...manualExtraDates,
      ...legacyExtraDates,
      String(date || '').trim()
    ].filter(item => /^\d{4}-\d{2}-\d{2}$/.test(String(item || ''))))).sort();
    const primaryDate = mergedDates[0] || date;
    const listingTags = formData.has('officialLiveTags') ? formLiveTags : visibleTicketTags(selectedLiveOption?.tags);
    const priceMeta = parsePriceMeta(formData.get('price'), formData.get('priceAmount'), formData.get('priceUnit'));
    const contactMeta = parseContactMeta(formData.get('contactDisplay'), formData.get('contactType'), formData.get('contactValue'));
    return {
      franchise,
      franchiseLabel: franchiseLabel(franchise),
      kind,
      kindLabel: kindLabel(kind),
      title,
      subtitle: note.slice(0, 36),
      city,
      venue,
      date: primaryDate,
      eventDates: mergedDates.length ? mergedDates : [primaryDate],
      price: formatPriceDisplay(priceMeta.amount, priceMeta.unit),
      priceAmount: priceMeta.amount,
      priceUnit: priceMeta.unit,
      contact: formatContactDisplay(contactMeta.type, contactMeta.value, '站内发布 / 待补充'),
      contactType: contactMeta.type,
      contactValue: contactMeta.value,
      tags: listingTags,
      note,
      quantity,
      canSerial,
      isPremium,
      accent: pickAccent(franchise, kind)
    };
  }

  function normalizeLiveOption(option) {
    if (!option || typeof option !== 'object') return null;
    const id = String(option.id || '').trim();
    const franchise = String(option.franchise || '').trim().toLowerCase();
    const title = String(option.title || '').trim();
    const date = String(option.date || '').trim();
    const city = String(option.city || '').trim();
    const venue = String(option.venue || '').trim();
    const tags = Array.isArray(option.tags) ? option.tags.map(item => String(item || '').trim()).filter(Boolean) : [];
    const url = String(option.url || '').trim();
    const sourceRaw = String(option.source || '').trim().toLowerCase();
    const source = sourceRaw === 'manual' || url.startsWith('manual://') ? 'manual' : 'official';
    if (!id || !franchise || !title || !date || !venue) return null;
    return { id, franchise, title, date, city, venue, tags, url, source, franchiseLabel: option.franchiseLabel || '' };
  }

  function visibleTicketTags(tags) {
    return (Array.isArray(tags) ? tags : [])
      .map(item => sanitizeOfficialLiveTag(item))
      .filter(Boolean)
      .filter(tag => !isGenericOfficialLiveTag(tag))
      .slice(0, 8);
  }

  function sanitizeOfficialLiveTag(tag) {
    let text = String(tag || '').trim();
    if (!text) return '';
    text = text
      .replace(/ライブ\s*[\/／]\s*イベント/ig, ' ')
      .replace(/live\s*[\/／]\s*event/ig, ' ')
      .replace(/live\s*[·・._-]?\s*event/ig, ' ')
      .replace(/ライブイベント/ig, ' ')
      .replace(/\b(?:official|live|event)\b/ig, ' ')
      .replace(/官方/ig, ' ')
      .replace(/ライブ/ig, ' ')
      .replace(/[\s·・._\-/]+/g, ' ')
      .trim();
    return text;
  }

  function isGenericOfficialLiveTag(tag) {
    const text = String(tag || '').trim().toLowerCase();
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

  function normalizeOfficialLiveTags(tags) {
    const list = Array.isArray(tags) ? tags : [];
    return Array.from(new Set(
      list
        .map(item => sanitizeOfficialLiveTag(item))
        .filter(Boolean)
        .filter(item => !isGenericOfficialLiveTag(item))
    ));
  }

  function collectFixedPublishTags() {
    if (!refs.draftForm) return [];
    const franchise = String(refs.draftForm.elements.franchise?.value || 'other');
    const kind = String(refs.draftForm.elements.kind?.value || 'transfer');
    const isPremium = String(refs.draftForm.elements.isPremium?.value || 'no') === 'yes';
    const quantity = Math.max(1, Number(refs.draftForm.elements.quantity?.value || 1) || 1);
    const canSerial = String(refs.draftForm.elements.canSerial?.value || 'no') === 'yes';

    const fixed = [
      franchiseLabel(franchise),
      kindLabel(kind),
      isPremium ? '严选票' : '非严选票'
    ];
    if (quantity > 1) {
      fixed.push(canSerial ? '可连番' : '不可连番');
    }
    return Array.from(new Set(fixed.map(item => String(item || '').trim()).filter(Boolean)));
  }

  function parseOfficialLiveTags(rawValue) {
    const text = String(rawValue || '').trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      return normalizeOfficialLiveTags(Array.isArray(parsed) ? parsed : []);
    } catch {
      return normalizeOfficialLiveTags(text.split(',').map(item => item.trim()));
    }
  }

  function setOfficialLiveTags(tags) {
    if (!refs.draftForm) return;
    const normalized = normalizeOfficialLiveTags(tags);
    if (refs.draftForm.elements.officialLiveTags) {
      refs.draftForm.elements.officialLiveTags.value = JSON.stringify(normalized);
    }
    renderOfficialLiveTags(normalized);
  }

  function parseOfficialLiveDates(rawValue) {
    const text = String(rawValue || '').trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      return Array.from(new Set((Array.isArray(parsed) ? parsed : [])
        .map(item => String(item || '').trim())
        .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item)))).sort();
    } catch {
      return [];
    }
  }

  function parseFlexibleDateList(rawValue) {
    const rawText = Array.isArray(rawValue)
      ? rawValue.map(item => String(item || '').trim()).filter(Boolean).join(',')
      : String(rawValue || '').trim();
    if (!rawText) return [];
    const tokens = rawText
      .replace(/[，；;、\n\r\t]+/g, ',')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    const normalized = [];
    for (const token of tokens) {
      const slashNormalized = token.replace(/\//g, '-');
      const isoMatch = slashNormalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!isoMatch) continue;
      const year = Number(isoMatch[1]);
      const month = Number(isoMatch[2]);
      const day = Number(isoMatch[3]);
      if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) continue;
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      normalized.push(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
    return Array.from(new Set(normalized)).sort();
  }

  function setOfficialLiveDates(dates) {
    if (!refs.draftForm?.elements.officialLiveDates) return;
    const normalized = Array.from(new Set((Array.isArray(dates) ? dates : [])
      .map(item => String(item || '').trim())
      .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item)))).sort();
    refs.draftForm.elements.officialLiveDates.value = JSON.stringify(normalized);
  }

  function collectMatchedOfficialLiveDates(item) {
    if (!item || !item.franchise) return [];
    const pool = Array.isArray(state.liveOptionsByFranchise[item.franchise]) ? state.liveOptionsByFranchise[item.franchise] : [];
    return Array.from(new Set(pool
      .map(normalizeLiveOption)
      .filter(Boolean)
      .filter(option => option.title === item.title && option.venue === item.venue)
      .map(option => option.date)
      .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))))).sort();
  }

  function createExtraDateField(name, value = '') {
    const row = document.createElement('div');
    row.className = 'field-row';
    row.dataset.extraDateRow = '1';

    const input = document.createElement('input');
    input.className = 'field';
    input.type = 'date';
    input.name = name;
    input.value = String(value || '').trim();

    const remove = document.createElement('button');
    remove.className = 'btn btn-secondary';
    remove.type = 'button';
    remove.dataset.removeExtraDate = '1';
    remove.textContent = '删除日期';

    row.appendChild(input);
    row.appendChild(remove);
    return row;
  }

  function setPublishExtraDates(dates) {
    const container = document.getElementById('extraDatesList');
    if (!container) return;
    container.innerHTML = '';
    const normalized = parseFlexibleDateList(dates);
    normalized.forEach(item => {
      container.appendChild(createExtraDateField('extraDates[]', item));
    });
  }

  function addPublishExtraDateField(value = '') {
    const container = document.getElementById('extraDatesList');
    if (!container) return;
    container.appendChild(createExtraDateField('extraDates[]', value));
  }

  function setAdminLiveExtraDates(dates) {
    const container = document.getElementById('adminLiveDatesList');
    if (!container) return;
    container.innerHTML = '';
    const normalized = parseFlexibleDateList(dates);
    normalized.forEach(item => {
      container.appendChild(createExtraDateField('adminLiveDateExtra[]', item));
    });
  }

  function getAdminLiveExtraDates() {
    const container = document.getElementById('adminLiveDatesList');
    if (!container) return [];
    const values = Array.from(container.querySelectorAll('input[name="adminLiveDateExtra[]"]')).map(input => input.value);
    return parseFlexibleDateList(values);
  }

  function addAdminLiveExtraDateField(value = '') {
    const container = document.getElementById('adminLiveDatesList');
    if (!container) return;
    container.appendChild(createExtraDateField('adminLiveDateExtra[]', value));
  }

  function removeOfficialLiveTag(tag) {
    if (!refs.draftForm?.elements.officialLiveTags) return;
    const current = parseOfficialLiveTags(refs.draftForm.elements.officialLiveTags.value);
    setOfficialLiveTags(current.filter(item => item !== tag));
  }

  function renderOfficialLiveTags(tags) {
    if (!refs.officialLiveTagList) return;
    const editableTags = normalizeOfficialLiveTags(tags);
    const fixedTags = collectFixedPublishTags();
    if (!editableTags.length && !fixedTags.length) {
      refs.officialLiveTagList.innerHTML = '<span class="muted">暂无已带入标签</span>';
      return;
    }
    refs.officialLiveTagList.innerHTML = '';

    fixedTags.forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'official-live-tag is-fixed';
      chip.append(document.createTextNode(tag));
      refs.officialLiveTagList.appendChild(chip);
    });

    editableTags.forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'official-live-tag';
      chip.append(document.createTextNode(tag));

      const removeButton = document.createElement('button');
      removeButton.className = 'official-live-tag-remove';
      removeButton.type = 'button';
      removeButton.dataset.officialTagRemove = tag;
      removeButton.setAttribute('aria-label', `删除标签 ${tag}`);
      removeButton.textContent = '×';

      chip.appendChild(removeButton);
      refs.officialLiveTagList.appendChild(chip);
    });
  }

  function updateOfficialLivePreview() {}

  function sanitizeOfficialLiveTitle(title) {
    return String(title || '').replace(/\s*[-ー–—]?\s*ライブ\s*$/u, '').trim();
  }

  function renderOfficialLiveOptions() {
    if (!refs.officialLiveSelect || !refs.draftForm) return;
    const franchise = String(refs.draftForm.elements.franchise?.value || 'other');
    const options = Array.isArray(state.liveOptionsByFranchise[franchise]) ? state.liveOptionsByFranchise[franchise] : [];
    liveOptionLookup.clear();
    refs.officialLiveSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = options.length ? '选择官方 Live...' : '当前企划暂无可用官方 Live';
    refs.officialLiveSelect.appendChild(placeholder);

    const mergedMap = new Map();
    for (const item of options) {
      const option = normalizeLiveOption(item);
      if (!option) continue;
      const mergeKey = `${option.franchise}|${option.title}|${option.venue}`;
      const existing = mergedMap.get(mergeKey);
      if (!existing || String(option.date) < String(existing.date)) {
        mergedMap.set(mergeKey, option);
      }
    }

    for (const option of mergedMap.values()) {
      const mergedId = `merged:${option.franchise}|${option.title}|${option.venue}`;
      liveOptionLookup.set(mergedId, option);
      const node = document.createElement('option');
      node.value = mergedId;
      const optionTitle = sanitizeOfficialLiveTitle(option.title) || option.title;
      node.textContent = `${optionTitle} | ${option.venue}`;
      refs.officialLiveSelect.appendChild(node);
    }

    refs.officialLiveSelect.disabled = options.length === 0;
    if (refs.officialLiveApplyButton) {
      refs.officialLiveApplyButton.disabled = options.length === 0;
    }
  }

  function applyOfficialLiveToForm() {
    if (!refs.draftForm || !refs.officialLiveSelect) return;
    const selectedId = String(refs.officialLiveSelect.value || '');
    const item = liveOptionLookup.get(selectedId);
    if (!item) {
      refs.composerFeedback.hidden = false;
      refs.composerFeedback.textContent = '请先选择一个官方 Live。';
      return;
    }
    const cleanedTitle = sanitizeOfficialLiveTitle(item.title) || item.title;
    refs.draftForm.elements.title.value = cleanedTitle;
    refs.draftForm.elements.date.value = item.date;
    refs.draftForm.elements.meta.value = item.venue;
    if (refs.draftForm.elements.officialLiveId) {
      refs.draftForm.elements.officialLiveId.value = item.id;
    }
    setOfficialLiveTags(item.tags);
    const matchedDates = collectMatchedOfficialLiveDates(item);
    setOfficialLiveDates(matchedDates);
    setPublishExtraDates(matchedDates.filter(value => value !== item.date));
    refs.composerFeedback.hidden = false;
    refs.composerFeedback.textContent = `已填入官方 Live：${cleanedTitle}`;
  }

  function commentDisplayName(comment) {
    return comment.authorName || comment.operator || '匿名用户';
  }

  function formatCommentTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '刚刚';
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  function canDeleteComment(comment) {
    if (!state.currentUser) return false;
    return state.currentUser.role === 'admin' || String(comment.authorId) === String(state.currentUser.id);
  }

  async function loadComments(listingId) {
    const list = document.querySelector(`[data-comment-list="${listingId}"]`);
    if (!list) return;
    list.innerHTML = '<div class="comment-empty">加载中…</div>';
    try {
      const payload = await apiFetch(`/api/listings/${listingId}/comments`);
      const comments = Array.isArray(payload.comments) ? payload.comments : [];
      if (!comments.length) {
        list.innerHTML = '<div class="comment-empty">还没有评论，先来抢个沙发。</div>';
        return;
      }
      list.innerHTML = comments.map(comment => `
        <article class="comment-item">
          <div class="comment-item-head">
            <div>
              <strong class="comment-author">${commentDisplayName(comment)}</strong>
              <span class="comment-meta">${formatCommentTime(comment.createdAt)}</span>
            </div>
            ${canDeleteComment(comment) ? `<button class="card-btn danger comment-delete" type="button" data-comment-delete="${comment.id}">删除</button>` : ''}
          </div>
          <div class="comment-text">${comment.text}</div>
        </article>
      `).join('');
      list.querySelectorAll('[data-comment-delete]').forEach(button => {
        button.onclick = async () => {
          await deleteComment(listingId, button.getAttribute('data-comment-delete'));
        };
      });
    } catch (error) {
      list.innerHTML = `<div class="comment-empty">${error.message || '评论加载失败'}</div>`;
    }
  }

  async function submitComment(listingId, text) {
    const payload = await apiFetch(`/api/listings/${listingId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ text })
    });
    return payload.comment;
  }

  async function deleteComment(listingId, commentId) {
    if (!confirm('确定删除这条评论吗？')) return;
    const message = document.querySelector(`[data-comment-message="${listingId}"]`);
    if (message) {
      message.hidden = false;
      message.textContent = '正在删除评论…';
      message.className = 'comment-message';
    }
    try {
      await apiFetch(`/api/listings/${listingId}/comments/${encodeURIComponent(commentId)}`, {
        method: 'DELETE',
        body: '{}'
      });
      if (message) {
        message.textContent = '评论已删除。';
        message.className = 'comment-message is-success';
      }
      await loadComments(listingId);
      await refreshData();
    } catch (error) {
      if (message) {
        message.hidden = false;
        message.textContent = error.message || '评论删除失败';
        message.className = 'comment-message is-error';
      }
    }
  }

  function bindCommentActions(listingId) {
    const form = document.querySelector(`[data-comment-form="${listingId}"]`);
    const message = document.querySelector(`[data-comment-message="${listingId}"]`);
    if (!form || !message) return;
    form.onsubmit = async event => {
      event.preventDefault();
      const text = String(new FormData(form).get('text') || '').trim();
      if (!text) {
        message.hidden = false;
        message.textContent = '请输入评论内容。';
        message.className = 'comment-message is-error';
        return;
      }
      try {
        message.hidden = false;
        message.textContent = '发送中…';
        message.className = 'comment-message';
        await submitComment(listingId, text);
        form.reset();
        message.textContent = '评论已发送。';
        message.className = 'comment-message is-success';
        await loadComments(listingId);
        await refreshData();
      } catch (error) {
        message.hidden = false;
        message.textContent = error.message || '评论发送失败';
        message.className = 'comment-message is-error';
      }
    };
  }

  function sortListings(items) {
    const copy = [...items];
    if (state.sort === 'priceAsc' || state.sort === 'priceDesc') {
      copy.sort((a, b) => {
        const aVal = Number(String(a.price).replace(/[^\d.]/g, '')) || Infinity;
        const bVal = Number(String(b.price).replace(/[^\d.]/g, '')) || Infinity;
        return state.sort === 'priceAsc' ? aVal - bVal : bVal - aVal;
      });
      return copy;
    }
    const sortByPublished = state.sort.startsWith('published');
    const asc = state.sort.endsWith('Asc');
    const getTimestamp = sortByPublished ? listingPublishedTimestamp : listingEventTimestamp;
    copy.sort((a, b) => (asc ? getTimestamp(a) - getTimestamp(b) : getTimestamp(b) - getTimestamp(a)));
    return copy;
  }

  function matchesSearch(listing) {
    if (!state.search) return true;
    const haystack = [listing.title, listing.subtitle, listing.city, listing.venue, listing.price, listing.contact, listing.note, listing.ownerName, listing.status].join(' ').toLowerCase();
    return haystack.includes(state.search.toLowerCase());
  }

  function visibleListings() {
    return sortListings(state.listings.filter(listing => {
      const visibleToMe = isVisibleForCurrentUser(listing);
      const franchiseOk = state.franchise === 'all' || listing.franchise === state.franchise;
      const kindOk = state.kind === 'all' || listing.kind === state.kind;
      const favoritesOk = !state.favoritesOnly || !!listing.favorited;
      return visibleToMe && franchiseOk && kindOk && favoritesOk && matchesSearch(listing);
    }));
  }

  function countByFranchise(franchise) {
    return state.listings.filter(listing => isVisibleForCurrentUser(listing) && listing.franchise === franchise).length;
  }

  function myListingCount() {
    if (!state.currentUser) return 0;
    return state.listings.filter(listing => listing.ownerId === state.currentUser.id).length;
  }

  function formatDate(date) {
    return new Date(date).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  function formatListingDates(listing) {
    const dates = Array.isArray(listing?.eventDates)
      ? listing.eventDates.map(item => String(item || '').trim()).filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item))
      : [];
    if (!dates.length) return formatDate(listing.date);
    return dates.map(item => formatDate(item)).join(' / ');
  }

  function formatTime(time) {
    if (!time || time === 'now') return '刚刚';
    const parsed = new Date(time);
    if (Number.isNaN(parsed.getTime())) return '刚刚';
    return parsed.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function isManagementNotification(item) {
    const text = String(item?.text || '');
    return item?.type === 'review' || /票务已下架|票务已通过|票务被驳回|等待审核|审核|上架|发布/i.test(text);
  }

  function visibleNotifications() {
    const hiddenSet = currentNotificationHiddenSet();
    const trashSet = currentNotificationTrashSet();
    const archivedSet = currentNotificationArchivedSet();
    if (state.currentUser?.role === 'admin') {
      return state.notifications.filter(item => !hiddenSet.has(notificationIdentity(item)) && !trashSet.has(notificationIdentity(item)) && !archivedSet.has(notificationIdentity(item)));
    }
    return state.notifications.filter(item => item.audience === 'all' && !isManagementNotification(item) && !hiddenSet.has(notificationIdentity(item)) && !trashSet.has(notificationIdentity(item)));
  }

  function trashedNotifications() {
    if (state.currentUser?.role !== 'admin') return [];
    const trashSet = currentNotificationTrashSet();
    return state.notifications.filter(item => trashSet.has(notificationIdentity(item)));
  }

  function notificationIdentity(item) {
    return String(item?.id ?? item?.at ?? item?.text ?? '');
  }

  function notificationReadMap() {
    try {
      return JSON.parse(localStorage.getItem(notificationReadKey) || '{}');
    } catch {
      return {};
    }
  }

  function currentNotificationReadSet() {
    const userId = state.currentUser?.id || 'guest';
    const map = notificationReadMap();
    return new Set(Array.isArray(map[userId]) ? map[userId] : []);
  }

  function notificationHiddenMap() {
    try {
      return JSON.parse(localStorage.getItem(notificationHiddenKey) || '{}');
    } catch {
      return {};
    }
  }

  function currentNotificationHiddenSet() {
    const userId = state.currentUser?.id || 'guest';
    const map = notificationHiddenMap();
    return new Set(Array.isArray(map[userId]) ? map[userId] : []);
  }

  function notificationTrashMap() {
    try {
      return JSON.parse(localStorage.getItem(notificationTrashKey) || '{}');
    } catch {
      return {};
    }
  }

  function notificationArchivedMap() {
    try {
      return JSON.parse(localStorage.getItem(notificationArchivedKey) || '{}');
    } catch {
      return {};
    }
  }

  function currentNotificationTrashSet() {
    const userId = state.currentUser?.id || 'guest';
    const map = notificationTrashMap();
    return new Set(Array.isArray(map[userId]) ? map[userId] : []);
  }

  function currentNotificationArchivedSet() {
    const userId = state.currentUser?.id || 'guest';
    const map = notificationArchivedMap();
    return new Set(Array.isArray(map[userId]) ? map[userId] : []);
  }

  function saveNotificationHiddenSet(hiddenSet) {
    const userId = state.currentUser?.id || 'guest';
    const map = notificationHiddenMap();
    map[userId] = Array.from(hiddenSet);
    localStorage.setItem(notificationHiddenKey, JSON.stringify(map));
  }

  function saveNotificationTrashSet(trashSet) {
    const userId = state.currentUser?.id || 'guest';
    const map = notificationTrashMap();
    map[userId] = Array.from(trashSet);
    localStorage.setItem(notificationTrashKey, JSON.stringify(map));
  }

  function saveNotificationArchivedSet(archivedSet) {
    const userId = state.currentUser?.id || 'guest';
    const map = notificationArchivedMap();
    map[userId] = Array.from(archivedSet);
    localStorage.setItem(notificationArchivedKey, JSON.stringify(map));
  }

  function saveNotificationReadSet(readSet) {
    const userId = state.currentUser?.id || 'guest';
    const map = notificationReadMap();
    map[userId] = Array.from(readSet);
    localStorage.setItem(notificationReadKey, JSON.stringify(map));
  }

  function isNotificationUnread(item) {
    return !currentNotificationReadSet().has(notificationIdentity(item));
  }

  function unreadNotificationCount() {
    return visibleNotifications().filter(item => isNotificationUnread(item)).length;
  }

  function markNotificationRead(notificationId) {
    const readSet = currentNotificationReadSet();
    readSet.add(String(notificationId));
    saveNotificationReadSet(readSet);
  }

  function markAllNotificationsRead() {
    const readSet = currentNotificationReadSet();
    visibleNotifications().forEach(item => readSet.add(notificationIdentity(item)));
    saveNotificationReadSet(readSet);
  }

  function hideNotificationForCurrentUser(notificationId) {
    const hiddenSet = currentNotificationHiddenSet();
    hiddenSet.add(String(notificationId));
    saveNotificationHiddenSet(hiddenSet);
  }

  function moveNotificationToTrash(notificationId) {
    const id = String(notificationId);
    const trashSet = currentNotificationTrashSet();
    trashSet.add(id);
    saveNotificationTrashSet(trashSet);
    const hiddenSet = currentNotificationHiddenSet();
    hiddenSet.delete(id);
    saveNotificationHiddenSet(hiddenSet);
  }

  function restoreNotificationFromTrash(notificationId) {
    const id = String(notificationId);
    const trashSet = currentNotificationTrashSet();
    trashSet.delete(id);
    saveNotificationTrashSet(trashSet);
  }

  function permanentlyDeleteNotification(notificationId) {
    const id = String(notificationId);
    const trashSet = currentNotificationTrashSet();
    trashSet.delete(id);
    saveNotificationTrashSet(trashSet);
    const archivedSet = currentNotificationArchivedSet();
    archivedSet.add(id);
    saveNotificationArchivedSet(archivedSet);
    const hiddenSet = currentNotificationHiddenSet();
    hiddenSet.delete(id);
    saveNotificationHiddenSet(hiddenSet);
  }

  function pruneNotificationLocalState() {
    const validIds = new Set(state.notifications.map(item => notificationIdentity(item)));
    const hiddenSet = currentNotificationHiddenSet();
    const hiddenPruned = new Set(Array.from(hiddenSet).filter(id => validIds.has(id)));
    if (hiddenPruned.size !== hiddenSet.size) saveNotificationHiddenSet(hiddenPruned);
    const trashSet = currentNotificationTrashSet();
    const trashPruned = new Set(Array.from(trashSet).filter(id => validIds.has(id)));
    if (trashPruned.size !== trashSet.size) saveNotificationTrashSet(trashPruned);
    const archivedSet = currentNotificationArchivedSet();
    const archivedPruned = new Set(Array.from(archivedSet).filter(id => validIds.has(id)));
    if (archivedPruned.size !== archivedSet.size) saveNotificationArchivedSet(archivedPruned);
  }

  function renderTopbar() {
    if (!refs.userChip || !refs.notificationChip) return;
    const topbarActions = document.querySelector('.topbar-actions');
    const isAdmin = state.currentUser?.role === 'admin';
    if (!state.currentUser) {
      refs.userChip.innerHTML = '<strong>未登录</strong>';
    } else {
      refs.userChip.innerHTML = `<strong>${state.currentUser.name}</strong><span>${state.currentUser.role === 'admin' ? '已登录' : '已登录'}</span>`;
    }
    if (refs.adminBroadcastButton) {
      if (!isAdmin) {
        refs.adminBroadcastButton.remove();
      } else if (topbarActions && !refs.adminBroadcastButton.parentElement) {
        topbarActions.insertBefore(refs.adminBroadcastButton, refs.notificationChip);
      }
      refs.adminBroadcastButton.hidden = !isAdmin;
    }
    if (refs.adminLiveRefreshButton) {
      if (!isAdmin) {
        refs.adminLiveRefreshButton.remove();
      } else if (topbarActions && !refs.adminLiveRefreshButton.parentElement) {
        topbarActions.insertBefore(refs.adminLiveRefreshButton, refs.notificationChip);
      }
      refs.adminLiveRefreshButton.hidden = !isAdmin;
    }
    if (refs.adminLiveManageButton) {
      refs.adminLiveManageButton.hidden = !isAdmin;
    }
    if (refs.notificationDeleteAllButton) {
      refs.notificationDeleteAllButton.hidden = !isAdmin;
    }
    if (isAdmin) {
      ensureNotificationTrashUI();
      if (refs.notificationTrashButton) refs.notificationTrashButton.hidden = false;
      if (refs.trashDeleteAllButton) refs.trashDeleteAllButton.hidden = false;
    } else {
      if (refs.notificationTrashButton) refs.notificationTrashButton.remove();
      if (refs.trashDeleteAllButton) refs.trashDeleteAllButton.remove();
      if (refs.notificationTrashOverlay) {
        refs.notificationTrashOverlay.classList.remove('is-open');
        refs.notificationTrashOverlay.hidden = true;
        refs.notificationTrashOverlay.style.display = 'none';
        refs.notificationTrashOverlay.remove();
      }
    }
    if (refs.notificationTrashOverlay && !isAdmin) {
      refs.notificationTrashOverlay.classList.remove('is-open');
      refs.notificationTrashOverlay.hidden = true;
      refs.notificationTrashOverlay.style.display = 'none';
    }
    const unreadCount = unreadNotificationCount();
    refs.notificationChip.innerHTML = `<strong>通知</strong><span>${visibleNotifications().length} 条${unreadCount ? ` · ${unreadCount} 未读` : ''}</span>`;
  }

  function setSessionMessage(message, kind = '', shouldShow = true) {
    if (!refs.sessionFeedback) return;
    refs.sessionFeedback.textContent = message;
    refs.sessionFeedback.className = `session-feedback ${kind}`.trim();
    refs.sessionFeedback.hidden = !shouldShow || !message;
  }

  function renderSessionPanel() {
    const roleLabel = state.currentUser ? (state.currentUser.role === 'admin' ? '管理员' : '普通用户') : '访客';
    refs.sessionStatusText.textContent = state.currentUser
      ? `当前账号：${state.currentUser.name}。你可以编辑、删除或收藏自己关注的票务。`
      : '当前未登录。登录后可开启个人管理权限。';
    refs.sessionRoleLabel.textContent = roleLabel;
    refs.myListingCount.textContent = `${myListingCount()} 条`;
    if (refs.sessionLoginArea) {
      refs.sessionLoginArea.hidden = !!state.currentUser;
      refs.sessionLoginArea.style.display = state.currentUser ? 'none' : '';
    }
    if (refs.sessionLoggedArea) {
      refs.sessionLoggedArea.hidden = !state.currentUser;
      refs.sessionLoggedArea.style.display = state.currentUser ? 'flex' : 'none';
    }
    if (refs.logoutButton) {
      refs.logoutButton.hidden = !state.currentUser;
      refs.logoutButton.style.display = state.currentUser ? '' : 'none';
    }
    if (refs.changePasswordToggleButton) {
      refs.changePasswordToggleButton.hidden = !state.currentUser;
      refs.changePasswordToggleButton.style.display = state.currentUser ? '' : 'none';
    }
    if (!state.currentUser) {
      if (refs.changePasswordArea) {
        refs.changePasswordArea.hidden = true;
        refs.changePasswordArea.style.display = 'none';
      }
      if (refs.changePasswordForm) {
        refs.changePasswordForm.reset();
      }
    }
    if (refs.feedbackComposerArea) {
      refs.feedbackComposerArea.hidden = !state.currentUser;
      refs.feedbackComposerArea.style.display = state.currentUser ? '' : 'none';
    }
  }

  function toggleChangePasswordArea(forceVisible) {
    if (!refs.changePasswordArea) return;
    if (!state.currentUser) {
      refs.changePasswordArea.hidden = true;
      refs.changePasswordArea.style.display = 'none';
      return;
    }
    const visible = typeof forceVisible === 'boolean' ? forceVisible : refs.changePasswordArea.hidden;
    refs.changePasswordArea.hidden = !visible;
    refs.changePasswordArea.style.display = visible ? '' : 'none';
    if (!visible && refs.changePasswordForm) refs.changePasswordForm.reset();
  }

  function renderStats() {
    if (!refs.stats) return;
    refs.stats.innerHTML = `
      <div class="stats-card">
        <div class="stats-label">我的票务</div>
        <div class="stats-value">${myListingCount()} 条</div>
        <p class="stats-note">登录后统计当前账号的发布数量。</p>
      </div>
    `;
  }

  function statusLabel(status) {
    if (status === 'approved') return '已通过';
    if (status === 'pending') return '审核中';
    if (status === 'rejected') return '已驳回';
    return status;
  }

  function statusClass(status) {
    if (status === 'approved') return 'tiny-pill';
    if (status === 'pending') return 'tiny-pill';
    return 'tiny-pill';
  }

  function statusBadge(status) {
    if (status === 'approved') return '';
    return `<span class="${statusClass(status)}">${statusLabel(status)}</span>`;
  }

  function statusDetailCard(status) {
    if (status === 'approved') return '';
    return `<div class="detail-card"><span>审核状态</span><strong>${statusLabel(status)}</strong></div>`;
  }

  function totalListingPages(items) {
    return Math.max(1, Math.ceil(items.length / listingPageSize));
  }

  function clampListingPage(items) {
    const totalPages = totalListingPages(items);
    if (state.currentPage > totalPages) state.currentPage = totalPages;
    if (state.currentPage < 1) state.currentPage = 1;
    return totalPages;
  }

  function buildPageWindow(totalPages, currentPage) {
    const pages = [];
    const start = Math.max(1, currentPage - 1);
    const end = Math.min(totalPages, currentPage + 1);
    if (start > 1) {
      pages.push(1);
      if (start > 2) pages.push('...');
    }
    for (let page = start; page <= end; page += 1) pages.push(page);
    if (end < totalPages) {
      if (end < totalPages - 1) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  }

  function renderListingPager(items) {
    if (!refs.listingPager) return;
    if (!items.length) {
      refs.listingPager.style.display = 'none';
      refs.listingPager.innerHTML = '';
      return;
    }

    const totalPages = clampListingPage(items);
    if (totalPages <= 1) {
      refs.listingPager.style.display = 'none';
      refs.listingPager.innerHTML = '';
      return;
    }

    const currentPage = state.currentPage;
    const pageWindow = buildPageWindow(totalPages, currentPage);
    refs.listingPager.style.display = 'flex';
    refs.listingPager.innerHTML = `
      <button class="btn pager-button" type="button" data-page-nav="prev" ${currentPage === 1 ? 'disabled' : ''}>上一页</button>
      <span class="pager-info">第 ${currentPage} / ${totalPages} 页</span>
      ${pageWindow.map(page => page === '...'
        ? '<span class="pager-info">...</span>'
        : `<button class="btn pager-button ${page === currentPage ? 'is-active' : ''}" type="button" data-page-number="${page}">${page}</button>`).join('')}
      <button class="btn pager-button" type="button" data-page-nav="next" ${currentPage === totalPages ? 'disabled' : ''}>下一页</button>
    `;

    refs.listingPager.querySelectorAll('[data-page-nav]').forEach(button => {
      button.addEventListener('click', () => {
        const direction = button.getAttribute('data-page-nav');
        if (direction === 'prev' && state.currentPage > 1) state.currentPage -= 1;
        if (direction === 'next' && state.currentPage < totalPages) state.currentPage += 1;
        renderAll();
      });
    });

    refs.listingPager.querySelectorAll('[data-page-number]').forEach(button => {
      button.addEventListener('click', () => {
        state.currentPage = Number(button.getAttribute('data-page-number')) || 1;
        renderAll();
      });
    });
  }

  function renderListings() {
    const items = visibleListings();
    if (!items.length) {
      refs.listingList.innerHTML = '<div class="loading-note">没有匹配到结果，试试调整筛选或者搜索关键词。</div>';
      refs.emptyState.style.display = 'none';
      renderListingPager(items);
      return;
    }

    const totalPages = clampListingPage(items);
    const startIndex = (state.currentPage - 1) * listingPageSize;
    const pageItems = items.slice(startIndex, startIndex + listingPageSize);

    refs.listingList.innerHTML = pageItems.map(listing => `
      <article class="listing-card fade-in ${canManageListing(listing) ? 'is-owned' : ''}" style="--accent:${listing.accent || pickAccent(listing.franchise, listing.kind)}">
        <div class="card-top">
          <div class="card-main">
            <h3 class="card-title">${listing.title}</h3>
            <p class="card-subtitle">${listing.subtitle}</p>
            <div class="listing-owner">发布者：<strong>${getOwnerName(listing)}</strong> <span class="favorite-count">· ${listing.favoriteCount || 0} 人收藏</span></div>
          </div>
          <div class="badge-row">
            <span class="badge"><strong>${listing.franchiseLabel}</strong></span>
            <span class="badge"><strong>${listing.kindLabel}</strong></span>
            ${listing.isPremium ? '<span class="badge badge-premium"><strong>严选票</strong></span>' : '<span class="badge badge-success"><strong>非严选票</strong></span>'}
            ${Number(listing.quantity || 1) > 1 ? `<span class="badge ${listing.canSerial ? 'badge-success' : 'badge-premium'}"><strong>${listing.canSerial ? '可连番' : '不可连番'}</strong></span>` : ''}
            ${visibleTicketTags(listing.tags).map(tag => `<span class="badge"><strong>${tag}</strong></span>`).join('')}
            ${statusBadge(listing.status)}
          </div>
        </div>
        <div class="meta-grid">
          <div class="meta"><div class="meta-label">城市</div><div class="meta-value">${listing.city}</div></div>
          <div class="meta"><div class="meta-label">场次日期</div><div class="meta-value">${formatListingDates(listing)}</div></div>
          <div class="meta"><div class="meta-label">数量</div><div class="meta-value">${listing.quantity || 1} 张</div></div>
          <div class="meta"><div class="meta-label">价格</div><div class="meta-value">${listing.priceDisplay || listing.price}</div></div>
          <div class="meta"><div class="meta-label">联系方式</div><div class="meta-value">${listing.contactDisplay || listing.contact}</div></div>
        </div>
        <p class="card-subtitle">备注：${listing.note}</p>
        <div class="card-actions">
          <button class="card-btn" type="button" data-detail="${listing.id}">详情</button>
          <button class="card-btn ${listing.favorited ? 'bookmark-on' : ''}" type="button" data-favorite="${listing.id}">${listing.favorited ? '已收藏' : '收藏'}</button>
          <button class="card-btn secondary" type="button" data-copy="${encodeURIComponent(listing.contact)}">复制联系方式</button>
          ${canManageListing(listing) ? `<button class="card-btn" type="button" data-edit="${listing.id}">编辑</button><button class="card-btn danger" type="button" data-delete="${listing.id}">删除</button>` : ''}
        </div>
      </article>
    `).join('');
    refs.emptyState.style.display = 'none';
    renderListingPager(items);
    bindCardActions();
  }

  function renderNotifications() {
    if (!refs.notificationList) return;
    const items = visibleNotifications();
    if (!items.length) {
      refs.notificationList.innerHTML = '<div class="notification-item">暂时没有通知。</div>';
      if (refs.notificationPager) {
        refs.notificationPager.style.display = 'none';
        refs.notificationPager.innerHTML = '';
      }
      return;
    }
    const totalPages = Math.max(1, Math.ceil(items.length / notificationPageSize));
    if (state.notificationPage > totalPages) state.notificationPage = totalPages;
    if (state.notificationPage < 1) state.notificationPage = 1;
    const startIndex = (state.notificationPage - 1) * notificationPageSize;
    const pageItems = items.slice(startIndex, startIndex + notificationPageSize);
    refs.notificationList.innerHTML = pageItems.map(item => {
      const title = item.type === 'feedback'
        ? '反馈通知'
        : (item.type === 'review' ? '审核通知' : '系统通知');
      return `
      <div class="notification-item ${isNotificationUnread(item) ? 'is-unread' : 'is-read'}" data-notification-id="${notificationIdentity(item)}">
        <div class="review-item-head">
          <div>
            <p class="review-item-title">${title}${isNotificationUnread(item) ? '<span class="notification-unread-dot">未读</span>' : ''}</p>
            <div class="notification-meta">${formatTime(item.at)} · 点击标记为已读</div>
          </div>
          <span class="tiny-pill">${isNotificationUnread(item) ? '未读' : '已读'}</span>
        </div>
        <div class="muted">${item.text}</div>
        <div class="notification-actions">
          <button class="card-btn danger" type="button" data-notification-delete="${notificationIdentity(item)}">删除</button>
          ${state.currentUser?.role === 'admin' ? `<button class="card-btn" type="button" data-notification-recall="${notificationIdentity(item)}">撤回</button>` : ''}
        </div>
      </div>
    `;
    }).join('');
    if (refs.notificationPager) {
      if (totalPages <= 1) {
        refs.notificationPager.style.display = 'none';
        refs.notificationPager.innerHTML = '';
      } else {
        refs.notificationPager.style.display = 'flex';
        refs.notificationPager.innerHTML = `
          <button class="btn pager-button" type="button" data-notification-page="prev" ${state.notificationPage === 1 ? 'disabled' : ''}>上一页</button>
          <span class="pager-info">第 ${state.notificationPage} / ${totalPages} 页</span>
          <button class="btn pager-button" type="button" data-notification-page="next" ${state.notificationPage === totalPages ? 'disabled' : ''}>下一页</button>
          <button class="btn pager-button" type="button" data-notification-read-all>全部已读</button>
        `;
        refs.notificationPager.querySelectorAll('[data-notification-page]').forEach(button => {
          button.onclick = () => {
            const direction = button.getAttribute('data-notification-page');
            if (direction === 'prev' && state.notificationPage > 1) state.notificationPage -= 1;
            if (direction === 'next' && state.notificationPage < totalPages) state.notificationPage += 1;
            renderNotifications();
          };
        });
        const markAllButton = refs.notificationPager.querySelector('[data-notification-read-all]');
        if (markAllButton) {
          markAllButton.onclick = () => {
            markAllNotificationsRead();
            renderAll();
          };
        }
      }
    }
    refs.notificationList.querySelectorAll('[data-notification-id]').forEach(item => {
      item.onclick = () => {
        markNotificationRead(item.getAttribute('data-notification-id'));
        renderAll();
      };
    });
    refs.notificationList.querySelectorAll('[data-notification-delete]').forEach(button => {
      button.onclick = async event => {
        event.stopPropagation();
        await deleteNotification(Number(button.getAttribute('data-notification-delete')));
      };
    });
    refs.notificationList.querySelectorAll('[data-notification-recall]').forEach(button => {
      button.onclick = async event => {
        event.stopPropagation();
        await recallNotification(Number(button.getAttribute('data-notification-recall')));
      };
    });
  }

  function renderNotificationTrash() {
    if (!refs.notificationTrashList) return;
    const items = trashedNotifications();
    if (!items.length) {
      refs.notificationTrashList.innerHTML = '<div class="notification-item">废纸篓是空的。</div>';
      return;
    }
    refs.notificationTrashList.innerHTML = items.map(item => {
      const trashTitle = item.type === 'feedback' ? '废纸篓反馈通知' : '废纸篓通知';
      return `
      <div class="notification-item is-read" data-trash-notification-id="${notificationIdentity(item)}">
        <div class="review-item-head">
          <div>
            <p class="review-item-title">${trashTitle}</p>
            <div class="notification-meta">${formatTime(item.at)} · 可恢复或永久删除</div>
          </div>
          <span class="tiny-pill">已删除</span>
        </div>
        <div class="muted">${item.text}</div>
        <div class="notification-actions">
          <button class="card-btn" type="button" data-trash-restore="${notificationIdentity(item)}">撤回</button>
          <button class="card-btn danger" type="button" data-trash-delete="${notificationIdentity(item)}">删除</button>
        </div>
      </div>
    `;
    }).join('');
    refs.notificationTrashList.querySelectorAll('[data-trash-restore]').forEach(button => {
      button.onclick = async event => {
        event.stopPropagation();
        await restoreFromTrash(Number(button.getAttribute('data-trash-restore')));
      };
    });
    refs.notificationTrashList.querySelectorAll('[data-trash-delete]').forEach(button => {
      button.onclick = async event => {
        event.stopPropagation();
        await deleteFromTrash(Number(button.getAttribute('data-trash-delete')));
      };
    });
  }

  function renderDetailModal() {
    if (!refs.detailOverlay) return;
    const listing = state.listings.find(item => item.id === state.selectedListingId);
    if (!listing) {
      refs.detailOverlay.classList.remove('is-open');
      return;
    }
    refs.detailContent.innerHTML = `
      <div class="detail-top">
        <div>
          <div class="badge-row" style="justify-content:flex-start; margin-bottom:12px;">
            <span class="badge"><strong>${listing.franchiseLabel}</strong></span>
            <span class="badge"><strong>${listing.kindLabel}</strong></span>
            ${listing.isPremium ? '<span class="badge badge-premium"><strong>严选票</strong></span>' : '<span class="badge badge-success"><strong>非严选票</strong></span>'}
            ${Number(listing.quantity || 1) > 1 ? `<span class="badge ${listing.canSerial ? 'badge-success' : 'badge-premium'}"><strong>${listing.canSerial ? '可连番' : '不可连番'}</strong></span>` : ''}
            ${visibleTicketTags(listing.tags).map(tag => `<span class="badge"><strong>${tag}</strong></span>`).join('')}
            ${statusBadge(listing.status)}
          </div>
          <h2 class="detail-title">${listing.title}</h2>
          <div class="muted" style="margin-top:8px;">发布者：${getOwnerName(listing)} · 收藏 ${listing.favoriteCount || 0} · ${formatListingDates(listing)}</div>
        </div>
        <button class="btn btn-secondary detail-close" type="button" id="detailCloseButton">关闭</button>
      </div>
      <div class="detail-grid">
        <div class="detail-card"><span>城市</span><strong>${listing.city}</strong></div>
        <div class="detail-card"><span>价格</span><strong>${listing.priceDisplay || listing.price}</strong></div>
        <div class="detail-card"><span>数量</span><strong>${listing.quantity || 1} 张</strong></div>
        <div class="detail-card"><span>联系方式</span><strong>${listing.contactDisplay || listing.contact}</strong></div>
        ${statusDetailCard(listing.status)}
      </div>
      <div class="detail-body">
        <div class="detail-card">
          <span>备注</span>
          <strong>${listing.note}</strong>
        </div>
        <section class="comment-panel" data-comment-panel="${listing.id}">
          <div class="comment-panel-head">
            <strong>评论区</strong>
            <span class="tiny-pill">${listing.commentCount || 0} 条评论</span>
          </div>
          <div class="comment-list" data-comment-list="${listing.id}">
            <div class="comment-empty">正在加载评论…</div>
          </div>
          <form class="comment-form" data-comment-form="${listing.id}">
            <textarea class="field" name="text" rows="3" placeholder="写下你对这条票务的评论" required></textarea>
            <div class="comment-actions">
              <button class="btn btn-primary" type="submit">发送评论</button>
            </div>
          </form>
          <p class="comment-message" data-comment-message="${listing.id}" hidden></p>
        </section>
        <div class="detail-actions">
          <button class="card-btn ${listing.favorited ? 'bookmark-on' : ''}" type="button" data-favorite-detail="${listing.id}">${listing.favorited ? '取消收藏' : '收藏'}</button>
          <button class="card-btn secondary" type="button" data-copy-detail="${encodeURIComponent(listing.contact)}">复制联系方式</button>
          ${canManageListing(listing) ? `<button class="card-btn" type="button" data-edit-detail="${listing.id}">编辑</button><button class="card-btn danger" type="button" data-delete-detail="${listing.id}">删除</button>` : ''}
        </div>
        <div class="detail-message" id="detailMessage"></div>
      </div>
    `;
    refs.detailOverlay.classList.add('is-open');
    refs.detailMessage = document.getElementById('detailMessage');
    bindDetailActions();
    loadComments(listing.id);
  }

  function setDetailMessage(message, kind = '') {
    if (!refs.detailMessage) return;
    refs.detailMessage.textContent = message;
    refs.detailMessage.className = `detail-message ${kind}`.trim();
  }

  function setComposerMode(listing) {
    refs.editingId.value = listing ? String(listing.id) : '';
    refs.draftSubmitButton.textContent = listing ? '保存修改' : '发布';
    refs.composerTitle.textContent = listing ? `编辑票务 #${listing.id}` : '发布票务';
    if (refs.cancelEditButton) refs.cancelEditButton.hidden = !listing;
  }

  function syncComposerChoices() {
    document.querySelectorAll('[data-choice-group]').forEach(group => {
      const fieldName = group.getAttribute('data-choice-group');
      const currentValue = String(refs.draftForm?.elements[fieldName]?.value || '');
      group.querySelectorAll('[data-choice-field]').forEach(button => {
        button.classList.toggle('is-active', button.getAttribute('data-choice-value') === currentValue);
      });
    });
  }

  function syncQuantityDependentChoices() {
    const quantityField = refs.draftForm?.elements.quantity;
    const canSerialCard = document.getElementById('canSerialCard');
    const canSerialField = refs.draftForm?.elements.canSerial;
    if (!quantityField || !canSerialCard || !canSerialField) return;
    const quantity = Math.max(1, Number(quantityField.value || 1) || 1);
    const showCanSerial = quantity > 1;
    canSerialCard.hidden = !showCanSerial;
    if (!showCanSerial) {
      canSerialField.value = 'no';
    } else if (!canSerialField.value) {
      canSerialField.value = 'yes';
    }
    syncComposerChoices();
    renderOfficialLiveTags(parseOfficialLiveTags(refs.draftForm?.elements.officialLiveTags?.value));
  }

  function setComposerChoice(fieldName, value) {
    const field = refs.draftForm.elements[fieldName];
    if (!field) return;
    field.value = value;
    syncComposerChoices();
    if (fieldName === 'franchise') {
      if (refs.draftForm.elements.officialLiveId) {
        refs.draftForm.elements.officialLiveId.value = '';
      }
      setOfficialLiveDates([]);
      setOfficialLiveTags([]);
      renderOfficialLiveOptions();
    }
    renderOfficialLiveTags(parseOfficialLiveTags(refs.draftForm?.elements.officialLiveTags?.value));
  }

  function fillFormForEdit(listing) {
    state.editingId = listing.id;
    setPage('publish', { scroll: false });
    setComposerMode(listing);
    refs.draftForm.elements.title.value = listing.title;
    refs.draftForm.elements.franchise.value = listing.franchise;
    refs.draftForm.elements.kind.value = listing.kind;
    refs.draftForm.elements.priceAmount.value = listing.priceAmount || listing.price || '';
    refs.draftForm.elements.priceUnit.value = listing.priceUnit || 'jpy';
    refs.draftForm.elements.contactType.value = listing.contactType || 'other';
    refs.draftForm.elements.contactValue.value = listing.contactValue || '';
    refs.draftForm.elements.quantity.value = listing.quantity || 1;
    refs.draftForm.elements.meta.value = `${listing.city} · ${listing.venue}`;
    refs.draftForm.elements.date.value = listing.date;
    const editDates = Array.isArray(listing.eventDates)
      ? listing.eventDates.map(item => String(item || '').trim()).filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item))
      : [];
    setPublishExtraDates(editDates.filter(item => item !== listing.date));
    refs.draftForm.elements.note.value = listing.note;
    if (refs.draftForm.elements.officialLiveId) {
      refs.draftForm.elements.officialLiveId.value = '';
    }
    setOfficialLiveDates(Array.isArray(listing.eventDates) ? listing.eventDates : [listing.date]);
    setOfficialLiveTags(listing.tags);
    refs.draftForm.elements.canSerial.value = listing.canSerial ? 'yes' : 'no';
    refs.draftForm.elements.isPremium.value = listing.isPremium ? 'yes' : 'no';
    syncQuantityDependentChoices();
    syncComposerChoices();
    renderOfficialLiveOptions();
    refs.composerFeedback.hidden = false;
    refs.composerFeedback.textContent = `正在编辑：${listing.title}`;
    document.getElementById('post').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetComposer() {
    state.editingId = null;
    refs.draftForm.reset();
    if (refs.draftForm.elements.officialLiveId) {
      refs.draftForm.elements.officialLiveId.value = '';
    }
    setPublishExtraDates([]);
    setOfficialLiveDates([]);
    setOfficialLiveTags([]);
    setComposerMode(null);
    syncQuantityDependentChoices();
    syncComposerChoices();
    renderOfficialLiveOptions();
  }

  function hideDetail() {
    state.selectedListingId = null;
    if (refs.detailOverlay) refs.detailOverlay.classList.remove('is-open');
  }

  function bindCardActions() {
    document.querySelectorAll('[data-copy]').forEach(button => {
      button.onclick = async () => {
        const value = decodeURIComponent(button.getAttribute('data-copy'));
        await navigator.clipboard.writeText(value).catch(() => {});
        const text = button.textContent;
        button.textContent = '已复制';
        setTimeout(() => { button.textContent = text; }, 1200);
      };
    });

    document.querySelectorAll('[data-detail]').forEach(button => {
      button.onclick = () => {
        state.selectedListingId = Number(button.getAttribute('data-detail'));
        renderDetailModal();
      };
    });

    document.querySelectorAll('[data-favorite]').forEach(button => {
      button.onclick = async () => {
        await apiFetch(`/api/listings/${Number(button.getAttribute('data-favorite'))}/favorite`, { method: 'POST', body: '{}' });
        await refreshData();
      };
    });

    document.querySelectorAll('[data-edit]').forEach(button => {
      button.onclick = () => {
        const listing = state.listings.find(item => item.id === Number(button.getAttribute('data-edit')));
        if (listing) fillFormForEdit(listing);
      };
    });

    document.querySelectorAll('[data-delete]').forEach(button => {
      button.onclick = () => removeListing(Number(button.getAttribute('data-delete')));
    });
  }

  function bindDetailActions() {
    const closeButton = document.getElementById('detailCloseButton');
    if (closeButton) closeButton.onclick = hideDetail;
    document.querySelectorAll('[data-favorite-detail]').forEach(button => {
      button.onclick = async () => {
        const originalText = button.textContent;
        if (!state.currentUser) {
          setDetailMessage('请先登录后再收藏。', 'is-error');
          return;
        }
        try {
          setDetailMessage('正在更新收藏状态…');
          await toggleFavorite(Number(button.getAttribute('data-favorite-detail')));
          button.textContent = button.textContent.includes('取消收藏') ? '收藏' : '取消收藏';
          setDetailMessage('收藏状态已更新。', 'is-success');
        } catch (error) {
          button.textContent = originalText;
          setDetailMessage(error.message || '收藏失败，请先登录后再试。', 'is-error');
        }
      };
    });
    document.querySelectorAll('[data-copy-detail]').forEach(button => {
      button.onclick = async () => {
        const value = decodeURIComponent(button.getAttribute('data-copy-detail'));
        const originalText = button.textContent;
        try {
          await navigator.clipboard.writeText(value);
          button.textContent = '已复制';
          setDetailMessage('联系方式已复制。', 'is-success');
          setTimeout(() => { button.textContent = originalText; }, 1200);
        } catch (error) {
          button.textContent = originalText;
          setDetailMessage('复制失败，请手动复制联系方式。', 'is-error');
        }
      };
    });
    document.querySelectorAll('[data-edit-detail]').forEach(button => {
      button.onclick = () => {
        const listing = state.listings.find(item => item.id === Number(button.getAttribute('data-edit-detail')));
        if (listing) {
          setDetailMessage('已切换到编辑状态。', 'is-success');
          hideDetail();
          fillFormForEdit(listing);
        }
      };
    });
    document.querySelectorAll('[data-delete-detail]').forEach(button => {
      button.onclick = async () => {
        setDetailMessage('正在删除票务…');
        await removeListing(Number(button.getAttribute('data-delete-detail')));
      };
    });
    const listingId = refs.detailOverlay?.querySelector('[data-comment-panel]')?.getAttribute('data-comment-panel');
    if (listingId) {
      bindCommentActions(Number(listingId));
      loadComments(Number(listingId));
    }
  }

  async function loadData() {
    try {
      const sessionPayload = await apiFetch('/api/session');
      state.currentUser = sessionPayload.user || null;
      // Render auth-related UI as soon as session is known to avoid login-state flicker.
      renderTopbar();
      renderSessionPanel();
      renderStats();

      const [listingsPayload, notificationsPayload, livePayload] = await Promise.all([
        apiFetch('/api/listings'),
        apiFetch('/api/notifications'),
        apiFetch('/api/live-options')
      ]);
      state.listings = (listingsPayload.listings || []).map(normalizeListing);
      state.notifications = notificationsPayload.notifications || [];
      applyLiveOptionsPayload(livePayload);
      pruneNotificationLocalState();
      state.notificationPage = 1;
      state.loading = false;
    } catch (error) {
      console.error(error);
      state.loading = false;
      state.currentUser = loadOfflineSession();
      refs.composerFeedback.hidden = false;
      refs.composerFeedback.textContent = '后端服务暂时不可用，页面已进入离线模式，请稍后再试。';
      state.listings = [];
      state.liveOptionsByFranchise = { bangdream: [], lovelive: [], imas: [], other: [] };
    }
  }

  function applyLiveOptionsPayload(livePayload) {
    state.liveOptionsByFranchise = { bangdream: [], lovelive: [], imas: [], other: [] };
    (livePayload?.liveOptions || []).forEach(item => {
      const normalized = normalizeLiveOption(item);
      if (!normalized) return;
      if (!Array.isArray(state.liveOptionsByFranchise[normalized.franchise])) {
        state.liveOptionsByFranchise[normalized.franchise] = [];
      }
      state.liveOptionsByFranchise[normalized.franchise].push(normalized);
    });
    state.liveOptionsUpdatedAt = livePayload?.updatedAt || null;
  }

  async function refreshOfficialLiveOptionsNow() {
    if (!state.currentUser || state.currentUser.role !== 'admin') return;
    if (refs.adminLiveRefreshButton) {
      refs.adminLiveRefreshButton.disabled = true;
      refs.adminLiveRefreshButton.textContent = '刷新中...';
    }
    refs.composerFeedback.hidden = false;
    refs.composerFeedback.textContent = '正在手动刷新官方 Live...';
    try {
      const livePayload = await apiFetch('/api/live-options?refresh=1');
      applyLiveOptionsPayload(livePayload);
      renderOfficialLiveOptions();
      refs.composerFeedback.textContent = '官方 Live 已刷新并同步。';
    } catch (error) {
      refs.composerFeedback.textContent = error.message || '官方 Live 刷新失败';
    } finally {
      if (refs.adminLiveRefreshButton) {
        refs.adminLiveRefreshButton.disabled = false;
        refs.adminLiveRefreshButton.textContent = '刷新官方Live';
      }
    }
  }

  async function refreshData() {
    await loadData();
    renderAll();
  }

  function renderAdminLivePanel() {
    if (!refs.adminLiveList || !refs.adminLivePanel) return;
    const all = Object.values(state.liveOptionsByFranchise).flat();
    if (!all.length) {
      refs.adminLiveList.innerHTML = '<div class="loading-note">暂无 Live 选项，可通过上方表单手动添加。</div>';
      if (refs.adminLivePager) {
        refs.adminLivePager.style.display = 'none';
        refs.adminLivePager.innerHTML = '';
      }
      return;
    }
    const franchiseLabelsMap = { bangdream: 'Bang Dream', lovelive: 'LoveLive', imas: 'IM@S', other: '其他' };
    const sorted = all.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const totalPages = Math.max(1, Math.ceil(sorted.length / adminLivePageSize));
    if (state.adminLivePage > totalPages) state.adminLivePage = totalPages;
    if (state.adminLivePage < 1) state.adminLivePage = 1;
    const startIndex = (state.adminLivePage - 1) * adminLivePageSize;
    const pageItems = sorted.slice(startIndex, startIndex + adminLivePageSize);

    refs.adminLiveList.innerHTML = pageItems.map(item => {
      const fl = item.franchiseLabel || franchiseLabelsMap[item.franchise] || item.franchise;
      const isManual = item.source === 'manual';
      return `<div class="review-item">
        <div class="review-item-head">
          <p class="review-item-title">${item.title}</p>
          <span class="tiny-pill">${isManual ? '手动' : '自动'}</span>
        </div>
        <p class="muted" style="margin:4px 0 8px;font-size:0.84rem">${fl} · ${item.venue} · ${item.date}</p>
        <div class="review-actions">
          <button class="card-btn secondary" type="button" data-live-edit="${encodeURIComponent(item.id)}">编辑</button>
          <button class="card-btn danger" type="button" data-live-delete="${encodeURIComponent(item.id)}">删除</button>
        </div>
      </div>`;
    }).join('');
    refs.adminLiveList.querySelectorAll('[data-live-edit]').forEach(btn => {
      btn.addEventListener('click', () => fillAdminLiveFormForEdit(decodeURIComponent(btn.getAttribute('data-live-edit'))));
    });
    refs.adminLiveList.querySelectorAll('[data-live-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteManualLiveOption(decodeURIComponent(btn.getAttribute('data-live-delete'))));
    });

    if (!refs.adminLivePager) return;
    if (totalPages <= 1) {
      refs.adminLivePager.style.display = 'none';
      refs.adminLivePager.innerHTML = '';
      return;
    }
    refs.adminLivePager.style.display = 'flex';
    refs.adminLivePager.innerHTML = `
      <button class="btn pager-button" type="button" data-admin-live-page="prev" ${state.adminLivePage === 1 ? 'disabled' : ''}>上一页</button>
      <span class="pager-info">第 ${state.adminLivePage} / ${totalPages} 页</span>
      <button class="btn pager-button" type="button" data-admin-live-page="next" ${state.adminLivePage === totalPages ? 'disabled' : ''}>下一页</button>
    `;
    refs.adminLivePager.querySelectorAll('[data-admin-live-page]').forEach(button => {
      button.addEventListener('click', () => {
        const direction = button.getAttribute('data-admin-live-page');
        if (direction === 'prev' && state.adminLivePage > 1) state.adminLivePage -= 1;
        if (direction === 'next' && state.adminLivePage < totalPages) state.adminLivePage += 1;
        renderAdminLivePanel();
      });
    });
  }

  function resetAdminLiveFormMode() {
    if (refs.adminLiveForm) refs.adminLiveForm.reset();
    if (refs.adminLiveEditingId) refs.adminLiveEditingId.value = '';
    if (refs.adminLiveSubmitButton) refs.adminLiveSubmitButton.textContent = '添加';
    if (refs.adminLiveCancelEditButton) refs.adminLiveCancelEditButton.hidden = true;
    setAdminLiveExtraDates([]);
  }

  function fillAdminLiveFormForEdit(id) {
    const all = Object.values(state.liveOptionsByFranchise).flat();
    const target = all.find(item => String(item.id) === String(id));
    if (!target) return;
    document.getElementById('adminLiveFranchise').value = target.franchise || 'other';
    document.getElementById('adminLiveTitle').value = target.title || '';
    document.getElementById('adminLiveVenue').value = target.venue || '';
    document.getElementById('adminLiveDate').value = target.date || '';
    document.getElementById('adminLiveTags').value = Array.isArray(target.tags) ? target.tags.join(', ') : '';
    document.getElementById('adminLiveUrl').value = target.url || '';
    if (refs.adminLiveEditingId) refs.adminLiveEditingId.value = target.id;
    if (refs.adminLiveSubmitButton) refs.adminLiveSubmitButton.textContent = '保存修改';
    if (refs.adminLiveCancelEditButton) refs.adminLiveCancelEditButton.hidden = false;
    setAdminLiveExtraDates([]);
    setSessionMessage(`正在编辑 Live：${target.title}`, 'is-success');
  }

  async function addManualLiveOption() {
    if (!state.currentUser || state.currentUser.role !== 'admin') return;
    const editingId = String(refs.adminLiveEditingId?.value || '').trim();
    const franchise = document.getElementById('adminLiveFranchise')?.value || 'other';
    const title = String(document.getElementById('adminLiveTitle')?.value || '').trim();
    const venue = String(document.getElementById('adminLiveVenue')?.value || '').trim();
    const date = String(document.getElementById('adminLiveDate')?.value || '').trim();
    const tagsRaw = String(document.getElementById('adminLiveTags')?.value || '').trim();
    const url = String(document.getElementById('adminLiveUrl')?.value || '').trim();
    if (!title || !venue || !date) {
      setSessionMessage('标题、场馆和日期为必填项。', 'is-error');
      return;
    }
    const allDates = Array.from(new Set([
      ...getAdminLiveExtraDates(),
      ...parseFlexibleDateList(date)
    ])).sort();
    if (!allDates.length) {
      setSessionMessage('请至少提供一个有效日期（YYYY-MM-DD）。', 'is-error');
      return;
    }
    const tags = tagsRaw ? normalizeOfficialLiveTags(tagsRaw.split(',').map(t => t.trim()).filter(Boolean)) : [];
    try {
      if (editingId) {
        await apiFetch(`/api/live-options/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          body: JSON.stringify({
            franchise,
            title,
            venue,
            date,
            tags,
            url: url || `manual://${franchise}/${date}/${Date.now()}`
          })
        });
        setSessionMessage(`已更新 Live：${title}`, 'is-success');
      } else {
        await Promise.all(allDates.map(currentDate => apiFetch('/api/live-options', {
          method: 'POST',
          body: JSON.stringify({
            franchise,
            title,
            venue,
            date: currentDate,
            tags,
            url: url || `manual://${franchise}/${currentDate}/${Date.now()}`
          })
        })));
        setSessionMessage(`已添加 Live：${title}（${allDates.length} 个日期）`, 'is-success');
      }
      resetAdminLiveFormMode();
      state.adminLivePage = 1;
      await loadData();
      renderOfficialLiveOptions();
      renderAdminLivePanel();
    } catch (error) {
      setSessionMessage(error.message || '添加失败', 'is-error');
    }
  }

  async function deleteManualLiveOption(id) {
    if (!state.currentUser || state.currentUser.role !== 'admin') return;
    if (!confirm('确认删除这条 Live 选项吗？')) return;
    try {
      await apiFetch(`/api/live-options/${encodeURIComponent(id)}`, { method: 'DELETE', body: '{}' });
      if (String(refs.adminLiveEditingId?.value || '') === String(id)) {
        resetAdminLiveFormMode();
      }
      state.adminLivePage = 1;
      setSessionMessage('已删除 Live 选项。', 'is-success');
      await loadData();
      renderOfficialLiveOptions();
      renderAdminLivePanel();
    } catch (error) {
      setSessionMessage(error.message || '删除失败', 'is-error');
    }
  }

  async function login(credentials) {
    try {
      const payload = await apiFetch('/api/session/login', {
        method: 'POST',
        body: JSON.stringify(credentials)
      });
      localStorage.setItem(tokenKey, payload.token);
      clearOfflineSession();
      state.currentUser = payload.user || payload.currentUser || null;
      await refreshData();
      setSessionMessage(`已切换到账号：${state.currentUser?.name || '未知账号'}`, 'is-success');
    } catch (error) {
      if (!isBackendUnavailable(error)) throw error;
      const username = String(credentials?.username || credentials?.nickname || credentials?.name || '').trim();
      if (!username) throw error;
      state.currentUser = {
        id: `offline-${username}`,
        name: username,
        role: username === 'admin' ? 'admin' : 'member'
      };
      clearOfflineSession();
      saveOfflineSession(state.currentUser);
      await refreshData();
      setSessionMessage('后端暂时不可用，已进入离线登录模式。', 'is-success');
    }
  }

  async function register(username, password) {
    const payload = await apiFetch('/api/session/register', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    localStorage.setItem(tokenKey, payload.token);
    state.currentUser = payload.user || payload.currentUser || null;
    await refreshData();
    setSessionMessage(`注册并登录成功：${state.currentUser?.name || '未知账号'}`, 'is-success');
  }

  async function logout() {
    await apiFetch('/api/session/logout', { method: 'POST', body: '{}' }).catch(() => {});
    localStorage.removeItem(tokenKey);
    clearOfflineSession();
    state.currentUser = null;
    await refreshData();
    setSessionMessage('已退出登录。', 'is-success');
  }

  async function changePassword(oldPassword, newPassword) {
    if (!state.currentUser) {
      throw new Error('请先登录后再修改密码。');
    }
    await apiFetch('/api/session/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword })
    });
  }

  async function submitListing(formData) {
    if (!state.currentUser) {
      throw new Error('请先登录后再发布');
    }
    const payload = buildPayloadFromForm(formData);
    const editingId = Number(formData.get('editingId'));
    const method = editingId ? 'PUT' : 'POST';
    const path = editingId ? `/api/listings/${editingId}` : '/api/listings';
    const response = await apiFetch(path, {
      method,
      body: JSON.stringify(payload)
    });
    await refreshData();
    return response.listing;
  }

  async function removeListing(listingId) {
    const listing = state.listings.find(item => item.id === listingId);
    if (!listing) return;
    if (!confirm(`确认删除这条票务吗？\n${listing.title}`)) return;
    await apiFetch(`/api/listings/${listingId}`, { method: 'DELETE', body: '{}' });
    if (state.editingId === listingId) resetComposer();
    await refreshData();
  }

  async function toggleFavorite(listingId) {
    await apiFetch(`/api/listings/${listingId}/favorite`, { method: 'POST', body: '{}' });
    await refreshData();
  }

  async function deleteNotification(notificationId) {
    if (!confirm('确定删除这条通知吗？')) return;
    if (state.currentUser?.role === 'admin') {
      moveNotificationToTrash(notificationId);
    } else {
      hideNotificationForCurrentUser(notificationId);
    }
    await refreshData();
  }

  async function recallNotification(notificationId) {
    if (!state.currentUser || state.currentUser.role !== 'admin') return;
    if (!confirm('确定撤回这条通知吗？这会让所有用户都看不到。')) return;
    await apiFetch(`/api/notifications/${notificationId}`, { method: 'DELETE', body: '{}' });
    await refreshData();
  }

  async function deleteAllNotifications() {
    const items = visibleNotifications();
    if (!items.length) return;
    if (!confirm(`确定删除全部通知吗？\n共 ${items.length} 条`)) return;
    if (state.currentUser?.role === 'admin') {
      const trashSet = currentNotificationTrashSet();
      items.forEach(item => trashSet.add(notificationIdentity(item)));
      saveNotificationTrashSet(trashSet);
    } else {
      const hiddenSet = currentNotificationHiddenSet();
      items.forEach(item => hiddenSet.add(notificationIdentity(item)));
      saveNotificationHiddenSet(hiddenSet);
    }
    await refreshData();
  }

  async function restoreFromTrash(notificationId) {
    if (!state.currentUser || state.currentUser.role !== 'admin') return;
    if (!confirm('确定从废纸篓撤回这条通知吗？')) return;
    restoreNotificationFromTrash(notificationId);
    await refreshData();
  }

  async function deleteFromTrash(notificationId) {
    if (!state.currentUser || state.currentUser.role !== 'admin') return;
    if (!confirm('确定永久删除这条废纸篓中的通知吗？')) return;
    permanentlyDeleteNotification(notificationId);
    await refreshData();
  }

  async function deleteAllFromTrash() {
    if (!state.currentUser || state.currentUser.role !== 'admin') return;
    const items = trashedNotifications();
    if (!items.length) return;
    if (!confirm(`确定永久删除废纸篓中的全部通知吗？\n共 ${items.length} 条`)) return;
    const trashSet = currentNotificationTrashSet();
    items.forEach(item => trashSet.delete(notificationIdentity(item)));
    saveNotificationTrashSet(trashSet);
    await refreshData();
  }

  async function sendBroadcastNotification() {
    if (!state.currentUser || state.currentUser.role !== 'admin') return;
    const panel = document.getElementById('adminBroadcastPanel');
    const textField = document.getElementById('adminBroadcastText');
    const text = String(textField?.value || '').trim();
    if (!text) {
      setSessionMessage('请输入通知内容。', 'is-error');
      textField?.focus();
      return;
    }
    try {
      await apiFetch('/api/notifications', {
        method: 'POST',
        body: JSON.stringify({ text, audience: 'all', type: 'system' })
      });
      if (textField) textField.value = '';
      if (panel) panel.hidden = true;
      await refreshData();
      setSessionMessage('全体通知已发送。', 'is-success');
    } catch (error) {
      setSessionMessage(error.message || '发送失败', 'is-error');
    }
  }

  async function submitFeedback() {
    if (!state.currentUser) {
      setSessionMessage('请先登录后再提交反馈。', 'is-error');
      return;
    }
    const textField = refs.feedbackText;
    const text = String(textField?.value || '').trim();
    if (!text) {
      setSessionMessage('请输入反馈内容。', 'is-error');
      textField?.focus();
      return;
    }
    try {
      await apiFetch('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({ text })
      });
      if (textField) textField.value = '';
      await refreshData();
      setSessionMessage('反馈已发送给管理员。', 'is-success');
    } catch (error) {
      setSessionMessage(error.message || '反馈发送失败', 'is-error');
    }
  }

  function enhanceTopbar() {
    const topbarActions = document.querySelector('.topbar-actions');
    if (!topbarActions) return;
    if (!document.getElementById('pageRail')) {
      const rail = document.createElement('div');
      rail.className = 'page-rail';
      rail.id = 'pageRail';
      rail.innerHTML = `
        <button type="button" data-page-tab="home">首页</button>
        <button type="button" data-page-tab="browse">浏览</button>
        <button type="button" data-page-tab="publish">发布</button>
        <button type="button" data-page-tab="center">通知</button>
      `;
      topbarActions.insertBefore(rail, topbarActions.firstChild);
      refs.pageRail = rail;
      refs.pageButtons = {
        home: rail.querySelector('[data-page-tab="home"]'),
        browse: rail.querySelector('[data-page-tab="browse"]'),
        publish: rail.querySelector('[data-page-tab="publish"]'),
        center: rail.querySelector('[data-page-tab="center"]')
      };
      Object.entries(refs.pageButtons).forEach(([page, button]) => {
        if (!button) return;
        button.addEventListener('click', () => setPage(page, { scroll: false }));
      });
    }
    if (!document.getElementById('adminBroadcastButton')) {
      const broadcastButton = document.createElement('button');
      broadcastButton.type = 'button';
      broadcastButton.className = 'btn btn-secondary';
      broadcastButton.id = 'adminBroadcastButton';
      broadcastButton.textContent = '全体通知';
      broadcastButton.hidden = true;
      broadcastButton.addEventListener('click', async () => {
        if (!state.currentUser || state.currentUser.role !== 'admin') return;
        const panel = document.getElementById('adminBroadcastPanel');
        const textField = document.getElementById('adminBroadcastText');
        if (panel) panel.hidden = false;
        textField?.focus();
        panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      topbarActions.insertBefore(broadcastButton, topbarActions.firstChild);
      refs.adminBroadcastButton = broadcastButton;
    }
    if (!document.getElementById('adminLiveRefreshButton')) {
      const refreshLiveButton = document.createElement('button');
      refreshLiveButton.type = 'button';
      refreshLiveButton.className = 'btn btn-secondary';
      refreshLiveButton.id = 'adminLiveRefreshButton';
      refreshLiveButton.textContent = '刷新官方Live';
      refreshLiveButton.hidden = true;
      refreshLiveButton.addEventListener('click', async () => {
        await refreshOfficialLiveOptionsNow();
      });
      topbarActions.insertBefore(refreshLiveButton, topbarActions.firstChild);
      refs.adminLiveRefreshButton = refreshLiveButton;
    }
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'notification-chip';
    chip.id = 'notificationChip';
    chip.innerHTML = '<strong>通知</strong><span>0 条</span>';
    chip.addEventListener('click', () => {
      const panel = document.getElementById('notificationPanel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    topbarActions.insertBefore(chip, topbarActions.firstChild);
    refs.notificationChip = chip;
    refs.userChip = document.getElementById('topbarUserChip');
  }

  function enhanceFilters() {
    const franchiseTabs = document.querySelector('[aria-label="企划筛选"]');
    if (franchiseTabs && !document.querySelector('[data-franchise="imas"]')) {
      const otherButtons = [
        ['imas', 'IM@S'],
        ['other', '其他']
      ];
      otherButtons.forEach(([value, label]) => {
        const button = document.createElement('button');
        button.className = 'chip';
        button.type = 'button';
        button.dataset.franchise = value;
        button.textContent = label;
        franchiseTabs.appendChild(button);
      });
    }
  }

  function syncToolbarAlignment() {
    const toolbar = document.querySelector('.toolbar');
    const heroCard = document.querySelector('.hero-card');
    const sessionPanel = document.querySelector('.session-panel');
    if (!toolbar || !heroCard) return;

    if (window.innerWidth <= 760) {
      toolbar.style.marginLeft = '';
      toolbar.style.marginRight = '';
      toolbar.style.width = '';
      return;
    }

    toolbar.style.marginLeft = '';
    toolbar.style.marginRight = '';
    toolbar.style.width = '';

    const baseRect = toolbar.getBoundingClientRect();
    const heroRect = heroCard.getBoundingClientRect();
    const sessionRect = (sessionPanel || heroCard).getBoundingClientRect();
    const leftShift = Math.max(0, heroRect.left - baseRect.left);
    const rightEdge = Math.max(heroRect.right, sessionRect.right);

    toolbar.style.marginLeft = `${leftShift}px`;
    toolbar.style.marginRight = '0';
    toolbar.style.width = `${Math.max(0, rightEdge - heroRect.left)}px`;
  }

  function injectPanels() {
    const sidebar = document.querySelector('#post')?.parentElement;
    if (!sidebar) return;
    if (!document.getElementById('notificationPanel')) {
      const notificationPanel = document.createElement('section');
      notificationPanel.className = 'notification-panel';
      notificationPanel.id = 'notificationPanel';
      notificationPanel.innerHTML = `
        <div class="panel-head">
          <h3 style="margin:0; font-family:'Noto Serif SC', 'Songti SC', serif;">通知中心</h3>
          <div class="panel-head-actions" id="notificationPanelActions">
            <span class="tiny-pill">最新动态</span>
            <button class="btn pager-button" type="button" id="notificationTrashButton">废纸篓</button>
            <button class="btn pager-button" type="button" id="notificationDeleteAllButton">全部删除</button>
          </div>
        </div>
        <div class="notification-list" id="notificationList"></div>
        <div class="listing-pager" id="notificationPager"></div>
      `;
      sidebar.appendChild(notificationPanel);
    }
    if (!document.getElementById('adminBroadcastPanel')) {
      const broadcastPanel = document.createElement('section');
      broadcastPanel.className = 'broadcast-panel';
      broadcastPanel.id = 'adminBroadcastPanel';
      broadcastPanel.hidden = true;
      broadcastPanel.innerHTML = `
        <div class="panel-head"><h3 style="margin:0; font-family:'Noto Serif SC', 'Songti SC', serif;">管理员全体通知</h3><span class="tiny-pill">全员可见</span></div>
        <form class="broadcast-form" id="adminBroadcastForm">
          <textarea class="field" id="adminBroadcastText" rows="4" placeholder="请输入要发送给全体用户的通知内容"></textarea>
          <div class="broadcast-actions">
            <button class="btn btn-primary" type="submit">发送通知</button>
            <button class="btn btn-secondary" type="button" id="adminBroadcastCancel">取消</button>
          </div>
        </form>
      `;
      sidebar.insertBefore(broadcastPanel, document.getElementById('notificationPanel'));
    }
    if (!document.getElementById('adminLivePanel')) {
      const livePanel = document.createElement('section');
      livePanel.className = 'broadcast-panel';
      livePanel.id = 'adminLivePanel';
      livePanel.hidden = true;
      livePanel.innerHTML = `
        <div class="panel-head"><h3 style="margin:0;font-family:'Noto Serif SC','Songti SC',serif;">管理官方 Live 选项</h3><span class="tiny-pill">仅管理员</span></div>
        <form class="broadcast-form" id="adminLiveForm">
          <input type="hidden" id="adminLiveEditingId" />
          <select class="field" id="adminLiveFranchise">
            <option value="bangdream">Bang Dream</option>
            <option value="lovelive">LoveLive</option>
            <option value="imas">IM@S</option>
            <option value="other">其他</option>
          </select>
          <input class="field" id="adminLiveTitle" placeholder="Live 标题（必填）" />
          <input class="field" id="adminLiveVenue" placeholder="场馆（必填）" />
          <input class="field" type="date" id="adminLiveDate" />
          <div class="choice-card">
            <span class="choice-label">额外日期（可选）</span>
            <div id="adminLiveDatesList" style="display:grid; gap:8px;"></div>
            <button class="btn btn-secondary" type="button" id="adminLiveAddDateButton">添加日期</button>
          </div>
          <input class="field" id="adminLiveTags" placeholder="标签，逗号分隔（可选）" />
          <input class="field" id="adminLiveUrl" placeholder="官方链接（可选）" />
          <div class="broadcast-actions">
            <button class="btn btn-primary" type="submit" id="adminLiveSubmitButton">添加</button>
            <button class="btn btn-secondary" type="button" id="adminLiveCancelEditButton" hidden>返回添加</button>
            <button class="btn btn-secondary" type="button" id="adminLivePanelClose">关闭</button>
          </div>
        </form>
        <div class="review-list" id="adminLiveList"></div>
        <div class="listing-pager" id="adminLivePager"></div>
      `;
      sidebar.insertBefore(livePanel, document.getElementById('notificationPanel'));
    }
    if (!document.getElementById('detailOverlay')) {
      const overlay = document.createElement('div');
      overlay.className = 'detail-overlay';
      overlay.id = 'detailOverlay';
      overlay.innerHTML = `
        <div class="detail-sheet">
          <div class="detail-shell">
            <div id="detailContent"></div>
          </div>
        </div>
      `;
      overlay.addEventListener('click', event => {
        if (event.target === overlay) hideDetail();
      });
      document.body.appendChild(overlay);
    }
    refs.notificationList = document.getElementById('notificationList');
    refs.notificationPager = document.getElementById('notificationPager');
    refs.adminLiveManageButton = document.getElementById('adminLiveManageButton');
    refs.notificationDeleteAllButton = document.getElementById('notificationDeleteAllButton');
    refs.notificationTrashButton = document.getElementById('notificationTrashButton');
    refs.notificationTrashOverlay = document.getElementById('notificationTrashOverlay');
    refs.notificationTrashList = document.getElementById('notificationTrashList');
    refs.trashDeleteAllButton = document.getElementById('trashDeleteAllButton');
    refs.trashCloseButton = document.getElementById('trashCloseButton');
    refs.adminBroadcastPanel = document.getElementById('adminBroadcastPanel');
    refs.adminBroadcastForm = document.getElementById('adminBroadcastForm');
    refs.adminBroadcastText = document.getElementById('adminBroadcastText');
    refs.adminLivePanel = document.getElementById('adminLivePanel');
    refs.adminLiveForm = document.getElementById('adminLiveForm');
    refs.adminLiveEditingId = document.getElementById('adminLiveEditingId');
    refs.adminLiveSubmitButton = document.getElementById('adminLiveSubmitButton');
    refs.adminLiveCancelEditButton = document.getElementById('adminLiveCancelEditButton');
    refs.adminLiveList = document.getElementById('adminLiveList');
    refs.adminLivePager = document.getElementById('adminLivePager');
    refs.adminBroadcastCancel = document.getElementById('adminBroadcastCancel');
    refs.detailOverlay = document.getElementById('detailOverlay');
    refs.detailContent = document.getElementById('detailContent');
  }

  function ensureNotificationTrashUI() {
    const notificationPanelActions = document.getElementById('notificationPanelActions');
    if (!notificationPanelActions) return;
    if (!document.getElementById('notificationTrashButton')) {
      const trashButton = document.createElement('button');
      trashButton.className = 'btn pager-button';
      trashButton.type = 'button';
      trashButton.id = 'notificationTrashButton';
      trashButton.textContent = '废纸篓';
      trashButton.onclick = () => {
        if (refs.notificationTrashOverlay) {
          refs.notificationTrashOverlay.hidden = false;
          refs.notificationTrashOverlay.classList.add('is-open');
          refs.notificationTrashOverlay.style.display = 'flex';
        }
      };
      notificationPanelActions.insertBefore(trashButton, notificationPanelActions.querySelector('#notificationDeleteAllButton'));
      refs.notificationTrashButton = trashButton;
    }
    if (!document.getElementById('notificationTrashOverlay')) {
      const trashOverlay = document.createElement('div');
      trashOverlay.className = 'detail-overlay';
      trashOverlay.id = 'notificationTrashOverlay';
      trashOverlay.hidden = true;
      trashOverlay.innerHTML = `
        <div class="detail-sheet">
          <div class="detail-shell">
            <div class="detail-top">
              <div>
                <div class="badge-row" style="justify-content:flex-start; margin-bottom:12px;">
                  <span class="tiny-pill">已移除通知</span>
                </div>
                <h2 class="detail-title" style="margin-bottom:0;">废纸篓</h2>
              </div>
              <div class="detail-actions">
                <button class="btn btn-secondary" type="button" id="trashCloseButton">关闭</button>
                <button class="btn pager-button" type="button" id="trashDeleteAllButton">全部删除</button>
              </div>
            </div>
            <div class="notification-list" id="notificationTrashList"></div>
          </div>
        </div>
      `;
      trashOverlay.addEventListener('click', event => {
        if (event.target === trashOverlay) trashOverlay.hidden = true;
      });
      document.body.appendChild(trashOverlay);
      refs.notificationTrashOverlay = trashOverlay;
      refs.notificationTrashList = document.getElementById('notificationTrashList');
      refs.trashDeleteAllButton = document.getElementById('trashDeleteAllButton');
      refs.trashCloseButton = document.getElementById('trashCloseButton');
      if (refs.trashDeleteAllButton) refs.trashDeleteAllButton.onclick = () => deleteAllFromTrash();
      if (refs.trashCloseButton) {
        refs.trashCloseButton.onclick = () => {
          if (refs.notificationTrashOverlay) {
            refs.notificationTrashOverlay.classList.remove('is-open');
            refs.notificationTrashOverlay.hidden = true;
            refs.notificationTrashOverlay.style.display = 'none';
          }
        };
      }
    }
  }

  function wireFormEvents() {
    refs.searchInput.addEventListener('input', event => {
      state.search = event.target.value.trim();
      state.currentPage = 1;
      renderAll();
    });

    if (refs.sortSelect) {
      refs.sortSelect.addEventListener('change', event => {
        state.sort = String(event.target.value || 'dateDesc');
        state.currentPage = 1;
        renderAll();
      });
    }

    refs.draftForm.elements.quantity.addEventListener('input', () => {
      syncQuantityDependentChoices();
    });

    if (refs.officialLiveApplyButton) {
      refs.officialLiveApplyButton.addEventListener('click', () => {
        applyOfficialLiveToForm();
      });
    }

    if (refs.officialLiveTagList) {
      refs.officialLiveTagList.addEventListener('click', event => {
        const button = event.target.closest('[data-official-tag-remove]');
        if (!button) return;
        removeOfficialLiveTag(button.getAttribute('data-official-tag-remove') || '');
      });
    }

    document.getElementById('addExtraDateButton')?.addEventListener('click', () => {
      addPublishExtraDateField('');
    });

    document.getElementById('extraDatesList')?.addEventListener('click', event => {
      const button = event.target.closest('[data-remove-extra-date]');
      if (!button) return;
      const row = button.closest('[data-extra-date-row]');
      if (row) row.remove();
    });

    document.querySelectorAll('[data-choice-field]').forEach(button => {
      button.addEventListener('click', () => {
        setComposerChoice(button.getAttribute('data-choice-field'), button.getAttribute('data-choice-value'));
      });
    });

    document.querySelectorAll('[data-franchise]').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-franchise]').forEach(item => item.classList.remove('is-active'));
        button.classList.add('is-active');
        state.franchise = button.dataset.franchise;
        state.currentPage = 1;
        renderAll();
      });
    });

    document.querySelectorAll('[data-kind]').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-kind]').forEach(item => item.classList.remove('is-active'));
        button.classList.add('is-active');
        state.kind = button.dataset.kind;
        state.currentPage = 1;
        renderAll();
      });
    });

    document.querySelectorAll('[data-favorites]').forEach(button => {
      button.addEventListener('click', () => {
        state.favoritesOnly = !state.favoritesOnly;
        button.classList.toggle('is-active', state.favoritesOnly);
        state.currentPage = 1;
        renderAll();
      });
    });

    refs.loginForm.addEventListener('submit', async event => {
      event.preventDefault();
      const formData = new FormData(refs.loginForm);
      const username = String(formData.get('username') || '').trim();
      const password = String(formData.get('password') || '').trim();
      if (!username || !password) {
        setSessionMessage('请输入用户名和密码。', 'is-error');
        return;
      }
      try {
        await login({ username, nickname: username, name: username, password });
      } catch (error) {
        setSessionMessage(error.message || '登录失败', 'is-error');
      }
    });

    document.getElementById('registerButton').addEventListener('click', () => {
      window.location.href = './register.html';
    });

    if (refs.logoutButton) {
      refs.logoutButton.addEventListener('click', async () => {
        try {
          await logout();
        } catch (error) {
          setSessionMessage(error.message || '退出失败', 'is-error');
        }
      });
    }

    if (refs.changePasswordToggleButton) {
      refs.changePasswordToggleButton.addEventListener('click', () => {
        toggleChangePasswordArea();
      });
    }

    if (refs.changePasswordCancelButton) {
      refs.changePasswordCancelButton.addEventListener('click', () => {
        toggleChangePasswordArea(false);
      });
    }

    if (refs.changePasswordForm) {
      refs.changePasswordForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (!state.currentUser) {
          setSessionMessage('请先登录后再修改密码。', 'is-error');
          return;
        }
        const formData = new FormData(refs.changePasswordForm);
        const oldPassword = String(formData.get('oldPassword') || '').trim();
        const newPassword = String(formData.get('newPassword') || '').trim();
        if (!oldPassword || !newPassword) {
          setSessionMessage('请填写旧密码和新密码。', 'is-error');
          return;
        }
        if (newPassword.length < 6) {
          setSessionMessage('新密码至少 6 位。', 'is-error');
          return;
        }
        if (oldPassword === newPassword) {
          setSessionMessage('新密码不能与旧密码相同。', 'is-error');
          return;
        }
        try {
          await changePassword(oldPassword, newPassword);
          refs.changePasswordForm.reset();
          toggleChangePasswordArea(false);
          setSessionMessage('密码修改成功。', 'is-success');
        } catch (error) {
          setSessionMessage(error.message || '修改密码失败', 'is-error');
        }
      });
    }

    if (refs.adminBroadcastForm) {
      refs.adminBroadcastForm.addEventListener('submit', event => {
        event.preventDefault();
        sendBroadcastNotification();
      });
    }

    if (refs.adminBroadcastCancel) {
      refs.adminBroadcastCancel.addEventListener('click', () => {
        if (refs.adminBroadcastPanel) refs.adminBroadcastPanel.hidden = true;
        if (refs.adminBroadcastText) refs.adminBroadcastText.value = '';
      });
    }

    if (refs.feedbackSubmitButton) {
      refs.feedbackSubmitButton.addEventListener('click', () => {
        submitFeedback();
      });
    }

    if (refs.notificationDeleteAllButton) {
      refs.notificationDeleteAllButton.addEventListener('click', () => deleteAllNotifications());
    }

    if (refs.adminLiveManageButton) {
      refs.adminLiveManageButton.addEventListener('click', () => {
        if (!state.currentUser || state.currentUser.role !== 'admin') return;
        const panel = document.getElementById('adminLivePanel');
        if (!panel) return;
        panel.hidden = !panel.hidden;
        if (!panel.hidden) {
          renderAdminLivePanel();
        }
      });
    }

    if (refs.notificationTrashButton) {
      refs.notificationTrashButton.onclick = () => {
        if (refs.notificationTrashOverlay) {
          refs.notificationTrashOverlay.hidden = false;
          refs.notificationTrashOverlay.classList.add('is-open');
          refs.notificationTrashOverlay.style.display = 'flex';
        }
      };
    }

    if (refs.trashDeleteAllButton) {
      refs.trashDeleteAllButton.onclick = () => deleteAllFromTrash();
    }

    if (refs.trashCloseButton) {
      refs.trashCloseButton.onclick = () => {
        if (refs.notificationTrashOverlay) {
          refs.notificationTrashOverlay.classList.remove('is-open');
          refs.notificationTrashOverlay.hidden = true;
          refs.notificationTrashOverlay.style.display = 'none';
        }
      };
    }

    if (refs.adminLiveForm) {
      refs.adminLiveForm.addEventListener('submit', event => {
        event.preventDefault();
        addManualLiveOption();
      });
    }
    document.getElementById('adminLiveAddDateButton')?.addEventListener('click', () => {
      addAdminLiveExtraDateField('');
    });
    document.getElementById('adminLiveDatesList')?.addEventListener('click', event => {
      const button = event.target.closest('[data-remove-extra-date]');
      if (!button) return;
      const row = button.closest('[data-extra-date-row]');
      if (row) row.remove();
    });
    document.getElementById('adminLivePanelClose')?.addEventListener('click', () => {
      resetAdminLiveFormMode();
      if (refs.adminLivePanel) refs.adminLivePanel.hidden = true;
    });
    document.getElementById('adminLiveCancelEditButton')?.addEventListener('click', () => {
      resetAdminLiveFormMode();
      setSessionMessage('已返回添加 Live 模式。', 'is-success');
    });

    refs.cancelEditButton.addEventListener('click', () => {
      resetComposer();
      refs.composerFeedback.hidden = false;
      refs.composerFeedback.textContent = '已返回发布模板。';
    });

    refs.draftForm.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        const listing = await submitListing(new FormData(refs.draftForm));
        refs.composerFeedback.hidden = false;
        refs.composerFeedback.textContent = state.editingId ? `已保存修改：${listing.title}` : `已发布：${listing.title}`;
        resetComposer();
      } catch (error) {
        refs.composerFeedback.hidden = false;
        refs.composerFeedback.textContent = error.message || '发布失败';
      }
    });
  }

  function renderAll() {
    renderTopbar();
    renderSessionPanel();
    renderStats();
    if (refs.sortSelect) refs.sortSelect.value = state.sort;
    renderListings();
    renderNotifications();
    renderNotificationTrash();
    if (state.page === 'center') renderAdminLivePanel();
    syncPageNavigation();
    syncToolbarAlignment();
    if (state.selectedListingId) {
      renderDetailModal();
    }
  }

  async function bootstrap() {
    document.title = 'Ticket Exchange';
    injectStyles();
    enhanceTopbar();
    enhanceFilters();
    injectPanels();
    document.body.dataset.page = state.page;

    refs.stats = document.getElementById('stats');
    refs.listingList = document.getElementById('listingList');
    refs.emptyState = document.getElementById('emptyState');
    refs.listingPager = document.getElementById('listingPager');
    refs.searchInput = document.getElementById('searchInput');
    refs.sortSelect = document.getElementById('sortSelect');
    refs.draftForm = document.getElementById('draftForm');
    refs.composerFeedback = document.getElementById('composerFeedback');
    refs.loginForm = document.getElementById('loginForm');
    refs.sessionLoginArea = document.getElementById('sessionLoginArea');
    refs.sessionLoggedArea = document.getElementById('sessionLoggedArea');
    refs.logoutButton = document.getElementById('logoutButton');
    refs.changePasswordArea = document.getElementById('changePasswordArea');
    refs.changePasswordForm = document.getElementById('changePasswordForm');
    refs.changePasswordToggleButton = document.getElementById('changePasswordToggleButton');
    refs.changePasswordCancelButton = document.getElementById('changePasswordCancelButton');
    refs.feedbackComposerArea = document.getElementById('feedbackComposerArea');
    refs.feedbackText = document.getElementById('feedbackText');
    refs.feedbackSubmitButton = document.getElementById('feedbackSubmitButton');
    refs.sessionFeedback = document.getElementById('sessionFeedback');
    refs.registerButton = document.getElementById('registerButton');
    refs.cancelEditButton = document.getElementById('cancelEditButton');
    refs.sessionStatusText = document.getElementById('sessionStatusText');
    refs.sessionRoleLabel = document.getElementById('sessionRoleLabel');
    refs.myListingCount = document.getElementById('myListingCount');
    refs.editingId = document.getElementById('editingId');
    refs.draftSubmitButton = document.getElementById('draftSubmitButton');
    refs.composerTitle = document.getElementById('composerTitle');
    refs.userChip = document.getElementById('topbarUserChip');
    refs.notificationChip = document.getElementById('notificationChip');
    refs.officialLiveSelect = document.getElementById('officialLiveSelect');
    refs.officialLiveApplyButton = document.getElementById('officialLiveApplyButton');
    refs.officialLiveTagList = document.getElementById('officialLiveTagList');
    refs.officialLiveMeta = document.getElementById('officialLiveMeta');

    syncComposerChoices();
    syncQuantityDependentChoices();
    setPublishExtraDates([]);
    setAdminLiveExtraDates([]);
    setOfficialLiveTags([]);
    wireFormEvents();
    window.addEventListener('resize', () => window.requestAnimationFrame(syncToolbarAlignment));
    setComposerMode(null);
    await loadData();
    renderOfficialLiveOptions();
    renderAll();

    if (!state.currentUser) {
      document.getElementById('composerFeedback').hidden = false;
      refs.composerFeedback.textContent = '请先登录后再发布、编辑或删除票务。';
      setSessionMessage('', '', false);
    } else {
      document.getElementById('composerFeedback').hidden = true;
      refs.composerFeedback.textContent = '';
      setSessionMessage('', '', false);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
