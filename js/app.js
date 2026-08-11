/* =========================================================
   赵梓池的工作台  ·  app.js
   数据分两层：
   1) 实时层  — 60s.viki.moe（已验证 CORS），浏览器直连，永远最新
   2) 快照层  — data/daily.json，服务端每日抓取（B站/小红书/政策/Agent）
   本地数据全部存 localStorage，不上传任何服务器
   ========================================================= */
'use strict';

/* ---------- 常量 ---------- */
const API = 'https://60s.viki.moe/v2';
const K = { task:'zc_tasks', punch:'zc_punch', tpl:'zc_tpl', set:'zc_set', fav:'zc_fav', ship:'zc_ship' };
const WD = ['周日','周一','周二','周三','周四','周五','周六'];
/* 沿江城市坐标（Open-Meteo 实时气象用，免 key、CORS 友好） */
const SHIP_CITIES = {
  '重庆':[29.56,106.55], '宜昌':[30.69,111.29], '武汉':[30.59,114.30],
  '城陵矶':[29.36,113.09], '九江':[29.71,116.00], '南京':[32.06,118.80],
  '南通':[31.98,120.89], '上海':[31.23,121.47]
};

/* ---------- 存储 ---------- */
const S = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){ toast('存储空间不足'); } }
};

/* ---------- 时间工具 ---------- */
const pad = n => String(n).padStart(2,'0');
function dkey(d){ d = d || new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function hm2min(s){ if(!s) return null; const p = String(s).split(':'); const h=+p[0], m=+p[1]; if(isNaN(h)||isNaN(m)) return null; return h*60+m; }
function min2hm(m){ m = Math.max(0, Math.round(m)); return pad(Math.floor(m/60))+':'+pad(m%60); }
function nowMin(){ const d = new Date(); return d.getHours()*60 + d.getMinutes() + d.getSeconds()/60; }
function fmtHour(m){ const h = m/60; return (h>=10 ? h.toFixed(1) : h.toFixed(1)).replace(/\.0$/,''); }
/** 取某天所在周的周一 */
function monday(d){
  const x = new Date(d); const w = x.getDay(); const diff = (w===0 ? -6 : 1-w);
  x.setDate(x.getDate()+diff); x.setHours(0,0,0,0); return x;
}
function fmtNum(n){
  n = +n || 0;
  if(n >= 100000000) return (n/100000000).toFixed(1).replace(/\.0$/,'')+'亿';
  if(n >= 10000) return (n/10000).toFixed(1).replace(/\.0$/,'')+'万';
  return String(n);
}
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- 全局状态 ---------- */
let SET  = Object.assign({ goal:8, name:'赵梓池' }, S.get(K.set,{}));
let SNAP = null;          // 快照数据
let LIVE = {};            // 实时数据缓存
let weekOffset = 0;       // 工时页周偏移
let tickTimer = null;

/* =========================================================
   1. 打卡
   ========================================================= */
function getPunch(day){
  const all = S.get(K.punch, {});
  return all[day || dkey()] || { segs: [] };
}
function setPunch(day, rec){
  const all = S.get(K.punch, {});
  if(!rec || !rec.segs || !rec.segs.length) delete all[day];
  else all[day] = rec;
  S.set(K.punch, all);
}
/** 计算某天总分钟数；live=true 时进行中的段计到当前 */
function dayMinutes(rec, live){
  if(!rec || !rec.segs) return 0;
  let t = 0;
  for(const s of rec.segs){
    const a = hm2min(s.in);
    if(a == null) continue;
    let b = hm2min(s.out);
    if(b == null){ if(!live) continue; b = nowMin(); }
    if(b > a) t += (b - a);
  }
  return t;
}
function isWorking(rec){
  return !!(rec && rec.segs && rec.segs.length && rec.segs[rec.segs.length-1].out == null);
}

function doPunch(){
  const day = dkey();
  const rec = getPunch(day);
  const d = new Date();
  const hm = pad(d.getHours())+':'+pad(d.getMinutes());
  if(isWorking(rec)){
    const last = rec.segs[rec.segs.length-1];
    if(hm2min(hm) <= hm2min(last.in)){ toast('下班时间需晚于上班时间'); return; }
    last.out = hm;
    setPunch(day, rec);
    toast('已下班打卡 · 今日 ' + fmtHour(dayMinutes(rec)) + ' 小时');
  }else{
    rec.segs.push({ in: hm, out: null });
    setPunch(day, rec);
    toast('已上班打卡 · ' + hm);
  }
  renderPunch(); renderTime();
}

function renderPunch(){
  const rec = getPunch();
  const working = isWorking(rec);
  const mins = dayMinutes(rec, true);
  const goalM = (+SET.goal||8) * 60;

  const secs = Math.floor(mins*60) % 60;
  document.getElementById('punchTimer').textContent =
    pad(Math.floor(mins/60)) + ':' + pad(Math.floor(mins)%60) + ':' + pad(working ? secs : 0);

  const st = document.getElementById('punchState');
  st.textContent = working ? '工作中' : (rec.segs.length ? '已下班' : '未打卡');
  st.classList.toggle('on', working);

  const btn = document.getElementById('btnPunch');
  btn.textContent = working ? '下班打卡' : (rec.segs.length ? '再次上班' : '上班打卡');
  btn.classList.toggle('off', working);

  const meta = document.getElementById('punchMeta');
  if(!rec.segs.length){
    meta.textContent = '今天还没有开始记录';
  }else{
    meta.textContent = rec.segs.map(s => s.in + '~' + (s.out || '进行中')).join('  ·  ');
  }

  const pct = Math.min(100, mins/goalM*100);
  document.getElementById('punchBar').style.width = pct + '%';
  document.getElementById('punchGoalTxt').textContent =
    mins >= goalM ? ('超出 ' + fmtHour(mins-goalM) + 'h') : ('目标 ' + SET.goal + 'h');
}

/* 补录 / 修改 */
function openPunchEdit(day){
  day = day || dkey();
  const rec = JSON.parse(JSON.stringify(getPunch(day)));
  if(!rec.segs.length) rec.segs.push({ in:'09:00', out:'18:00' });

  const draw = () => {
    const rows = rec.segs.map((s,i) => `
      <div class="seg-row">
        <input type="time" value="${esc(s.in||'')}" data-i="${i}" data-f="in">
        <span>至</span>
        <input type="time" value="${esc(s.out||'')}" data-i="${i}" data-f="out">
        <button class="seg-del" data-del="${i}">✕</button>
      </div>`).join('');
    modal('工时记录 · ' + day, `
      <div class="field"><label>时间段（可添加多段，如中途外出）</label>
        <div class="seg-list" id="segList">${rows}</div>
        <button class="link-btn" id="segAdd">+ 添加一段</button>
        <div class="hint">留空「至」表示该段仍在进行中。修改后会立即生效并同步到周统计。</div>
      </div>
      <div class="modal-btns">
        <button class="btn btn-ghost" id="segClear">清空当天</button>
        <button class="btn btn-primary" id="segSave">保存</button>
      </div>`);

    document.getElementById('segList').oninput = e => {
      const t = e.target, i = +t.dataset.i, f = t.dataset.f;
      if(isNaN(i)) return;
      rec.segs[i][f] = t.value || null;
    };
    document.getElementById('segList').onclick = e => {
      const b = e.target.closest('[data-del]'); if(!b) return;
      rec.segs.splice(+b.dataset.del, 1); draw();
    };
    document.getElementById('segAdd').onclick = () => { rec.segs.push({in:'',out:''}); draw(); };
    document.getElementById('segClear').onclick = () => { setPunch(day, null); closeModal(); renderPunch(); renderTime(); toast('已清空 ' + day); };
    document.getElementById('segSave').onclick = () => {
      const clean = rec.segs.filter(s => hm2min(s.in) != null);
      for(const s of clean){
        if(s.out && hm2min(s.out) <= hm2min(s.in)){ toast('结束时间需晚于开始时间'); return; }
      }
      setPunch(day, { segs: clean });
      closeModal(); renderPunch(); renderTime(); toast('已保存');
    };
  };
  draw();
}

/* =========================================================
   2. 任务
   ========================================================= */
function getTasks(day){
  const all = S.get(K.task, {});
  return all[day || dkey()] || null;
}
function setTasks(day, list){
  const all = S.get(K.task, {});
  all[day] = list;
  // 只保留最近 90 天，避免无限膨胀
  const keys = Object.keys(all).sort().reverse();
  if(keys.length > 90) keys.slice(90).forEach(k => delete all[k]);
  S.set(K.task, all);
}
/** 每天首次进入：用模板生成当日任务 */
function ensureToday(){
  const day = dkey();
  let list = getTasks(day);
  if(list === null){
    const tpl = S.get(K.tpl, []);
    list = tpl.map(t => ({ id:'t'+Math.random().toString(36).slice(2,9), title:t.title, prio:t.prio||2, done:false, tpl:true }));
    setTasks(day, list);
  }
  return list;
}
function addTask(title, prio){
  title = (title||'').trim(); if(!title) return;
  const day = dkey(); const list = ensureToday();
  list.push({ id:'t'+Math.random().toString(36).slice(2,9), title, prio:+prio||2, done:false });
  setTasks(day, list); renderTasks();
}
function renderTasks(){
  const list = ensureToday();
  const ul = document.getElementById('taskList');
  const sorted = list.slice().sort((a,b) => (a.done - b.done) || (b.prio - a.prio));

  if(!list.length){
    ul.innerHTML = `<div class="empty"><b>✓</b>今天还没有任务<br>在上面添加，或设置每日重复任务</div>`;
  }else{
    ul.innerHTML = sorted.map(t => `
      <li class="${t.done?'done':''}" data-id="${t.id}">
        <button class="tk-box" data-act="toggle" aria-label="完成">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>
        </button>
        <div class="tk-main">
          <div class="tk-title">${esc(t.title)}</div>
          <div class="tk-sub">
            <button class="chip p${t.prio} prio-btn" data-act="prio" aria-label="修改优先级">${t.prio===3?'重要':t.prio===1?'低':'普通'}<span class="caret">▾</span></button>
            ${t.tpl?'<span class="chip tpl">每日</span>':''}
          </div>
        </div>
        <button class="tk-del" data-act="del" aria-label="删除">✕</button>
      </li>`).join('');
  }
    const done = list.filter(t=>t.done).length;
  const pct = list.length ? Math.round(done/list.length*100) : 0;
  document.getElementById('ringFg').style.strokeDashoffset = 100 - pct;
  document.getElementById('ringTxt').textContent = pct + '%';
}

/** 点击任务项上的优先级按钮：就地弹出小菜单切换类型 */
function openPrioMenu(btn, id){
  const pop = document.getElementById('prioPop');
  const opts = [['3','重要'],['2','普通'],['1','低']];
  pop.innerHTML = opts.map(([v,l]) =>
    `<button data-v="${v}"><span class="dot p${v}"></span>${l}</button>`).join('');
  const r = btn.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  let left = window.scrollX + r.left;
  if(left + 132 > window.scrollX + vw) left = window.scrollX + vw - 132;
  pop.style.left = Math.max(window.scrollX + 8, left) + 'px';
  pop.style.top  = (window.scrollY + r.bottom + 6) + 'px';
  pop.hidden = false;
  pop.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      const day = dkey(); const list = ensureToday();
      const idx = list.findIndex(t => t.id === id);
      if(idx >= 0){ list[idx].prio = +b.dataset.v; setTasks(day, list); renderTasks(); }
      pop.hidden = true;
      toast('已改为「' + b.textContent + '」');
    };
  });
}

/* 每日重复任务模板 */
function openTplMgr(){
  const draw = () => {
    const tpl = S.get(K.tpl, []);
    const rows = tpl.length ? tpl.map((t,i) => `
      <div class="tpl-item">
        <span class="chip p${t.prio||2}">${t.prio===3?'重要':t.prio===1?'低':'普通'}</span>
        <span class="tpl-tx">${esc(t.title)}</span>
        <button class="seg-del" data-del="${i}">✕</button>
      </div>`).join('') : '<div class="empty" style="padding:18px"><b>↻</b>还没有重复任务</div>';

    modal('每日重复任务', `
      <div class="hint" style="font-size:12.5px;color:var(--tx3);margin-bottom:12px;line-height:1.55">
        这里的任务会在每天第一次打开工作台时自动加入当日清单，适合日报、复盘、看数据这类固定动作。
      </div>
      <div id="tplList">${rows}</div>
      <div class="field-row" style="margin-top:14px">
        <div class="field" style="flex:1"><label>任务内容</label><input id="tplIn" placeholder="例如：写今日复盘" maxlength="60"></div>
        <div class="field" style="flex:0 0 92px"><label>优先级</label>
          <select id="tplPrio"><option value="2">普通</option><option value="3">重要</option><option value="1">低</option></select>
        </div>
      </div>
      <div class="modal-btns"><button class="btn btn-primary" id="tplAdd">添加到每日</button></div>`);

    document.getElementById('tplList').onclick = e => {
      const b = e.target.closest('[data-del]'); if(!b) return;
      const t = S.get(K.tpl, []); t.splice(+b.dataset.del,1); S.set(K.tpl,t); draw();
    };
    document.getElementById('tplAdd').onclick = () => {
      const v = document.getElementById('tplIn').value.trim();
      if(!v){ toast('请输入内容'); return; }
      const t = S.get(K.tpl, []);
      t.push({ title:v, prio:+document.getElementById('tplPrio').value });
      S.set(K.tpl, t);
      // 同步补进今天
      const day = dkey(); const list = ensureToday();
      list.push({ id:'t'+Math.random().toString(36).slice(2,9), title:v, prio:+document.getElementById('tplPrio').value, done:false, tpl:true });
      setTasks(day, list); renderTasks();
      draw(); toast('已添加');
    };
  };
  draw();
}

/* =========================================================
   3. 数据获取
   ========================================================= */
function fetchJSON(url, ms){
  ms = ms || 12000;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { signal: ctl.signal, cache:'no-store' })
    .then(r => { if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
    .finally(() => clearTimeout(timer));
}
/** 实时接口，带 5 分钟会话缓存 */
function live(name){
  if(LIVE[name] && Date.now() - LIVE[name].t < 300000) return Promise.resolve(LIVE[name].d);
  return fetchJSON(API + '/' + name).then(j => {
    if(j && j.code === 200 && j.data){ LIVE[name] = { t:Date.now(), d:j.data }; return j.data; }
    throw new Error('bad payload');
  });
}
function snapshot(){
  if(SNAP) return Promise.resolve(SNAP);
  return fetchJSON('data/daily.json', 15000).then(d => { SNAP = d; return d; });
}
/** 快照新鲜度标签：是今天就显示「今日快照」，不是今天就明确标出日期并提示待更新 */
function snapTag(){
  const d = (SNAP && SNAP.date) || '';
  if(!d) return '<span class="tag-live snap">快照</span>';
  if(d === dkey()) return '<span class="tag-live snap">今日快照</span>';
  const p = d.split('-');
  const md = p.length === 3 ? (+p[1]) + '月' + (+p[2]) + '日' : d;
  return `<span class="tag-live stale" title="快照生成于 ${d}，尚未更新到今天">${md}快照 · 待更新</span>`;
}

/* =========================================================
   4. 今日速览
   ========================================================= */
function renderBrief(){
  const box = document.getElementById('briefGrid');
  Promise.allSettled([ live('60s'), live('douyin'), snapshot() ]).then(([n, d, s]) => {
    const items = [];
    if(n.status === 'fulfilled' && n.value && n.value.news){
      n.value.news.slice(0,4).forEach(t => items.push({ t, warn:/预警|台风|暴雨|地震|事故|紧急|灾/.test(t) }));
    }
    if(d.status === 'fulfilled' && Array.isArray(d.value)){
      d.value.slice(0,2).forEach(x => items.push({ t:'抖音热榜 · ' + x.title, warn:false }));
    }
    if(s.status === 'fulfilled' && s.value.policy && s.value.policy.length){
      const p = s.value.policy[0];
      items.push({ t:'政策 · ' + p.title + '（' + p.date + '）', warn:false });
    }
    if(!items.length){
      box.innerHTML = '<div class="load-tip">暂时拿不到实时数据，可下拉刷新重试</div>';
      document.getElementById('briefLive').className = 'tag-live snap';
      document.getElementById('briefLive').textContent = '离线';
      return;
    }
    box.innerHTML = items.slice(0,7).map((x,i) =>
      `<div class="brief-item ${x.warn?'warn':''}"><span class="brief-idx">${i+1}</span><span>${esc(x.t)}</span></div>`
    ).join('');
  });
}

/* =========================================================
   5. 爆款页
   ========================================================= */
let hotTab = 'douyin';
function renderHot(){
  const box = document.getElementById('hotBody');
  box.innerHTML = '<div class="load-tip">加载中…</div>';

  if(hotTab === 'douyin' || hotTab === 'weibo'){
    const isDy = hotTab === 'douyin';
    live(isDy ? 'douyin' : 'weibo').then(d => {
      if(!Array.isArray(d) || !d.length) throw new Error('empty');
      box.innerHTML = `<div class="sec-title"><span>${isDy?'抖音':'微博'}实时热榜 · 共 ${d.length} 条</span><span class="tag-live">实时</span></div>
        <div class="rank-list">` + d.slice(0,40).map((x,i) => `
        <a class="rank-item" href="${esc(x.link||'#')}" target="_blank" rel="noopener">
          <span class="rk-no ${i<3?'top':''}">${i+1}</span>
          <div class="rk-body">
            <div class="rk-title">${esc(x.title)}</div>
            <div class="rk-meta"><span class="rk-hot">🔥 ${fmtNum(x.hot_value)}</span>${x.event_time?'<span>'+esc(String(x.event_time).slice(5,16))+'</span>':''}</div>
          </div>
          ${x.cover?`<img class="rk-cover" src="${esc(x.cover)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`:''}
        </a>`).join('') + '</div>';
    }).catch(() => {
      box.innerHTML = `<div class="err-tip">实时热榜接口暂时不可用（可能是网络或上游波动）。请稍后点右上角刷新重试。</div>`;
    });
    return;
  }

  snapshot().then(s => {
    if(hotTab === 'xhs'){
      const list = s.xiaohongshu || [];
      box.innerHTML = `<div class="sec-title"><span>小红书爆款内容 & 商品 · ${s.date}</span>${snapTag()}</div>
        <div class="grid-2">` +
        list.map(x => `
        <div class="xhs-card">
          <div class="xhs-head"><div class="xhs-title">${esc(x.title)}</div><span class="xhs-tag">${esc(x.tag)}</span></div>
          <div class="xhs-desc">${esc(x.desc)}</div>
          <div class="xhs-rows">
            <div class="xhs-row"><span class="xhs-k">热度</span><span class="xhs-v">${esc(x.heat)}</span></div>
            <div class="xhs-row"><span class="xhs-k">关联品</span><span class="xhs-v">${esc(x.goods)}</span></div>
            <div class="xhs-row insight"><span class="xhs-k">洞察</span><span class="xhs-v">${esc(x.insight)}</span></div>
          </div>
          <div class="xhs-src">来源：${esc(x.source)}</div>
        </div>`).join('') + '</div>' +
        `<div class="err-tip">小红书没有公开的免费热榜接口，这里由每日抓取的趋势快照 + 数据源交叉验证生成，附带可执行洞察而非单纯榜单。</div>`;
    }else{
      const list = s.bilibili || [];
      box.innerHTML = `<div class="sec-title"><span>B站全站排行榜</span><span class="tag-live snap">最近快照</span></div>
        <div class="err-tip" style="margin:8px 0 4px">⚠️ B站官方接口需账号登录态才能实时读取，当前为最近一次成功抓取快照（非每日刷新）。如需每日自动更新，请提供 B站 Cookie。</div>
        <div class="rank-list">` + list.map((x,i) => `
        <a class="rank-item" href="${esc(x.link)}" target="_blank" rel="noopener">
          <span class="rk-no ${i<3?'top':''}">${i+1}</span>
          <div class="rk-body">
            <div class="rk-title">${esc(x.title)}</div>
            <div class="rk-meta"><span class="rk-hot">▶ ${fmtNum(x.view)}</span><span>👍 ${fmtNum(x.like)}</span><span>${esc(x.cat)}</span><span>${esc(x.author)}</span></div>
          </div>
          ${x.cover?`<img class="rk-cover" src="${esc(x.cover)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`:''}
        </a>`).join('') + '</div>' +
        `<div class="err-tip">B 站接口有 Referer 风控，浏览器端无法直连，因此由服务端每日抓取。</div>`;
    }
  }).catch(() => { box.innerHTML = '<div class="err-tip">快照数据加载失败，请刷新页面重试。</div>'; });
}

/* =========================================================
   6. 资讯页
   ========================================================= */
let newsTab = 'cn';

/* 航运物流相关政策/法条识别：用于资讯页自动提炼并重点标红 */
const SHIP_KW = ['航运','水运','长江','海事','港口','船舶','船闸','航道','驳船','码头','货运','物流','运输','交通部','海运','内河','集装箱','多式联运','供应链','岸电','硫含量','燃油','排污','长江大保护','禁航','限航','过闸','船级','船员','油污','海关','关务','进出口','外贸','舱位','提单'];
function shipHit(x){
  let blob;
  if(typeof x === 'string') blob = x;
  else blob = [ x.title||'', x.summary||'', ...(x.impact||[]).flatMap(m => [m.industry||'', m.text||'']), x.source||'' ].join(' ');
  return SHIP_KW.some(k => blob.includes(k));
}

function renderNews(){
  const box = document.getElementById('newsBody');
  box.innerHTML = '<div class="load-tip">加载中…</div>';

  if(newsTab === 'cn'){
    Promise.allSettled([ live('60s'), live('toutiao'), snapshot() ]).then(([n, t, s]) => {
      let html = '';
      if(n.status === 'fulfilled' && n.value && n.value.news){
        html += `<div class="sec-title"><span>每日 60 秒读懂世界 · ${esc(n.value.date||'')}</span><span class="tag-live">实时</span></div>
          <div class="card"><div class="s60-list">` +
          n.value.news.map((x,i) => `<div class="s60-item ${shipHit(x)?'ship':''}"><span class="s60-no">${i+1}</span>${shipHit(x)?'<span class="pill ship">🚢</span>':''}<span>${esc(x)}</span></div>`).join('') +
          `</div></div>`;
      }
      if(t.status === 'fulfilled' && Array.isArray(t.value)){
        html += `<div class="sec-title"><span>今日头条热榜</span><span class="tag-live">实时</span></div><div class="rank-list">` +
          t.value.slice(0,20).map((x,i) => `
          <a class="rank-item" href="${esc(x.link||'#')}" target="_blank" rel="noopener">
            <span class="rk-no ${i<3?'top':''}">${i+1}</span>
            <div class="rk-body"><div class="rk-title">${esc(x.title)} ${shipHit(x.title)?'<span class="pill ship">🚢</span>':''}</div>
            <div class="rk-meta"><span class="rk-hot">🔥 ${fmtNum(x.hot_value)}</span></div></div>
          </a>`).join('') + '</div>';
      }
      if(s.status === 'fulfilled' && s.value.news_cn_extra){
        html += `<div class="sec-title"><span>国内要闻精编</span>${snapTag()}</div>
          <div class="grid-2">` +
          s.value.news_cn_extra.map(x => `
          <div class="news-card ${shipHit(x)?'ship':''}">
            <div class="news-title">${esc(x.title)}</div>
            <div class="news-desc">${esc(x.desc)}</div>
            <div class="news-foot"><span class="badge">${esc(x.tag)}</span>${shipHit(x)?'<span class="badge ship">🚢 航运物流</span>':''}</div>
          </div>`).join('') + '</div>';
      }
      box.innerHTML = html || '<div class="err-tip">数据加载失败，请刷新重试。</div>';
    });
    return;
  }

  snapshot().then(s => {
    if(newsTab === 'world'){
      box.innerHTML = `<div class="sec-title"><span>国际要闻 · ${s.date}</span>${snapTag()}</div>
        <div class="grid-2">` +
        (s.news_world||[]).map(x => `
        <div class="news-card">
          <div class="news-title">${esc(x.title)}</div>
          <div class="news-desc">${esc(x.desc)}</div>
          <div class="news-foot"><span class="badge o">${esc(x.region)}</span><span>${esc(x.source)}</span></div>
        </div>`).join('') + '</div>';
    }
    else if(newsTab === 'policy'){
      const pols = s.policy||[];
      const shipIdx = new Set();
      pols.forEach((x,i) => { if(shipHit(x)) shipIdx.add(i); });
      const ship = pols.filter((_,i) => shipIdx.has(i));
      const rest = pols.filter((_,i) => !shipIdx.has(i));
      const card = (x,i) => `
        <div class="pol-card${shipIdx.has(i)?' ship':''}" data-pol="${i}">
          <div class="pol-head">
            <div class="pol-top"><div class="pol-title">${esc(x.title)}</div></div>
            <div class="pol-date"><span>📅 ${esc(x.date)}</span><span class="badge r">${esc(x.level)}</span>${shipIdx.has(i)?'<span class="badge ship">🚢 航运物流</span>':''}</div>
            <div class="pol-sum">${esc(x.summary)}</div>
            <div class="pol-toggle"><span>查看对 ${(x.impact||[]).length} 个行业的影响解读</span><span class="pol-arrow">▼</span></div>
          </div>
          <div class="pol-impact"><div class="pol-impact-in">
            ${(x.impact||[]).map(im => `<div class="imp-item"><span class="imp-ind">${esc(im.industry)}</span><span class="imp-tx">${esc(im.text)}</span></div>`).join('')}
            <div class="xhs-src" style="margin-top:12px">来源：${esc(x.source)}</div>
          </div></div>
        </div>`;
      let html = `<div class="sec-title"><span>政策与法律更新 · 含行业影响解读</span>${snapTag()}</div>`;
      if(ship.length){
        html += `<div class="sec-title ship-h"><span>🚢 航运物流重点关注（${ship.length}）</span><span class="badge ship">已自动提炼</span></div>
          <div class="grid-2 ship-grid">` + ship.map(card).join('') + '</div>';
      }
      if(rest.length){
        html += (ship.length ? `<div class="sec-title sub"><span>其他政策与法律</span></div>` : '') +
          `<div class="grid-2">` + rest.map(card).join('') + '</div>';
      }
      box.innerHTML = html || '<div class="err-tip">暂无政策数据。</div>';
      box.querySelectorAll('.pol-head').forEach(h => {
        h.onclick = () => h.parentElement.classList.toggle('open');
      });
    }
    else{
      box.innerHTML = `<div class="sec-title"><span>新发布的 AI Agent / 智能体</span>${snapTag()}</div>
        <div class="grid-2">` +
        (s.agents||[]).map(x => `
        <div class="ag-card">
          <div class="ag-top">
            <div><div class="ag-name">${esc(x.name)}</div><div class="ag-org">${esc(x.org)} · ${esc(x.date)}</div></div>
            <span class="badge p">${esc(x.tag)}</span>
          </div>
          <div class="ag-desc">${esc(x.desc)}</div>
          <div class="ag-price">💰 ${esc(x.price)}</div>
          <div class="ag-why"><b>为什么值得关注：</b>${esc(x.why)}</div>
          ${x.link?`<div style="margin-top:11px"><a class="link-btn" href="${esc(x.link)}" target="_blank" rel="noopener">查看原文 ↗</a></div>`:''}
        </div>`).join('') + '</div>';
    }
  }).catch(() => { box.innerHTML = '<div class="err-tip">快照数据加载失败，请刷新页面重试。</div>'; });
}

/* =========================================================
   7. 灵感引擎
   ========================================================= */
let ideaPool = [];
function renderIdea(){
  const box = document.getElementById('ideaBody');
  box.innerHTML = '<div class="load-tip">加载中…</div>';

  Promise.allSettled([ snapshot(), live('douyin'), live('weibo') ]).then(([s, d, w]) => {
    const snap = s.status === 'fulfilled' ? s.value : {};
    const insp = snap.inspiration || { quote:{}, angles:[], sources:[] };

    // 关键词池：热榜标题（过滤娱乐八卦类噪音）
    const kws = [];
    const push = arr => { if(Array.isArray(arr)) arr.forEach(x => { if(x && x.title && x.title.length <= 22) kws.push(x.title); }); };
    if(d.status === 'fulfilled') push(d.value.slice(0,30));
    if(w.status === 'fulfilled') push(w.value.slice(0,20));
    (snap.xiaohongshu||[]).forEach(x => kws.push(x.title));
    (snap.agents||[]).forEach(x => kws.push(x.name));
    ideaPool = { kws: kws.length ? kws : ['今日热点'], angles: insp.angles||[] };

    box.innerHTML = `
      <div class="quote-card">
        <div class="quote-mark">"</div>
        <div class="quote-tx">${esc(insp.quote.text||'')}</div>
        <div class="quote-from">— ${esc(insp.quote.from||'')}</div>
      </div>

      <div class="sec-title"><span>灵感引擎 · 今日热点 × 内容角度</span><span class="tag-live">实时</span></div>
      <div class="gen-box">
        <button class="btn btn-primary" id="btnGen">生成选题</button>
        <button class="btn btn-ghost" id="btnGen3">一次来 3 个</button>
      </div>
      <div id="ideaOut"></div>

      <div class="sec-title" style="margin-top:20px">灵感来源 · 常逛的地方</div>
      <div class="src-grid">
        ${(insp.sources||[]).map(x => `
          <a class="src-item" href="${esc(x.url)}" target="_blank" rel="noopener">
            <div class="src-name">${esc(x.name)}</div>
            <div class="src-desc">${esc(x.desc)}</div>
          </a>`).join('')}
      </div>`;

    document.getElementById('btnGen').onclick = () => genIdea(1);
    document.getElementById('btnGen3').onclick = () => genIdea(3);
    genIdea(1);
  });
}
function genIdea(n){
  const out = document.getElementById('ideaOut');
  if(!out || !ideaPool.angles || !ideaPool.angles.length){ if(out) out.innerHTML = ''; return; }
  let html = '';
  const used = new Set();
  for(let i=0; i<n; i++){
    let kw, tries = 0;
    do{ kw = ideaPool.kws[Math.floor(Math.random()*ideaPool.kws.length)]; tries++; }while(used.has(kw) && tries < 20);
    used.add(kw);
    const a = ideaPool.angles[Math.floor(Math.random()*ideaPool.angles.length)];
    html += `
      <div class="idea-out">
        <div class="idea-kw">热点关键词 · <b>${esc(kw)}</b></div>
        <div class="idea-title">${esc(a.tpl.replace('{热点}', kw).replace('{某职业}','你的目标人群'))}</div>
        <div class="idea-angle"><span class="badge p">${esc(a.name)}</span></div>
        <div class="idea-good">${esc(a.good)}</div>
      </div>`;
  }
  out.innerHTML = html;
}

/* =========================================================
   8. 工时统计
   ========================================================= */
function renderTime(){
  const box = document.getElementById('timeBody');
  const base = new Date(); base.setDate(base.getDate() + weekOffset*7);
  const mon = monday(base);
  const goalM = (+SET.goal||8)*60;
  const today = dkey();

  const days = [];
  for(let i=0;i<7;i++){
    const d = new Date(mon); d.setDate(mon.getDate()+i);
    const key = dkey(d);
    const rec = getPunch(key);
    days.push({ key, d, mins: dayMinutes(rec, key===today), rec, isToday: key===today });
  }
  const total = days.reduce((s,x)=>s+x.mins, 0);
  const workDays = days.filter(x=>x.mins>0).length;
  const avg = workDays ? total/workDays : 0;
  const overDays = days.filter(x=>x.mins>goalM).length;
  const max = Math.max(goalM*1.15, ...days.map(x=>x.mins), 60);

  const label = weekOffset===0 ? '本周' : (weekOffset===-1 ? '上周' : `${mon.getMonth()+1}/${mon.getDate()} 那周`);
  const sun = new Date(mon); sun.setDate(mon.getDate()+6);

  box.innerHTML = `
    <div class="stat-row">
      <div class="stat-box hl"><div class="stat-v">${fmtHour(total)}</div><div class="stat-k">${label}总时长 (h)</div></div>
      <div class="stat-box"><div class="stat-v">${fmtHour(avg)}</div><div class="stat-k">日均 (h)</div></div>
      <div class="stat-box"><div class="stat-v">${workDays}<small style="font-size:12px;color:var(--tx3)">天</small></div><div class="stat-k">出勤天数</div></div>
    </div>

    <div class="card">
      <div class="wk-nav">
        <button class="wk-btn" id="wkPrev">‹</button>
        <b>${mon.getMonth()+1}月${mon.getDate()}日 - ${sun.getMonth()+1}月${sun.getDate()}日</b>
        <button class="wk-btn" id="wkNext" ${weekOffset>=0?'disabled':''}>›</button>
      </div>
      <div class="chart" id="chart">
        ${days.map(x => {
          const h = Math.max(3, x.mins/max*112);
          const cls = x.mins===0 ? 'zero' : (x.isToday ? 'today' : (x.mins>goalM ? 'over' : ''));
          return `<div class="bar-wrap">
            <span class="bar-val">${x.mins?fmtHour(x.mins):''}</span>
            <div class="bar ${cls}" style="height:${h}px"></div>
            <span class="bar-day ${x.isToday?'is-today':''}">${WD[x.d.getDay()]}</span>
          </div>`;
        }).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:14px;padding-top:13px;border-top:1px solid var(--line2);font-size:12.5px;color:var(--tx2)">
        <span>超过 ${SET.goal}h 的天数：<b style="color:var(--pri)">${overDays}</b> 天</span>
        <span>周目标 ${(SET.goal*5)}h · 完成 ${Math.round(total/60/(SET.goal*5)*100)}%</span>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>${label}打卡明细</h2><button class="link-btn" id="btnExport">导出备份</button></div>
      ${days.filter(x=>x.rec.segs.length).length ? days.filter(x=>x.rec.segs.length).map(x => `
        <div class="rec-item">
          <div class="rec-date"><div class="rec-d">${x.d.getDate()}</div><div class="rec-w">${WD[x.d.getDay()]}</div></div>
          <div class="rec-main"><div class="rec-seg">${x.rec.segs.map(s=>esc(s.in)+'~'+esc(s.out||'进行中')).join('  ·  ')}</div></div>
          <div class="rec-dur">${fmtHour(x.mins)}h</div>
          <button class="rec-edit" data-day="${x.key}">✎</button>
        </div>`).join('')
      : '<div class="empty"><b>◷</b>这一周还没有打卡记录</div>'}
    </div>`;

  document.getElementById('wkPrev').onclick = () => { weekOffset--; renderTime(); };
  document.getElementById('wkNext').onclick = () => { if(weekOffset<0){ weekOffset++; renderTime(); } };
  document.getElementById('btnExport').onclick = exportData;
  box.querySelectorAll('[data-day]').forEach(b => b.onclick = () => openPunchEdit(b.dataset.day));
}

/* =========================================================
   9. 设置 / 备份
   ========================================================= */
function openSettings(){
  modal('设置', `
    <div class="set-item">
      <div class="set-k">每日工时目标<small>用于进度条和周统计的达标判断</small></div>
      <div class="set-v"><input type="number" id="setGoal" value="${SET.goal}" min="1" max="24" step="0.5"> </div>
    </div>
    <div class="set-item">
      <div class="set-k">称呼<small>显示在顶部问候语</small></div>
      <div class="set-v"><input type="text" id="setName" value="${esc(SET.name)}" style="width:110px"></div>
    </div>
    <div class="set-item">
      <div class="set-k">数据备份<small>所有数据只存在这台设备的浏览器里，换设备或清缓存前请先导出</small></div>
    </div>
    <div class="modal-btns" style="margin-top:14px">
      <button class="btn btn-ghost" id="btnImp">导入</button>
      <button class="btn btn-ghost" id="btnExp">导出</button>
      <button class="btn btn-primary" id="btnSetSave">保存</button>
    </div>
    <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--line2);font-size:11.5px;color:var(--tx3);line-height:1.65">
      数据说明：抖音 / 微博 / 头条 / 60 秒新闻为浏览器实时直连接口，每次打开都是最新；
      B站 / 小红书 / 政策法律 / AI Agent 因接口有风控或无公开免费接口，由服务端每日抓取快照。
      <br><br>快照生成时间：<b id="snapTime">—</b>
    </div>`);

  snapshot().then(s => { const el = document.getElementById('snapTime'); if(el) el.textContent = s.generated_at || '—'; }).catch(()=>{});
  document.getElementById('btnSetSave').onclick = () => {
    const g = parseFloat(document.getElementById('setGoal').value);
    SET.goal = (isNaN(g)||g<=0) ? 8 : g;
    SET.name = document.getElementById('setName').value.trim() || '赵梓池';
    S.set(K.set, SET);
    closeModal(); hello(); renderPunch(); renderTime(); toast('已保存');
  };
  document.getElementById('btnExp').onclick = exportData;
  document.getElementById('btnImp').onclick = importData;
}
function exportData(){
  const dump = { v:1, at:new Date().toISOString() };
  Object.values(K).forEach(k => dump[k] = S.get(k, null));
  const blob = new Blob([JSON.stringify(dump,null,1)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '工作台备份-' + dkey() + '.json';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 3000);
  toast('已导出备份文件');
}
function importData(){
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = () => {
    const f = inp.files[0]; if(!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try{
        const d = JSON.parse(rd.result);
        Object.values(K).forEach(k => { if(d[k] != null) S.set(k, d[k]); });
        SET = Object.assign({ goal:8, name:'赵梓池' }, S.get(K.set,{}));
        closeModal(); hello(); renderPunch(); renderTasks(); renderTime();
        toast('导入成功');
      }catch(e){ toast('文件格式不对'); }
    };
    rd.readAsText(f);
  };
  inp.click();
}

/* =========================================================
   10. UI 基础
   ========================================================= */
function modal(title, html){
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modal').classList.add('on');
  document.getElementById('modalMask').classList.add('on');
}
function closeModal(){
  document.getElementById('modal').classList.remove('on');
  document.getElementById('modalMask').classList.remove('on');
}
let toastTimer = null;
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2100);
}
function hello(){
  const h = new Date().getHours();
  const g = h<6?'凌晨好':h<9?'早上好':h<12?'上午好':h<14?'中午好':h<18?'下午好':h<23?'晚上好':'夜深了';
  document.getElementById('greeting').textContent = g + '，' + SET.name;
  const d = new Date();
  document.getElementById('dateline').textContent =
    `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 ${WD[d.getDay()]}`;
}
function go(page){
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page===page));
  window.scrollTo({top:0, behavior:'instant'});
  if(page==='hot')  renderHot();
  if(page==='news') renderNews();
  if(page==='idea') renderIdea();
  if(page==='time') renderTime();
  if(page==='ship') renderShip();
  try{ history.replaceState(null,'','#'+page); }catch(e){}
}

/* =========================================================
   10.5 航运情报（长江内河物流）
   ========================================================= */
function getShip(){
  return Object.assign({ cities:['武汉','宜昌','南京'], stations:[], note:'' }, S.get(K.ship,{}));
}
function setShip(v){ S.set(K.ship, v); }

let shipWxWarn = '';   // 气象大风/雾提示，由实时气象填充
let shipWxReady = false; // 气象快照是否已加载（无论成败）

/** 综合水位红线 + 气象，给出绿/黄/红结论 */
function applyShipCondition(){
  const cfg = getShip();
  let level = 0; const msgs = [];
  cfg.stations.forEach(s => {
    if(s.redline !== '' && s.redline != null && s.water !== '' && s.water != null){
      const w = +s.water, r = +s.redline;
      if(w < r){ level = 2; msgs.push(`${s.name}水位 ${w}m 低于红线 ${r}m`); }
      else if(w < r + 1){ level = Math.max(level, 1); msgs.push(`${s.name}接近红线`); }
    }
  });
  if(shipWxWarn){ level = Math.max(level, 1); msgs.push(shipWxWarn); }

  const light = document.getElementById('shipLight');
  const cond  = document.getElementById('shipCond');
  const sub   = document.getElementById('shipCondSub');
  if(!shipWxReady && !cfg.stations.length){
    light.textContent = '🟡'; cond.textContent = '航行条件评估中…';
    sub.textContent = '设置水位站红线后自动评估'; return;
  }
  if(level === 2){ light.textContent = '🔴'; cond.textContent = '航行条件差 · 谨慎安排'; }
  else if(level === 1){ light.textContent = '🟡'; cond.textContent = '航行条件一般 · 注意减载/绕行'; }
  else { light.textContent = '🟢'; cond.textContent = '航行条件良好'; }
  sub.textContent = msgs.join('；') || (cfg.stations.length ? '各站水位正常' : '气象正常（未设置水位站，仅供参考）');
}

/** 实时气象：读取服务端快照 data/weather.json（Open-Meteo 由定时任务抓取，国内稳定） */
function fetchShipWeather(){
  const cfg = getShip();
  const box = document.getElementById('shipWx');
  const live = document.getElementById('shipWxLive');
  if(!cfg.cities.length){
    box.innerHTML = '<div class="empty" style="padding:16px">先在「设置」选择沿江城市</div>';
    return;
  }
  box.innerHTML = '<div class="load-tip">加载中…</div>';
  const names = cfg.cities.slice(0, 6);

  /* 双保险：先浏览器直连 Open-Meteo 取实时（网络通就是最新的），
     失败/超时再回落服务端快照 data/weather.json，两条路都断才报离线。
     注意 wind_speed_unit=ms —— 不写默认返回 km/h，数值会虚高 3.6 倍。 */
  const tryLive = Promise.all(names.map(n => {
    const c = SHIP_CITIES[n];
    if(!c) return Promise.reject(new Error('unknown city'));
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${c[0]}&longitude=${c[1]}`
      + `&current=wind_speed_10m,wind_gusts_10m,precipitation,relative_humidity_2m,temperature_2m`
      + `&wind_speed_unit=ms&timezone=Asia%2FShanghai`;
    return fetchJSON(url, 8000).then(j => {
      const d = j.current || {};
      return [n, { wind:d.wind_speed_10m||0, gust:d.wind_gusts_10m||0, rain:d.precipitation||0,
                   hum:d.relative_humidity_2m||0, temp:d.temperature_2m }];
    });
  })).then(pairs => ({ cities:Object.fromEntries(pairs), mode:'live' }));

  tryLive
    .catch(() => fetch('data/weather.json?t=' + Date.now()).then(r => r.json())
      .then(d => ({ cities:d.cities || {}, mode:'snap', at:d.updated })))
    .then(res => {
      shipWxReady = true;
      const cities = res.cities;
      const list = names.filter(n => cities[n] && !cities[n].error);
      if(!list.length){
        box.innerHTML = '<div class="empty">暂无气象数据，请稍后自动更新</div>';
        live.className = 'tag-live snap'; live.textContent = '离线';
        applyShipCondition(); return;
      }
      if(res.mode === 'live'){
        live.className = 'tag-live'; live.textContent = '实时';
      }else{
        const t = res.at ? new Date(res.at) : null;
        live.className = 'tag-live snap';
        live.textContent = t ? ('快照 ' + pad(t.getHours()) + ':' + pad(t.getMinutes())) : '快照';
      }
      let maxGust = 0;
      box.innerHTML = list.map(n => {
        const w = cities[n];
        const wsp = w.wind||0, gust = w.gust||0, rain = w.rain||0, hum = w.hum||0, t = w.temp;
        maxGust = Math.max(maxGust, gust);
        const warn = gust >= 10.8, fog = hum >= 90 && wsp < 3;   // 阵风≥10.8m/s 约 6 级
        return `<div class="wx-cell"><div class="wx-name">${esc(n)}${warn?' <span style="color:var(--red);font-size:11px">大风</span>':''}${fog?' <span style="color:var(--orange);font-size:11px">雾</span>':''}</div>
          <div class="wx-wind ${warn?'warn':''}">${wsp.toFixed(1)}<small style="font-size:12px"> m/s</small></div>
          <div class="wx-meta">阵风 ${gust.toFixed(1)} · ${rain>0?('雨 '+rain+'mm'):'无降水'} · 湿${Math.round(hum)}% · ${Math.round(t)}°</div></div>`;
      }).join('');
      shipWxWarn = maxGust >= 10.8 ? `沿江阵风达 ${maxGust.toFixed(1)} m/s（≥6 级），注意封航/减速` : '';
      applyShipCondition();
    })
    .catch(() => {
      shipWxReady = true;
      box.innerHTML = '<div class="err-tip">气象加载失败，稍后自动重试</div>';
      live.className = 'tag-live snap'; live.textContent = '离线';
      applyShipCondition();
    });
}

function renderShip(){
  const cfg = getShip();
  const stBox = document.getElementById('shipStations');
  if(!cfg.stations.length){
    stBox.innerHTML = '<div class="empty" style="padding:18px"><b>🌊</b>还没有设置水位站</div>';
  }else{
    stBox.innerHTML = cfg.stations.map(s => {
      const low = (s.redline !== '' && s.redline != null && s.water !== '' && s.water != null && +s.water < +s.redline);
      return `<div class="st-row ${low?'low':''}">
        <div class="st-name">${esc(s.name)}</div>
        <div class="st-vals">水位 <b>${s.water!==''&&s.water!=null?esc(s.water):'—'}</b> m<br>红线 ${esc(s.redline||'—')} m</div>
      </div>`;
    }).join('');
  }
  document.getElementById('shipNotes').textContent = cfg.note || '在「设置」里填写船闸、禁航与备注';
  applyShipCondition();
  fetchShipWeather();
  renderFleet();
}

/** 船队实时位置（读取 data/ships.json 快照） */
function renderFleet(){
  const box = document.getElementById('shipFleet');
  if(!box) return;
  fetch('data/ships.json?t=' + Date.now()).then(r => r.json()).then(d => {
    document.getElementById('shipFleetLive').textContent = '快照';
    if(!d.ships || !d.ships.length){ box.innerHTML = '<div class="empty">暂无船位数据</div>'; return; }
    const col = { 0:'g', 1:'y', 2:'gr', 3:'gr', 4:'r', 5:'y', 6:'r', 7:'y', 8:'g', 9:'r' };
    const upd = (d.updated||'').replace('T',' ').slice(0,16);
    box.innerHTML = `<div class="fleet-upd">数据更新：${esc(upd)}（服务端定时刷新）</div>` + d.ships.map(s => {
      const c = col[s.navistat] != null ? col[s.navistat] : 'gr';
      return `<div class="fleet-row">
        <span class="dot dot-${c}"></span>
        <div class="fleet-main">
          <div class="fleet-name">${esc(s.name)}</div>
          <div class="fleet-meta">MMSI ${s.mmsi} · ${s.lat!=null?s.lat.toFixed(3):'?'}, ${s.lng!=null?s.lng.toFixed(3):'?'}</div>
        </div>
        <div class="fleet-side">
          <div class="fleet-stat">${esc(s.navText)}</div>
          <div class="fleet-sub">${s.sog!=null?s.sog:0} kn${s.dest?(' · →'+esc(s.dest)):''}</div>
        </div>
      </div>`;
    }).join('');
  }).catch(() => { box.innerHTML = '<div class="empty">加载失败，请稍后重试</div>'; });
}

/** 设置：城市多选 + 水位站增删 + 备注 */
function openShipSet(){
  const cfg = JSON.parse(JSON.stringify(getShip()));
  if(!cfg.cities) cfg.cities = [];
  if(!cfg.stations) cfg.stations = [];
  const draw = () => {
    const cityChecks = Object.keys(SHIP_CITIES).map(n =>
      `<label class="chk"><input type="checkbox" data-city="${esc(n)}" ${cfg.cities.includes(n)?'checked':''}> ${esc(n)}</label>`).join('');
    const stRows = cfg.stations.map((s,i) => `
      <div class="st-edit-row">
        <input placeholder="站名" value="${esc(s.name||'')}" data-i="${i}" data-f="name" class="se-name">
        <input placeholder="水位m" value="${esc(s.water??'')}" data-i="${i}" data-f="water" class="se-num">
        <input placeholder="红线m" value="${esc(s.redline??'')}" data-i="${i}" data-f="redline" class="se-num">
        <button class="seg-del" data-del="${i}">✕</button>
      </div>`).join('');
    modal('航运情报设置', `
      <div class="field"><label>关注的城市（用于实时气象）</label>
        <div class="chk-grid">${cityChecks}</div></div>
      <div class="field"><label>水位站（手录当前水位与红线水位）</label>
        <div id="stEdit">${stRows}</div>
        <button class="link-btn" id="stAdd">+ 添加水位站</button></div>
      <div class="field"><label>船闸 / 禁航 / 备注</label>
        <textarea id="shipNote" placeholder="例如：三峡待闸约120艘，预计延误6-10h；下游晨间有雾预警">${esc(cfg.note||'')}</textarea></div>
      <div class="modal-btns"><button class="btn btn-primary" id="shipSave">保存</button></div>
      <div class="hint" style="margin-top:10px">实时气象由 Open-Meteo 自动获取；水位、船闸、禁航目前需手动录入（公开水文接口暂无浏览器直连）。</div>`);

    document.getElementById('stEdit').oninput = e => {
      const t = e.target, i = +t.dataset.i, f = t.dataset.f; if(isNaN(i)) return;
      cfg.stations[i][f] = t.value;
    };
    document.getElementById('stEdit').onclick = e => {
      const b = e.target.closest('[data-del]'); if(!b) return;
      cfg.stations.splice(+b.dataset.del, 1); draw();
    };
    document.getElementById('stAdd').onclick = () => { cfg.stations.push({name:'',water:'',redline:''}); draw(); };
    document.getElementById('shipSave').onclick = () => {
      cfg.cities = Array.from(document.querySelectorAll('#modalBody [data-city]:checked')).map(x => x.dataset.city);
      cfg.note = document.getElementById('shipNote').value.trim();
      setShip(cfg); closeModal(); renderShip(); toast('已保存');
    };
  };
  draw();
}

/* =========================================================
   11. 初始化
   ========================================================= */
function init(){
  hello();
  renderPunch();
  renderTasks();
  renderBrief();

  // 每秒刷新计时器
  tickTimer = setInterval(() => { if(isWorking(getPunch())) renderPunch(); }, 1000);

  // 跨零点自动切换到新的一天
  let curDay = dkey();
  setInterval(() => {
    if(dkey() !== curDay){ curDay = dkey(); hello(); renderPunch(); renderTasks(); renderTime(); }
  }, 30000);

  /* 打卡 */
  document.getElementById('btnPunch').onclick = doPunch;
  document.getElementById('btnPunchEdit').onclick = () => openPunchEdit();

  /* 任务 */
  const ti = document.getElementById('taskInput');
  const submit = () => { addTask(ti.value, document.getElementById('taskPrio').value); ti.value=''; };
  document.getElementById('btnAddTask').onclick = submit;
  ti.addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); submit(); ti.blur(); } });

  document.getElementById('taskList').onclick = e => {
    const btn = e.target.closest('[data-act]'); if(!btn) return;
    const li = e.target.closest('li'); if(!li) return;
    const day = dkey(); const list = ensureToday();
    const idx = list.findIndex(t => t.id === li.dataset.id); if(idx < 0) return;
    if(btn.dataset.act === 'prio'){ e.stopPropagation(); openPrioMenu(btn, li.dataset.id); return; }
    if(btn.dataset.act === 'toggle'){
      list[idx].done = !list[idx].done;
      if(list[idx].done && list.every(t=>t.done)) setTimeout(()=>toast('今天的任务全部完成 🎉'), 260);
    }else{
      list.splice(idx,1);
    }
    setTasks(day, list); renderTasks();
  };
  document.getElementById('btnTplMgr').onclick = openTplMgr;
  document.getElementById('btnClearDone').onclick = () => {
    const day = dkey(); const list = ensureToday().filter(t => !t.done);
    setTasks(day, list); renderTasks(); toast('已清除完成项');
  };

  /* 导航 */
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => go(t.dataset.page));
  document.getElementById('hotTabs').onclick = e => {
    const b = e.target.closest('.subtab'); if(!b) return;
    hotTab = b.dataset.p;
    document.querySelectorAll('#hotTabs .subtab').forEach(x => x.classList.toggle('active', x===b));
    renderHot();
  };
  document.getElementById('newsTabs').onclick = e => {
    const b = e.target.closest('.subtab'); if(!b) return;
    newsTab = b.dataset.p;
    document.querySelectorAll('#newsTabs .subtab').forEach(x => x.classList.toggle('active', x===b));
    renderNews();
  };

  /* 顶栏 */
  document.getElementById('btnSettings').onclick = openSettings;
  document.getElementById('btnRefresh').onclick = function(){
    LIVE = {}; SNAP = null;
    this.classList.add('spin');
    const cur = document.querySelector('.page.active').id.replace('page-','');
    renderBrief();
    if(cur==='hot') renderHot(); else if(cur==='news') renderNews(); else if(cur==='idea') renderIdea();
    setTimeout(() => { this.classList.remove('spin'); toast('已刷新'); }, 900);
  };

  /* 航运情报 */
  document.getElementById('btnShipSet').onclick = openShipSet;
  document.getElementById('btnShipEditSt').onclick = openShipSet;
  renderShip();

  /* 弹窗关闭 */
  document.getElementById('modalClose').onclick = closeModal;
  document.getElementById('modalMask').onclick = closeModal;
  document.addEventListener('keydown', e => { if(e.key==='Escape') closeModal(); });
  /* 点击空白处关闭优先级下拉 */
  document.addEventListener('click', e => {
    const pop = document.getElementById('prioPop');
    if(!pop.hidden && !pop.contains(e.target)) pop.hidden = true;
  });

  /* 深链 */
  const hash = (location.hash||'').replace('#','');
  if(['home','hot','news','idea','time'].includes(hash) && hash!=='home') go(hash);

  /* 预热快照 */
  snapshot().catch(()=>{});
}

document.addEventListener('DOMContentLoaded', init);
