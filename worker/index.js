/* ============================================================
 * CrushLens Cloud · Cloudflare Worker (ES module)
 * ------------------------------------------------------------
 * Only ACCOUNT METADATA is stored in D1. Chat content never
 * leaves the browser. All crypto here stays within Workers Free
 * 10ms CPU budget: exactly one HMAC-SHA256 per password op; the
 * expensive PBKDF2 (100k) runs in the browser via crypto.subtle.
 * ============================================================ */

const SESSION_TTL = 7 * 24 * 3600 * 1000;
const CODE_TTL = 10 * 60 * 1000;
const COOKIE = 'cl_session';

/* ---------------- CORS / origin allowlist ---------------- */
// Hard fact: GitHub device/oauth endpoints are 404 cross-origin, so this
// relay is mandatory. We accept only the site and localhost dev origins.
function allowedOrigin(origin) {
  if (!origin) return false;
  if (origin === 'https://him-wang.github.io') return true;
  // http://localhost:* and http://127.0.0.1:* on any port
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function cors(origin) {
  const h = {
    'Access-Control-Allow-Origin': allowedOrigin(origin) ? origin : 'null',
    'Vary': 'Origin',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600'
  };
  return h;
}
function json(body, status, origin, extraHeaders) {
  const h = new Headers();
  Object.entries(cors(origin)).forEach(([k, v]) => h.set(k, v));
  h.set('Content-Type', 'application/json; charset=utf-8');
  Object.entries(extraHeaders || {}).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((one) => h.append(k, one));
    else h.set(k, v);
  });
  return new Response(JSON.stringify(body), { status: status || 200, headers: h });
}
function fail(status, msg, origin) { return json({ error: msg }, status, origin); }

/* ---------------- crypto helpers ---------------- */
function bufToHex(buf) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
function randHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return bufToHex(a); }
async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bufToHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}
async function sha256Hex(data) {
  return bufToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)));
}
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim().toLowerCase()); }

// Cryptographically secure 6-digit code. Rejection sampling avoids modulo bias
// (never derive auth codes from Math.random()).
function random6Digit() {
  const a = new Uint32Array(1);
  const span = 900000;
  const limit = Math.floor(4294967296 / span) * span;
  do { crypto.getRandomValues(a); } while (a[0] >= limit);
  return String(100000 + (a[0] % span));
}

/* ---------------- request helpers ---------------- */
async function body(req) {
  try { return await req.json(); } catch (e) { return {}; }
}
function clientIp(req) {
  return req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || 'unknown';
}
function cookieValue(req, name) {
  const raw = req.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function sessionCookie(token, maxAge) {
  // SameSite=None is required: the site (github.io) and API (workers.dev)
  // are cross-site. Secure + HttpOnly keep the token off JS + plaintext HTTP.
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`;
}

/* ---------------- session ---------------- */
async function readSession(env, req) {
  const token = cookieValue(req, COOKIE);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare('SELECT account_id, expires_at FROM sessions WHERE token_hash=?').bind(hash).first();
  if (!row || row.expires_at < Date.now()) return null;
  return row.account_id;
}
async function issueSession(env, accountId) {
  const token = randHex(32);
  const hash = await sha256Hex(token);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions(token_hash, account_id, created_at, expires_at) VALUES(?,?,?,?)')
    .bind(hash, accountId, now, now + SESSION_TTL).run();
  return token;
}
// Return a JSON response that also carries the session cookie.
async function withSession(env, origin, accountId, payload, status) {
  const token = await issueSession(env, accountId);
  return json(payload, status || 200, origin, { 'Set-Cookie': sessionCookie(token, Math.floor(SESSION_TTL / 1000)) });
}

/* ---------------- rate limiting (D1, never KV) ---------------- */
async function rateHit(env, bucket, limit, windowMs) {
  const now = Date.now();
  const row = await env.DB.prepare('SELECT count, window_start FROM rate WHERE bucket=?').bind(bucket).first();
  if (!row || now - row.window_start >= windowMs) {
    await env.DB.prepare('INSERT INTO rate(bucket,count,window_start) VALUES(?,?,?) ON CONFLICT(bucket) DO UPDATE SET count=excluded.count, window_start=excluded.window_start')
      .bind(bucket, 1, now).run();
    return { ok: true, remaining: limit - 1 };
  }
  if (row.count >= limit) return { ok: false, remaining: 0 };
  await env.DB.prepare('UPDATE rate SET count=count+1 WHERE bucket=?').bind(bucket).run();
  return { ok: true, remaining: limit - row.count - 1 };
}

/* ---------------- account whitelist (NO chat content) ---------------- */
function publicAccount(a) {
  return {
    id: a.id, email: a.email, name: a.name, provider: a.provider,
    avatar: a.avatar || null, created_at: a.created_at, last_login: a.last_login,
    login_count: a.login_count, partner_count: a.partner_count
  };
}

/* ---------------- Brevo mail ---------------- */
async function sendCodeMail(env, email, code) {
  if (!env.BREVO_KEY) return { sent: false, reason: 'BREVO_KEY 尚未配置（部署后需 wrangler secret put BREVO_KEY）' };
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_KEY },
    body: JSON.stringify({
      sender: { name: 'CrushLens', email: (env.MAIL_FROM || '').match(/<(.+)>/)?.[1] || 'no-reply@crushlens.workers.dev' },
      to: [{ email, name: email.split('@')[0] }],
      subject: '心动镜验证码',
      htmlContent: `<div style="font-family:sans-serif;line-height:1.7"><h2>心动镜 · 邮箱验证</h2><p>你的验证码是：</p><div style="font-size:34px;font-weight:700;letter-spacing:8px;color:#e11d48">${code}</div><p style="color:#76706c">10 分钟内有效。如果不是你本人操作，请忽略这封邮件。</p></div>`
    })
  });
  if (!resp.ok) return { sent: false, reason: '邮件服务返回 ' + resp.status };
  return { sent: true };
}

/* ============================================================
 * Router
 * ============================================================ */
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    // CSRF-ish guard for state-changing API calls from other origins.
    const isApi = path !== '/gh/login' && path !== '/gh/callback';
    if (isApi && request.method !== 'GET' && origin && !allowedOrigin(origin)) {
      return fail(403, '来源不被允许', origin);
    }

    try {
      /* ---------- GitHub OAuth (server-side relay) ---------- */
      if (path === '/gh/login') {
        if (!env.GH_CLIENT_ID) return new Response('GitHub 登录尚未配置（缺少 GH_CLIENT_ID）', { status: 503 });
        const state = randHex(16);
        const redirect = env.SITE_ORIGIN + '/#/gh/callback';
        const auth = new URL('https://github.com/login/oauth/authorize');
        auth.searchParams.set('client_id', env.GH_CLIENT_ID);
        auth.searchParams.set('redirect_uri', env.SITE_ORIGIN + '/?gh=1'); // callback proxy below
        auth.searchParams.set('scope', 'read:user user:email');
        auth.searchParams.set('state', state);
        auth.searchParams.set('allow_signup', 'true');
        return new Response(null, {
          status: 302,
          headers: {
            'Location': auth.toString(),
            'Set-Cookie': `cl_oauth_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=None`
          }
        });
      }
      if (path === '/gh/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const saved = cookieValue(request, 'cl_oauth_state');
        if (!code || !state || !saved || state !== saved) return fail(400, '登录状态校验失败，请重试', origin);
        if (!env.GH_CLIENT_ID || !env.GH_CLIENT_SECRET) return fail(503, 'GitHub 登录尚未配置', origin);
        // exchange code -> token (server-side only; never exposed to browser)
        const tr = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            client_id: env.GH_CLIENT_ID, client_secret: env.GH_CLIENT_SECRET, code,
            redirect_uri: env.SITE_ORIGIN + '/?gh=1'
          })
        });
        const tok = await tr.json();
        if (!tok.access_token) return fail(401, 'GitHub 授权失败：' + (tok.error_description || tok.error || '未返回 token'), origin);
        const ghRes = await fetch('https://api.github.com/user', {
          headers: { 'Authorization': 'Bearer ' + tok.access_token, 'User-Agent': 'CrushLens', 'Accept': 'application/vnd.github+json' }
        });
        if (!ghRes.ok) return fail(401, '读取 GitHub 用户信息失败（' + ghRes.status + '）', origin);
        const g = await ghRes.json();
        const ghId = 'gh_' + g.id;
        // reuse by github id
        let acc = await env.DB.prepare('SELECT * FROM accounts WHERE github_id=?').bind(ghId).first();
        const now = Date.now();
        if (!acc) {
          const id = 'gh_' + randHex(12);
          await env.DB.prepare('INSERT INTO accounts(id,email,name,provider,github_id,avatar,created_at,last_login,login_count,partner_count) VALUES(?,?,?,?,?,?,?,?,?,0)')
            .bind(id, g.email || (g.login + '@users.noreply.github.com'), g.name || g.login, 'github', ghId, g.avatar_url, now, now, 1).run();
          acc = await env.DB.prepare('SELECT * FROM accounts WHERE id=?').bind(id).first();
        } else {
          await env.DB.prepare('UPDATE accounts SET last_login=?, login_count=login_count+1, name=?, avatar=? WHERE id=?')
            .bind(now, g.name || g.login, g.avatar_url, acc.id).run();
        }
        // Clear the oauth state cookie and set the session cookie together.
        const token = await issueSession(env, acc.id);
        return json({ ok: true, account: publicAccount(acc) }, 200, origin, {
          'Set-Cookie': [
            `cl_oauth_state=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`,
            sessionCookie(token, Math.floor(SESSION_TTL / 1000))
          ]
        });
      }

      /* ---------- email code ---------- */
      if (path === '/email/code' && request.method === 'POST') {
        const b = await body(request);
        const email = String(b.email || '').trim().toLowerCase();
        if (!validEmail(email)) return fail(400, '邮箱格式不对', origin);
        const ip = clientIp(request);
        const ipLimit = await rateHit(env, 'ip:' + ip, 30, 3600 * 1000);
        if (!ipLimit.ok) return fail(429, '请求太频繁，稍后再试（IP 限流）', origin);
        const one = await rateHit(env, 'code:1m:' + email, 1, 60 * 1000);
        if (!one.ok) return fail(429, '同一个邮箱每分钟只能发一次验证码', origin);
        const ten = await rateHit(env, 'code:10m:' + email, 5, 10 * 60 * 1000);
        if (!ten.ok) return fail(429, '这个邮箱 10 分钟内请求太多了', origin);
        // Email verification is only available when real mail delivery is
        // configured. Never hand the code back to the browser: the same code
        // authorizes /register AND /password/reset, so returning it would let
        // anyone reset another account's password (account takeover).
        if (!env.BREVO_KEY) {
          return fail(503, '邮件服务未配置，邮箱注册/找回暂不可用；请配置 BREVO_KEY 或改用 GitHub 登录', origin);
        }
        const code = random6Digit();
        const now = Date.now();
        await env.DB.prepare('INSERT INTO codes(email,code_hash,expires_at,tries,created_at) VALUES(?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, tries=0, created_at=excluded.created_at')
          .bind(email, await hmacHex(env.PEPPER, code + '|' + email), now + CODE_TTL, 0, now).run();
        await sendCodeMail(env, email, code);
        // Only a boolean ack — no code, no reason string with mail internals.
        return json({ ok: true, sent: true }, 200, origin);
      }

      /* ---------- salt (browser stretches password) ---------- */
      if (path === '/salt' && request.method === 'GET') {
        const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
        if (!validEmail(email)) return fail(400, '邮箱格式不对', origin);
        const acc = await env.DB.prepare('SELECT salt, provider FROM accounts WHERE email=?').bind(email).first();
        if (!acc) return json({ salt: randHex(16), exists: false, provider: null }, 200, origin);
        return json({ salt: acc.salt, exists: true, provider: acc.provider }, 200, origin);
      }

      /* ---------- register ---------- */
      if (path === '/register' && request.method === 'POST') {
        const b = await body(request);
        const email = String(b.email || '').trim().toLowerCase();
        const code = String(b.code || '').trim();
        const salt = String(b.salt || '');
        const stretched = String(b.stretched || '');
        if (!validEmail(email) || !/^[0-9a-f]{64}$/i.test(stretched) || !/^[0-9a-f]{32}$/i.test(salt)) {
          return fail(400, '参数不合法', origin);
        }
        const row = await env.DB.prepare('SELECT * FROM codes WHERE email=?').bind(email).first();
        if (!row || row.expires_at < Date.now()) return fail(400, '验证码已过期，重新发一个', origin);
        if (row.tries >= 5) return fail(429, '验证码错误次数太多，重新发一个', origin);
        if (!timingSafeEqual(row.code_hash, await hmacHex(env.PEPPER, code + '|' + email))) {
          await env.DB.prepare('UPDATE codes SET tries=tries+1 WHERE email=?').bind(email).run();
          return fail(400, '验证码不对', origin);
        }
        const exist = await env.DB.prepare('SELECT id FROM accounts WHERE email=?').bind(email).first();
        if (exist) return fail(409, '这个邮箱已经注册过了', origin);
        const passwordHash = await hmacHex(env.PEPPER, stretched + '|' + salt);
        const id = 'a_' + randHex(12);
        const now = Date.now();
        await env.DB.prepare('INSERT INTO accounts(id,email,name,password_hash,salt,provider,created_at,last_login,login_count,partner_count) VALUES(?,?,?,?,?,?,?,?,?,0)')
          .bind(id, email, email.split('@')[0], passwordHash, salt, 'password', now, now, 1).run();
        await env.DB.prepare('DELETE FROM codes WHERE email=?').bind(email).run();
        const acc = await env.DB.prepare('SELECT * FROM accounts WHERE id=?').bind(id).first();
        return await withSession(env, origin, id, { ok: true, account: publicAccount(acc) }, 200);
      }

      /* ---------- login ---------- */
      if (path === '/login' && request.method === 'POST') {
        const b = await body(request);
        const email = String(b.email || '').trim().toLowerCase();
        const stretched = String(b.stretched || '');
        if (!validEmail(email) || !/^[0-9a-f]{64}$/i.test(stretched)) return fail(400, '参数不合法', origin);
        // 5 failed logins -> 15-minute lock
        const lockKey = 'fail:' + email;
        const lk = await env.DB.prepare('SELECT count, window_start FROM rate WHERE bucket=?').bind(lockKey).first();
        if (lk && lk.count >= 5 && Date.now() - lk.window_start < 15 * 60 * 1000) {
          return fail(429, '密码错误次数太多，请 15 分钟后再试', origin);
        }
        const acc = await env.DB.prepare('SELECT * FROM accounts WHERE email=?').bind(email).first();
        if (!acc || acc.provider !== 'password') {
          if (acc && acc.provider === 'github') return fail(400, '这个账号是用 GitHub 登录的，请用 GitHub 按钮登录', origin);
          return fail(401, '邮箱或密码不对', origin);
        }
        const hash = await hmacHex(env.PEPPER, stretched + '|' + acc.salt);
        if (!timingSafeEqual(hash, acc.password_hash)) {
          if (!lk || Date.now() - lk.window_start >= 15 * 60 * 1000) {
            await env.DB.prepare('INSERT INTO rate(bucket,count,window_start) VALUES(?,?,?) ON CONFLICT(bucket) DO UPDATE SET count=excluded.count, window_start=excluded.window_start')
              .bind(lockKey, 1, Date.now()).run();
          } else {
            await env.DB.prepare('UPDATE rate SET count=count+1 WHERE bucket=?').bind(lockKey).run();
          }
          return fail(401, '邮箱或密码不对', origin);
        }
        await env.DB.prepare('UPDATE accounts SET last_login=?, login_count=login_count+1 WHERE id=?').bind(Date.now(), acc.id).run();
        await env.DB.prepare('DELETE FROM rate WHERE bucket=?').bind(lockKey).run();
        acc.login_count = (acc.login_count || 0) + 1;
        return await withSession(env, origin, acc.id, { ok: true, account: publicAccount(acc) }, 200);
      }

      /* ---------- password reset ---------- */
      if (path === '/password/reset' && request.method === 'POST') {
        const b = await body(request);
        const email = String(b.email || '').trim().toLowerCase();
        const code = String(b.code || '').trim();
        const salt = String(b.salt || '');
        const stretched = String(b.stretched || '');
        const row = await env.DB.prepare('SELECT * FROM codes WHERE email=?').bind(email).first();
        if (!row || row.expires_at < Date.now() || row.tries >= 5) return fail(400, '验证码无效或已过期', origin);
        if (!timingSafeEqual(row.code_hash, await hmacHex(env.PEPPER, code + '|' + email))) {
          await env.DB.prepare('UPDATE codes SET tries=tries+1 WHERE email=?').bind(email).run();
          return fail(400, '验证码不对', origin);
        }
        const acc = await env.DB.prepare('SELECT id, provider FROM accounts WHERE email=?').bind(email).first();
        if (!acc) return fail(404, '没有这个账号', origin);
        if (acc.provider === 'github') return fail(400, 'GitHub 账号无需重置密码', origin);
        const passwordHash = await hmacHex(env.PEPPER, stretched + '|' + salt);
        await env.DB.prepare('UPDATE accounts SET password_hash=?, salt=? WHERE id=?').bind(passwordHash, salt, acc.id).run();
        await env.DB.prepare('DELETE FROM codes WHERE email=?').bind(email).run();
        return json({ ok: true }, 200, origin);
      }

      /* ---------- logout ---------- */
      if (path === '/logout' && request.method === 'POST') {
        const token = cookieValue(request, COOKIE);
        if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256Hex(token)).run();
        const out = json({ ok: true }, 200, origin);
        out.headers.set('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`);
        return out;
      }

      /* ---------- me ---------- */
      if (path === '/me' && request.method === 'GET') {
        const id = await readSession(env, request);
        if (!id) return fail(401, '未登录', origin);
        const acc = await env.DB.prepare('SELECT * FROM accounts WHERE id=?').bind(id).first();
        if (!acc) return fail(401, '账号不存在', origin);
        return json({ account: publicAccount(acc) }, 200, origin);
      }

      /* ---------- admin: cloud accounts (owner only, metadata only) ---------- */
      if (path === '/admin/accounts' && request.method === 'GET') {
        const id = await readSession(env, request);
        if (!id) return fail(401, '未登录', origin);
        const me = await env.DB.prepare('SELECT email FROM accounts WHERE id=?').bind(id).first();
        if (!me || !env.OWNER_EMAIL || me.email !== env.OWNER_EMAIL.toLowerCase()) return fail(403, '仅总开发者可查看', origin);
        const rows = await env.DB.prepare('SELECT * FROM accounts ORDER BY created_at DESC LIMIT 500').all();
        return json({ accounts: (rows.results || []).map(publicAccount) }, 200, origin);
      }

      /* ---------- sync partner count (metadata only) ---------- */
      if (path === '/account/sync-counts' && request.method === 'POST') {
        const id = await readSession(env, request);
        if (!id) return fail(401, '未登录', origin);
        const b = await body(request);
        const n = Math.max(0, Math.min(1000000, Math.floor(Number(b.partner_count) || 0)));
        await env.DB.prepare('UPDATE accounts SET partner_count=? WHERE id=?').bind(n, id).run();
        return json({ ok: true, partner_count: n }, 200, origin);
      }

      return fail(404, 'Not found', origin);
    } catch (err) {
      // Never leak stack / secrets. Clear message, no white screen.
      return fail(500, '服务暂时不可用：' + (err && err.message ? err.message : '未知错误'), origin);
    }
  }
};

