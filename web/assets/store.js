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
  const DEMO_KEY = 'cl_demo';

  let dbPromise = null;

  /* ---------------- 演示模式（T3，纯内存，一行都不落盘） ----------------
     进入演示会 sessionStorage 置 cl_demo=1；所有写操作经 assertWritable()
     抛出 DEMO_READONLY，读操作改走内存库 demoDB。刷新后 sessionStorage 仍在
     但 app 启动会离开演示态并清掉内存库，IndexedDB 全程零写入。 */
  let demoMode = false;
  let demoDB = null;
  function assertWritable() {
    if (demoMode) throw new Error('DEMO_READONLY：演示数据不会保存，注册后即可开始记录');
  }
  function isDemo() { return demoMode || (() => { try { return sessionStorage.getItem(DEMO_KEY) === '1'; } catch (e) { return false; } })(); }

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
    if (demoMode && mode !== 'readonly') return Promise.reject(new Error('DEMO_READONLY：演示数据不会保存'));
    // 演示态下所有读都走内存库：用一个最小的 store 桩，语义与 IndexedDB 一致
    if (demoMode) {
      const rows = (demoDB && demoDB[store]) || [];
      const fake = {
        getAll() { return memReq(rows.slice()); },
        get(k) { return memReq(rows.find((x) => x.id === k)); },
        index(name) {
          return { getAll(k) { return memReq(rows.filter((x) => indexValue(x, name) === k)); } };
        },
        put() { return memReq(null); }, add() { return memReq(null); }, delete() { return memReq(null); }
      };
      let out;
      try { out = fn(fake); } catch (err) { return Promise.reject(err); }
      return Promise.resolve(out && out.__result !== undefined ? out.__result : out);
    }
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

  function indexValue(row, name) {
    // store.js 里所有二级索引都是单字段（uid / pid / status / at / email）
    if (name === 'uidName') return [row.uid, row.name];
    return row[name];
  }
  function memReq(result) {
    // 同步回填 __result：演示态的 run() 直接 Promise.resolve，不能等 setTimeout
    return { __result: result, result };
  }

  function wrap(request) {
    // __result 预置值用于演示态的同步内存请求；真实 IndexedDB 请求初始为 undefined，
    // 由 onsuccess 回填。
    const o = { __result: request && request.__result !== undefined ? request.__result : undefined };
    request.onsuccess = () => { o.__result = request.result; };
    return o;
  }

  const getAll = (store, index, key) => run(store, 'readonly', (s) => wrap(index ? s.index(index).getAll(key) : s.getAll()));
  const getOne = (store, key) => run(store, 'readonly', (s) => wrap(s.get(key)));
  const put = (store, val) => { assertWritable(); return run(store, 'readwrite', (s) => wrap(s.put(val))); };
  const add = (store, val) => { assertWritable(); return run(store, 'readwrite', (s) => wrap(s.add(val))); };
  const del = (store, key) => { assertWritable(); return run(store, 'readwrite', (s) => wrap(s.delete(key))); };

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
      provider: o.provider || 'password', githubId: o.githubId || null, avatar: o.avatar || null,
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
    // provider:'github' 的账号禁止密码登录（T1）：否则等于给社交账号留了一个弱口令后门
    if (acc.provider === 'github') throw new Error('这个账号是用 GitHub 登录的，请用 GitHub 按钮登录');
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

  // 按名字找已有对象（不看平台：同一个人换了端导入，也应该并入同一个对象）。
  // 返回全部同名：两个不同的人恰好同名时，调用方要把平台列出来让用户挑，
  // 不能闷头并进第一个。
  async function findPartnersByName(uid, name) {
    const want = String(name || '').trim().toLowerCase();
    if (!want) return [];
    const rows = await getAll('partners', 'uid', uid);
    return rows.filter((p) => String(p.name || '').trim().toLowerCase() === want);
  }

  async function findPartnerByName(uid, name) {
    const all = await findPartnersByName(uid, name);
    return all[0] || null;
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
    assertWritable();
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

  /* ---------------- 配色 ----------------
     只负责「按名字散列出一个稳定的色板索引」，真正的颜色由当前主题决定
     （UI.avatarPair / CLTheme.avatarPair），换主题时头像跟着换。
     旧数据里 partner.color 存的 [bg,fg] 数组仍然兼容（渲染层会原样使用）。 */
  const PALETTE_SIZE = 8;
  function pickColor(name) {
    const h = parseInt(E.hash(String(name || 'x')).slice(0, 4), 16);
    return h % PALETTE_SIZE;
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

  /* ---------------- 演示模式（T3）---------------- */
  // 全部数据在内存里构造，不调用任何 add/put，IndexedDB 零写入。
  function buildDemoDB() {
    const uid = 'demo';
    const dbx = { accounts: [], partners: [], messages: [], batches: [], reports: [], grants: [], requests: [], audit: [], meta: [] };
    dbx.accounts.push({
      id: uid, email: 'demo@local', name: '演示用户', provider: 'password',
      createdAt: Date.now(), lastLogin: Date.now(), loginCount: 1
    });
    const specs = [
      { name: '林晚', platform: 'wechat', mode: 'crush', days: 46, kind: 'rise', note: '同事介绍，聊了一个多月' },
      { name: '陈屿', platform: 'qq', mode: 'crush', days: 38, kind: 'flat', note: '大学同学，最近重新聊上' },
      { name: '苏念', platform: 'dingtalk', mode: 'couple', days: 34, kind: 'fall', note: '在一起两年，最近有点冷战' }
    ];
    let pid = 0;
    specs.forEach((spec, si) => {
      const p = {
        id: ++pid, uid, name: spec.name, platform: spec.platform, mode: spec.mode, note: spec.note,
        meSpeaker: '我', color: pickColor(spec.name),
        createdAt: Date.now() - spec.days * 86400000, msgCount: 0,
        firstMsgAt: null, lastMsgAt: null, lastImportAt: Date.now()
      };
      const rnd = mulberry32(2000 + si * 77);
      const rows = [];
      for (let d = spec.days - 1; d >= 0; d--) {
        const day = E.addDays(new Date(), -d);
        const progress = (spec.days - d) / spec.days;
        let temp = spec.kind === 'rise' ? 0.25 + progress * 0.6 + (rnd() - 0.5) * 0.18
          : spec.kind === 'fall' ? 0.78 - progress * 0.5 + (rnd() - 0.5) * 0.15
            : 0.5 + Math.sin(progress * 6) * 0.12 + (rnd() - 0.5) * 0.12;
        temp = E.clamp(temp, 0.05, 0.95);
        if (rnd() >= 0.55 + temp * 0.4) continue;
        const count = Math.max(2, Math.round(2 + temp * 9 + (rnd() - 0.5) * 3));
        for (let i = 0; i < count; i++) {
          const speaker = rnd() < 0.5 ? spec.name : '我';
          const bucket = rnd() < temp ? 'warm' : (rnd() < 0.5 ? 'neutral' : 'cool');
          let text = pickSentence(bucket, rnd);
          if (bucket === 'warm' && rnd() < 0.35) text += rnd() < 0.5 ? ' 😊' : ' [表情]';
          const t = new Date(day); t.setHours(9 + Math.floor(rnd() * 14), Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0);
          rows.push({ speaker, text, time: t, media: text.includes('[表情]') ? 1 : 0 });
        }
      }
      rows.sort((a, b) => a.time - b.time);
      const msgs = rows.map((m, i) => {
        const ts = m.time.getTime();
        return { id: i + 1, uid, pid: p.id, speaker: m.speaker, text: m.text, ts, hash: E.hash(p.id + '|' + m.speaker + '|' + ts + '|' + m.text) };
      });
      dbx.messages.push(...msgs);
      p.msgCount = msgs.length;
      p.firstMsgAt = msgs.length ? msgs[0].ts : null;
      p.lastMsgAt = msgs.length ? msgs[msgs.length - 1].ts : null;
      dbx.partners.push(p);
      dbx.batches.push({ id: p.id, uid, pid: p.id, source: spec.platform, detected: spec.platform, fileName: '演示数据', added: msgs.length, skipped: 0, total: msgs.length, firstAt: p.firstMsgAt, lastAt: p.lastMsgAt, createdAt: Date.now() - 60 * 1000 });
      const a = E.analyze(rows, { me: '我' });
      if (!a.empty) {
        dbx.reports.push({
          id: p.id, uid, pid: p.id, mode: spec.mode, score: a.total, dims: a.dims,
          narrative: a.narrative, review: a.review, forecast: a.forecast, daily: a.daily,
          count: a.count, firstDay: a.firstDay, lastDay: a.lastDay, createdAt: Date.now()
        });
        p.lastAnalysis = a.total;
      }
    });
    return dbx;
  }

  function enterDemo() {
    demoMode = true;
    demoDB = buildDemoDB();
    try { sessionStorage.setItem(DEMO_KEY, '1'); } catch (e) { }
    return demoDB.accounts[0];
  }
  function leaveDemo() {
    demoMode = false;
    demoDB = null;
    try { sessionStorage.removeItem(DEMO_KEY); } catch (e) { }
  }
  function demoAccount() { return demoMode && demoDB ? demoDB.accounts[0] : null; }

  /* ---------------- 云端账号在本地的映射 ----------------
     云端 id 直接作为本地 uid，账号元数据落到本地 accounts（不含任何凭据）。
     同一 githubId 复用；provider:'github' 记录不设 pw，杜绝密码登录。 */
  async function upsertCloudAccount(profile) {
    if (!profile || !profile.id) throw new Error('云端账号资料不完整');
    const all = await getAll('accounts');
    let acc = all.find((a) => (profile.provider === 'github' && a.githubId && a.githubId === profile.github_id) || a.id === profile.id);
    const now = Date.now();
    if (!acc) {
      acc = {
        id: String(profile.id), email: profile.email || '', name: profile.name || '用户',
        provider: profile.provider || 'password', githubId: profile.github_id || null, avatar: profile.avatar || null,
        salt: null, pw: null, pwAlg: null,
        createdAt: profile.created_at || now, lastLogin: now, loginCount: profile.login_count || 1,
        partnerCount: profile.partner_count || 0, cloud: true
      };
      await add('accounts', acc);
    } else {
      acc.lastLogin = now;
      acc.loginCount = (acc.loginCount || 1) + 1;
      acc.name = profile.name || acc.name;
      acc.avatar = profile.avatar || acc.avatar;
      acc.cloud = true;
      await put('accounts', acc);
    }
    saveSession(acc.id);
    await log(acc.id, 'cloud_login', acc.email, { provider: acc.provider });
    return acc;
  }

  /* ---------------- 访客数据合并（T8）----------------
     访客数据本来就在本地；登录后把 uid 从旧值批量改成云账号 id。
     用一个事务完成，失败回滚。这里通过 raw 事务封装实现原子性。 */
  function migrateUid(fromUid, toUid) {
    if (fromUid === toUid) return Promise.resolve({ moved: 0 });
    assertWritable();
    return db().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(['partners', 'messages', 'batches', 'reports'], 'readwrite');
      let moved = 0;
      const move = (store, idx) => {
        const req = store.index(idx).getAll(fromUid);
        req.onsuccess = () => {
          (req.result || []).forEach((row) => { row.uid = toUid; store.put(row); moved++; });
        };
      };
      try {
        move(t.objectStore('partners'), 'uid');
        move(t.objectStore('messages'), 'uid');
        move(t.objectStore('batches'), 'uid');
        move(t.objectStore('reports'), 'uid');
      } catch (err) { try { t.abort(); } catch (e) { } reject(err); return; }
      t.oncomplete = () => resolve({ moved });
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('迁移被中止，已回滚'));
    }));
  }

  /* ---------------- 备份 JSON（T8，绝不含 API key）----------------
     API key 属于 settings 模块的 localStorage，这里只导出 IndexedDB 数据，
     字段白名单明确排除 pw/salt/pwAlg 等凭据。 */
  async function exportBackup() {
    const stores = ['partners', 'messages', 'batches', 'reports', 'grants', 'requests', 'audit', 'meta'];
    const out = { app: 'CrushLens', version: 2, exportedAt: Date.now(), data: {} };
    for (const s of stores) out.data[s] = await getAll(s);
    // 账号只导出非敏感元数据
    out.data.accounts = (await getAll('accounts')).map((a) => ({
      id: a.id, email: a.email, name: a.name, provider: a.provider,
      githubId: a.githubId || null, avatar: a.avatar || null,
      createdAt: a.createdAt, lastLogin: a.lastLogin, loginCount: a.loginCount
    }));
    return out;
  }

  async function importBackup(payload, replace) {
    assertWritable();
    if (!payload || payload.app !== 'CrushLens' || !Array.isArray(payload.data)) throw new Error('备份文件格式不对');
    const replaceSet = replace ? new Set(String(replace).split(',')) : new Set();
    const order = ['partners', 'messages', 'batches', 'reports', 'grants', 'requests', 'audit', 'meta', 'accounts'];
    let n = 0;
    for (const s of order) {
      const rows = payload.data[s] || [];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        // 只接受普通对象且主键为原始值；拒绝原型污染载荷与非对象行
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        if (row.__proto__ !== undefined || 'constructor' in row || 'prototype' in row) continue;
        if (row.id !== undefined && typeof row.id !== 'string' && typeof row.id !== 'number') continue;
        if (replaceSet.has(s) && row.id !== undefined) await del(s, row.id);
        // add 对已有主键会失败；用 put 做幂等恢复
        await put(s, row); n++;
      }
    }
    await log(null, 'import_backup', '', { rows: n });
    return { rows: n };
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
    listPartners, findPartnerByName, findPartnersByName, createPartner, updatePartner, deletePartner,
    importMessages, messagesOf, batchesOf, saveReport, reportsOf,
    adminOverview, adminUserRows, log,
    broadcast, onBroadcast, seedDemo, wipeAccount, clearChatData,
    getMeta, setMeta, pickColor,
    // T1/T3/T8
    assertWritable, isDemo, enterDemo, leaveDemo, demoAccount,
    upsertCloudAccount, migrateUid, exportBackup, importBackup,
    raw: { getAll, getOne, put, add, del }
  };
})(window);
