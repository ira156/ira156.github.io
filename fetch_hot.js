// 云端每日热榜抓取（GitHub Actions 中运行，无需任何 key）
// 更新 daily.json 中可从公开接口获取的部分：
//   weibo(微博热搜快照·浏览器回落用) / bilibili(B站官方热门) / xhs_hot(小红书热榜 rednote)
//   news_world(每天60秒读懂世界) / inspiration.quote(一言)
// 需 LLM 精编的字段（policy/agents/xiaohongshu 精选/news_cn_extra）原样保留，
// 并用 *_date 记录各自最后生成日期，前端按分区显示新鲜度标签。
const fs = require('fs');
const path = require('path');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
const base = __dirname;
const fpath = path.join(base, 'data', 'daily.json');
const old = (() => { try { return JSON.parse(fs.readFileSync(fpath, 'utf8')); } catch (e) { return {}; } })();

// 北京时间日期（workflow 的 07:30 北京档对应 UTC 前一天 23:30，不能用 UTC 日期）
const bj = new Date(Date.now() + 8 * 3600e3);
const today = bj.toISOString().slice(0, 10);
const weekday = ['周日','周一','周二','周三','周四','周五','周六'][bj.getUTCDay()];

async function getJSON(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 12000);
  try {
    const r = await fetch(url, { headers: UA, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

(async () => {
  const out = Object.assign({}, old);
  const got = [];

  // 1) 微博热搜（供浏览器直连失败时回落）
  try {
    const j = await getJSON('https://60s.viki.moe/v2/weibo');
    if (j && j.code === 200 && Array.isArray(j.data) && j.data.length) {
      out.weibo = j.data.slice(0, 40).map(x => ({ title: x.title, hot_value: x.hot_value, link: x.link }));
      got.push('微博 ' + out.weibo.length);
    }
  } catch (e) { console.log('微博抓取失败，保留旧值:', e.message); }

  // 2) B站官方热门（无需登录）
  try {
    const j = await getJSON('https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1');
    if (j && j.code === 0 && j.data && Array.isArray(j.data.list) && j.data.list.length) {
      out.bilibili = j.data.list.map(x => ({
        title: x.title,
        author: (x.owner && x.owner.name) || '',
        view: (x.stat && x.stat.view) || 0,
        like: (x.stat && x.stat.like) || 0,
        cat: x.tname || '',
        link: 'https://www.bilibili.com/video/' + x.bvid,
        cover: x.pic || ''
      }));
      got.push('B站 ' + out.bilibili.length);
    }
  } catch (e) { console.log('B站抓取失败，保留旧值:', e.message); }

  // 3) 小红书热榜（60s rednote 端点）
  try {
    const j = await getJSON('https://60s.viki.moe/v2/rednote');
    if (j && j.code === 200 && Array.isArray(j.data) && j.data.length) {
      out.xhs_hot = j.data.slice(0, 30).map(x => ({
        rank: x.rank, title: x.title, score: x.score || '', word_type: x.word_type || '', link: x.link || ''
      }));
      got.push('小红书 ' + out.xhs_hot.length);
    }
  } catch (e) { console.log('小红书抓取失败，保留旧值:', e.message); }

  // 4) 国际/天下要闻（每天60秒读懂世界）
  try {
    const j = await getJSON('https://60s.viki.moe/v2/60s');
    if (j && j.code === 200 && j.data && Array.isArray(j.data.news) && j.data.news.length) {
      out.news_world = j.data.news.slice(0, 14).map(t => ({
        title: String(t).replace(/^\d+[.、]\s*/, ''),
        desc: '', region: '天下', source: '每天60秒读懂世界 ' + (j.data.date || today)
      }));
      got.push('国际 ' + out.news_world.length);
    }
  } catch (e) { console.log('60s抓取失败，保留旧值:', e.message); }

  // 5) 灵感金句（一言）
  try {
    const j = await getJSON('https://v1.hitokoto.cn');
    if (j && j.hitokoto) {
      out.inspiration = out.inspiration || {};
      out.inspiration.quote = { text: j.hitokoto, from: [j.from_who, j.from].filter(Boolean).join('《') ? (j.from_who ? j.from_who + (j.from ? ' · 《' + j.from + '》' : '') : '《' + (j.from || '') + '》') : '一言' };
      got.push('一言');
    }
  } catch (e) { console.log('一言抓取失败，保留旧值:', e.message); }

  // 6) 分区日期：LLM 精编字段沿用各自的旧日期（首次迁移时取旧文件的总日期）
  const legacyDate = old.date || today;
  out.policy_date        = old.policy_date        || (old.policy        && old.policy.length        ? legacyDate : '');
  out.agents_date        = old.agents_date        || (old.agents        && old.agents.length        ? legacyDate : '');
  out.xiaohongshu_date   = old.xiaohongshu_date   || (old.xiaohongshu   && old.xiaohongshu.length   ? legacyDate : '');
  out.news_cn_extra_date = old.news_cn_extra_date || (old.news_cn_extra && old.news_cn_extra.length ? legacyDate : '');

  // 7) 总日期与元信息
  out.generated_at = bj.toISOString().replace('T', ' ').slice(0, 19) + ' +08:00';
  out.date = today;
  out.weekday = weekday;
  out.note = '热榜/国际/金句由云端公开接口每日抓取；政策、AI Agent、小红书精选等需 LLM 精编的分区沿用各自最近快照（分区标签会标注日期）。';

  fs.mkdirSync(path.join(base, 'data'), { recursive: true });
  fs.writeFileSync(fpath, JSON.stringify(out, null, 2), 'utf8');
  console.log('✅ daily.json 热榜已更新 →', today, weekday, '|', got.join(' | ') || '（全部源失败，仅更新日期）');
})();
