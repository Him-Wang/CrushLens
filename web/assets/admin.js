/* ============================================================
 * CrushLens Cloud · 开发端监管台
 * 总开发者：永久权限 / 可查看全部使用记录与聊天内容
 * 被授权者：限时权限 / 可看统计与用户，不可调阅聊天内容
 * ============================================================ */
(function (root) {
  'use strict';
  const { $, $$, esc, icon, toast, modal, confirmDlg, donut, bars, avatar,
    empty, fmtDate, fmtDateFull, fmtDT, relTime, fmtNum, sideDrawer, cssVar, avatarPair,
    wireTheme, wireThemeSelects } = UI;
  const S = Store, E = CLEngine;

  // 权限门页面也要跟随主题（含系统深色的实时切换），门上的主题下拉在这里就接上
  if (window.CLTheme) { CLTheme.init(); wireThemeSelects(); }

  const state = { me: null, role: null, view: 'dash', owner: null, search: '', cloud: null, serverAdmin: false };

  const ACTIONS = {
    signup: ['注册账号', 'blue'], login: ['登录', 'gray'], logout: ['退出登录', 'gray'],
    import: ['导入聊天记录', 'rose'], partner_create: ['新建追踪对象', 'violet'],
    partner_delete: ['删除追踪对象', 'amber'], access_request: ['申请开发者权限', 'amber'],
    request_approve: ['通过权限申请', 'green'], request_reject: ['拒绝权限申请', 'gray'],
    grant_issue: ['发放授权', 'green'], grant_revoke: ['撤销授权', 'amber'],
    claim_owner: ['认领总开发者', 'rose'], seed_demo: ['载入示例数据', 'gray'],
    wipe_account: ['清空账号数据', 'amber']
  };

  boot();

  /* 云端身份：admin 由 Worker 判定（白名单），前端只读结果。
     返回 null 表示没配云端 / 没登录；否则 {account, admin}。 */
  async function cloudIdentity() {
    const Api = root.CLApi;
    if (!Api || !Api.configured()) return null;
    try {
      const r = await Api.me();
      return r && r.account ? { account: r.account, admin: !!r.admin } : null;
    } catch (e) { return null; }
  }

  async function boot() {
    state.owner = await S.ownerUid();
    const me = await S.current();

    // 1) 云端已登录：以服务端白名单为准，这是唯一可信的判定
    const cloud = await cloudIdentity();
    if (cloud) {
      state.cloud = cloud.account;
      if (cloud.admin) {
        // 白名单账号：把云端身份落到本地，并认领本机总开发者，
        // 这样离线时控制台也能用（本机角色与云端白名单互不冲突）
        const acc = await S.upsertCloudAccount(cloud.account);
        if (!(await S.ownerUid())) {
          try { await S.claimOwner(acc); } catch (e) { }
        }
        return await route(acc, true);
      }
      // 云端登录了但不在白名单：硬拒绝，不给申请入口
      return gateDenied(cloud.account);
    }

    // 2) 没连云端：退回本机模式（离线也能用，但只认本机 IndexedDB）
    if (!me) return gateLogin();
    await route(me);
  }

  /* 云端已登录但不在白名单——没有申请入口，只有退出。
     前端拦一层是体验，真正的门在 Worker 的 isAdminAccount()。 */
  function gateDenied(account) {
    const who = esc(account.name || account.email || '这个账号');
    showGate(`
      <h2>没有开发端权限</h2>
      <p>${who}，这个账号不在开发端白名单里。</p>
      <div class="perm-card" style="margin:22px 0">
        <div class="pi">${icon('shield', 18)}</div>
        <div>
          <div style="font-weight:600;font-size:13.5px">开发端只对指定账号开放</div>
          <div class="tiny muted">由服务端校验 GitHub 账号，无法自助申请</div>
        </div>
      </div>
      <button class="btn ghost block" id="deniedLogout">退出，回用户端</button>
    `);
    $('#deniedLogout').onclick = async () => {
      try { await (root.CLApi && root.CLApi.logout && root.CLApi.logout()); } catch (e) { }
      S.logout();
      location.href = 'index.html';
    };
  }

  async function route(me, serverAdmin) {
    state.me = me;
    state.serverAdmin = !!serverAdmin;
    const role = await S.roleOf(me);
    state.role = role;

    // 服务端白名单已是最高裁决：哪怕本机没认领过总开发者、也没有 grants，
    // 只要 Worker 说是 admin 就必须放行，否则 1102-seven 这类账号会被本机
    // 角色卡在「申请权限」页上，前后端判定不一致。
    if (serverAdmin) {
      state.role = { level: 'owner', permanent: true, expiresAt: null, viaServer: true };
      return enterConsole();
    }

    if (!state.owner) return gateSetup();
    if (role.level === 'owner') return enterConsole();
    if (role.level === 'dev') return enterConsole();
    if (role.level === 'pending') return gatePending();
    return gateNoPerm();
  }

  /* ================= 入口页 ================= */
  const THEME_ROW = `
      <div class="theme-row">
        <span>主题</span>
        <select data-theme-select aria-label="配色主题">
          <option value="system">跟随系统</option>
          <option value="rose">玫瑰</option>
          <option value="mist">雾蓝</option>
          <option value="matcha">抹茶</option>
          <option value="dusk">黄昏</option>
          <option value="night">夜间</option>
        </select>
      </div>`;

  function showGate(html) {
    $('#gate').hidden = false;
    $('#app').hidden = true;
    $('#gateCard').innerHTML = html + THEME_ROW;
    wireThemeSelects();
  }

  function gateLogin() {
    const Api = root.CLApi;
    const cloudOn = !!(Api && Api.configured());
    showGate(`
      <h2>开发端登录</h2>
      <p>这里只给开发者使用，普通用户请回用户端</p>

      ${cloudOn ? `
      <button class="btn gh block lg" id="gGhBtn" type="button" style="margin-top:22px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.6-4-1.6-.5-1.4-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 4.9 18 5.2 18 5.2c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z"/></svg>
        使用 GitHub 登录
      </button>
      <div class="auth-or"><span>或用邮箱</span></div>` : ''}

      <form id="gForm" ${cloudOn ? '' : 'style="margin-top:22px"'}>
        <div class="field"><label>邮箱</label>
          <input class="input" id="gEmail" type="email" placeholder="you@example.com" required></div>
        <div class="field"><label>密码</label>
          <input class="input" id="gPass" type="password" placeholder="••••••" required></div>
        <div class="err-line" id="gErr"></div>
        <button class="btn primary block lg" type="submit">登录</button>
      </form>

      <div class="auth-note">
        ${cloudOn
          ? '<b>开发端只对指定账号开放。</b>用白名单里的 GitHub 账号登录即可进入；其他账号会被服务端拒绝，无法自助申请。'
          : '<b>还没有账号？</b>先到 <a href="index.html" class="link">用户端</a> 注册，再回来登录。第一个登录并认领的账号将成为<b>总开发者</b>。'}
      </div>
      <a class="small muted" href="index.html" style="display:block;margin-top:16px;text-decoration:underline">← 返回用户端</a>
    `);
    const ghBtn = $('#gGhBtn');
    if (ghBtn) ghBtn.onclick = () => {
      try {
        sessionStorage.setItem('cl_want_admin', '1');
        Api.githubLogin('admin');
      } catch (e) { $('#gErr').textContent = e.message; }
    };
    $('#gForm').onsubmit = async (e) => {
      e.preventDefault();
      $('#gErr').textContent = '';
      try {
        const acc = await S.login($('#gEmail').value, $('#gPass').value);
        await boot();
      } catch (err) { $('#gErr').textContent = err.message; }
    };
  }

  function gateSetup() {
    showGate(`
      <h2>初始化总开发者</h2>
      <p>这个应用还没有总开发者。第一个认领的账号会成为<b>这台设备上的</b>总开发者，之后不能转让。</p>
      <div class="bridge-warn" style="margin:16px 0 4px">
        ${icon('alert', 14)} 说明：当前版本没有服务端，监管台只能看到<b>同一个浏览器</b>里注册过的账号。
        换一台设备、换一个浏览器就是另一份独立数据。
      </div>
      <div class="perm-card big" style="margin:22px 0">
        <div class="pi">${icon('shield', 18)}</div>
        <div>
          <div style="font-weight:600;font-size:13.5px">${esc(state.me.name)} · ${esc(state.me.email)}</div>
          <div class="tiny muted">将以此账号作为总开发者</div>
        </div>
      </div>
      <button class="btn primary block lg" id="claimBtn">成为总开发者</button>
      <div class="auth-note" style="margin-top:16px">
        总开发者可以：查看全部使用记录、调到聊天内容、发放与撤销开发者权限、查看完整审计日志。
      </div>
    `);
    $('#claimBtn').onclick = async () => {
      try {
        await S.claimOwner(state.me);
        state.owner = state.me.id;
        toast('已初始化，你是总开发者');
        await boot();
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  function gateNoPerm() {
    showGate(`
      <h2>没有开发端权限</h2>
      <p>${esc(state.me.name)}，你的账号当前是普通用户。开发端权限需要向总开发者申请，通过后按时长生效。</p>
      <div class="field" style="margin-top:20px">
        <label>申请理由</label>
        <textarea class="textarea" id="reqReason" placeholder="例如：需要排查用户反馈的导入格式问题"></textarea>
      </div>
      <button class="btn primary block lg" id="reqBtn">提交申请</button>
      <div class="auth-note" style="margin-top:14px">
        只有总开发者能审批。授权到期后会自动失效，需要再次申请。
      </div>
      <a class="small muted" href="index.html" style="display:block;margin-top:16px;text-decoration:underline">← 返回用户端</a>
    `);
    $('#reqBtn').onclick = async () => {
      const reason = $('#reqReason').value.trim();
      if (reason.length < 4) { toast('写几个字说明用途吧', 'warn'); return; }
      await S.requestAccess(state.me, reason);
      toast('申请已提交');
      await route(state.me);
    };
  }

  function gatePending() {
    showGate(`
      <h2>申请审核中</h2>
      <p>${esc(state.me.name)}，你的开发端权限申请已经提交，等待总开发者处理。</p>
      <div class="perm-card" style="margin:22px 0">
        <div class="pi">${icon('clock', 18)}</div>
        <div>
          <div style="font-weight:600;font-size:13.5px">状态：待审批</div>
          <div class="tiny muted">批准后你会收到提示，届时刷新此页即可进入</div>
        </div>
      </div>
      <button class="btn ghost block" id="recheck">刷新状态</button>
      <a class="small muted" href="index.html" style="display:block;margin-top:16px;text-decoration:underline">← 返回用户端</a>
    `);
    $('#recheck').onclick = () => boot();
  }

  /* ================= 控制台 ================= */
  const NAV = [
    { id: 'dash', label: '总览', icon: 'dash' },
    { id: 'users', label: '用户与记录', icon: 'users' },
    { id: 'usage', label: '使用分析', icon: 'chart' },
    { id: 'perms', label: '权限管理', icon: 'shield' },
    { id: 'audit', label: '审计日志', icon: 'report' },
    { id: 'cloud', label: '云端账号', icon: 'users' }
  ];

  function enterConsole() {
    $('#gate').hidden = true;
    $('#app').hidden = false;
    $('#meName').textContent = state.me.name;
    $('#meAvatar').textContent = String(state.me.name || '?').slice(0, 1);
    const [meBg, meFg] = avatarPair(S.pickColor(state.me.name));
    $('#meAvatar').style.background = meBg;
    $('#meAvatar').style.color = meFg;
    $('#meRole').textContent = state.serverAdmin
      ? '白名单开发者 · 服务端校验'
      : (state.role.level === 'owner' ? '总开发者 · 本机唯一' : '授权开发者');
    $('#logoutBtn').onclick = async () => {
      if (!(await confirmDlg({ title: '退出开发端', text: '只是退出登录，不会删除任何数据。', okText: '退出' }))) return;
      S.logout(); location.reload();
    };
    sideDrawer({ side: '#side', toggle: '#sideToggle' });
    wireTheme(() => {
      const [bg, fg] = avatarPair(S.pickColor(state.me.name));
      $('#meAvatar').style.background = bg;
      $('#meAvatar').style.color = fg;
      renderNav();
      if (state.view) goto(state.view, { quiet: true });
    });
    S.log(state.me.id, 'console_open', '', { role: state.role.level });
    renderNav();
    goto('dash');
  }

  function renderNav() {
    const items = NAV.filter((n) => n.id !== 'perms' || state.role.level === 'owner' || state.role.level === 'dev');
    $('#nav').innerHTML = items.map((n) => `
      <button class="nav-item ${state.view === n.id ? 'active' : ''}" data-nav="${n.id}">
        ${icon(n.icon, 17)}<span>${n.label}</span>
      </button>`).join('');
    $$('[data-nav]').forEach((b) => b.onclick = () => goto(b.dataset.nav));

    const ownerTag = state.serverAdmin
      ? `<span class="badge rose" style="margin-left:auto">白名单</span>`
      : (state.role.level === 'owner'
        ? `<span class="badge rose" style="margin-left:auto">总开发者</span>`
        : `<span class="badge amber" style="margin-left:auto">限时</span>`);
    $('#quick').innerHTML = `
      <div class="pitem" style="cursor:default">
        ${avatar(state.me.name, S.pickColor(state.me.name), 30)}
        <div class="pitem-body"><div class="pitem-name">${esc(state.me.name)}</div>
        <div class="pitem-sub">${state.serverAdmin
          ? '服务端白名单'
          : (state.role.expiresAt ? '到期 ' + fmtDT(state.role.expiresAt) : '长期有效')}</div></div>
        ${ownerTag}
      </div>`;
  }

  /* quiet: 换主题时不闪「加载中」、不回滚滚动位置 */
  async function goto(view, opts) {
    const quiet = !!(opts && opts.quiet);
    state.view = view;
    renderNav();
    if (!quiet) $('#main').innerHTML = `<div class="card pad center muted small" style="padding:60px">加载中…</div>`;
    if (view === 'dash') await viewDash();
    else if (view === 'users') await viewUsers();
    else if (view === 'usage') await viewUsage();
    else if (view === 'perms') await viewPerms();
    else if (view === 'audit') await viewAudit();
    else if (view === 'cloud') await viewCloudAccounts();
    if (!quiet) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function head(title, sub, actions) {
    return `<div class="page-head"><div><h1>${title}</h1><p>${sub || ''}</p></div>
      <div class="spacer"></div><div class="row">${actions || ''}</div></div>`;
  }

  function banner() {
    // 数据范围必须写清楚：没有服务端时，"监管所有用户"只在同一浏览器内成立
    const scope = `<div class="mask-hint" style="margin-bottom:12px">${icon('alert', 13)}
      <span>数据源：当前浏览器的本地数据库（IndexedDB）。这里只统计<b>在本机这个浏览器里</b>注册过的账号，
      不含其他设备上的用户。</span></div>`;
    if (state.serverAdmin) {
      // 白名单账号：权限来自 Worker，不依赖本机是否认领过总开发者
      return scope + `<div class="perm-banner owner"><span class="pi">${icon('shield', 15)}</span>
        <div><b>白名单开发者（服务端校验）。</b> 你的 GitHub 账号在开发端白名单里，权限由服务端判定，换浏览器同样有效。</div></div>`;
    }
    if (state.role.level === 'owner') {
      return scope + `<div class="perm-banner owner"><span class="pi">${icon('shield', 15)}</span>
        <div><b>总开发者（本机唯一）。</b> 可查看本机的使用记录与聊天内容，可发放/撤销他人权限。</div></div>`;
    }
    const left = state.role.expiresAt ? Math.max(0, state.role.expiresAt - Date.now()) : 0;
    const hrs = Math.floor(left / 3600000), mins = Math.floor((left % 3600000) / 60000);
    return scope + `<div class="perm-banner"><span class="pi">${icon('clock', 15)}</span>
      <div><b>限时权限，剩余 ${hrs} 小时 ${mins} 分。</b> 到期自动失效，需再次向总开发者申请。聊天内容调阅仅对总开发者开放。</div></div>`;
  }

  /* ---------------- 总览 ---------------- */
  async function viewDash() {
    const o = await S.adminOverview();
    const rows = await S.adminUserRows();
    const recent = (await S.raw.getAll('audit')).sort((a, b) => b.at - a.at).slice(0, 14);

    const html = `
      ${head('总览', `所有用户的使用情况 · 更新于 ${fmtDT(Date.now())}`, `<button class="btn ghost sm" id="refresh">${icon('refresh', 14)} 刷新</button>`)}
      ${banner()}

      <div class="grid g4 mb16">
        <div class="card kpi"><div class="kpi-lab">${icon('users', 13)} 注册用户</div>
          <div class="kpi-val">${o.users}<small>人</small></div>
          <div class="kpi-foot"><span class="muted tiny">其中开发者 ${o.developers} 人</span></div></div>
        <div class="card kpi"><div class="kpi-lab">${icon('folder', 13)} 追踪对象</div>
          <div class="kpi-val">${o.partnerCount}<small>个</small></div>
          <div class="kpi-foot"><span class="muted tiny">平均每人 ${(o.partnerCount / Math.max(1, o.users)).toFixed(1)} 个</span></div></div>
        <div class="card kpi"><div class="kpi-lab">${icon('import', 13)} 累计消息</div>
          <div class="kpi-val">${fmtNum(o.messageCount)}<small>条</small></div>
          <div class="kpi-foot"><span class="muted tiny">共 ${o.batchCount} 次导入</span></div></div>
        <div class="card kpi"><div class="kpi-lab">${icon('report', 13)} 生成报告</div>
          <div class="kpi-val">${o.reports}<small>份</small></div>
          <div class="kpi-foot"><span class="muted tiny">每次导入自动生成</span></div></div>
      </div>

      <div class="grid g-2-1 mb16">
        <div class="card">
          <div class="card-head"><div><h3>近 14 天活跃</h3><div class="sub">橙色为导入次数，下方为新增消息量</div></div></div>
          <div class="card-body">
            ${bars(o.days.map((d) => ({ label: d.date.slice(5), value: d.imports })), { height: 130 })}
            <div class="mt12" style="opacity:.55">
              ${bars(o.days.map((d) => ({ label: d.date.slice(5), value: d.messages, color: cssVar('--acc-a', '#a5b4fc') })), { height: 90, showLabels: false })}
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>来源平台</h3><div class="sub">用户导入了哪些平台的记录</div></div></div>
          <div class="card-body">
            ${donut(Object.fromEntries(Object.entries(o.platform).map(([k, v]) => [(E.PLATFORM_META[k] || {}).label || k, v])), { label: '追踪对象' })}
          </div>
        </div>
      </div>

      <div class="grid g2">
        <div class="card">
          <div class="card-head"><div><h3>最近活动</h3></div>
            <div class="spacer"></div><span class="link" data-nav2="audit">全部日志 →</span></div>
          <div class="card-body">
            <div class="timeline">
              ${recent.map((a) => {
      const u = rows.find((r) => r.id === a.uid);
      const [label, tone] = ACTIONS[a.action] || [a.action, 'gray'];
      return `<div class="tl-item"><div class="tl-time">${fmtDT(a.at)} · ${esc(u ? u.name : '系统')}</div>
        <div class="tl-txt"><span class="badge ${tone === 'gray' ? 'gray' : tone}" style="margin-right:6px">${esc(label)}</span>
        ${esc(a.target || '')}</div></div>`;
    }).join('') || '<p class="muted small">暂无</p>'}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>用户排行</h3><div class="sub">按消息量</div></div></div>
          <div class="card-body">
            ${rows.slice().sort((a, b) => b.msgCount - a.msgCount).slice(0, 6).map((u) => `
              <div class="row between" style="padding:9px 0;border-bottom:1px solid var(--line-2)">
                <div class="row">${avatar(u.name, S.pickColor(u.name), 30)}
                  <div><div style="font-size:13px;font-weight:560">${esc(u.name)}</div>
                    <div class="tiny muted">${esc(u.role)}</div></div></div>
                <div class="num" style="font-weight:650">${fmtNum(u.msgCount)}</div>
              </div>`).join('')}
          </div>
        </div>
      </div>
    `;
    $('#main').innerHTML = html;
    $('#refresh').onclick = () => goto('dash');
    $$('[data-nav2]').forEach((b) => b.onclick = () => goto(b.dataset.nav2));
  }

  /* ---------------- 用户与记录 ---------------- */
  async function viewUsers() {
    const rows = await S.adminUserRows();
    const kw = state.search.toLowerCase();
    const list = rows.filter((u) => !kw || (u.name + u.email).toLowerCase().includes(kw));

    const html = `
      ${head('用户与记录', `共 ${rows.length} 个账号`, `
        <div class="row" style="position:relative">
          ${icon('search', 14)}
          <input class="input" id="searchInput" placeholder="搜索昵称或邮箱" value="${esc(state.search)}"
            style="height:34px;width:210px;padding-left:30px">
        </div>`)}
      ${banner()}
      <div class="card">
        <div class="table-wrap">
          <table class="tb">
            <thead><tr>
              <th>用户</th><th>角色</th><th>追踪对象</th><th>消息数</th><th>导入次数</th><th>最近活跃</th><th></th>
            </tr></thead>
            <tbody>
              ${list.map((u) => `<tr data-uid="${u.id}" style="cursor:pointer">
                <td><div class="cell-main">${avatar(u.name, S.pickColor(u.name), 32)}
                  <div><div class="n">${esc(u.name)}</div><div class="s">${esc(u.email)}</div></div></div></td>
                <td><span class="badge ${u.role === '总开发者' ? 'rose' : u.role === '授权开发者' ? 'amber' : 'gray'}">${esc(u.role)}</span></td>
                <td class="num">${u.partnerCount}</td>
                <td class="num">${fmtNum(u.msgCount)}</td>
                <td class="num">${u.batchCount}</td>
                <td class="small muted">${u.lastActive ? relTime(u.lastActive) : '—'}</td>
                <td class="right">${icon('eye', 15)}</td>
              </tr>`).join('') || `<tr><td colspan="7"><div class="empty"><p>没有匹配的用户</p></div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
    $('#main').innerHTML = html;
    const si = $('#searchInput');
    if (si) {
      si.oninput = () => { state.search = si.value; };
      si.onkeydown = (e) => { if (e.key === 'Enter') viewUsers(); };
    }
    $$('[data-uid]').forEach((tr) => tr.onclick = () => openUser(+tr.dataset.uid));
  }

  async function openUser(uid) {
    const rows = await S.adminUserRows();
    const u = rows.find((x) => x.id === uid);
    const partners = (await S.raw.getAll('partners', 'uid', uid)).sort((a, b) => (b.lastImportAt || 0) - (a.lastImportAt || 0));
    const allBatches = (await S.raw.getAll('batches', 'uid', uid)).sort((a, b) => b.createdAt - a.createdAt);
    const audits = (await S.raw.getAll('audit', 'uid', uid)).sort((a, b) => b.at - a.at).slice(0, 20);
    const isOwner = state.role.level === 'owner';

    const body = `
      <div class="row between mb16">
        <div class="row">
          ${avatar(u.name, S.pickColor(u.name), 46)}
          <div>
            <div style="font-size:16px;font-weight:650">${esc(u.name)}</div>
            <div class="tiny muted">${esc(u.email)} · 注册于 ${fmtDateFull(u.createdAt)}</div>
          </div>
        </div>
        <span class="badge ${u.role === '总开发者' ? 'rose' : u.role === '授权开发者' ? 'amber' : 'gray'}">${esc(u.role)}</span>
      </div>

      <div class="grid g4" style="gap:10px;margin-bottom:18px">
        <div class="card pad" style="padding:13px"><div class="tiny muted">追踪对象</div><div style="font-size:19px;font-weight:700">${u.partnerCount}</div></div>
        <div class="card pad" style="padding:13px"><div class="tiny muted">消息总数</div><div style="font-size:19px;font-weight:700">${fmtNum(u.msgCount)}</div></div>
        <div class="card pad" style="padding:13px"><div class="tiny muted">导入次数</div><div style="font-size:19px;font-weight:700">${u.batchCount}</div></div>
        <div class="card pad" style="padding:13px"><div class="tiny muted">登录次数</div><div style="font-size:19px;font-weight:700">${u.loginCount || 0}</div></div>
      </div>

      <strong style="font-size:12.5px">追踪对象</strong>
      <div class="card mt8 mb16">
        <div class="table-wrap"><table class="tb">
          <thead><tr><th>对象</th><th>平台</th><th>消息</th><th>最近导入</th><th>内容</th></tr></thead>
          <tbody>${partners.map((p) => `<tr>
            <td><div class="cell-main"><span class="avatar" style="width:28px;height:28px;font-size:11px;background:${avatarPair(p.color)[0]};color:${avatarPair(p.color)[1]}">${esc(p.name.slice(0, 1))}</span>
              <span class="n">${esc(p.name)}</span></div></td>
            <td><span class="badge gray">${esc((E.PLATFORM_META[p.platform] || {}).label || p.platform)}</span></td>
            <td class="num">${fmtNum(p.msgCount || 0)}</td>
            <td class="small muted">${p.lastImportAt ? relTime(p.lastImportAt) : '—'}</td>
            <td>${isOwner
        ? `<span class="link" data-chat="${p.id}">查看</span>`
        : `<span class="tiny muted">仅总开发者</span>`}</td>
          </tr>`).join('') || `<tr><td colspan="5"><p class="muted small" style="padding:10px">还没有追踪对象</p></td></tr>`}</tbody>
        </table></div>
      </div>

      <strong style="font-size:12.5px">导入来源明细</strong>
      <div class="card mt8 mb16">
        <div class="table-wrap"><table class="tb">
          <thead><tr><th>时间</th><th>来源</th><th>文件 / 方式</th><th>新增</th><th>跳过</th></tr></thead>
          <tbody>${allBatches.slice(0, 12).map((b) => `<tr>
            <td class="small">${fmtDT(b.createdAt)}</td>
            <td><span class="badge gray">${esc((E.PLATFORM_META[b.source] || {}).label || b.source)}</span></td>
            <td class="small muted">${esc(b.fileName || '粘贴')}</td>
            <td class="num">+${b.added}</td><td class="num muted">${b.skipped}</td>
          </tr>`).join('') || `<tr><td colspan="5"><p class="muted small" style="padding:10px">没有导入记录</p></td></tr>`}</tbody>
        </table></div>
      </div>

      <strong style="font-size:12.5px">该用户的操作轨迹</strong>
      <div class="timeline mt12">
        ${audits.map((a) => {
      const [label, tone] = ACTIONS[a.action] || [a.action, 'gray'];
      return `<div class="tl-item"><div class="tl-time">${fmtDT(a.at)}</div>
        <div class="tl-txt"><span class="badge ${tone === 'gray' ? 'gray' : tone}" style="margin-right:6px">${esc(label)}</span>${esc(a.target || '')}</div></div>`;
    }).join('') || '<p class="muted small">暂无</p>'}
      </div>
    `;

    const m = modal({ wide: true, title: '用户档案', sub: '监管视图 · 本次查看已记录审计', html: body, footer: `<button class="btn ghost" data-close>关闭</button>` });
    m.el.querySelectorAll('[data-chat]').forEach((b) => b.onclick = () => openChat(+b.dataset.chat, partners.find((p) => p.id === +b.dataset.chat)));
  }

  async function openChat(pid, partner) {
    const rows = await S.messagesOf(pid);
    let lastDay = '';
    const items = rows.slice(-300).map((m) => {
      const d = E.dayKey(new Date(m.ts));
      const sep = d !== lastDay ? `<div class="chat-day">${d}</div>` : '';
      lastDay = d;
      const me = m.speaker === (partner && partner.meSpeaker);
      return `${sep}<div class="msg-row ${me ? 'me' : ''}">
        ${avatar(m.speaker, S.pickColor(m.speaker), 26)}
        <div><div class="msg-bub">${esc(m.text.slice(0, 400))}</div>
        <div class="msg-meta">${esc(m.speaker)} · ${fmtDT(m.ts)}</div></div>
      </div>`;
    }).join('');

    await S.log(state.me.id, 'chat_view', partner ? partner.name : ('pid:' + pid), { pid, count: rows.length });

    modal({
      wide: true,
      title: `聊天记录 · ${partner ? partner.name : ''}`,
      sub: `共 ${rows.length} 条，显示最近 300 条 · 本次调阅已写入审计日志`,
      html: `<div class="mask-hint mb12">${icon('alert', 14)} 聊天内容属于用户隐私，仅用于合规核查。请勿外传或另作他用。</div>
             <div class="chat-view">${items || '<p class="muted small">没有消息</p>'}</div>`,
      footer: `<button class="btn ghost" data-close>关闭</button>`
    });
  }

  /* ---------------- 使用分析 ---------------- */
  async function viewUsage() {
    const o = await S.adminOverview();
    const rows = await S.adminUserRows();
    const batches = (await S.raw.getAll('batches')).sort((a, b) => b.createdAt - a.createdAt);
    const src = {};
    batches.forEach((b) => { const k = (E.PLATFORM_META[b.source] || {}).label || b.source; src[k] = (src[k] || 0) + 1; });
    const avgPerUser = rows.map((u) => ({ label: u.name, value: u.msgCount }));
    const hourBuckets = new Array(12).fill(0);
    (await S.raw.getAll('batches')).forEach((b) => { hourBuckets[Math.floor(new Date(b.createdAt).getHours() / 2)]++; });

    const html = `
      ${head('使用分析', '从使用侧看产品：谁在用、怎么用、用得多不多')}
      ${banner()}
      <div class="grid g3 mb16">
        <div class="card"><div class="card-head"><div><h3>导入方式分布</h3><div class="sub">按平台/文件类型</div></div></div>
          <div class="card-body">${donut(src, { label: '导入次数' })}</div></div>
        <div class="card"><div class="card-head"><div><h3>人均消息量</h3><div class="sub">Top 8</div></div></div>
          <div class="card-body">${bars(avgPerUser.sort((a, b) => b.value - a.value).slice(0, 8), { height: 150 })}</div></div>
        <div class="card"><div class="card-head"><div><h3>导入时段分布</h3><div class="sub">每 2 小时聚合</div></div></div>
          <div class="card-body">${bars(hourBuckets.map((v, i) => ({ label: (i * 2) + '点', value: v, color: cssVar('--acc-a', '#818cf8') })), { height: 150 })}</div></div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>导入明细</h3><div class="sub">全部用户的导入流水，共 ${batches.length} 条</div></div></div>
        <div class="card-body table-wrap">
          <table class="tb">
            <thead><tr><th>时间</th><th>用户</th><th>对象</th><th>来源</th><th>新增</th><th>跳过</th></tr></thead>
            <tbody>${batches.slice(0, 40).map((b) => {
      const u = rows.find((x) => x.id === b.uid);
      return `<tr>
                <td class="small">${fmtDT(b.createdAt)}</td>
                <td class="small">${esc(u ? u.name : '—')}</td>
                <td class="small">${esc(b.pid)}</td>
                <td><span class="badge gray">${esc((E.PLATFORM_META[b.source] || {}).label || b.source)}</span>
                  ${b.fileName ? `<span class="tiny muted"> ${esc(b.fileName)}</span>` : ''}</td>
                <td class="num">+${b.added}</td><td class="num muted">${b.skipped}</td>
              </tr>`;
    }).join('') || '<tr><td colspan="6"><p class="muted small">还没有导入</p></td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;
    $('#main').innerHTML = html;
  }

  /* ---------------- 权限管理 ---------------- */
  async function viewPerms() {
    const isOwner = state.role.level === 'owner';
    const grants = (await S.raw.getAll('grants')).sort((a, b) => b.grantedAt - a.grantedAt);
    const reqs = (await S.raw.getAll('requests')).sort((a, b) => b.requestedAt - a.requestedAt);
    const pending = reqs.filter((r) => r.status === 'pending');
    const accounts = await S.raw.getAll('accounts');
    const nameOf = (uid) => (accounts.find((a) => a.id === uid) || {}).name || '—';

    const html = `
      ${head('权限管理', isOwner ? '你是总开发者，可以发放与撤销开发端权限' : '你的授权状态')}
      ${banner()}

      ${isOwner ? `
      <div class="grid g-1-2 mb16">
        <div class="card pad">
          <h3 style="font-size:14px;margin-bottom:4px">发放授权</h3>
          <p class="tiny muted mb12">对方必须先在用户端注册过账号</p>
          <div class="field"><label>对方邮箱</label><input class="input" id="gEmail2" placeholder="user@example.com"></div>
          <div class="field"><label>有效时长</label>
            <select class="select" id="gHours">
              <option value="1">1 小时</option>
              <option value="6">6 小时</option>
              <option value="24" selected>24 小时</option>
              <option value="72">3 天</option>
              <option value="168">7 天</option>
            </select>
          </div>
          <div class="field"><label>备注</label><input class="input" id="gNote" placeholder="例如：协助排查导入 bug"></div>
          <button class="btn primary block" id="grantBtn">发放</button>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>待审批申请</h3><div class="sub">${pending.length} 条待处理</div></div></div>
          <div class="card-body">
            ${pending.length ? pending.map((r) => `<div class="perm-card mb12">
              <div class="pi">${icon('key', 16)}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:13px">${esc(r.name)} · ${esc(r.email)}</div>
                <div class="tiny muted">${fmtDT(r.requestedAt)}</div>
                <div class="small mt8" style="color:var(--ink-2)">「${esc(r.reason || '未填写理由')}」</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:6px">
                <button class="btn soft sm" data-approve="${r.id}">通过 24h</button>
                <button class="btn ghost sm" data-reject="${r.id}">拒绝</button>
              </div>
            </div>`).join('') : `<p class="muted small">暂无待审申请</p>`}
          </div>
        </div>
      </div>` : ''}

      <div class="card">
        <div class="card-head"><div><h3>当前授权</h3><div class="sub">总开发者为永久，其他按到期时间自动失效</div></div></div>
        <div class="card-body table-wrap">
          <table class="tb">
            <thead><tr><th>账号</th><th>级别</th><th>状态</th><th>到期时间</th><th>备注</th><th></th></tr></thead>
            <tbody>
              ${grants.map((g) => {
      const expired = g.expiresAt && g.expiresAt < Date.now();
      const st = g.status === 'revoked' ? '已撤销' : expired ? '已过期' : '生效中';
      const tone = g.status === 'revoked' ? 'gray' : expired ? 'gray' : 'green';
      return `<tr>
                  <td><div class="cell-main">${avatar(g.name || '?', S.pickColor(g.name || '?'), 28)}
                    <div><div class="n">${esc(g.name || nameOf(g.uid))}</div><div class="s">${esc(g.email || '')}</div></div></div></td>
                  <td><span class="badge ${g.level === 'owner' ? 'rose' : 'amber'}">${g.level === 'owner' ? '总开发者' : '授权开发者'}</span></td>
                  <td><span class="badge ${tone}">${st}</span></td>
                  <td class="small muted">${g.expiresAt ? fmtDT(g.expiresAt) : '永久有效'}</td>
                  <td class="small muted">${esc(g.note || '')}</td>
                  <td class="right">${isOwner && g.level !== 'owner' && st === '生效中'
          ? `<button class="btn ghost sm" data-revoke="${g.id}">撤销</button>` : ''}</td>
                </tr>`;
    }).join('') || '<tr><td colspan="6"><p class="muted small">还没有任何授权</p></td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      ${!isOwner ? `<div class="card pad mt16">
        <div class="row between">
          <div><strong style="font-size:13px">需要延长权限？</strong>
            <p class="tiny muted mt8">被分享的权限到期后自动失效，必须重新向总开发者申请。</p></div>
          <button class="btn primary sm" id="renewBtn">申请续期</button>
        </div>
      </div>` : ''}
    `;
    $('#main').innerHTML = html;

    if (isOwner) {
      $('#grantBtn').onclick = async () => {
        const email = $('#gEmail2').value.trim();
        const hours = +$('#gHours').value;
        if (!email) { toast('填对方邮箱', 'warn'); return; }
        try {
          await S.issueGrant(state.me, email, hours, $('#gNote').value.trim());
          toast('授权已发放');
          viewPerms();
        } catch (err) { toast(err.message, 'error'); }
      };
      $$('[data-approve]').forEach((b) => b.onclick = async () => {
        await S.decideRequest(state.me, +b.dataset.approve, true, 24);
        toast('已通过，授权 24 小时');
        viewPerms();
      });
      $$('[data-reject]').forEach((b) => b.onclick = async () => {
        await S.decideRequest(state.me, +b.dataset.reject, false);
        toast('已拒绝');
        viewPerms();
      });
      $$('[data-revoke]').forEach((b) => b.onclick = async () => {
        if (!(await confirmDlg({ title: '撤销授权', text: '对方会立刻失去开发端访问权限。', danger: true, okText: '撤销' }))) return;
        await S.revokeGrant(state.me, +b.dataset.revoke);
        toast('已撤销');
        viewPerms();
      });
    } else {
      const rn = $('#renewBtn');
      if (rn) rn.onclick = async () => {
        await S.requestAccess(state.me, '申请续期开发端权限');
        toast('续期申请已提交');
        viewPerms();
      };
    }
  }

  /* ---------------- 审计日志 ---------------- */
  async function viewAudit() {
    const logs = (await S.raw.getAll('audit')).sort((a, b) => b.at - a.at);
    const accounts = await S.raw.getAll('accounts');
    const nameOf = (uid) => (accounts.find((a) => a.id === uid) || {}).name || '系统';

    const html = `
      ${head('审计日志', `共 ${logs.length} 条记录，包含登录、导入、权限变更与内容调阅`)}
      ${banner()}
      <div class="card">
        <div class="table-wrap">
          <table class="tb">
            <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象 / 详情</th></tr></thead>
            <tbody>
              ${logs.slice(0, 200).map((a) => {
      const [label, tone] = ACTIONS[a.action] || [a.action, 'gray'];
      const detail = a.meta && Object.keys(a.meta).length
        ? Object.entries(a.meta).filter(([k]) => k !== 'pid').map(([k, v]) => `${k}: ${v}`).join(' · ')
        : '';
      return `<tr>
                  <td class="small muted" style="white-space:nowrap">${fmtDT(a.at)}</td>
                  <td class="small">${esc(nameOf(a.uid))}</td>
                  <td><span class="badge ${tone === 'gray' ? 'gray' : tone}">${esc(label)}</span></td>
                  <td class="small muted">${esc(a.target || '')}${detail ? `<div class="audit-meta">${esc(detail)}</div>` : ''}</td>
                </tr>`;
    }).join('') || '<tr><td colspan="4"><p class="muted small">暂无日志</p></td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      <p class="tiny muted mt12">日志只增不改，用于合规追溯。当前最多展示最近 200 条。</p>
    `;
    $('#main').innerHTML = html;
  }

  /* ================= 云端账号（T8：仅元数据，零聊天内容） ================= */
  async function viewCloudAccounts() {
    const Api = root.CLApi;
    const headHtml = `<div class="page-head"><div><h1>云端账号</h1>
      <p>来自云端 Worker 的账号元数据：邮箱、昵称、登录次数、追踪对象计数。不含任何聊天内容。</p></div>
      <div class="spacer"></div><div class="row"><button class="btn ghost sm" id="caRefresh">${icon('refresh', 14)} 刷新</button></div></div>`;
    if (!Api || !Api.configured()) {
      $('#main').innerHTML = headHtml + `<div class="card">${empty('alert', '还没配置云端接口地址', '请在用户端「设置 → 云端账号」填入 Worker 地址后刷新。', '')}</div>`;
      return;
    }
    $('#main').innerHTML = headHtml + `<div class="card pad center muted small" style="padding:48px">正在读取云端账号…</div>`;
    try {
      const r = await Api.adminAccounts();
      const rows = r.accounts || [];
      $('#main').innerHTML = headHtml + `
        <div class="grid g4 mb16">
          <div class="card kpi"><div class="kpi-lab">云端账号</div><div class="kpi-val">${rows.length}</div></div>
          <div class="card kpi"><div class="kpi-lab">GitHub 登录</div><div class="kpi-val">${rows.filter((a) => a.provider === 'github').length}</div></div>
          <div class="card kpi"><div class="kpi-lab">邮箱注册</div><div class="kpi-val">${rows.filter((a) => a.provider === 'password').length}</div></div>
          <div class="card kpi"><div class="kpi-lab">追踪对象合计</div><div class="kpi-val">${rows.reduce((s, a) => s + (a.partner_count || 0), 0)}</div></div>
        </div>
        <div class="card"><div class="card-head"><div><h3>账号列表</h3><div class="sub">仅元数据 · 聊天内容仍在本机</div></div></div>
          <div class="card-body table-wrap">
          ${rows.length ? `<table class="tb"><thead><tr><th>邮箱</th><th>昵称</th><th>来源</th><th>创建</th><th>最近登录</th><th>登录次数</th><th>追踪对象</th></tr></thead>
            <tbody>${rows.map((a) => `<tr>
              <td>${esc(a.email || '—')}</td><td>${esc(a.name || '—')}</td>
              <td><span class="badge gray">${esc(a.provider || '—')}</span></td>
              <td class="small muted">${fmtDateFull(a.created_at)}</td>
              <td class="small muted">${relTime(a.last_login)}</td>
              <td class="num">${a.login_count || 0}</td>
              <td class="num">${a.partner_count || 0}</td>
            </tr>`).join('')}</tbody></table>`
        : empty('users', '云端还没有账号', '用户注册或 GitHub 登录后会出现在这里。')}
          </div>
        </div>
        <p class="tiny muted mt12">注意：这里刻意不展示也不存储任何聊天记录 / 追踪对象明细，符合「聊天内容只在本机」的约定。</p>
      `;
      $('#caRefresh').onclick = () => viewCloudAccounts();
      await S.log(state.me.id, 'cloud_accounts_view', '', { count: rows.length });
    } catch (e) {
      $('#main').innerHTML = headHtml + `<div class="card">${empty('alert', '读取失败', e.message || '请确认是总开发者且云端地址正确。', '<button class="btn ghost sm" id="caRefresh">重试</button>')}</div>`;
      const rr = $('#caRefresh'); if (rr) rr.onclick = () => viewCloudAccounts();
    }
  }
})(window);
