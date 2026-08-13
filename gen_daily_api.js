// 云端每日内容精编（GitHub Actions 中运行）
// 仅在配置了 LLM_API_KEY 时生效；否则直接退出，不影响气象/船队/热榜刷新。
// 架构：逐分区「两阶段」——①联网检索出真实材料（自由文本）②把材料格式化为指定 JSON。
// 分步的原因：一次性大 prompt + 强制 JSON 会让小模型（glm-4-flash）跳过检索直接臆造占位内容。
// 每个分区独立质量门，不合格就保留旧快照（前端会按分区日期显示「待更新」，绝不用假数据冒充新鲜）。
const fs = require('fs');
const path = require('path');

const KEY = process.env.LLM_API_KEY || '';
if (!KEY) { console.log('未配置 LLM_API_KEY，跳过内容精编'); process.exit(0); }

const BASE = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const IS_GLM = /bigmodel\.cn/.test(BASE);
const base = __dirname;
const fpath = path.join(base, 'data', 'daily.json');
const old = (() => { try { return JSON.parse(fs.readFileSync(fpath, 'utf8')); } catch (e) { return {}; } })();

const bj = new Date(Date.now() + 8 * 3600e3);
const today = bj.toISOString().slice(0, 10);

const SECTIONS = [
  {
    field: 'policy', dateField: 'policy_date', dateKey: 'date', min: 2,
    query: `联网搜索 ${today} 前后 7 天内中国最新发布的政策法规（优先交通运输部、国务院、航运/物流/水运/长江相关）。把检索到的真实结果逐条列出，每条含：标题、发布日期、发布机构、来源媒体。只列真实检索到的，找不到就明说，不要编造。`,
    schema: '[{"title":"","date":"YYYY-MM-DD","level":"如 国家级/部委/地方","summary":"60字内真实要点","impact":[{"industry":"受影响行业","text":"40字内影响"}],"source":"真实来源"}] ×3~5 条'
  },
  {
    field: 'agents', dateField: 'agents_date', dateKey: null, min: 2,
    query: `联网搜索 ${today} 前后两周内真实新发布或重大更新的 AI Agent / 智能体产品。逐条列出检索到的真实结果，每条含：产品名、公司、发布日期、能做什么、来源链接。只列真实检索到的，不要编造。`,
    schema: '[{"name":"真实产品名","date":"真实日期","org":"真实公司","tag":"类型","desc":"60字内真实能力","price":"价格或免费","why":"30字内值得关注点","link":"真实链接"}] ×3~5 条'
  },
  {
    field: 'xiaohongshu', dateField: 'xiaohongshu_date', dateKey: null, min: 2,
    query: `联网搜索 ${today} 前后小红书平台上真实的热门趋势/爆款话题（穿搭、美食、家居、数码等消费方向）。逐条列出检索到的真实趋势，每条含：话题名、热度证据、相关商品、来源。只列真实检索到的，不要编造。`,
    schema: '[{"title":"真实话题","tag":"品类","desc":"60字内趋势描述","heat":"真实热度证据","goods":"关联商品","insight":"40字内可执行洞察","source":"真实来源"}] ×3~5 条'
  },
  {
    field: 'news_cn_extra', dateField: 'news_cn_extra_date', dateKey: null, min: 2,
    query: `联网搜索 ${today} 及前后两天的中国国内重要新闻（财经、产业、交通、民生方向）。逐条列出检索到的真实新闻，每条含：标题、日期、来源。只列真实检索到的，不要编造。`,
    schema: '[{"title":"真实标题","desc":"60字内真实摘要","tag":"分类"}] ×4~6 条'
  }
];

async function chat(messages, useSearch) {
  const body = { model: MODEL, messages, temperature: 0.3, max_tokens: 4000 };
  if (useSearch && IS_GLM) body.tools = [{ type: 'web_search', web_search: { enable: true } }];
  if (useSearch && !IS_GLM) body.response_format = undefined;
  const r = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 150));
  const j = await r.json();
  return j.choices?.[0]?.message?.content || '';
}

function parseArray(text) {
  const m = String(text || '').match(/\[[\s\S]*\]/);
  if (!m) return null;
  try { const a = JSON.parse(m[0]); return Array.isArray(a) ? a : null; } catch (e) { return null; }
}

function looksFake(items, dateKey) {
  if (!Array.isArray(items)) return true;
  const blob = JSON.stringify(items);
  if (/公司[A-ZＡ-Ｚ]|AI Agent [A-Z]|示例|占位|产品[AB甲]/.test(blob)) return true;
  if (dateKey) {
    const dates = items.map(x => Date.parse(x[dateKey] || '')).filter(n => !isNaN(n));
    if (dates.length && Math.max(...dates) < Date.now() - 30 * 864e5) return true;
  }
  return false;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const out = Object.assign({}, old);
  out.generated_at = bj.toISOString().replace('T', ' ').slice(0, 19) + ' +08:00';
  out.date = today;
  out.weekday = ['周日','周一','周二','周三','周四','周五','周六'][bj.getUTCDay()];
  out.note = '热榜/国际/金句来自公开接口每日抓取；政策/AI Agent/小红书精选/国内精编由云端 LLM 联网检索精编（检索失败的分区保留最近真实快照并标注日期）。';

  for (const sec of SECTIONS) {
    try {
      // 阶段①：联网检索真实材料
      const material = await chat([
        { role: 'system', content: '你是严谨的中文编辑，只报告联网检索到的真实信息，绝不编造。' },
        { role: 'user', content: sec.query }
      ], true);
      if (!material || material.length < 50 || /没有找到|无法检索|未检索到/.test(material.slice(0, 60))) {
        console.log('  ⏭️', sec.field, '检索无有效材料，保留旧快照');
        continue;
      }
      await sleep(800);
      // 阶段②：材料 → 目标 JSON（只允许用材料里的信息）
      const formatted = await chat([
        { role: 'system', content: '你只把给定材料整理成指定 JSON，材料之外的信息一律不得添加。只输出 JSON 数组。' },
        { role: 'user', content: `把以下检索材料整理成 JSON 数组，结构：${sec.schema}\n规则：只允许使用材料中出现的信息；材料缺失的字段填空字符串；不得编造。\n\n检索材料：\n${material}` }
      ], false);
      const arr = parseArray(formatted);
      if (arr && arr.length >= sec.min && !looksFake(arr, sec.dateKey)) {
        out[sec.field] = arr;
        out[sec.dateField] = today;
        console.log('  ✅', sec.field, arr.length, '条（联网精编）');
      } else {
        console.log('  ⏭️', sec.field, '质量门未过（' + (arr ? arr.length + '条' : '解析失败') + '），保留旧快照');
      }
    } catch (e) {
      console.log('  ⚠️', sec.field, '生成出错，保留旧快照:', e.message.slice(0, 80));
    }
    await sleep(800);
  }

  // 实时分区始终保留 fetch_hot.js 的成果；国际/金句以公开接口为准，LLM 不碰
  out.bilibili = old.bilibili || [];
  out.weibo = old.weibo || [];
  out.xhs_hot = old.xhs_hot || [];
  out.news_world = old.news_world || [];
  out.inspiration = old.inspiration || {};

  fs.writeFileSync(fpath, JSON.stringify(out, null, 2), 'utf8');
  console.log('✅ daily.json 精编流程完成 →', today);
})();
