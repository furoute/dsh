// @deepseek-ai/dsh-billing — node fetch-helper.
// Called by the host half as `node fetch-helper.js <out> <token> [proxy]`.
// Fetches DeepSeek platform balance + TODAY's consumption through the local
// proxy and writes the normalized JSON result to <out>.
import { writeFileSync } from "node:fs";

const token = process.argv[3] || "";
const outPath = process.argv[2];
const proxy = process.argv[4] || "http://127.0.0.1:7897";

process.env.HTTP_PROXY = proxy;
process.env.HTTPS_PROXY = proxy;

const SUMMARY = "https://platform.deepseek.com/api/v0/users/get_user_summary";
const COST = "https://platform.deepseek.com/api/v0/usage/by_api_key/cost";

function writeResult(result) {
  writeFileSync(outPath, JSON.stringify(result), "utf8");
}

function utc(y, mo, d, h, mi, s) {
  return Date.UTC(y, mo, d, h, mi, s) / 1000;
}

function todayRange() {
  const tzSec = -new Date().getTimezoneOffset() * 60;
  const now = new Date();
  const startSec = utc(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0) - tzSec;
  const endSec = utc(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0) - tzSec;
  return { startSec, endSec, tzSec };
}

async function getJSON(url, signal) {
  const res = await fetch(url, {
    signal,
    headers: {
      Authorization: "Bearer " + token,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

(async () => {
  if (!token) {
    writeResult({ ok: false, reason: "no-token", message: "缺少 token" });
    return;
  }
  try {
    const ctrl = new AbortController();
    const kill = setTimeout(() => ctrl.abort(), 25000);

    const sum = await getJSON(SUMMARY, ctrl.signal);
    let wallets = [];
    if (sum.ok && sum.json && sum.json.data && sum.json.data.biz_data) {
      const biz = sum.json.data.biz_data;
      wallets = (biz.normal_wallets || []).map((w) => ({ balance: w.balance, currency: w.currency }));
    }

    const { startSec, endSec, tzSec } = todayRange();
    const costUrl = COST + "?start=" + startSec + "&end=" + endSec + "&tz=" + tzSec;
    const cost = await getJSON(costUrl, ctrl.signal);
    let todayCosts = [];
    if (cost.ok && cost.json && cost.json.data && cost.json.data.biz_data) {
      const biz = cost.json.data.biz_data;
      const byCurrency = {};
      (biz.data || []).forEach((entry) => {
        const cur = entry.currency || "CNY";
        (entry.series || []).forEach((ser) => {
          (ser.buckets || []).forEach((b) => {
            const v = parseFloat(b.cost);
            if (!isNaN(v)) byCurrency[cur] = (byCurrency[cur] || 0) + v;
          });
        });
      });
      todayCosts = Object.keys(byCurrency).map((cur) => ({ currency: cur, amount: byCurrency[cur].toFixed(6) }));
    }

    clearTimeout(kill);

    if (!sum.ok) {
      writeResult({ ok: false, reason: "http-" + sum.status, message: sum.text.slice(0, 300) });
      return;
    }
    if (!cost.ok) {
      writeResult({ ok: false, reason: "cost-http-" + cost.status, message: cost.text.slice(0, 300) });
      return;
    }
    if (!wallets.length && !todayCosts.length) {
      writeResult({ ok: false, reason: "no-data", message: "未返回数据" });
      return;
    }

    writeResult({ ok: true, ts: Date.now(), today: true, wallets, totalCosts: todayCosts });
  } catch (e) {
    writeResult({ ok: false, reason: "exception", message: String((e && e.message) || e) });
  }
})();
