/* Worker security regression tests — no Cloudflare account needed.
 * Simulates Workers runtime (crypto/Request/Response/fetch) + in-memory D1.
 * Run: node worker/worker.test.mjs
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const { default: worker } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ok  -', msg); } else { fail++; console.log('  FAIL-', msg); } }

function makeD1() {
  const codes = new Map(), rate = new Map(), accounts = new Map(), sessions = new Map();
  const usage = []; // anonymous usage_events rows
  const findAccount = (pred) => [...accounts.values()].find(pred) || null;
  function exec(sql, b) {
    const s = sql.trim();
    if (s.includes('usage_events')) {
      if (s.startsWith('INSERT')) { usage.push({ kind: b[0], platform: b[1], msg_bucket: b[2], app_version: b[3], created_at: b[4] }); return null; }
      if (s.includes('COUNT(*) AS users')) {
        return { users: accounts.size, logins: [...accounts.values()].reduce((n, a) => n + (a.login_count || 0), 0), partners: [...accounts.values()].reduce((n, a) => n + (a.partner_count || 0), 0), first_at: null };
      }
      if (s.includes('GROUP BY kind')) {
        const m = {}; usage.filter((u) => u.created_at >= (b[0] || 0)).forEach((u) => { m[u.kind] = (m[u.kind] || 0) + 1; });
        return { results: Object.entries(m).map(([kind, n]) => ({ kind, n })) };
      }
      if (s.includes('GROUP BY platform')) {
        const m = {}; usage.filter((u) => u.kind === 'import' && u.created_at >= (b[1] || 0) && u.platform).forEach((u) => { m[u.platform] = (m[u.platform] || 0) + 1; });
        return { results: Object.entries(m).map(([platform, n]) => ({ platform, n })) };
      }
      if (s.includes('GROUP BY msg_bucket')) {
        const m = {}; usage.filter((u) => u.kind === 'import' && u.created_at >= (b[1] || 0) && u.msg_bucket != null).forEach((u) => { m[u.msg_bucket] = (m[u.msg_bucket] || 0) + 1; });
        return { results: Object.entries(m).map(([msg_bucket, n]) => ({ msg_bucket, n })) };
      }
      if (s.includes('ORDER BY created_at DESC')) {
        return { results: usage.filter((u) => u.created_at >= (b[0] || 0)).slice().reverse() };
      }
      return null;
    }
    if (s.includes('FROM rate')) {
      if (s.startsWith('SELECT')) return rate.get(b[0]) || null;
      if (s.startsWith('INSERT')) rate.set(b[0], { count: b[1], window_start: b[2] });
      if (s.startsWith('UPDATE')) { const r = rate.get(b[0]); if (r) r.count++; }
      return null;
    }
    if (s.includes('codes')) {
      if (s.startsWith('SELECT')) return codes.get(b[0]) || null;
      if (s.startsWith('INSERT')) { codes.set(b[0], { code_hash: b[1], expires_at: b[2], tries: b[3], created_at: b[4] }); return null; }
      if (s.includes('tries=tries+1')) { const c = codes.get(b[0]); if (c) c.tries++; return null; }
      if (s.startsWith('DELETE')) { codes.delete(b[0]); return null; }
    }
    if (s.includes('FROM accounts')) {
      if (s.includes('email=?')) return findAccount((a) => a.email === b[0]);
      if (s.includes('id=?')) return findAccount((a) => a.id === b[0]);
      if (s.includes('github_id=?')) return findAccount((a) => a.github_id === b[0]);
      return null;
    }
    if (s.startsWith('INSERT INTO accounts')) {
      // 按列名映射，并尊重 VALUES 里的字面量（如 partner_count 写成 0），
      // 否则占位符与列会静默错位，测试会给出假结论。
      const m = s.match(/INSERT INTO accounts\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
      const a = { login_count: 0, partner_count: 0 };
      if (m) {
        const cols = m[1].split(',').map((c) => c.trim());
        const vals = m[2].split(',').map((v) => v.trim());
        let bi = 0;
        cols.forEach((c, i) => {
          const v = vals[i];
          if (v === '?') { a[c] = b[bi++]; }
          else if (/^null$/i.test(v)) { a[c] = null; }
          else if (/^-?\d+(\.\d+)?$/.test(v)) { a[c] = Number(v); }
          else { a[c] = v.replace(/^'|'$/g, ''); }
        });
      }
      accounts.set(a.id, a); return null;
    }
    if (s.includes('UPDATE accounts SET password_hash')) {
      const a = findAccount((x) => x.id === b[2]); if (a) { a.password_hash = b[0]; a.salt = b[1]; } return null;
    }
    if (s.includes('INTO sessions')) { sessions.set(b[0], { account_id: b[1], expires_at: b[3] }); return null; }
    if (s.includes('FROM sessions') && s.startsWith('SELECT')) return sessions.get(b[0]) || null;
    if (s.startsWith('DELETE FROM sessions')) { sessions.delete(b[0]); return null; }
    return null;
  }
  return {
    _codes: codes, _accounts: accounts, _sessions: sessions, _usage: usage,
    prepare(sql) {
      const b = [];
      const st = {
        bind(...x) { b.push(...x); return st; },
        async first() { return exec(sql, b); },
        async run() { exec(sql, b); return { success: true }; },
        async all() { const r = exec(sql, b); return (r && r.results) ? r : { results: [] }; }
      };
      return st;
    }
  };
}

async function call(env, path, { method = 'GET', body, origin = 'http://localhost:5173' } = {}) {
  const init = { method, headers: { Origin: origin } };
  if (body) init.headers['Content-Type'] = 'application/json', init.body = JSON.stringify(body);
  const req = new Request('https://api.test' + path, init);
  const res = await worker.fetch(req, env, {});
  let data = null; try { data = await res.json(); } catch (e) { }
  return { status: res.status, data, headers: res.headers };
}

// --- 1. Brevo unconfigured: no code, no devCode, no DB row ---
{
  const env = { DB: makeD1(), PEPPER: 'p', SITE_ORIGIN: 'http://localhost:5173' };
  const r = await call(env, '/email/code', { method: 'POST', body: { email: 'victim@example.com' } });
  ok(r.status === 503, 'BREVO_KEY missing -> 503 (no silent code)');
  ok(!('devCode' in (r.data || {})), 'no devCode in response');
  ok(env.DB._codes.size === 0, 'no verification code stored in DB');
  const r2 = await call(env, '/password/reset', { method: 'POST', body: { email: 'victim@example.com', code: '000000', salt: 'a'.repeat(32), stretched: 'b'.repeat(64) } });
  ok(r2.status === 400, 'password/reset cannot succeed without a stored code');
}

// --- 2. Brevo configured: CSPRNG code mailed, never echoed; legitimate reset works ---
{
  const env = { DB: makeD1(), PEPPER: 'pepper', BREVO_KEY: 'fake-brevo-key', SITE_ORIGIN: 'http://localhost:5173' };
  // seed a victim password account directly into the mock DB
  await env.DB.prepare('INSERT INTO accounts(id,email,name,password_hash,salt,provider,created_at,last_login,login_count,partner_count) VALUES(?,?,?,?,?,?,?,?,?,0)')
    .bind('a_1', 'victim@example.com', 'v', 'oldhash', 'a'.repeat(32), 'password', Date.now(), Date.now(), 1).run();

  const origFetch = globalThis.fetch;
  let mailedCode = null;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const m = body.htmlContent.match(/letter-spacing:8px[^>]*>(\d{6})</);
    if (m) mailedCode = m[1];
    return new Response('{}', { status: 200 });
  };
  try {
    const r = await call(env, '/email/code', { method: 'POST', body: { email: 'victim@example.com' } });
    ok(r.status === 200 && r.data.sent === true, 'configured -> 200 sent:true');
    ok(!('devCode' in r.data), 'no devCode leaked to browser even when configured');
    ok(/^\d{6}$/.test(mailedCode || ''), '6-digit code was generated and handed to mailer');
    ok(env.DB._codes.size === 1, 'code hash stored in D1');
    ok([...env.DB._codes.values()][0].code_hash !== mailedCode, 'DB stores HMAC, not plaintext code');

    const reset = await call(env, '/password/reset', { method: 'POST', body: { email: 'victim@example.com', code: mailedCode, salt: 'c'.repeat(32), stretched: 'd'.repeat(64) } });
    ok(reset.status === 200 && reset.data.ok === true, 'legitimate email-code reset still works');
    ok(env.DB._codes.size === 0, 'code consumed after reset');
  } finally { globalThis.fetch = origFetch; }
}

// --- 3. CORS: disallowed origin gets no ACAO header, no credentials ---
{
  const env = { DB: makeD1(), PEPPER: 'p', SITE_ORIGIN: 'https://him-wang.github.io' };
  const r = await call(env, '/email/code', { method: 'POST', origin: 'https://evil.example', body: { email: 'a@b.com' } });
  ok(r.status === 403, 'disallowed origin POST -> 403');
  ok(r.headers.get('Access-Control-Allow-Origin') === null, 'no ACAO header for disallowed origin');
  ok(r.headers.get('Access-Control-Allow-Credentials') === null, 'no Allow-Credentials for disallowed origin');
}

// --- 4. CSRF: state-changing request with NO Origin is rejected ---
{
  const env = { DB: makeD1(), PEPPER: 'p', SITE_ORIGIN: 'https://him-wang.github.io' };
  const req = new Request('https://api.test/email/code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.com' })
  });
  const res = await worker.fetch(req, env, {});
  ok(res.status === 403, 'POST without Origin -> 403 (no-Origin bypass closed)');
}

// --- 5. GET is not blocked by the origin guard (public salt lookup) ---
{
  const env = { DB: makeD1(), PEPPER: 'p', SITE_ORIGIN: 'https://him-wang.github.io' };
  const r = await call(env, '/salt?email=a%40b.com', { method: 'GET', origin: '' });
  ok(r.status === 200, 'GET still works without a browser Origin');
}

// --- 6. 开发端白名单：只有指定 GitHub id 能进（服务端强校验）---
{
  const { createHash } = await import('node:crypto');
  const sha = (s) => createHash('sha256').update(s).digest('hex');

  // 三个账号：白名单里的两个 GitHub 账号 + 一个普通账号
  const env = { DB: makeD1(), PEPPER: 'p', SITE_ORIGIN: 'http://localhost:5173' };
  const seed = async (id, email, githubId) => {
    await env.DB.prepare('INSERT INTO accounts(id,email,name,password_hash,salt,provider,created_at,last_login,login_count,partner_count,github_id,avatar) VALUES(?,?,?,?,?,?,?,?,?,0,?,?)')
      .bind(id, email, id, null, null, githubId ? 'github' : 'password', Date.now(), Date.now(), 1, githubId, null).run();
  };
  await seed('a_him', 'him@example.com', 'gh_106427909');
  await seed('a_seven', 'seven@example.com', 'gh_355639050');
  await seed('a_rando', 'rando@example.com', 'gh_999999');

  // 直接种一个已知 token 的会话（token 明文 -> sha256 作 key）
  const tokOf = (accountId) => {
    const tok = 'tok_' + accountId;
    env.DB._sessions.set(sha(tok), { account_id: accountId, expires_at: Date.now() + 3600e3 });
    return tok;
  };
  const asUser = async (tok, path) => {
    const req = new Request('https://api.test' + path, { method: 'GET', headers: { Origin: 'http://localhost:5173', Cookie: 'cl_session=' + tok } });
    const res = await worker.fetch(req, env, {});
    let data = null; try { data = await res.json(); } catch (e) { }
    return { status: res.status, data };
  };

  const me_him = await asUser(tokOf('a_him'), '/me');
  ok(me_him.status === 200 && me_him.data.admin === true, '白名单账号 Him-Wang -> /me admin:true');
  const me_seven = await asUser(tokOf('a_seven'), '/me');
  ok(me_seven.status === 200 && me_seven.data.admin === true, '白名单账号 1102-seven -> /me admin:true');
  const me_rando = await asUser(tokOf('a_rando'), '/me');
  ok(me_rando.status === 200 && me_rando.data.admin === false, '非白名单账号 -> /me admin:false');

  const list_admin = await asUser(tokOf('a_him'), '/admin/accounts');
  ok(list_admin.status === 200 && Array.isArray(list_admin.data.accounts), '白名单账号 -> /admin/accounts 200');
  const list_rando = await asUser(tokOf('a_rando'), '/admin/accounts');
  ok(list_rando.status === 403, '非白名单账号 -> /admin/accounts 403');
  ok(!list_rando.data || !list_rando.data.accounts, '非白名单账号拿不到任何账号数据');

  // 未登录
  const anon = await (async () => {
    const req = new Request('https://api.test/admin/accounts', { method: 'GET', headers: { Origin: 'http://localhost:5173' } });
    const res = await worker.fetch(req, env, {});
    return res.status;
  })();
  ok(anon === 401, '未登录 -> /admin/accounts 401');

  // 环境变量 ADMIN_GITHUB_IDS 可追加（不必改代码）
  const env2 = { DB: makeD1(), PEPPER: 'p', SITE_ORIGIN: 'http://localhost:5173', ADMIN_GITHUB_IDS: 'gh_999999' };
  await env2.DB.prepare('INSERT INTO accounts(id,email,name,password_hash,salt,provider,created_at,last_login,login_count,partner_count,github_id,avatar) VALUES(?,?,?,?,?,?,?,?,?,0,?,?)')
    .bind('a_x', 'x@example.com', 'x', null, null, 'github', Date.now(), Date.now(), 1, 'gh_999999', null).run();
  const tokx = 'tok_x';
  env2.DB._sessions.set(sha(tokx), { account_id: 'a_x', expires_at: Date.now() + 3600e3 });
  const req2 = new Request('https://api.test/me', { method: 'GET', headers: { Origin: 'http://localhost:5173', Cookie: 'cl_session=' + tokx } });
  const r2 = await worker.fetch(req2, env2, {});
  const d2 = await r2.json();
  ok(d2.admin === true, 'ADMIN_GITHUB_IDS 环境变量可追加白名单');

  // OWNER_EMAIL 兼容：邮箱命中仍是 admin（老部署不会把自己锁在门外）
  const env3 = { DB: makeD1(), PEPPER: 'p', SITE_ORIGIN: 'http://localhost:5173', OWNER_EMAIL: 'boss@example.com' };
  await env3.DB.prepare('INSERT INTO accounts(id,email,name,password_hash,salt,provider,created_at,last_login,login_count,partner_count) VALUES(?,?,?,?,?,?,?,?,?,0)')
    .bind('a_owner', 'boss@example.com', 'b', 'h', 's', 'password', Date.now(), Date.now(), 1).run();
  env3.DB._sessions.set(sha('tok_o'), { account_id: 'a_owner', expires_at: Date.now() + 3600e3 });
  const req3 = new Request('https://api.test/me', { method: 'GET', headers: { Origin: 'http://localhost:5173', Cookie: 'cl_session=tok_o' } });
  const r3 = await worker.fetch(req3, env3, {});
  const d3 = await r3.json();
  ok(d3.admin === true, 'OWNER_EMAIL 邮箱账号仍是 admin（向后兼容）');
}

// --- 7. /register 使用用户填写的昵称，且 publicAccount 含 github_id 字段 ---
{
  const env = { DB: makeD1(), PEPPER: 'pepper', BREVO_KEY: 'fake-key', SITE_ORIGIN: 'http://localhost:5173' };
  const origFetch = globalThis.fetch;
  let mailedCode = null;
  globalThis.fetch = async (url, init) => {
    const m = JSON.parse(init.body).htmlContent.match(/letter-spacing:8px[^>]*>(\d{6})</);
    if (m) mailedCode = m[1];
    return new Response('{}', { status: 200 });
  };
  try {
    await call(env, '/email/code', { method: 'POST', body: { email: 'nick@example.com' } });
    const r = await call(env, '/register', { method: 'POST', body: {
      email: 'nick@example.com', code: mailedCode,
      salt: 'a'.repeat(32), stretched: 'b'.repeat(64), name: '小镜'
    } });
    ok(r.status === 200, 'register with valid code -> 200');
    ok(r.data && r.data.account && r.data.account.name === '小镜', '/register 使用提交的昵称');
    ok(r.data && r.data.account && 'github_id' in r.data.account, 'publicAccount 含 github_id 字段');
  } finally { globalThis.fetch = origFetch; }
}

// --- 8. 发信失败 -> 非 2xx 且不落库（不再伪装成功） ---
{
  const env = { DB: makeD1(), PEPPER: 'pepper', BREVO_KEY: 'fake-key', SITE_ORIGIN: 'http://localhost:5173' };
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 400 });
  try {
    const r = await call(env, '/email/code', { method: 'POST', body: { email: 'mailfail@example.com' } });
    ok(r.status !== 200, 'mailer failure -> non-200 (not silent success)');
    ok(env.DB._codes.size === 0, 'no code stored when mail failed');
  } finally { globalThis.fetch = origFetch; }
}

// --- 9. SITE_ORIGIN 配置的来源被 CORS 放行（自托管可用） ---
{
  const env = { DB: makeD1(), PEPPER: 'p', BREVO_KEY: 'k', SITE_ORIGIN: 'https://custom.example.com/app' };
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  try {
    const r = await call(env, '/email/code', { method: 'POST', origin: 'https://custom.example.com', body: { email: 'x@y.com' } });
    ok(r.status === 200, 'SITE_ORIGIN 来源被放行');
    ok(r.headers.get('Access-Control-Allow-Origin') === 'https://custom.example.com', 'ACAO reflects custom origin');
  } finally { globalThis.fetch = origFetch; }
}

// --- 10. 匿名使用统计：服务端事件自动记录，客户端仅能 opt-in 上报匿名事件 ---
{
  const { createHash } = await import('node:crypto');
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const env = { DB: makeD1(), PEPPER: 'pepper', BREVO_KEY: 'fake-key', SITE_ORIGIN: 'http://localhost:5173' };
  const origFetch = globalThis.fetch;
  let mailedCode = null;
  globalThis.fetch = async (url, init) => {
    const m = JSON.parse(init.body).htmlContent.match(/letter-spacing:8px[^>]*>(\d{6})</);
    if (m) mailedCode = m[1];
    return new Response('{}', { status: 200 });
  };
  try {
    await call(env, '/email/code', { method: 'POST', body: { email: 'telemetry@example.com' } });
    const reg = await call(env, '/register', { method: 'POST', body: {
      email: 'telemetry@example.com', code: mailedCode, salt: 'a'.repeat(32), stretched: 'b'.repeat(64), name: '隐私'
    } });
    ok(reg.status === 200, 'register success (telemetry env)');
    // signup 事件应由服务端自动记录（不含任何身份信息）
    const signup = env.DB._usage.find((u) => u.kind === 'signup');
    ok(!!signup, '服务端自动记录 signup 事件');
    ok(!('email' in signup) && !('account' in signup) && !('name' in signup), 'signup 事件不含邮箱/账号/昵称');

    // 客户端上报 import：合法
    const imp = await call(env, '/usage/report', { method: 'POST', body: {
      kind: 'import', platform: 'wechat', msgBucket: 137, appVersion: 'v2.1'
    } });
    ok(imp.status === 200 && imp.data.ok === true, 'opt-in import 上报 200');
    const impRow = env.DB._usage.find((u) => u.kind === 'import');
    ok(impRow && impRow.platform === 'wechat', '上报记录 platform');
    ok(impRow && impRow.msg_bucket === 250, '消息数被分桶（137 -> 250），不存精确值');
    ok(impRow && !('email' in impRow) && !('text' in impRow), '上报事件不含身份或聊天内容');

    // 客户端不能伪造服务端专属事件
    const fake = await call(env, '/usage/report', { method: 'POST', body: { kind: 'signup' } });
    ok(fake.status === 400, '客户端不能伪造 signup 事件');
    const badKind = await call(env, '/usage/report', { method: 'POST', body: { kind: 'steal_password' } });
    ok(badKind.status === 400, '未知事件类型被拒');

    // admin/stats 权限门
    const anon = await call(env, '/admin/stats', { method: 'GET' });
    ok(anon.status === 401, '/admin/stats 未登录 -> 401');
    const regular = 'tok_regular';
    env.DB._sessions.set(sha(regular), { account_id: reg.data.account.id, expires_at: Date.now() + 3600e3 });
    const reqU = new Request('https://api.test/admin/stats', { method: 'GET', headers: { Origin: 'http://localhost:5173', Cookie: 'cl_session=' + regular } });
    const resU = await worker.fetch(reqU, env, {});
    ok(resU.status === 403, '非白名单账号 -> /admin/stats 403');
    // 白名单账号可读真实统计
    await env.DB.prepare('INSERT INTO accounts(id,email,name,password_hash,salt,provider,created_at,last_login,login_count,partner_count,github_id,avatar) VALUES(?,?,?,?,?,?,?,?,?,0,?,?)')
      .bind('a_admin', 'admin@example.com', 'a', null, null, 'github', Date.now(), Date.now(), 1, 'gh_106427909', null).run();
    const admTok = 'tok_admin';
    env.DB._sessions.set(sha(admTok), { account_id: 'a_admin', expires_at: Date.now() + 3600e3 });
    const reqA = new Request('https://api.test/admin/stats', { method: 'GET', headers: { Origin: 'http://localhost:5173', Cookie: 'cl_session=' + admTok } });
    const resA = await worker.fetch(reqA, env, {});
    const dA = await resA.json();
    ok(resA.status === 200 && dA.stats && typeof dA.stats.users === 'number', '白名单账号读到真实服务端统计');
    ok(dA.stats.byKind && dA.stats.byKind.signup >= 1, '统计按事件类型聚合（含 signup）');
    ok(dA.stats.byPlatform && dA.stats.byPlatform.wechat >= 1, '统计按导入平台聚合');
    ok(dA.stats.byDay && Object.keys(dA.stats.byDay).length >= 1, '统计按天聚合');
  } finally { globalThis.fetch = origFetch; }
}

// --- 11. GitHub 镜像：未配置 token/repo 时静默跳过；配置后 token 只在服务端使用 ---
{
  const { createHash } = await import('node:crypto');
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const seedAdmin = async (env, id, tok, ghId) => {
    await env.DB.prepare('INSERT INTO accounts(id,email,name,password_hash,salt,provider,created_at,last_login,login_count,partner_count,github_id,avatar) VALUES(?,?,?,?,?,?,?,?,?,0,?,?)')
      .bind(id, id + '@example.com', 'a', null, null, 'github', Date.now(), Date.now(), 1, ghId, null).run();
    env.DB._sessions.set(sha(tok), { account_id: id, expires_at: Date.now() + 3600e3 });
  };
  // 未配置
  const env = { DB: makeD1(), PEPPER: 'p', SITE_ORIGIN: 'http://localhost:5173' };
  await seedAdmin(env, 'a_admin2', 'tok_admin2', 'gh_106427909');
  const req = new Request('https://api.test/admin/stats?mirror=1', { method: 'GET', headers: { Origin: 'http://localhost:5173', Cookie: 'cl_session=tok_admin2' } });
  const res = await worker.fetch(req, env, {});
  const d = await res.json();
  ok(res.status === 200, 'mirror=1 且未配置 token -> 统计仍 200');
  ok(d.mirror && d.mirror.mirrored === false && d.mirror.reason === 'not_configured', '镜像未配置时明确标记 mirrored:false/no-config');

  // 已配置：mock GitHub contents API，验证 Bearer token 只在服务端发往 api.github.com
  const env2 = { DB: makeD1(), PEPPER: 'p', SITE_ORIGIN: 'http://localhost:5173', GH_MIRROR_TOKEN: 'server_only_pat', GH_MIRROR_REPO: 'owner/repo' };
  await seedAdmin(env2, 'a_admin3', 'tok_admin3', 'gh_106427909');
  const origFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), auth: init.headers && init.headers.Authorization });
    if (String(url).includes('/contents/') && !init.method) return new Response('{"sha":"abc123"}', { status: 200 }); // GET 现有文件
    return new Response('{"content":{}}', { status: 200 }); // PUT 写入
  };
  try {
    const req2 = new Request('https://api.test/admin/stats?mirror=1', { method: 'GET', headers: { Origin: 'http://localhost:5173', Cookie: 'cl_session=tok_admin3' } });
    const res2 = await worker.fetch(req2, env2, {});
    const d2 = await res2.json();
    ok(res2.status === 200 && d2.mirror && d2.mirror.mirrored === true, '配置后镜像成功 mirrored:true');
    const put = seen.find((s) => s.url.includes('api.github.com/repos/owner/repo/contents/'));
    ok(!!put, '请求打到了 GitHub contents API');
    ok(put && put.auth === 'Bearer server_only_pat', 'PAT 只作为 Bearer 从服务端发往 GitHub');
    ok(seen.every((s) => s.auth === 'Bearer server_only_pat'), '所有 GitHub 请求都带服务端 token');
  } finally { globalThis.fetch = origFetch; }
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
