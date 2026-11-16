/* ============================================================
 * CrushLens Cloud · 本地数据层（IndexedDB + 本地账号）
 * 所有数据只存在当前浏览器，不上传任何服务器
 * ============================================================ */
(function (root) {
  'use strict';
  const E = root.CLEngine;

  const DB_NAME = 'crushlens_local_v1';
  const DB_VER = 1;
  const SESSION_KEY = 'crushlens_session_v1';

  let dbPromise = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        const mk = (name, opts, idx) => {
          if (db.objectStoreNames.contains(name)) return;
          const s = db.createObjectStore(name, opts);
          (idx || []).forEach(([n, k, o]) => s.createIndex(n, k, o || {}));
        };
        mk('accounts', { keyPath: 'id', autoIncrement: true }, [['email', 'email', { unique: true }]]);
        mk('partners', { keyPath: 'id', autoIncrement: true }, [['uid', 'uid'], ['uidName', ['uid', 'name']]]);
        mk('messages', { keyPath: 'id', autoIncrement: true }, [['pid', 'pid'], ['uid', 'uid']]);
        mk('batches', { keyPath: 'id', autoIncrement: true }, [['pid', 'pid'], ['uid', 'uid']]);
        mk('reports', { keyPath: 'id', autoIncrement: true }, [['pid', 'pid'], ['uid', 'uid']]);
        mk('grants', { keyPath: 'id', autoIncrement: true }, [['uid', 'uid'], ['status', 'status']]);
        mk('requests', { keyPath: 'id', autoIncrement: true }, [['uid', 'uid'], ['status', 'status']]);
        mk('audit', { keyPath: 'id', autoIncrement: true }, [['uid', 'uid'], ['at', 'at']]);
        mk('meta', { keyPath: 'k' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  function db() {
    if (!dbPromise) dbPromise = openDB();
    return dbPromise;
  }

  function run(store, mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      try { out = fn(s); } catch (err) { reject(err); return; }
      t.oncomplete = () => resolve(out && out.__result !== undefined ? out.__result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  function wrap(request) {
    const o = { __result: undefined };
    request.onsuccess = () => { o.__result = request.result; };
    return o;
  }

  const getAll = (store, index, key) => run(store, 'readonly', (s) => wrap(index ? s.index(index).getAll(key) : s.getAll()));
  const getOne = (store, key) => run(store, 'readonly', (s) => wrap(s.get(key)));
  const put = (store, val) => run(store, 'readwrite', (s) => wrap(s.put(val)));
  const add = (store, val) => run(store, 'readwrite', (s) => wrap(s.add(val)));
  const del = (store, key) => run(store, 'readwrite', (s) => wrap(s.delete(key)));

  /* ---------------- 密码哈希 ----------------
     只用 PBKDF2。绝不静默降级成非加密哈希：
     crypto.subtle 在非安全上下文（file:// 双击、手机访问 http://192.168.x.x）不存在，
     一旦降级，同一个库里会混存两种算法，换到 localhost 打开就再也登不进自己的账号。 */
  const PW_ALG = 'pbkdf2-sha256-60000';

  function bufToHex(buf) {
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  function hexToBuf(hex) {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16);
    return arr;
  }
  function randHex(n) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return bufToHex(a);
  }
  function hasSubtle() {
    try { return !!(root.crypto && root.crypto.subtle && root.crypto.subtle.importKey); }
    catch (e) { return false; }
  }
  function assertSecureContext() {
    if (!hasSubtle()) {
      throw new Error('当前打开方式不支持安全加密（缺少 WebCrypto）。请用 http://localhost 或 https 地址打开，不要直接双击 html 文件。');
    }
  }

  async function hashPw(pw, saltHex) {
    assertSecureContext();
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: hexToBuf(saltHex), iterations: 60000, hash: 'SHA-256' }, key, 256
    );
    return bufToHex(bits);
  }

  /* ---------------- 会话 ---------------- */
  function saveSession(uid) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ uid, at: Date.now() }));
    // 登录/注册成功即复位过期标志，否则同一个页面生命周期里
    // 「旧会话过期 → 重新登录」后登录页仍提示「已过期」
    sessionExpired = false;
  }
  function clearSession() { localStorage.removeItem(SESSION_KEY); }

  // 会话有效期：7 天。共用电脑上「上次登录的人永远登不出去」是安全问题。
  const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
  let sessionExpired = false;

  // 滑动续期：会话还有效但上次活跃已超过 1 天时刷新 at，
  // 「连续每天都在用」不会被 7 天硬上限踢出去；真正 7 天没碰才会过期
  const SESSION_ROLL = 24 * 60 * 60 * 1000;

  function sessionUid() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!s || !s.uid) return null;
      const age = s.at ? (Date.now() - s.at) : 0;
      if (s.at && age > SESSION_TTL) {
        sessionExpired = true;
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      if (!s.at || age > SESSION_ROLL) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ uid: s.uid, at: Date.now() }));
      }
      return s.uid;
    } catch (e) { return null; }
  }
  function wasSessionExpired() { return sessionExpired; }

  /* ---------------- 审计 ---------------- */
  async function log(uid, action, target, meta) {
    return add('audit', { uid: uid || null, action, target: target || '', meta: meta || {}, at: Date.now() });
  }

  /* ---------------- 账号 ---------------- */
  async function signup(email, password, name, opts) {
    const o = opts || {};
    email = String(email || '').trim().toLowerCase();
    name = String(name || '').trim() || email.split('@')[0];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('邮箱格式不对，检查一下');
    if (String(password || '').length < 6) throw new Error('密码至少 6 位');
    assertSecureContext();
    const all = await getAll('accounts');
    if (all.some((a) => a.email === email)) throw new Error('这个邮箱已经注册过了，直接登录吧');

    const salt = randHex(16);
    const acc = {
      email, name, salt, pw: await hashPw(password, salt), pwAlg: PW_ALG,
      createdAt: Date.now(), lastLogin: Date.now(), loginCount: 1,
      isDeveloper: !!o.developer
    };
    acc.id = await add('accounts', acc);
    saveSession(acc.id);
    await log(acc.id, 'signup', email, { developer: !!o.developer });
    return acc;
  }

  async function login(email, password) {
    email = String(email || '').trim().toLowerCase();
    const all = await getAll('accounts');
    const acc = all.find((a) => a.email === email);
    if (!acc) throw new Error('没有找到这个账号，先注册一个');
    // 老账号没有算法标记说明是早期弱哈希，明确提示而不是给出「密码不对」
    if (acc.pwAlg !== PW_ALG) {
      throw new Error('这个账号是旧版本创建的，密码校验方式已升级，无法登录。请用同一个邮箱重新注册。');
    }
    const h = await hashPw(password, acc.salt);
    if (h !== acc.pw) throw new Error('密码不对');
    acc.lastLogin = Date.now();
    acc.loginCount = (acc.loginCount || 1) + 1;
    await put('accounts', acc);
    saveSession(acc.id);
    await log(acc.id, 'login', acc.email, {});
    return acc;
  }

  function logout() {
    const uid = sessionUid();
    if (uid) log(uid, 'logout', '', {});
    clearSession();
  }

  async function current() {
    const uid = sessionUid();
    if (!uid) return null;
    const acc = await getOne('accounts', uid);
    return acc || null;
  }

  /* ---------------- 角色 / 权限 ---------------- */
  async function getMeta(k, fallback) {
    const row = await getOne('meta', k);
    return row ? row.v : fallback;
  }
  async function setMeta(k, v) { return put('meta', { k, v }); }

  async function ownerUid() { return getMeta('owner_uid', null); }

  async function claimOwner(acc) {
    const cur = await ownerUid();
    if (cur) throw new Error('已经存在总开发者，不能重复认领');
    await setMeta('owner_uid', acc.id);
    await add('grants', {
      uid: acc.id, email: acc.email, name: acc.name,
      level: 'owner', status: 'active', grantedBy: acc.id,
      grantedAt: Date.now(), expiresAt: null, note: '总开发者（永久）'
    });
    await log(acc.id, 'claim_owner', acc.email, {});
    return true;
  }

  async function grantsOf(uid) {
    const rows = await getAll('grants', 'uid', uid);
    let changed = false;
    for (const g of rows) {
      if (g.status === 'active' && g.expiresAt && g.expiresAt < Date.now()) {
        g.status = 'expired'; await put('grants', g); changed = true;
      }
    }
    return rows.sort((a, b) => b.grantedAt - a.grantedAt);
  }

  async function roleOf(acc) {
    if (!acc) return { level: 'guest', permanent: false };
    const owner = await ownerUid();
    if (owner && owner === acc.id) return { level: 'owner', permanent: true, expiresAt: null };
    const rows = await grantsOf(acc.id);
    const active = rows.find((g) => g.status === 'active' && (!g.expiresAt || g.expiresAt > Date.now()));
    if (active) return { level: 'dev', permanent: false, expiresAt: active.expiresAt, grant: active };
    const pending = (await getAll('requests', 'uid', acc.id)).find((r) => r.status === 'pending');
    if (pending) return { level: 'pending', permanent: false };
    return { level: 'user', permanent: false };
  }

  async function issueGrant(ownerAcc, email, hours, note) {
    const all = await getAll('accounts');
    const target = all.find((a) => a.email === String(email || '').trim().toLowerCase());
    if (!target) throw new Error('这个邮箱还没有注册过账号，让对方先注册再来申请');
    // 时长必须校验：NaN / 负数 / 超大值会写出 expiresAt: NaN，让授权状态不可预测
    let h = Number(hours);
    if (!isFinite(h) || h <= 0) h = 24;
    h = Math.min(168, Math.max(1, Math.round(h)));
    const g = {
      uid: target.id, email: target.email, name: target.name,
      level: 'dev', status: 'active', grantedBy: ownerAcc.id,
      grantedAt: Date.now(), expiresAt: Date.now() + h * 3600 * 1000,
      note: note || ''
    };
    g.id = await add('grants', g);
    // 同时把该用户的待审申请置为通过
    const reqs = await getAll('requests', 'uid', target.id);
    for (const r of reqs.filter((x) => x.status === 'pending')) {
      r.status = 'approved'; r.decidedAt = Date.now(); r.decidedBy = ownerAcc.id; r.grantId = g.id;
      await put('requests', r);
    }
    await log(ownerAcc.id, 'grant_issue', target.email, { hours: h, grantId: g.id });
    return g;
  }

  async function revokeGrant(ownerAcc, id) {
    const g = await getOne('grants', id);
    if (!g) return false;
    if (g.level === 'owner') throw new Error('总开发者权限不可撤销');
    g.status = 'revoked'; g.revokedAt = Date.now();
    await put('grants', g);
    await log(ownerAcc.id, 'grant_revoke', g.email, { grantId: id });
    return true;
  }

  async function requestAccess(acc, reason) {
    const r = {
      uid: acc.id, email: acc.email, name: acc.name,
      reason: String(reason || '').slice(0, 300),
      status: 'pending', requestedAt: Date.now()
    };
    r.id = await add('requests', r);
    await log(acc.id, 'access_request', acc.email, { reason: r.reason });
    return r;
  }

  async function decideRequest(ownerAcc, id, approve, hours) {
    const r = await getOne('requests', id);
    if (!r) throw new Error('申请不存在');
    r.decidedAt = Date.now(); r.decidedBy = ownerAcc.id;
    if (approve) {
      const g = await issueGrant(ownerAcc, r.email, hours || 24, '申请通过');
      r.status = 'approved'; r.grantId = g.id;
    } else {
      r.status = 'rejected';
    }
    await put('requests', r);
    await log(ownerAcc.id, approve ? 'request_approve' : 'request_reject', r.email, { id });
    return r;
  }

  /* ---------------- 追踪对象 ---------------- */
  async function listPartners(uid) {
    const rows = await getAll('partners', 'uid', uid);
    return rows.sort((a, b) => (b.lastMsgAt || b.createdAt) - (a.lastMsgAt || a.createdAt));
  }

  // 按名字找已有对象（不看平台：同一个人换了端导入，也应该并入同一个对象）
  async function findPartnerByName(uid, name) {
    const want = String(name || '').trim().toLowerCase();
    if (!want) return null;
    const rows = await getAll('partners', 'uid', uid);
    return rows.find((p) => String(p.name || '').trim().toLowerCase() === want) || null;
  }

  async function createPartner(uid, data) {
    const p = {
      uid, name: data.name, platform: data.platform || 'paste',
      mode: data.mode || 'crush', note: data.note || '',
      // 记住「哪个说话人是我」，否则 compute() 里 me=null，主动/回应两个维度会退化成 50 基线
      meSpeaker: data.meSpeaker || null,
      color: data.color || pickColor(data.name),
      createdAt: Date.now(), msgCount: 0, firstMsgAt: null, lastMsgAt: null, lastImportAt: null
    };
    p.id = await add('partners', p);
    await log(uid, 'partner_create', p.name, { platform: p.platform });
    return p;
  }

  async function updatePartner(uid, id, patch) {
    const p = await getOne('partners', id);
    if (!p || p.uid !== uid) throw new Error('找不到这个对象');
    Object.assign(p, patch);
    await put('partners', p);
    return p;
  }

  async function deletePartner(uid, id) {
    const p = await getOne('partners', id);
    if (!p || p.uid !== uid) return false;
    const msgs = await getAll('messages', 'pid', id);
    for (const m of msgs) await del('messages', m.id);
    const bs = await getAll('batches', 'pid', id);
    for (const b of bs) await del('batches', b.id);
    const rs = await getAll('reports', 'pid', id);
    for (const r of rs) await del('reports', r.id);
    await del('partners', id);
    await log(uid, 'partner_delete', p.name, { msgs: msgs.length });
    return true;
  }

  /* ---------------- 消息导入（增量去重） ---------------- */
  // 每 500 条一个事务：原来一条消息一个事务，1 万条要开 1 万次事务，手机上直接卡死
  const IMPORT_BATCH = 500;

  function bulkPut(rows) {
    return db().then((d) => new Promise((resolve, reject) => {
      if (!rows.length) { resolve(0); return; }
      const t = d.transaction('messages', 'readwrite');
      const s = t.objectStore('messages');
      try {
        for (const r of rows) s.put(r);
      } catch (err) { reject(err); return; }
      t.oncomplete = () => resolve(rows.length);
      t.onerror = () => reject(t.error || new Error('写入失败'));
      t.onabort = () => reject(t.error || new Error('写入被中断'));
    }));
  }

  async function importMessages(uid, pid, parsed, meta, onProgress) {
    const partner = await getOne('partners', pid);
    if (!partner) throw new Error('追踪对象不存在');
    const existing = await getAll('messages', 'pid', pid);
    const seen = new Set(existing.map((m) => m.hash));

    let added = 0, skipped = 0;
    const toAdd = [];
    for (const m of parsed.messages) {
      const ts = m.time ? m.time.getTime() : Date.now();
      const h = E.hash(pid + '|' + m.speaker + '|' + ts + '|' + m.text);
      if (seen.has(h)) { skipped++; continue; }
      seen.add(h);
      toAdd.push({ uid, pid, speaker: m.speaker, text: m.text, ts, hash: h });
      added++;
    }

    // 攒批写入，每批回报一次进度（已写 / 本次总数）
    let written = 0;
    if (onProgress) { try { onProgress({ written: 0, total: toAdd.length }); } catch (e) { } }
    for (let i = 0; i < toAdd.length; i += IMPORT_BATCH) {
      const slice = toAdd.slice(i, i + IMPORT_BATCH);
      await bulkPut(slice);
      written += slice.length;
      if (onProgress) { try { onProgress({ written, total: toAdd.length }); } catch (e) { } }
    }

    const times = toAdd.map((r) => r.ts);
    const firstAt = Math.min(partner.firstMsgAt || Infinity, ...(times.length ? times : [Infinity]));
    const lastAt = Math.max(partner.lastMsgAt || 0, ...(times.length ? times : [0]));

    partner.msgCount = existing.length + added;
    partner.firstMsgAt = isFinite(firstAt) ? firstAt : null;
    partner.lastMsgAt = lastAt || null;
    partner.lastImportAt = Date.now();
    await put('partners', partner);

    const batch = {
      uid, pid,
      source: meta.source || parsed.platform,
      detected: parsed.detected || parsed.platform,
      fileName: meta.fileName || null,
      added, skipped, total: parsed.messages.length,
      firstAt: times.length ? Math.min(...times) : null,
      lastAt: times.length ? Math.max(...times) : null,
      createdAt: Date.now()
    };
    batch.id = await add('batches', batch);

    await log(uid, 'import', partner.name, {
      added, skipped, source: batch.source, fileName: batch.fileName, pid
    });

    broadcast('messages-changed', { pid, added });
    return { batch, added, skipped, partner };
  }

  async function messagesOf(pid, limit) {
    const rows = await getAll('messages', 'pid', pid);
    rows.sort((a, b) => a.ts - b.ts);
    return limit ? rows.slice(-limit) : rows;
  }

  /* ---------------- 批次 / 报告 ---------------- */
  async function batchesOf(pid) {
    const rows = await getAll('batches', 'pid', pid);
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }

  async function saveReport(uid, pid, analysis, mode) {
    const r = {
      uid, pid, mode: mode || 'crush',
      score: analysis.total,
      dims: analysis.dims,
      narrative: analysis.narrative,
      review: analysis.review,
      forecast: analysis.forecast,
      daily: analysis.daily.map((d) => ({ date: d.date, score: d.score, count: d.count })),
      count: analysis.count,
      firstDay: analysis.firstDay, lastDay: analysis.lastDay,
      createdAt: Date.now()
    };
    r.id = await add('reports', r);
    broadcast('report-saved', { pid });
    return r;
  }

  async function reportsOf(pid) {
    const rows = await getAll('reports', 'pid', pid);
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }

  /* ---------------- 开发端聚合 ---------------- */
  async function adminOverview() {
    const [accounts, partners, messages, batches, grants, reports] = await Promise.all([
      getAll('accounts'), getAll('partners'), getAll('messages'), getAll('batches'), getAll('grants'), getAll('reports')
    ]);
    const platform = {};
    partners.forEach((p) => { platform[p.platform] = (platform[p.platform] || 0) + 1; });
    const source = {};
    batches.forEach((b) => { source[b.source] = (source[b.source] || 0) + 1; });

    // 近 14 天导入趋势
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = E.addDays(new Date(), -i);
      const k = E.dayKey(d);
      const start = new Date(d); start.setHours(0, 0, 0, 0);
      const end = start.getTime() + 86400000;
      days.push({
        date: k,
        imports: batches.filter((b) => b.createdAt >= start.getTime() && b.createdAt < end).length,
        messages: messages.filter((m) => m.ts >= start.getTime() && m.ts < end).length
      });
    }

    return {
      users: accounts.length,
      developers: grants.filter((g) => g.status === 'active' && (!g.expiresAt || g.expiresAt > Date.now())).length,
      partnerCount: partners.length,
      messageCount: messages.length,
      batchCount: batches.length,
      reports: reports.length,
      platform, source, days,
      accounts, partners, batches
    };
  }

  async function adminUserRows() {
    const [accounts, partners, messages, batches, grants] = await Promise.all([
      getAll('accounts'), getAll('partners'), getAll('messages'), getAll('batches'), getAll('grants')
    ]);
    return accounts.map((a) => {
      const ps = partners.filter((p) => p.uid === a.id);
      const ids = new Set(ps.map((p) => p.id));
      const ms = messages.filter((m) => ids.has(m.pid));
      const bs = batches.filter((b) => b.uid === a.id);
      const g = grants.find((x) => x.uid === a.id && x.status === 'active' && (!x.expiresAt || x.expiresAt > Date.now()));
      return {
        // 白名单字段：绝不把 salt / pw / pwAlg 这类凭据摊给 UI 层
        id: a.id,
        email: a.email,
        name: a.name,
        createdAt: a.createdAt,
        lastLogin: a.lastLogin,
        loginCount: a.loginCount,
        partnerCount: ps.length,
        msgCount: ms.length,
        batchCount: bs.length,
        lastActive: Math.max(a.lastLogin || 0, ...bs.map((b) => b.createdAt), 0),
        role: g ? (g.level === 'owner' ? '总开发者' : '授权开发者') : '普通用户',
        grantExpires: g ? g.expiresAt : null
      };
    }).sort((a, b) => b.lastActive - a.lastActive);
  }

  /* ---------------- 跨标签页广播 ---------------- */
  let bc = null;
  try { bc = new BroadcastChannel('crushlens'); } catch (e) { bc = null; }
  function broadcast(type, payload) {
    if (bc) { try { bc.postMessage({ type, payload, at: Date.now() }); } catch (e) { } }
  }
  function onBroadcast(cb) {
    if (!bc) return;
    bc.onmessage = (ev) => { if (ev.data) cb(ev.data); };
  }

  /* ---------------- 配色 ---------------- */
  const PALETTE = [
    ['#fecdd3', '#e11d48'], ['#ddd6fe', '#7c3aed'], ['#bfdbfe', '#2563eb'],
    ['#bbf7d0', '#059669'], ['#fed7aa', '#ea580c'], ['#fbcfe8', '#db2777'],
    ['#cffafe', '#0891b2'], ['#e9d5ff', '#9333ea']
  ];
  function pickColor(name) {
    const h = parseInt(E.hash(String(name || 'x')).slice(0, 4), 16);
    return PALETTE[h % PALETTE.length];
  }

  /* ---------------- 示例数据 ---------------- */
  const PERSONAS = {
    warm: ['今天好累啊', '刚下班', '你吃饭了吗', '嘿嘿 你真好', '想你啦', '晚安做个好梦', '今天超开心', '谢谢你陪我',
      '周末一起去看海吧', '我买了你爱吃的那家', '抱抱', '别熬夜啦', '到家了跟我说一声'],
    cool: ['嗯', '哦', '在忙', '晚点说', '随便吧', '有点烦', '不想聊这个', '算了', '知道了', '看情况'],
    neutral: ['在干嘛', '刚吃完饭', '今天天气不错', '还好', '在开会', '晚点回你', '好的', '你也是', '嗯嗯', '我先忙了']
  };

  function pickSentence(bucket, rnd) {
    const arr = PERSONAS[bucket];
    return arr[Math.floor(rnd() * arr.length)];
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  async function seedDemo(uid, force) {
    const existing = await listPartners(uid);
    if (existing.length && !force) return { skipped: true };

    const specs = [
      { name: '林晚', platform: 'wechat', mode: 'crush', days: 46, kind: 'rise', note: '同事介绍，聊了一个多月' },
      { name: '陈屿', platform: 'qq', mode: 'crush', days: 38, kind: 'flat', note: '大学同学，最近重新聊上' },
      { name: '苏念', platform: 'dingtalk', mode: 'couple', days: 34, kind: 'fall', note: '在一起两年，最近有点冷战' }
    ];

    for (let si = 0; si < specs.length; si++) {
      const spec = specs[si];
      const p = await createPartner(uid, spec);
      const rnd = mulberry32(1000 + si * 77);
      const msgs = [];
      for (let d = spec.days - 1; d >= 0; d--) {
        const day = E.addDays(new Date(), -d);
        const progress = (spec.days - d) / spec.days;
        let temp;
        if (spec.kind === 'rise') temp = 0.25 + progress * 0.6 + (rnd() - 0.5) * 0.18;
        else if (spec.kind === 'fall') temp = 0.78 - progress * 0.5 + (rnd() - 0.5) * 0.15;
        else temp = 0.5 + Math.sin(progress * 6) * 0.12 + (rnd() - 0.5) * 0.12;
        temp = E.clamp(temp, 0.05, 0.95);

        const active = rnd() < (0.55 + temp * 0.4);
        if (!active) continue;
        const count = Math.max(2, Math.round(2 + temp * 9 + (rnd() - 0.5) * 3));

        for (let i = 0; i < count; i++) {
          const who = rnd() < 0.5 ? spec.name : '我';
          const bucket = rnd() < temp ? 'warm' : (rnd() < 0.5 ? 'neutral' : 'cool');
          let text = pickSentence(bucket, rnd);
          if (bucket === 'warm' && rnd() < 0.35) text += rnd() < 0.5 ? ' 😊' : ' [表情]';
          const hour = 9 + Math.floor(rnd() * 14);
          const t = new Date(day);
          t.setHours(hour, Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0);
          msgs.push({ speaker: who, time: t, text, media: text.includes('[表情]') ? 1 : 0 });
        }
      }
      msgs.sort((a, b) => a.time - b.time);
      await importMessages(uid, p.id, { messages: msgs, platform: spec.platform, detected: spec.platform }, {
        source: spec.platform, fileName: '示例数据'
      });
      const all = await messagesOf(p.id);
      const rows = all.map((m) => ({
        speaker: m.speaker, text: m.text, time: new Date(m.ts),
        media: (m.text.match(/\[(图片|表情|语音|视频|文件|动画表情)\]/g) || []).length
      }));
      const a = E.analyze(rows, { me: '我' });
      if (!a.empty) {
        await saveReport(uid, p.id, a, spec.mode);
        await updatePartner(uid, p.id, { lastAnalysis: a.total });
      }
    }
    await log(uid, 'seed_demo', '', { count: specs.length });
    return { skipped: false, count: specs.length };
  }

  /* ---------------- 清空（危险操作，需二次确认于 UI） ---------------- */
  async function wipeAccount(uid) {
    const ps = await listPartners(uid);
    for (const p of ps) await deletePartner(uid, p.id);
    const rs = await getAll('reports', 'uid', uid);
    for (const r of rs) await del('reports', r.id);
    // 审计记录只增不删：清号本身也留痕，否则「全量审计」就自相矛盾
    await log(uid, 'wipe_account', '', { partners: ps.length, reports: rs.length });
  }

  // 只清本机聊天数据，保留账号与审计日志（退出登录时的可选项）
  async function clearChatData(uid) {
    const ps = await listPartners(uid);
    let msgs = 0;
    for (const p of ps) {
      const m = await getAll('messages', 'pid', p.id);
      msgs += m.length;
      for (const x of m) await del('messages', x.id);
      for (const b of await getAll('batches', 'pid', p.id)) await del('batches', b.id);
      for (const r of await getAll('reports', 'pid', p.id)) await del('reports', r.id);
      await del('partners', p.id);
    }
    await log(uid, 'clear_chat_data', '', { partners: ps.length, msgs });
    broadcast('messages-changed', { pid: null, added: 0 });
    return { partners: ps.length, msgs };
  }

  root.Store = {
    signup, login, logout, current, sessionUid, wasSessionExpired,
    roleOf, ownerUid, claimOwner, grantsOf, issueGrant, revokeGrant,
    requestAccess, decideRequest,
    listPartners, findPartnerByName, createPartner, updatePartner, deletePartner,
    importMessages, messagesOf, batchesOf, saveReport, reportsOf,
    adminOverview, adminUserRows, log,
    broadcast, onBroadcast, seedDemo, wipeAccount, clearChatData,
    getMeta, setMeta, pickColor,
    raw: { getAll, getOne, put, add, del }
  };
})(window);
