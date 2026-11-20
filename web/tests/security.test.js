/* ============================================================
 * 安全回归测试（Node 直接跑：node tests/security.test.js）
 * 用真实源码 + 最小 DOM / fetch 桩，验证 PR#4 审查中的修复：
 *  1. confirmDlg 的 text 被转义（存储型 XSS）
 *  2. safeLocalSnapshot 排除会话 / 桥接 token（备份泄露）
 *  3. githubCallback 把 code/state 转交 /gh/callback（OAuth 接线）
 * 不重写被测逻辑，全部加载 assets/ 下的真实文件。
 * ============================================================ */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function section(t) { console.log('\n' + t); }
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'assets', f), 'utf8');

/* ---------- 1. confirmDlg XSS ---------- */
function loadUI() {
  let lastHTML = '';
  const mkEl = () => {
    const node = {
      _html: '',
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = String(v); if (this._html.includes('confirm-text')) lastHTML = this._html; },
      className: '',
      classList: { add() {}, remove() {} },
      addEventListener() {}, removeEventListener() {},
      querySelector() { return { onclick: null }; },
      closest() { return null; },
      remove() {},
      appendChild() {},
      setAttribute() {}, getAttribute() { return null; }
    };
    return node;
  };
  const body = Object.assign(mkEl(), { appendChild() {} });
  globalThis.document = {
    createElement: mkEl,
    body,
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; },
    documentElement: mkEl()
  };
  globalThis.requestAnimationFrame = (cb) => cb();
  globalThis.window = globalThis;
  globalThis.CLTheme = { cssVar: () => '', avatarPair: () => [] };
  new Function('window', read('ui.js'))(globalThis);
  return { UI: globalThis.UI, getHTML: () => lastHTML };
}

/* ---------- 2. safeLocalSnapshot ---------- */
function loadModel(entries) {
  const ls = new Map(entries);
  globalThis.localStorage = {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => ls.set(k, String(v)),
    removeItem: (k) => ls.delete(k),
    get length() { return ls.size; },
    key(i) { return [...ls.keys()][i]; }
  };
  globalThis.CLApi = { BASE_KEY: 'cl_api_base' };
  globalThis.fetch = () => Promise.reject(new Error('no network'));
  new Function('window', read('model.js'))(globalThis);
  return globalThis.Model;
}

/* ---------- 3. githubCallback ---------- */
function loadApi() {
  const ls = new Map([['cl_api_base', 'https://api.example.com']]);
  globalThis.localStorage = {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => ls.set(k, String(v)),
    removeItem: (k) => ls.delete(k)
  };
  const calls = [];
  globalThis.fetch = (url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  };
  globalThis.location = { href: '' };
  new Function('window', read('api.js'))(globalThis);
  return { Api: globalThis.CLApi, calls };
}

(async () => {
  section('1. confirmDlg 文本转义（存储型 XSS）');
  const { UI, getHTML } = loadUI();
  const payload = '<img src=x onerror="alert(1)">';
  UI.confirmDlg({ title: 't', text: payload, okText: '确定' }); // promise 保持 pending，无妨
  const html = getHTML();
  ok(html.length > 0, 'confirmDlg 渲染出 confirm-text 内容');
  ok(html.indexOf('&lt;img') >= 0, '危险标签被转义为 &lt;img');
  ok(html.indexOf('<img') < 0, '渲染内容中不含可执行 <img 标签');
  ok(html.indexOf('&quot;') >= 0, '属性引号被转义为 &quot;');

  section('2. safeLocalSnapshot 排除凭据（备份泄露）');
  const M = loadModel([
    ['cl_api_key', 'sk-secret'],
    ['crushlens_session_v1', JSON.stringify({ uid: 'victim' })],
    ['crushlens_bridge_token', 'tok-secret'],
    ['cl_demo', '0'],
    ['theme', 'rose']
  ]);
  const snap = M.safeLocalSnapshot();
  const keys = Object.keys(snap);
  ok(!('crushlens_session_v1' in snap), '快照排除 crushlens_session_v1');
  ok(!('crushlens_bridge_token' in snap), '快照排除 crushlens_bridge_token');
  ok(!('cl_api_key' in snap), '快照排除 cl_api_key');
  ok('theme' in snap && 'cl_demo' in snap, '非敏感键正常保留');
  ok(JSON.stringify(snap).indexOf('victim') < 0 && JSON.stringify(snap).indexOf('tok-secret') < 0, '快照中不含会话/令牌值');

  section('3. githubCallback 转交 code/state（OAuth 接线）');
  const { Api, calls } = loadApi();
  await Api.githubCallback('the-code', 'the-state');
  ok(calls.length === 1, '发起了一次 fetch');
  const url = calls[0].url;
  ok(url.indexOf('/gh/callback') >= 0, '请求指向 /gh/callback');
  ok(url.indexOf('code=the-code') >= 0, '带上 code 参数');
  ok(url.indexOf('state=the-state') >= 0, '带上 state 参数');
  ok(calls[0].opts.credentials === 'include', '携带 credentials:include 以接收会话 Cookie');

  console.log('\n────────────────────────────────────────────');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
