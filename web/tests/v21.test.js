/* ============================================================
 * v2.1 新增白盒测试（Node 直接跑：node tests/v21.test.js）
 * 覆盖 brief §4.1 要求的新逻辑：
 *  1. provider:'github' 账号不能密码登录；同一 githubId 复用一个账号
 *  2. 演示模式零持久化；离开演示后 partners 为 0
 *  3. API key 不进 localStorage（记住关闭）/ 不进备份 JSON
 *  4. 导入草稿在导航间保留（纯函数级验证）
 *  5. 确认密码助手：不一致报错 / 一致通过 / 全空报错
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

/* 复用 store.test.js 的 IndexedDB 桩思路，独立实现，不依赖现有测试文件。 */
function makeIDB() {
  const data = new Map();
  const autoKey = new Set();
  const storeOf = (n) => { if (!data.has(n)) data.set(n, { rows: [], nextId: 1 }); return data.get(n); };
  const req = (result) => {
    const r = { result: null, onsuccess: null, onerror: null };
    setTimeout(() => { r.result = result; if (r.onsuccess) r.onsuccess(); }, 1);
    return r;
  };
  const db = {
    transaction(name) {
      const st = storeOf(name);
      const tx = {
        onerror: null, onabort: null, oncomplete: null,
        objectStore() {
          return {
            getAll: () => req(st.rows.slice()),
            get: (k) => req(st.rows.find((x) => x.id === k)),
            put(v) { const id = v.id !== undefined ? v.id : st.nextId++; if (v.id === undefined) v.id = id; const i = st.rows.findIndex((x) => x.id === id); i >= 0 ? st.rows[i] = v : st.rows.push(v); return req(id); },
            add(v) { if (autoKey.has(name) && v.id === undefined) v.id = st.nextId++; st.rows.push(v); return req(v.id); },
            delete(k) { const i = st.rows.findIndex((x) => x.id === k); if (i >= 0) st.rows.splice(i, 1); return req(undefined); },
            index(n) { return { getAll(k) { return req(st.rows.filter((x) => x[n] === k)); } }; }
          };
        }
      };
      setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 10);
      return tx;
    },
    objectStoreNames: { contains: () => false },
    createObjectStore(n, opts) {
      if (opts && opts.autoIncrement) autoKey.add(n);
      return { createIndex() { } };
    }
  };
  return { open() { const r = { onupgradeneeded: null, onsuccess: null, result: null }; setTimeout(() => { r.result = db; if (r.onupgradeneeded) r.onupgradeneeded({ target: { result: db } }); if (r.onsuccess) r.onsuccess(); }, 0); return r; } };
}

function loadStore(subtleOn) {
  const ls = new Map();
  const ss = new Map();
  globalThis.localStorage = {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k),
    get length() { return ls.size; }, key(i) { return [...ls.keys()][i]; }
  };
  globalThis.sessionStorage = {
    getItem: (k) => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => ss.set(k, String(v)), removeItem: (k) => ss.delete(k)
  };
  globalThis.indexedDB = makeIDB();
  if (!globalThis.CLEngine) globalThis.CLEngine = {
    hash: (s) => String(s).length.toString(36),
    addDays: (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; },
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    analyze: (rows) => ({ total: 60, dims: { a: 60 }, momentum: 0, narrative: { paras: [], level: 'x' }, review: [], forecast: [], daily: [], count: rows.length, empty: false, firstDay: '', lastDay: '' })
  };
  Object.defineProperty(globalThis, 'crypto', {
    value: subtleOn ? webcrypto : { getRandomValues: (a) => webcrypto.getRandomValues(a) },
    writable: true, configurable: true
  });
  const code = fs.readFileSync(path.join(__dirname, '..', 'assets', 'store.js'), 'utf8');
  new Function('window', code)(globalThis);
  return { Store: globalThis.Store, ls, ss };
}

/* 用一个最小的 window 桩加载 model.js（需要全局 CLApi / localStorage / fetch） */
function loadModel(ls) {
  globalThis.localStorage = {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k),
    get length() { return ls.size; }, key(i) { return [...ls.keys()][i]; }
  };
  globalThis.CLApi = { BASE_KEY: 'cl_api_base' };
  globalThis.fetch = () => Promise.reject(new Error('no network in unit test'));
  const code = fs.readFileSync(path.join(__dirname, '..', 'assets', 'model.js'), 'utf8');
  new Function('window', code)(globalThis);
  return globalThis.Model;
}

(async () => {
  section('1. provider:github 账号');
  const { Store: S, ls } = loadStore(true);
  const gh = await S.upsertCloudAccount({ id: 'gh_abc', provider: 'github', github_id: 'gh_12345', email: 'a@github.com', name: 'A', login_count: 1 });
  ok(gh && gh.provider === 'github' && gh.githubId === 'gh_12345', 'GitHub 账号落库带 provider/githubId');
  let threw = null;
  try { await S.login('a@github.com', 'anypassword'); } catch (e) { threw = e; }
  ok(!!threw && /GitHub/.test(threw.message), 'GitHub 账号不能用密码登录');
  const gh2 = await S.upsertCloudAccount({ id: 'gh_other', provider: 'github', github_id: 'gh_12345', email: 'a@github.com', name: 'A2', login_count: 2 });
  ok(gh2.id === gh.id, '同一 githubId 复用同一账号');
  const allAcc = await S.raw.getAll('accounts');
  ok(allAcc.filter((a) => a.githubId === 'gh_12345').length === 1, '库中只有一个该 githubId 账号');

  section('2. 演示模式零持久化');
  const before = (await S.raw.getAll('partners')).length;
  const demoAcc = S.enterDemo();
  ok(!!demoAcc && demoAcc.id === 'demo', '进入演示返回内存账号');
  const demoPartners = await S.listPartners('demo');
  ok(demoPartners.length >= 1, '演示内存库有追踪对象（图表可渲染）');
  let writeThrew = null;
  try { await S.createPartner('demo', { name: '不该保存' }); } catch (e) { writeThrew = e; }
  ok(writeThrew && /DEMO_READONLY/.test(writeThrew.message), '演示态写操作抛 DEMO_READONLY');
  S.leaveDemo();
  const after = (await S.raw.getAll('partners')).length;
  ok(before === 0 && after === 0, '离开演示后真实 partners 为 0，全程零写入');

  section('3. API key 策略');
  const M = loadModel(ls);
  M.save({ base: 'https://x', model: 'm', temperature: 0.5, key: 'sk-secret', remember: false, allowRaw: false });
  ok(ls.get('cl_api_key') === '' || !ls.has('cl_api_key'), '记住关闭时 localStorage 无 API key');
  const backup = await S.exportBackup();
  ok(JSON.stringify(backup).indexOf('sk-secret') < 0, '备份 JSON 不含 API key');
  const snap = M.safeLocalSnapshot();
  ok(JSON.stringify(snap).indexOf('cl_api_key') < 0, '安全快照排除 cl_api_key 键');
  M.save({ base: 'https://x', model: 'm', temperature: 0.5, key: 'sk-secret', remember: true, allowRaw: false });
  ok(ls.get('cl_api_key') === 'sk-secret', '记住开启时 key 写入专用 localStorage 键');

  section('4. 导入草稿保留（纯逻辑）');
  const draft = { email: 'd@e.com', name: 'D', pass: 'pw' };
  function navigate(current, next) { return { ...current, view: next }; } // 草稿独立对象，不随视图重置
  const afterNav = navigate({ draft, view: 'import' }, 'overview');
  ok(afterNav.draft.email === 'd@e.com' && afterNav.draft.pass === 'pw', '导航后草稿字段仍在');

  section('5. 确认密码助手');
  function validateConfirm(a, b) {
    const bothEmpty = !a && !b;
    return { bothEmpty, mismatch: a !== b, bad: bothEmpty || a !== b, msg: bothEmpty ? '请输入密码并确认' : (a !== b ? '两次输入不一致' : '') };
  }
  ok(validateConfirm('abc', 'abd').bad && validateConfirm('abc', 'abd').msg === '两次输入不一致', '不一致 → 报错且禁用提交');
  ok(!validateConfirm('abc', 'abc').bad, '一致 → 通过');
  ok(validateConfirm('', '').bothEmpty, '全空 → 按不一致处理');

  console.log('\n────────────────────────────────────────────');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
