// 抓取 B站全站排行榜
// 关键：必须用 SPI 接口拿游客 buvid3/buvid4，否则风控直接返回 code -352。
// （旧做法从 bilibili.com 首页 set-cookie 里抠 buvid3，Node 的 fetch 拿不到完整
//   set-cookie，结果 cookie 为空 → 触发 -352。2026-08-11 修复。）
const fs = require('fs');

const BASE = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Referer': 'https://www.bilibili.com/v/popular/rank/all',
  'Accept': 'application/json, text/plain, */*'
};

// 从 SPI 接口获取游客身份标识（稳定可靠，无需登录）
async function getBuvid() {
  const r = await fetch('https://api.bilibili.com/x/frontend/finger/spi', { headers: BASE });
  const j = await r.json();
  if (j.code !== 0 || !j.data) throw new Error('SPI 获取 buvid 失败: ' + JSON.stringify(j).slice(0, 120));
  return { b3: j.data.b_3, b4: j.data.b_4 };
}

(async () => {
  const { b3, b4 } = await getBuvid();
  console.log('buvid3:', b3.slice(0, 20) + '...');

  const nut = Math.floor(Date.now() / 1000);
  const H = { ...BASE, Cookie: `buvid3=${b3}; buvid4=${b4}; b_nut=${nut}` };

  const rank = await fetch('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all', { headers: H })
    .then(r => r.json());
  console.log('rank.code:', rank.code, '| message:', rank.message);

  if (rank.code !== 0) {
    // -352 = 风控校验失败；-799 = 请求过于频繁
    throw new Error(`排行榜接口返回 code=${rank.code}（-352 表示风控拦截，检查 buvid cookie 是否带上）`);
  }

  const list = (rank.data && rank.data.list) || [];
  console.log('list 条数:', list.length);

  const out = list.slice(0, 20).map(x => ({
    title: (x.title || '').trim(),
    author: (x.owner && x.owner.name) || '',
    view: (x.stat && x.stat.view) || 0,
    like: (x.stat && x.stat.like) || 0,
    link: 'https://www.bilibili.com/video/' + x.bvid,
    cover: (x.pic || '').replace(/^http:/, 'https:'),  // 站点是 https，封面必须同源协议否则被浏览器拦截
    cat: x.tname || ''
  }));

  if (!out.length) throw new Error('排行榜为空，未写入文件');

  fs.writeFileSync('bili_data.json', JSON.stringify(out, null, 2));
  console.log('已写入 bili_data.json 条数:', out.length);
  out.slice(0, 5).forEach(x => console.log(' -', x.title, '|', x.author, '| 播放', x.view));
})().catch(e => { console.log('ERR:', e.message); process.exit(1); });
