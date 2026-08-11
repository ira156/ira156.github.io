// 云端每日内容生成（GitHub Actions 中运行）
// 仅在配置了 LLM_API_KEY 时生效；否则直接退出，不影响气象/船队刷新。
// 兼容 OpenAI / DeepSeek 等 OpenAI 协议接口（通过 LLM_BASE_URL 切换）。
const fs = require('fs');
const path = require('path');

const KEY = process.env.LLM_API_KEY || '';
if (!KEY) {
  console.log('未配置 LLM_API_KEY，跳过内容生成（保留原有 daily.json）');
  process.exit(0);
}

const BASE = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const base = __dirname;
const old = (() => { try { return JSON.parse(fs.readFileSync(path.join(base, 'data/daily.json'), 'utf8')); } catch (e) { return {}; } })();

const PROMPT = `你是「赵梓池工作台」的每日编辑。请基于今天真实可检索的公开信息，生成一份中文每日情报快照。
要求：严格返回 JSON，不要任何解释文字。结构如下：
{
  "xiaohongshu": [ {"title":"","tag":"","desc":"","heat":"","goods":"","insight":"","source":""} ×≥6 ],
  "policy": [ {"title":"","date":"","level":"","summary":"","impact":[{"industry":"","text":""}],"source":""} ×≥6，优先航运/物流/水运/长江相关内容 ],
  "agents": [ {"name":"","date":"","org":"","tag":"","desc":"","price":""} ×≥6 新发布或更新的 AI Agent/产品 ],
  "news_world": [ {"title":"","desc":"","region":"","source":""} ×≥8 国际要闻 ],
  "news_cn_extra": [ {"title":"","desc":"","tag":""} ×≥8 国内精编 ],
  "inspiration": {
    "quote": {"text":"","from":""},
    "angles": [ {"name":"","tpl":"","good":""} ×≥6 ],
    "sources": [ "字符串" ×≥10 ]
  }
}
所有内容必须基于真实公开来源，抓不到就如实精简，绝不编造。日期相关字段用真实日期（年-月-日）。`;

function buildBody() {
  return {
    model: MODEL,
    messages: [
      { role: 'system', content: '你只输出符合要求的 JSON，不要 markdown 代码块，不要多余文字。' },
      { role: 'user', content: PROMPT }
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' }
  };
}

(async () => {
  try {
    const r = await fetch(BASE + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
      body: JSON.stringify(buildBody())
    });
    if (!r.ok) { console.error('LLM HTTP', r.status, await r.text().slice(0, 300)); process.exit(1); }
    const j = await r.json();
    let text = j.choices?.[0]?.message?.content || '';
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const data = JSON.parse(text);
    const now = new Date();
    const out = {
      generated_at: now.toLocaleString('zh-CN', { hour12: false }),
      date: now.toISOString().slice(0, 10),
      weekday: ['周日','周一','周二','周三','周四','周五','周六'][now.getDay()],
      note: '每日快照由云端 LLM（真实公开来源整理）；B站排行榜需登录态，沿用最近一次成功快照。',
      xiaohongshu: data.xiaohongshu || [],
      policy: data.policy || [],
      agents: data.agents || [],
      news_world: data.news_world || [],
      news_cn_extra: data.news_cn_extra || [],
      inspiration: data.inspiration || old.inspiration || {},
      bilibili: old.bilibili || []
    };
    fs.mkdirSync(path.join(base, 'data'), { recursive: true });
    fs.writeFileSync(path.join(base, 'data', 'daily.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('✅ daily.json 已生成（云端 LLM）：',
      'xhs', out.xiaohongshu.length, '| policy', out.policy.length,
      '| agents', out.agents.length, '| news_w', out.news_world.length, '| news_cn', out.news_cn_extra.length);
  } catch (e) {
    console.error('LLM 内容生成失败，保留旧 daily.json：', e.message);
    process.exit(1);
  }
})();
