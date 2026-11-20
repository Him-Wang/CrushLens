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
  const findAccount = (pred) => [...accounts.values()].find(pred) || null;
  function exec(sql, b) {
    const s = sql.trim();
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
      const a = { id: b[0], email: b[1], name: b[2], password_hash: b[3], salt: b[4], provider: b[5], github_id: b[6], avatar: b[7], created_at: b[8], last_login: b[9], login_count: b[10], partner_count: b[11] };
      accounts.set(a.id, a); return null;
    }
    if (s.includes('UPDATE accounts SET password_hash')) {
      const a = findAccount((x) => x.id === b[2]); if (a) { a.password_hash = b[0]; a.salt = b[1]; } return null;
    }
    if (s.includes('INTO sessions')) { sessions.set(b[0], { account_id: b[1], expires_at: b[3] }); return null; }
    return null;
  }
  return {
    _codes: codes, _accounts: accounts,
    prepare(sql) {
      const b = [];
      const st = {
        bind(...x) { b.push(...x); return st; },
        async first() { return exec(sql, b); },
        async run() { exec(sql, b); return { success: true }; },
        async all() { return { results: [] }; }
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

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
