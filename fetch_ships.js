// 船讯网(ShipXY) V3 船队船位拉取脚本
// 从 .shipxy-key 读取 Key（不进仓库），批量查询固定 MMSI 列表，输出 data/ships.json
const fs = require('fs');
const path = require('path');

const KEY = (() => {
  try { return fs.readFileSync(path.join(__dirname, '.shipxy-key'), 'utf8').trim(); }
  catch (e) { return process.env.SHIPXY_KEY || ''; }
})();

// 公司船队 MMSI 列表（用户于 2026-08-10 提供）
const MMSIS = ['413826197', '413800874', '413800879', '413825207', '413829252', '413794831'];

if (!KEY) { console.error('未找到 Key：请放 .shipxy-key 或设置 SHIPXY_KEY'); process.exit(1); }

const url = 'https://api.shipxy.com/apicall/v3/GetManyShip?key=' + KEY + '&mmsis=' + MMSIS.join(',');

const STAT = { 0: '在航', 1: '锚泊', 2: '系泊', 3: '靠岸', 4: '受限操纵', 5: '锚泊(漂泊)', 6: '搁浅', 7: '从事捕捞', 8: '靠帆航行', 9: '危险货物' };

fetch(url)
  .then(r => r.text())
  .then(t => {
    const j = JSON.parse(t);
    if (j.status !== 0) { console.error('API错误 status=' + j.status, j.msg); process.exit(1); }
    const now = new Date().toISOString();
    const ships = (j.data || []).map(s => ({
      mmsi: s.mmsi,
      name: s.ship_cnname || s.ship_name || String(s.mmsi),
      lng: s.lng, lat: s.lat,
      sog: s.sog, cog: s.cog,
      navistat: s.navistat,
      navText: STAT[s.navistat] || '未知',
      dest: s.dest || '',
      eta: s.eta || '',
      last_time: s.last_time || '',
      updated: now
    }));
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'data', 'ships.json'), JSON.stringify({ updated: now, ships }, null, 2));
    console.log('OK 已写入 data/ships.json，船数=' + ships.length);
  })
  .catch(e => { console.error('FETCH_FAIL', e.message); process.exit(1); });
