// @deepseek-ai/dsh-billing — Host half (persistent web-profile plugin).
// Shows DeepSeek 充值余额 (recharge balance) and 今日消费 (today's consumption)
// below the chat dialog. Uses the DeepSeek platform login bearer token to call
// the official /api/v0 endpoints through the local Clash proxy (Node fetch).
//
// Data flow: /billing/data → spawn node lib/fetch-helper.js (through proxy) →
// read result JSON → serve to the browser client (lib/client.js).
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Plugin identity used by the loader and the client-modules scan. */
const name = "dsh-billing";

/** Cordis services this plugin needs to activate. */
const inject = ["webServer", "timer", "subprocess"];

// Local Clash proxy (127.0.0.1:7897) is required to reach platform.deepseek.com.
const PROXY = "http://127.0.0.1:7897";
const BALANCE_TTL = 60000; // refresh data at most once per minute

const __dirname = dirname(fileURLToPath(import.meta.url));
const HELPER = join(__dirname, "fetch-helper.js");
const CONFIG = join(__dirname, "..", "config.json");
const OUT = join(__dirname, ".last-data.json");

let cached = null;
let cachedAt = 0;

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
  res.end(JSON.stringify(body));
}

function queryOf(url) {
  const out = {};
  if (!url) return out;
  const q = url.indexOf("?");
  if (q === -1) return out;
  const search = url.slice(q + 1);
  for (const part of search.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) out[decodeURIComponent(part)] = "";
    else out[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1));
  }
  return out;
}

/**
 * Spawn node lib/fetch-helper.js <out> <token>. The helper writes its JSON
 * result to <out> and the host reads it back (avoids pipe-capture issues).
 */
async function runHelper(ctx, token) {
  const sub = ctx.get("subprocess");
  if (!sub) return { ok: false, reason: "no-subprocess" };
  const exe = await sub.resolveExecutable("node.exe");
  const handle = sub.spawn({
    argv: [exe, HELPER, OUT, token, PROXY],
    cwd: __dirname,
    stdio: { stdin: "ignore", stdout: "inherit", stderr: "inherit" },
    graceMs: 8000,
  });
  await handle.done;
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(OUT, "utf8");
  return JSON.parse(text);
}

async function ensureFresh(ctx) {
  const now = Date.now();
  if (cached && now - cachedAt < BALANCE_TTL && !cached.error) return cached;
  try {
    const { readFile } = await import("node:fs/promises");
    let token = "";
    try {
      const cfg = JSON.parse(await readFile(CONFIG, "utf8"));
      token = (cfg && cfg.token) || "";
    } catch (e) {
      token = "";
    }
    let data;
    if (!token) {
      data = { ok: false, reason: "no-token", message: "尚未配置 token" };
    } else {
      data = await runHelper(ctx, token);
    }
    if (data && data.ok) {
      cached = data;
      cachedAt = Date.now();
    }
    return data;
  } catch (e) {
    return { ok: false, reason: "exception", message: String((e && e.message) || e) };
  }
}

function apply(ctx) {
  ctx.webServer.register({
    kind: "exact",
    path: "/billing/data",
    handler: async (req, res) => {
      const route = new URL(req.url || "/", "http://x");
      if (route.pathname !== "/billing/data") return json(res, 404, { error: "not-found" });
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method" });
      const q = queryOf(req.url);
      void q; // session-scoped display not needed for today-wide spend
      const data = await ensureFresh(ctx);
      if (!data || !data.ok) {
        return json(res, 200, { ok: false, error: (data && data.message) || "failed" });
      }
      // wallets → balance (充值余额), totalCosts → today's spend (今日消费)
      const wallets = data.wallets || [];
      const costs = data.totalCosts || [];
      const balance = wallets.length ? wallets[0] : { balance: null, currency: "CNY" };
      const spend = costs.length ? costs[0] : { amount: "0", currency: "CNY" };
      json(res, 200, {
        ok: true,
        balance: {
          currency: balance.currency || "CNY",
          toppedUp: balance.balance != null ? String(balance.balance) : null,
        },
        consumption: {
          cny: parseFloat(spend.amount) || 0,
          currency: spend.currency || "CNY",
          today: data.today === true,
        },
        ts: data.ts,
      });
    },
  });

  // Keep warm every minute.
  ctx.timer.interval(() => {
    ensureFresh(ctx).then(() => {}, () => {});
  }, 60000);
}

export { apply, inject, name };
