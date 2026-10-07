# DSH Extensions

> 个人基于 **DeepSeek Harness (DSH)** 桌面版开发/验证的一组扩展：客户端插件、会话工具、
> 以及踩坑与调优沉淀的中文文档。
>
> 本仓库是**独立社区仓库**，非 DeepSeek 官方项目。内容按「自建资产」归档，
> 所有私有凭据在归档管线中已被剔除（见 [安全与脱敏](#安全与脱敏)）。

---

## 这是什么

DSH 桌面版提供了一套插件（cordis 插件）机制，允许在 Host 与 Web 两个半侧注入自定义能力。
本仓库归档的是我在实际使用中**自己写出来并跑通**的东西，分四类：

| 目录 | 内容 | 说明 |
|---|---|---|
| [`plugins/`](plugins/) | 4 个客户端插件源码 | 可直接放入 `$DSH_HOME/local-plugins/` 使用 |
| [`deploy/`](deploy/) | 插件一键部署包 | 含 `install.ps1` 与使用说明 |
| [`tools/`](tools/) | 会话检索与 asar 解析工具 | 独立 Node 脚本，不依赖 DSH 运行 |
| [`docs/`](docs/) | 中文实践文档 | 配置、迁移、升级、安全架构等 |

---

## 插件一览

### 1. `dsh-billing` — 余额与消费显示
在聊天输入框下方常驻显示 **DeepSeek 平台充值余额**与**当前会话消费金额**。
通过宿主半侧 spawn 一个 Node 小助手进程请求平台接口，避免在渲染进程直接暴露凭据。

- 注入点：`dsh-client-ui-conversation`
- 凭据来源：插件目录下 `config.json`（**仓库内为空模板**）
- 文件：[`plugins/dsh-billing/`](plugins/dsh-billing/)

> ⚠️ 使用前请把 `config.json` 的 `token` 换成你自己的平台登录令牌，**不要提交到任何仓库**。

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
| [Agent产物归类方法](docs/Agent产物归类方法.md) | Agent 产物组织思路 |
| [dsh-security-architecture.svg](docs/dsh-security-architecture.svg) | 安全架构图 |

---

## 安装插件

### 方式一：一键部署包（推荐）

```powershell
# 以 dsh-billing 为例
cd deploy\dsh-billing-deploy
pwsh -File install.ps1
```

脚本会把 `package\` 内容复制到 `$env:USERPROFILE\.dsh\local-plugins\<插件名>\`。

### 方式二：手动放置

```powershell
Copy-Item -Recurse plugins\dsh-billing "$env:USERPROFILE\.dsh\local-plugins\dsh-billing"
```

放置后**重启 DSH 桌面版**生效。

### 依赖要求

- DSH 桌面版（插件基于 cordis `^4.0.1`、React 18 的客户端注入协议）
- 插件自带 `package.json`，无需 `npm install`（依赖由宿主提供）

---

## 安全与脱敏

本仓库的每一条内容都经过**归档管线**处理，而非手工挑选。管线在
[`scripts/`](scripts/) 中可复现：

```powershell
pwsh -File scripts\sanitize-copy.ps1   # 白名单复制 + 自动脱敏
pwsh -File scripts\audit-secrets.ps1   # 审计闸门，发现敏感信息即非零退出
```

### 脱敏策略

| 类别 | 处理 |
|---|---|
| API Key / Token | 替换为 `<YOUR_...>` 占位符 |
| 本机用户名 | 替换为 `<USER>` |
| 用户目录绝对路径 | 替换为 `<USERPROFILE>` |
| 依赖目录 / 备份 / 日志 / 缓存 | 整体排除，不进入归档 |

### 推送前校验

审计脚本对以下模式做**阻断式**检查（命中即拒绝推送）：

- `sk-*`、`gho_*` / `ghp_*`、`AKIA*`、`AIza*`、`xox*-*`
- PEM 私钥块、长 Bearer 令牌
- 形如 `api_key|secret|token|password = "<20+ 字符>"` 的赋值
- 残留的本机用户名与他人用户目录路径

**当前状态**：仓库内所有凭据均为占位符，**不含任何真实密钥**。

### 使用提示

- `plugins/dsh-billing/config.json` 需要你自己填 token，且**务必加入 `.gitignore`**（已预置）
- 文档中出现的 `<USER>` / `<USERPROFILE>` 是脱敏占位符，按你的实际路径替换

---

## 许可

本仓库内容采用 [MIT License](LICENSE)。

DeepSeek Harness 及其官方组件（`@deepseek-ai/*`）版权归其各自所有者，
本仓库仅归档个人扩展与文档，与官方无隶属关系。
