/* ============================================================
 * store.js 白盒测试（Node 直接跑：node tests/store.test.js）
 *
 * 测的是 review 提出的两个安全点：
 *   1. crypto.subtle 不存在时，注册/登录必须显式报错，绝不静默降级成非加密哈希
 *   2. adminUserRows() 只输出白名单字段，salt / pw / pwAlg 绝不外泄到 UI 层
 *
 * 说明：store.js 是浏览器模块，这里用最小的 IndexedDB 假桩 + localStorage
 * 假桩在 Node 里加载真实源码（不改一行产品代码）。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function section(t) { console.log('\n' + t); }

/* ---------------- IndexedDB 假桩 ---------------- */
function makeIDB() {
  const data = new Map(); // store -> { rows, nextId }
  const autoKey = new Set();
  function storeOf(name) {
    if (!data.has(name)) data.set(name, { rows: [], nextId: 1 });
    return data.get(name);
  }
  function req(result) {
    const r = { result: null, onsuccess: null, onerror: null };
    setTimeout(() => { r.result = result; if (r.onsuccess) r.onsuccess(); if (r.onerror) r.onerror(); }, 1);
    return r;
  }
  const indexes = new Map(); // store -> { name -> keyPath }
  const db = {
    transaction(name, mode) {
      const st = storeOf(name);
      const tx = {
        onerror: null, onabort: null, oncomplete: null,
        objectStore() {
          return {
            getAll() { return req(st.rows.slice()); },
            get(key) { return req(st.rows.find((x) => x.id === key) || undefined); },
            put(v) {
              const id = (v.id !== undefined) ? v.id : st.nextId;
              if (v.id === undefined) v.id = st.nextId++;
              const i = st.rows.findIndex((x) => x.id === id);
              if (i >= 0) st.rows[i] = v; else st.rows.push(v);
              return req(id);
            },
            add(v) {
              if (autoKey.has(name) && v.id === undefined) { v.id = st.nextId++; }
              else if (autoKey.has(name)) { st.nextId = Math.max(st.nextId, v.id + 1); }
              st.rows.push(v);
              return req(v.id !== undefined ? v.id : st.rows.length);
            },
            delete(key) {
              const i = st.rows.findIndex((x) => x.id === key);
              if (i >= 0) st.rows.splice(i, 1);
              return req(undefined);
            },
            index(idxName) {
              const keyPath = (indexes.get(name) || {})[idxName] || idxName;
              return {
                getAll(key) {
                  return req(st.rows.filter((x) => x[keyPath] === key).slice());
                }
              };
            }
          };
        }
      };
      setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 10);
      return tx;
    },
    objectStoreNames: { contains: () => false },
    createObjectStore(name, opts, idxs) {
      if (opts && opts.autoIncrement) autoKey.add(name);
      (idxs || []).forEach(([n, kp]) => {
        if (!indexes.has(name)) indexes.set(name, {});
        indexes.get(name)[n] = kp;
      });
      return { createIndex() { } };
    }
  };
  return {
    open(name, ver) {
      const r = { onupgradeneeded: null, onsuccess: null, onerror: null, result: null };
      setTimeout(() => {
        r.result = db;
        if (r.onupgradeneeded) r.onupgradeneeded({ target: { result: db } });
        if (r.onsuccess) r.onsuccess();
      }, 0);
      return r;
    }
  };
}

/* ---------------- 加载真实源码 ---------------- */
function loadStore(subtleOn) {
  const ls = new Map();
  globalThis.localStorage = {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => ls.set(k, String(v)),
    removeItem: (k) => ls.delete(k)
  };
  globalThis.indexedDB = makeIDB();
  // Node 22 的 globalThis.crypto 是 getter，普通赋值会静默失败，必须 defineProperty
  Object.defineProperty(globalThis, 'crypto', {
    value: subtleOn ? webcrypto : { getRandomValues: (a) => webcrypto.getRandomValues(a) },
    writable: true, configurable: true
  });
  const code = fs.readFileSync(path.join(__dirname, '..', 'assets', 'store.js'), 'utf8');
  new Function('window', code)(globalThis);
  return globalThis.Store;
}

(async () => {
  /* ---------------- 1. 无 crypto.subtle：必须显式拒绝 ---------------- */
  section('1. 非安全上下文（无 crypto.subtle）');
  const S1 = loadStore(false);
  let threw = null;
  try { await S1.signup('a@b.com', 'secret123', '测试'); }
  catch (e) { threw = e; }
  ok(!!threw, 'signup 被拒绝（而不是静默降级）');
  ok(threw && /WebCrypto|localhost|https/.test(threw.message), '报错文案提示改用 localhost/https：' + (threw && threw.message));

  let threw2 = null;
  try { await S1.login('a@b.com', 'secret123'); }
  catch (e) { threw2 = e; }
  ok(!!threw2, 'login 同样被拒绝（不读弱哈希旧数据）');

  /* ---------------- 2. 正常注册 → adminUserRows 白名单 ---------------- */
  section('2. 正常注册 + adminUserRows 字段白名单');
  const S2 = loadStore(true);
  const acc = await S2.signup('user@test.com', 'secret123', '小明');
  ok(acc && acc.email === 'user@test.com', '注册成功');
  ok(typeof acc.salt === 'string' && acc.salt.length === 32, 'salt 存在（账号对象内部）');
  ok(acc.pw && acc.pw !== 'secret123' && acc.pw.length === 64, '密码只存 PBKDF2 哈希，不存明文');
  ok(acc.pwAlg === 'pbkdf2-sha256-60000', '哈希算法有版本标记');

  const rows = await S2.adminUserRows();
  ok(Array.isArray(rows) && rows.length === 1, 'adminUserRows 返回 1 条');
  const r0 = rows[0];
  ok(!('salt' in r0) && !('pw' in r0) && !('pwAlg' in r0), '输出不含 salt / pw / pwAlg');
  const leak = Object.keys(r0).filter((k) => JSON.stringify(r0[k]).indexOf(acc.salt) >= 0 || JSON.stringify(r0[k]).indexOf(acc.pw) >= 0);
  ok(leak.length === 0, '任何字段值里也不含凭据片段' + (leak.length ? ('：泄漏于 ' + leak.join(',')) : ''));
  ok(r0.email === 'user@test.com' && typeof r0.partnerCount === 'number', '业务字段正常（email/partnerCount）');

  console.log('\n────────────────────────────────────────────');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
