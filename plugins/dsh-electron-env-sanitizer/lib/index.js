// @deepseek-ai/dsh-electron-env-sanitizer — Host 半侧插件
//
// 解决的问题
// ----------
// DSH 桌面版在宿主进程环境里留下了 `ELECTRON_RUN_AS_NODE=1`。
// 该变量是 DSH 自己用的：`resources\runtime\bin\node.cmd` 靠它把 Electron
// 主程序当 Node 跑（`set ELECTRON_RUN_AS_NODE=1` + `DeepSeek Harness.exe --expose-internals`）。
//
// 问题出在**继承**：宿主进程带着这个变量，凡是它 spawn 的子进程都会继承。
// 而 Electron 系应用的启动器（VS Code / Cursor / Windsurf / Zed …）看到该变量
// 就**进入 Node 模式而不是 GUI 模式**，把传来的路径当成 JS 脚本加载：
//
//     $ "…\Code.exe" "D:\LLM\DSH"
//     Error: Cannot find module 'D:\LLM\DSH'
//       code: 'MODULE_NOT_FOUND'   (Node.js v24.18.0)
//     exit code: 1
//
// 结果是应用**根本没启动**，只返回退出码 1 —— 界面表现为
// 「用 VS Code 打开」报「操作失败，请重试」。
//
// 为什么 scrubbedParentEnv() 没拦住
// ---------------------------------
// open-in-app 启动子进程时确实用了 `scrubbedParentEnv()`，但它只清理两类：
//   ① DSH_* 前缀的变量
//   ② 匹配 /KEY|PASSWORD|SECRET|TOKEN/i 的敏感变量
// `ELECTRON_RUN_AS_NODE` 两类都不属于，于是被原样传给子进程。
//
// 本插件做什么
// ------------
// 在宿主启动时把 `ELECTRON_RUN_AS_NODE` 从 process.env 中删除。
// 子进程因此不再继承它，Electron 系应用恢复正常的 GUI 启动。
//
// 为什么不影响 DSH 自身
// ---------------------
// DSH 需要该变量时是在 `node.cmd` 跳板里**显式 set** 的，每次调用都会重设；
// 宿主进程本身已是运行中的 Electron 主程序，不依赖这个变量继续运行。
// 因此从宿主环境删除只影响「子进程继承」，不削弱 DSH 的任何功能。
//
// 版本：0.2.0
//
// 实测记录（2026-09-27）——干净对照实验：
//   ELECTRON_RUN_AS_NODE=1  → VS Code 退出码 1，进程数 0（未启动）
//   未设置该变量            → VS Code 正常打开「欢迎 - DSH」窗口
//
/** 插件名（与 profile patch 的 id 对应）。 */
export const name = "electron-env-sanitizer";

/**
 * 需要从宿主环境中清除的变量。
 *
 * 目前只有 `ELECTRON_RUN_AS_NODE`：它让所有 Electron 系应用退化为 Node。
 * 若日后发现其它同类泄漏（例如 `ELECTRON_NO_ATTACH_CONSOLE`），在此追加即可。
 */
const POLLUTED_ENV_KEYS = ["ELECTRON_RUN_AS_NODE"];

/** 本插件的运行记录，便于诊断。 */
export const sanitizerState = {
  /** 本次启动实际清除了哪些键 */
  cleared: [],
  /** 清除时的原始值（仅诊断用，不含敏感信息） */
  originalValues: {},
};

/**
 * Cordis 插件入口。
 *
 * 本插件**不注册任何服务、不注入任何依赖**：它只在激活时做一次进程级
 * 环境净化，属于"启动即生效"的一次性动作。
 *
 * @param {object} ctx - Cordis 上下文。
 */
export function apply(ctx) {
  // 只在 Windows 桌面版语境下有意义；其它平台直接跳过（无害）。
  if (process.platform !== "win32") {
    ctx.logger?.debug?.("electron-env-sanitizer: 仅 Windows 需要，已跳过");
    return;
  }

  const cleared = [];
  for (const key of POLLUTED_ENV_KEYS) {
    const value = process.env[key];
    if (value === undefined) continue;
    sanitizerState.originalValues[key] = value;
    delete process.env[key];
    cleared.push(key);
  }

  sanitizerState.cleared = cleared;

  if (cleared.length === 0) {
    ctx.logger?.info?.("electron-env-sanitizer: 无需清理（相关变量不存在）");
    return;
  }

  // 这条日志是排障的关键线索：出现它说明宿主环境确实被污染过，
  // 且现在已净化——之后 spawn 的 Electron 系应用应能正常启动。
  ctx.logger?.info?.(
    `electron-env-sanitizer: 已从宿主环境清除 ${cleared.length} 个污染变量 `
    + `(${cleared.join(", ")})；此后子进程不再继承，Electron 系应用可正常启动`,
  );
}
