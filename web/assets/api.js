/* ============================================================
 * CrushLens Cloud · 云端接口封装（浏览器侧）
 * ------------------------------------------------------------
 * - 所有请求走 Worker（CORS + 会话 Cookie），不在前端保存任何
 *   GitHub token / gho_ / github_pat_ / Brevo key。
 * - 密码在这里用 crypto.subtle 做 10 万次 PBKDF2 拉伸，Worker
 *   只做一次 HMAC，绕开 Workers Free 10ms CPU 上限。
 * - Worker 地址预置为已部署的官方实例；用户在 localStorage 覆盖后以其为准。
 * ============================================================ */
(function (root) {
  'use strict';

  const BASE_KEY = 'cl_api_base';
  const DEFAULT_BASE = 'https://crushlens-api.crushlens.workers.dev';
  const enc = new TextEncoder();

  function base() {
    try { return (localStorage.getItem(BASE_KEY) || DEFAULT_BASE).replace(/\/$/, ''); } catch (e) { return DEFAULT_BASE; }
  }
  function configured() { return !!base(); }
  function setBase(url) {
    const u = String(url || '').trim().replace(/\/$/, '');
    if (u && !/^https:\/\//.test(u)) throw new Error('云端接口地址必须是 https:// 开头');
    try { u ? localStorage.setItem(BASE_KEY, u) : localStorage.removeItem(BASE_KEY); } catch (e) { }
  }

  function bufToHex(buf) {
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  function hexToBuf(hex) {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16);
    return arr;
  }
  function assertSecure() {
    if (!(root.crypto && crypto.subtle && crypto.subtle.importKey)) {
      throw new Error('当前打开方式不支持安全加密，请用 http://localhost 或 https 地址打开');
    }
  }

  // 浏览器端 10 万次拉伸；返回 64 位 hex（password-equivalent，绝不落盘）
  async function stretch(password, saltHex) {
    assertSecure();
    const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: hexToBuf(saltHex), iterations: 100000, hash: 'SHA-256' }, key, 256
    );
    return bufToHex(bits);
  }

  async function req(path, opts) {
    if (!configured()) throw Object.assign(new Error('还没有配置云端接口地址，请在「设置 → 模型与云端」里填写'), { code: 'NOT_CONFIGURED' });
    const o = opts || {};
    let resp;
    try {
      resp = await fetch(base() + path, {
        method: o.method || 'GET',
        credentials: 'include', // 携带跨站会话 Cookie（SameSite=None; Secure）
        cache: 'no-store',
        headers: o.body ? { 'Content-Type': 'application/json' } : {},
        body: o.body ? JSON.stringify(o.body) : undefined,
        signal: o.signal
      });
    } catch (e) {
      throw Object.assign(new Error('连不上云端服务，检查网络或接口地址'), { code: 'NETWORK' });
    }
    let data = null;
    try { data = await resp.json(); } catch (e) { data = null; }
    if (!resp.ok) {
      throw Object.assign(new Error((data && data.error) || ('服务返回 ' + resp.status)), { code: data && data.code, status: resp.status });
    }
    return data;
  }

  /* ---------------- 邮箱登录 ---------------- */
  async function sendCode(email) { return req('/email/code', { method: 'POST', body: { email } }); }

  async function register(email, code, password, name) {
    const s = await req('/salt?email=' + encodeURIComponent(email));
    const stretched = await stretch(password, s.salt);
    const d = await req('/register', { method: 'POST', body: { email, code, salt: s.salt, stretched, name } });
    return d;
  }

  async function login(email, password) {
    const s = await req('/salt?email=' + encodeURIComponent(email));
    if (!s.exists) throw new Error('没有找到这个账号，先注册');
    if (s.provider === 'github') throw new Error('这个账号是用 GitHub 登录的，请用 GitHub 按钮登录');
    const stretched = await stretch(password, s.salt);
    return req('/login', { method: 'POST', body: { email, stretched } });
  }

  async function resetPassword(email, code, password) {
    const s = await req('/salt?email=' + encodeURIComponent(email));
    const stretched = await stretch(password, s.salt);
    return req('/password/reset', { method: 'POST', body: { email, code, salt: s.salt, stretched } });
  }

  function logout() { return req('/logout', { method: 'POST' }).catch(() => null); }
  function me() { return req('/me'); }
  function adminAccounts() { return req('/admin/accounts'); }
  function syncCounts(partnerCount) { return req('/account/sync-counts', { method: 'POST', body: { partner_count: partnerCount } }); }

  // 匿名使用上报（用户 opt-in）：只发元数据，绝不含聊天内容/邮箱/昵称。
  // 失败完全静默，绝不影响用户正常使用。
  const TELEMETRY_KEY = 'cl_telemetry_optin';
  const APP_VERSION = 'v2.1';
  function telemetryEnabled() { try { return localStorage.getItem(TELEMETRY_KEY) === '1'; } catch (e) { return false; } }
  function setTelemetry(on) { try { on ? localStorage.setItem(TELEMETRY_KEY, '1') : localStorage.removeItem(TELEMETRY_KEY); } catch (e) { } }
  function reportUsage(kind, extra) {
    if (!telemetryEnabled() || !configured()) return Promise.resolve(false);
    const b = Object.assign({ kind, appVersion: APP_VERSION }, extra || {});
    return req('/usage/report', { method: 'POST', body: b })
      .then(() => true)
      .catch(() => false);
  }
  // 开发端：从服务端读真实统计（白名单账号），可选 mirror=1 触发 GitHub 镜像。
  function adminStats(days, mirror) {
    return req('/admin/stats' + '?days=' + encodeURIComponent(days || 14) + (mirror ? '&mirror=1' : ''));
  }

  // GitHub 登录：整页跳转到 Worker；授权后 GitHub 带 code/state 回到站点 /?gh=1，
  // 前端 boot() 再调用 githubCallback 把 code/state 转交服务端换取会话 Cookie。
  // 前端全程不接触 access_token / client_secret。
  // to='admin' 时由 Worker 记住回跳目标，登录完成后前端把用户送到开发端。
  function githubLogin(to) {
    if (!configured()) throw new Error('还没有配置云端接口地址');
    location.href = base() + '/gh/login' + (to ? '?to=' + encodeURIComponent(to) : '');
  }

  // 把 GitHub 回调的 code/state 转交 Worker。服务端用它换 token（client_secret
  // 只在 Worker secret）、校验 state、写入 cl_session Cookie；浏览器靠
  // credentials:'include' 接收跨站 Cookie。返回后前端再调用 me() 感知登录态。
  function githubCallback(code, state) {
    return req('/gh/callback?code=' + encodeURIComponent(code) + '&state=' + encodeURIComponent(state));
  }

  root.CLApi = {
    BASE_KEY, DEFAULT_BASE, base, configured, setBase, stretch, req,
    sendCode, register, login, resetPassword, logout, me, adminAccounts, syncCounts, githubLogin, githubCallback,
    TELEMETRY_KEY, telemetryEnabled, setTelemetry, reportUsage, adminStats
  };
})(window);
