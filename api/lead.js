/* =========================================================================
   线索中转 · /api/lead
   把 pushplus token 留在服务端环境变量里，不进页面、不进仓库、不进聊天记录。
   -------------------------------------------------------------------------
   为什么要有这一层：
     静态页直连 pushplus ⇒ token 必须写在 index.html 里 ⇒ 谁 view-source 谁拿到。
     加了这层，页面只认识"中转地址"，token 只在平台的环境变量里。
   -------------------------------------------------------------------------
   Vercel 部署（免费，GitHub 账号直接登录）：
     1. vercel.com → Add New → Project → Import 仓库 yingkk174-droid/kk-kikibot → Deploy
     2. Settings → Environment Variables → 加 PUSHPLUS_TOKEN = <你的 token> → 重新 Deploy 一次
     3. 得到 https://<项目>.vercel.app ，函数地址 = /api/lead
     4. 把该地址给我，我改 index.html：SINK="raw"、WEBHOOK="https://<项目>.vercel.app/api/lead"

   ⚠️ 本文件是仓库里的 api/lead.js 的源。改了这里要同步推到仓库，否则线上跑的是旧的。

   换平台：
     Cloudflare Worker → export default { async fetch(req, env){ … } }，token 取 env.PUSHPLUS_TOKEN
     腾讯云函数 / 阿里云 FC → module.exports.main_handler = async (event) => { … }，body 在 event.body
   ========================================================================= */

const PUSHPLUS = "https://www.pushplus.plus/send";

/* 只接受这几个来源，挡掉随手打过来的请求。
   ⚠️ Origin 可被 curl 伪造，这不是安全边界，只挡"顺手乱打"。真正的边界是 pushplus 的额度。 */
const ALLOW = [
  "https://yingkk174-droid.github.io",
  "http://localhost"
];

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || "";
  const okOrigin = !origin || ALLOW.some(a => origin === a) || origin.endsWith(".vercel.app");

  res.setHeader("Access-Control-Allow-Origin", okOrigin ? (origin || "*") : "null");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(204).end();   /* 页面发 json，预检必须答得上 */
  if (req.method !== "POST") return res.status(405).json({ err: "POST only" });
  if (!okOrigin) return res.status(403).json({ err: "bad origin" });

  const d = typeof req.body === "string" ? safeParse(req.body) : (req.body || {});
  if (!d) return res.status(400).json({ err: "bad json" });

  const text = d.text || fallbackText(d);   /* 页面 raw SINK 会带 text；缺了就按字段拼，不静默丢 */
  const hi = d.intent === "high";
  const title = "新线索 · " + (d.branch_name || d.branch || "") + (hi ? " · 高意向" : "");

  let r;
  try {
    r = await fetch(PUSHPLUS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: process.env.PUSHPLUS_TOKEN,
        title: title.slice(0, 32),
        content: text,
        template: "txt"
      })
    }).then(x => x.json());
  } catch (e) {
    return res.status(502).json({ relayed: false, err: String(e) });   /* 让前端能感知失败 */
  }

  /* 200 只是"中转收到了"。pushplus 的结果原样带回，方便排障（code 200 = 真发出去了） */
  return res.status(200).json({ relayed: true, pushplus: r });
};

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
function fallbackText(d) {
  return [
    "【KK 团队 · 需求登记】",
    "渠道：" + (d.channel || ""),
    "需求：" + (d.branch_name || ""),
    "称呼：" + (d.name || ""),
    "平台 / 品类：" + (d.plat || "") + " / " + (d.cat || ""),
    "体量：" + (d.scale || ""),
    "想解决：" + (d.want || ""),
    "联系方式：" + (d.contact || ""),
    "时间：" + (d.ts || "")
  ].join("\n");
}
