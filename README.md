# DSH Extensions

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![secret-scan](https://github.com/furoute/dsh/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/furoute/dsh/actions/workflows/secret-scan.yml)
[![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.2-4a9eff)](https://github.com/deepseek-ai)

> 基于 **DeepSeek Harness (DSH)** 桌面版的个人扩展集合：客户端插件、会话工具，
> 以及踩坑与调优沉淀的中文实践文档。

> ⚠️ **本仓库是个人扩展，非官方项目，与 DeepSeek 无任何隶属或背书关系。**
> 所有私有凭据在归档管线中已被剔除（见 [安全与脱敏](#安全与脱敏)）。
> 插件 `package.json` 沿用 `@deepseek-ai/*` 前缀，仅因宿主注入协议按包名识别；
> 这些包**均标记 `"private": true`，不会也不得发布到 npm 的 `@deepseek-ai` scope**
> （该 scope 属于官方，发布即构成冒用）。

## 目录

- [特性](#特性)
- [插件一览](#插件一览)
- [快速开始](#快速开始)
- [实践 Issues（已修复）](#实践-issues我们踩过并已修复的)
- [工具一览](#工具一览)
- [文档一览](#文档一览)
- [兼容性](#兼容性)
- [安全与脱敏](#安全与脱敏)
- [贡献](#贡献)
- [许可](#许可)

---

## 🔴 最近更新（2026-10-18）

- 新增插件 [`dsh-work-mode`](plugins/dsh-work-mode/)：办公 / 代码模式**即时切换**（不重启会话）。
- 新增「实践 Issues」章节，归置 3 条已修复问题（升级启动失败、CLI 凭证、资源管理器打开）。

---

## 特性

- **即插即用** —— 复制到 `$DSH_HOME/local-plugins/`，重启 DSH 桌面版即可使用，无需 `npm install`。
- **纯本地运行** —— 插件在宿主 / 浏览器两端注入，无独立服务；全部外联端点见 [网络与外联](#网络与外联)。
- **中文实践文档** —— 每条经验都附排障过程与验证方法，不转述官方公告。
- **三道密钥闸门** —— 自研审计脚本 + gitleaks CI + 外部独立复核，实现互相独立。
- **持续跟进升级** —— 随 DSH 桌面版迭代同步验证（当前基线 `0.2.1-rc.2`）。

---

## 插件一览

### 1. `dsh-billing` — 余额与消费显示

在聊天输入框下方常驻显示 **DeepSeek 平台充值余额**与**当前会话消费金额**。
通过宿主半侧 spawn 一个 Node 小助手进程请求平台接口，避免在渲染进程直接暴露凭据。

- 注入点：`dsh-client-ui-conversation`
- 凭据来源：插件目录下 `config.json`（**仓库内为空模板**）
- 安全：token 经**环境变量**传给子进程，**不走命令行参数**
  （Windows 上命令行可被同机其它进程通过 WMI/CIM 读取）
- 文件：[`plugins/dsh-billing/`](plugins/dsh-billing/)

> ⚠️ 使用前请把 `config.json` 的 `token` 换成你自己的平台登录令牌，**不要提交到任何仓库**。
> 该文件已被 `.gitignore` 排除。

### 2. `dsh-poetry` — 侧边栏诗泉

侧边栏常驻的小面板，从 `poetry.palemoky.com` 在线接口随机拉取一首中国古典诗词展示。

- 注入点：`dsh-client-ui-sidebar`
- 无需凭据
- 文件：[`plugins/dsh-poetry/`](plugins/dsh-poetry/)

### 3. `dsh-find` — 会话内查找

在会话里提供 **Ctrl+F 查找条**：高亮 + 上一处/下一处跳转。
基于 DOM 文本级匹配，**对中文分词友好**（不依赖浏览器原生 find）。

- 注入点：`dsh-client-runtime`（纯客户端）
- 无需凭据
- 文件：[`plugins/dsh-find/`](plugins/dsh-find/)

### 4. `dsh-electron-env-sanitizer` — Electron 环境变量净化

**修复 DSH 桌面版一个真实缺陷**：宿主进程残留 `ELECTRON_RUN_AS_NODE=1`，
被 spawn 的子进程继承后，导致 VS Code / Cursor 等 Electron 系应用**以 Node 模式启动**，
表现为「用 VS Code 打开」报「操作失败，请重试」。

插件在宿主启动时从 `process.env` 删除该变量，恢复子进程正常 GUI 启动。

> 完整根因分析（含 `scrubbedParentEnv()` 为何漏掉此变量）见
> [`plugins/dsh-electron-env-sanitizer/lib/index.js`](plugins/dsh-electron-env-sanitizer/lib/index.js) 顶部注释。

- 文件：[`plugins/dsh-electron-env-sanitizer/`](plugins/dsh-electron-env-sanitizer/)

### 5. `dsh-work-mode` — 办公 / 代码工作模式切换

在输入框下方常驻一个模式胶囊，**点一下即可在「办公」与「代码」之间即时切换**，无需重启会话
（类似 Codex ↔ ChatGPT Work 的切换体验）；「设置 → 通用」里另有「办公 / 代码 / 两者」三选一行。

切换时同步写入四项偏好，宿主即时生效：

| 配置项 | 办公 | 代码 |
|---|---|---|
| `ui-chat.transcriptView` | `compact` | `standard` |
| `ui-chat.performanceUsage` | `compact` | `detailed` |
| `ui-settings.developerTools` | 关 | 开 |
| `ui-settings-account.purpose` | `office` | `development` / `both` |

> 这一项 `purpose` 正是 DSH 桌面版首次启动引导向导里「办公 / 代码」选择所写入的字段；
> 插件把它变成可随时切换的开关，避免引导选择在升级后丢失或无法更改。
> 切换只影响界面偏好（对话视图、用量显示、开发者工具），不影响模型能力与技能。

- 注入点：`conversation.composer.dock` + `settings.general.item`
- 无需凭据、无外联
- 文件：[`plugins/dsh-work-mode/`](plugins/dsh-work-mode/)

---

## 快速开始

### 环境要求

| 项 | 要求 |
|---|---|
| DSH | 桌面版（当前验证基线 `0.2.1-rc.2`） |
| 插件协议 | cordis `^4.0.1`、React 18（由 DSH 宿主提供） |
| 操作系统 | Windows（全部插件在 Windows 桌面版上验证） |

### 安装插件

**方式一：一键部署包（推荐）**

```powershell
# 以 dsh-billing 为例
cd deploy\dsh-billing-deploy
pwsh -File install.ps1
```

脚本会把 `package\` 内容复制到 `$env:USERPROFILE\.dsh\local-plugins\<插件名>\`。

**方式二：手动放置**

```powershell
Copy-Item -Recurse plugins\dsh-billing "$env:USERPROFILE\.dsh\local-plugins\dsh-billing"
```

放置后**重启 DSH 桌面版**生效。

> `dsh-work-mode` 需要注册进 profile 才会加载。放置后执行一次：
>
> ```powershell
> dsh plugin --profile desktop add "$env:USERPROFILE\.dsh\local-plugins\dsh-work-mode"
> ```
>
> 然后在该 profile 的 `cordis.patch.yml` 末尾追加：
>
> ```yaml
> - insert:
>     - id: dsh-work-mode
>       name: '@deepseek-ai/dsh-work-mode'
> ```
>
> 重启后输入框下方会出现模式胶囊。

### 验证

- 重启后打开一个会话，确认插件入口出现（如 `dsh-work-mode` 的模式胶囊、`dsh-billing` 的余额条）。
- 修改 `cordis.patch.yml` 后若未生效，先确认 DSH 是**完全退出再启动**（不是刷新页面）。
- 插件加载失败时查看 `%APPDATA%\@deepseek-ai\dsh-desktop\logs\` 下的最新日志。

---

## 实践 Issues（我们踩过并已修复的）

> 这里只收录**本仓库作者在真实环境中遇到、定位、修复并复测过**的问题。
> 每条都附完整排障记录（含走过的弯路与验证方法）；官方在后续版本已修复的，会注明版本与验证日期。
> 它不是官方公告的转述，而是我们自己的实践记录。

| # | 问题 | 根因（一句话） | 状态 | 详细记录 |
|---|---|---|---|---|
| 1 | 升级 `0.2.1-rc.2` 后 DSH 打不开 | 用户级环境变量 `DSH_TOOLS_MODE=both`，新版 `dsh-tools` 只认 `native` / `ptc` | ✅ 已修复并复测 | [升级事故与 DSH_TOOLS_MODE 排障](docs/DSH-0.2.1-rc.2-升级事故与DSH_TOOLS_MODE排障.md) |
| 2 | CLI（headless）报 `MISSING_CREDENTIAL` | `dsh-headless` bundle 把凭据服务设为 `disabled: true` | ✅ 已修复并复测 | 同上 |
| 3 | 「用文件资源管理器打开」打不开文件夹 | `runNativeCommand` 固定 `windowsHide: true`，`explorer.exe` 继承 `SW_HIDE` | ✅ 已修复（`0.2.0-rc.2` 官方已内置等价修复） | [部署与迁移总结 · 第八节](docs/桌面版DSH部署与迁移总结.md#八修复实录用文件资源管理器打开按钮打不开文件夹2026-09-28) |

### Issue #1 · 升级 `0.2.1-rc.2` 后启动失败（2026-10-17）

**如果 DSH 桌面版升级到 `0.2.1-rc.2` 后打不开，弹出「插件全部加载失败」，先查这一条 —— 5 秒就能定位：**

```powershell
[Environment]::GetEnvironmentVariable('DSH_TOOLS_MODE','User')
```

**如果返回 `both`，就是它。** 新版 `dsh-tools` 只认 `native` / `ptc`，`both` 是老版本的值：

```powershell
[Environment]::SetEnvironmentVariable('DSH_TOOLS_MODE','native','User')
# 然后完全退出 DSH（进程全退）再启动
```

**要点三条：**

1. **报错框误导人** —— 它让你「禁用第三方插件」，但真凶是核心 `tools` 插件，第三方插件只是被牵连。
2. **真错误在崩溃日志里** —— `%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*.log`，搜 `invalid config`。
3. **升级要连带升级 CLI** —— 桌面版新、全局 `dsh` 和 profile 依赖旧，会隐性错配。

### Issue #2 · CLI（headless）报 `MISSING_CREDENTIAL`（2026-10-17）

**桌面版好了，但用 SSH 唤醒 CLI（headless）仍然不通。** 原因不是 key 丢了，而是新版 `dsh-headless` bundle 把凭据服务禁用了：

```yaml
# dsh --profile headless --dump-config 里能看到
- id: credentials
  name: '@deepseek-ai/dsh-credentials-local'
  disabled: true
```

**修法** —— 追加到 `~/.dsh/profiles/headless/cordis.patch.yml`：

```yaml
- id: credentials
  disabled: false
```

```powershell
dsh --profile headless "只回复两个字：正常"   # 期望：正常（实测 5.7 秒）
```

> 顺带把 `mode` 也从环境变量搬进了三个 profile 的补丁层（`- id: tools` / `mode: native`），
> 然后删掉用户级 `DSH_TOOLS_MODE` —— 以后某个 profile 想切 `ptc` 不会连累其他两个。

📄 完整排障记录（含 6 个查错弯路清单 + CLI 凭证坑 + 环境变量治理）：**[docs/DSH-0.2.1-rc.2-升级事故与DSH_TOOLS_MODE排障.md](docs/DSH-0.2.1-rc.2-升级事故与DSH_TOOLS_MODE排障.md)**

### Issue #3 · 「用文件资源管理器打开」打不开文件夹（2026-09-28）

**现象**：点击会话右上角的「**用 文件资源管理器 打开**」（快捷键 `Ctrl+Alt+O`）后，文件夹窗口没有出现；
用窗口枚举看，`explorer.exe` 进程确实起来了、窗口也在，但 `WS_VISIBLE = 0`（不可见）。

**真根因**：`runNativeCommand()` 对所有命令固定 `windowsHide: true`。这个选项本意是给 `reg.exe` 这类
**控制台工具**「别闪黑框」，但 **`explorer.exe` 是 GUI 启动器**，它继承 `SW_HIDE` 后，窗口被创建出来却是隐藏的。
当时一度怀疑「前台窗口锁」「状态累积」，都被 A/B 对照否定了——任务栏里那个「隐形窗口」就是证据。

**修复**：本机当时对 `app.asar` 内的执行器做了等长原地修补（仅 GUI 启动器不隐藏，其余命令保持隐藏）。
**官方已在 `0.2.0-rc.2` 内置等价修复**（`windowsHide: window === "hidden"`，explorer 调用显式传 `visible`），
所以 9-28 的等长补丁随升级被覆盖，**无需重打**。

📄 完整实录（含 A/B 对照、窗口计数、`ELECTRON_RUN_AS_NODE` 同批发现与「危险修法」）：**[docs/桌面版DSH部署与迁移总结.md 第八节](docs/桌面版DSH部署与迁移总结.md#八修复实录用文件资源管理器打开按钮打不开文件夹2026-09-28)**

---

## 工具一览

| 工具 | 用途 |
|---|---|
| [`tools/dsh-session-search.js`](tools/dsh-session-search.js) | 跨会话检索实现 |
| [`tools/dsh-search.mjs`](tools/dsh-search.mjs) | 会话搜索 CLI |
| [`tools/dsh-search-window.js`](tools/dsh-search-window.js) | 搜索窗口 UI |
| [`tools/verify-fts-chinese.mjs`](tools/verify-fts-chinese.mjs) | 中文全文检索验证 |
| [`tools/asar/`](tools/asar/) | 解析 DSH `app.asar` 的轻量脚本 |

另有一份功能建议：[`tools/DSH会话搜索-功能建议.md`](tools/DSH会话搜索-功能建议.md)

---

## 文档一览

| 文档 | 内容 |
|---|---|
| [DSH-思维链中文配置记录](docs/DSH-思维链中文配置记录.md) | 让模型思考链输出中文的配置 |
| [DSH思维链中文化-复用步骤](docs/DSH思维链中文化-复用步骤.md) | 上述配置的可复用步骤 |
| [DSH-启用run_code-PTC模式-操作手册](docs/DSH-启用run_code-PTC模式-操作手册.md) | PTC 模式启用全过程 |
| [DSH-Computer-Use-安装与测评报告](docs/DSH-Computer-Use-安装与测评报告.md) | Computer Use 能力测评 |
| [DSH-Windows沙箱调研](docs/DSH-Windows沙箱调研.md) | Windows 沙箱机制调研 |
| [桌面版DSH部署与迁移总结](docs/桌面版DSH部署与迁移总结.md) | 部署与迁移完整记录 |
| [DSH-快速升级手册](docs/DSH-快速升级手册.md) | 版本升级流程 |
| [DSH-0.2.1-rc.2-升级事故与DSH_TOOLS_MODE排障](docs/DSH-0.2.1-rc.2-升级事故与DSH_TOOLS_MODE排障.md) | 升级后启动失败的真因：环境变量 `DSH_TOOLS_MODE=both`（含弯路清单）|
| [Agent产物归类方法](docs/Agent产物归类方法.md) | Agent 产物组织思路 |
| [dsh-security-architecture.svg](docs/dsh-security-architecture.svg) | 安全架构图 |

---

## 兼容性

| 组件 | 版本 | 状态 |
|---|---|---|
| DSH 桌面版 | `0.2.1-rc.2` | ✅ 当前验证基线（全部插件与文档按此版本验证） |
| DSH 桌面版 | `0.2.0-rc.2` | ⚠️ 部分验证（「资源管理器」修复官方已内置；新插件以 `0.2.1` 为准） |
| cordis | `^4.0.1` | 插件客户端注入协议要求 |
| React | 18 | 由 DSH 宿主提供，无需单独安装 |

> 升级 DSH 后如遇插件异常，先查 [实践 Issues](#实践-issues我们踩过并已修复的) 与崩溃日志，再反馈。

---

## 安全与脱敏

本仓库的每一条内容都经过**归档管线**处理，而非手工挑选。管线在
[`scripts/`](scripts/) 中可复现：

```powershell
pwsh -File scripts\sanitize-copy.ps1   # 白名单复制 + 自动脱敏
pwsh -File scripts\audit-secrets.ps1   # 审计闸门，发现敏感信息即非零退出
```

> 两台电脑的工作区根不同时，用 `DSH_WORKSPACE` 把它们都列上（分号或逗号分隔），
> 一次运行即同时脱敏两种写法：
> `$env:DSH_WORKSPACE = "<根1>;<根2>"; pwsh -File scripts\sanitize-copy.ps1`

> 最初本仓库是用 GitHub REST API 推送的（开发机未装 git）。现已改用
> **标准 git 流程**维护，CI 闸门随每次 push 自动运行。

### 脱敏策略

| 类别 | 处理 |
|---|---|
| API Key / Token | 替换为 `<YOUR_...>` 占位符 |
| 本机用户名 | 替换为 `<USER>` |
| 用户目录绝对路径 | 替换为 `<USERPROFILE>` |
| 本机工作目录 | 替换为 `<DSH_ROOT>` |
| 本地代理端口 | 替换为 `<PORT>`，改为环境变量读取 |
| 依赖目录 / 备份 / 日志 / 缓存 | 整体排除，不进入归档 |

> 脱敏脚本**不硬编码任何真实用户名或路径**，一律运行时从
> `$env:USERNAME` / `$env:USERPROFILE` 取值——避免"脱敏工具自身成为泄露源"。

### 网络与外联

为了让使用者知情，这里显式列出全部外部端点：

| 插件 | 端点 | 用途 | 是否携带用户数据 |
|---|---|---|---|
| `dsh-billing` | `platform.deepseek.com` | 读取**你自己的**余额与会话消费 | 仅本人 token |
| `dsh-poetry` | `poetry.palemoky.com` | 随机取一首古诗词 | 否（纯 GET） |
| `dsh-work-mode` | 无外联 | 仅读写本机 DSH 设置（`configForms`） | 否 |

除此之外**没有任何其它外联**。

### 代理配置

若你的网络环境需要代理，请**通过环境变量**设置，程序不会硬编码任何端口：

```powershell
$env:HTTPS_PROXY = "http://127.0.0.1:<你的端口>"
$env:HTTP_PROXY  = "http://127.0.0.1:<你的端口>"
```

未设置则直连。`dsh-billing` 的 `config.json` 也支持 `proxy` 字段。

### 推送前校验

审计脚本对以下模式做**阻断式**检查（命中即拒绝推送）：

- `sk-*`、`gho_*` / `ghp_*`、`AKIA*`、`AIza*`、`xox*-*`
- PEM 私钥块、长 Bearer 令牌
- 形如 `api_key|secret|token|password = "<20+ 字符>"` 的赋值
- 残留的本机用户名与他人用户目录路径

**当前状态**：仓库内所有凭据均为占位符，**不含任何真实密钥**。

### 扫描闸门（三道，实现互相独立）

| 闸门 | 实现者 | 何时运行 |
|---|---|---|
| `scripts/audit-secrets.ps1` | 本仓库作者 | 推送前手动 |
| [`.gitleaks.toml`](.gitleaks.toml) + [GitHub Actions](.github/workflows/secret-scan.yml) | **第三方** gitleaks | **每次 push 自动** |
| 外部独立复核 | 其它 AI 智能体 | 阶段性人工发起 |

> **为什么强调"实现独立"**：本仓库实测过一个教训——作者自己写的扫描器，
> 扫不出作者自己制造的盲区。详见 [SECURITY.md](SECURITY.md#最重要的一条教训)。
> **扫描器的数量不解决问题，实现思路不同才解决。**

### 使用提示

- `plugins/dsh-billing/config.json` 需要你自己填 token，且**务必加入 `.gitignore`**（已预置）
- 文档中出现的 `<USER>` / `<USERPROFILE>` / `<DSH_ROOT>` / `<PORT>` 是脱敏占位符，
  按你的实际环境替换
- 网络需代理时，用环境变量设置（`HTTPS_PROXY` 等），代码中不硬编码任何端口

---

## 贡献

- **Bug / 建议**：欢迎提 Issue，请附上 DSH 版本、复现步骤与相关日志片段（注意先脱敏）。
- **Pull Request**：请保持插件 `package.json` 的 `"private": true`，不要提交任何凭据或本机绝对路径。
- **提交前自检**：

  ```powershell
  pwsh -File scripts\audit-secrets.ps1
  ```

  仓库的 gitleaks CI 会在每次 push 时自动运行。

---

## 许可

本仓库内容采用 [MIT License](LICENSE)。

DeepSeek Harness 及其官方组件（`@deepseek-ai/*`）版权归其各自所有者，
本仓库仅归档个人扩展与文档，与官方无隶属关系。
