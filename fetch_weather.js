// 服务端抓取沿江城市气象（Open-Meteo，免 key），输出 data/weather.json
// 由自动化任务定时运行（与 fetch_ships.js 配合），前端读静态快照，避免浏览器直连境外 API 超时。
const fs = require('fs');

const SHIP_CITIES = {
  '重庆':[29.56,106.55], '宜昌':[30.69,111.29], '武汉':[30.59,114.30],
  '城陵矶':[29.36,113.09], '九江':[29.71,116.00], '南京':[32.06,118.80],
  '南通':[31.98,120.89], '上海':[31.23,121.47]
};

function pull(name, c){
  const [lat, lon] = c;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`+
    `&current=wind_speed_10m,wind_gusts_10m,precipitation,relative_humidity_2m,temperature_2m&timezone=Asia%2FShanghai`;
  return fetch(url).then(r => r.json()).then(j => {
    const d = j.current || {};
    return { name, wind:d.wind_speed_10m||0, gust:d.wind_gusts_10m||0, rain:d.precipitation||0, hum:d.relative_humidity_2m||0, temp:d.temperature_2m||null };
  }).catch(() => ({ name, error:true }));
}

(async () => {
  const arr = await Promise.all(Object.entries(SHIP_CITIES).map(([n,c]) => pull(n,c)));
  const cities = {}; arr.forEach(x => cities[x.name] = x);
  fs.mkdirSync('data', { recursive:true });
  fs.writeFileSync('data/weather.json', JSON.stringify({ updated:new Date().toISOString(), cities }, null, 2));
  console.log('已写 data/weather.json，城市数=', arr.length);
})();
