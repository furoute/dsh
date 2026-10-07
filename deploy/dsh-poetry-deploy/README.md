# dsh-poetry-deploy · 把“诗泉诗词”侧边小插件搬/装到另一台 DSH

这是一个**自包含**部署包：把「诗词」侧边栏小插件（随机读诗 + 全文/标题/内容/作者分类搜索）
复制并安装到**另一台电脑**的 DSH 上。它**不依赖任何 token / 代理 / 本地服务**——所有数据都来自
公开在线 API `https://poetry.palemoky.com`，由浏览器直接请求，所以两个前提（能上网、能访问该域名）。

---

## 它由什么组成

| 文件 | 作用 |
| --- | --- |
| `package/lib/client.js` | 插件主体（浏览器端）：在侧边栏 Settings 上方加「诗词」按钮，弹出面板（随机 + 搜索）|
| `package/lib/index.js` | Host 半区：纯 UI 插件，空的 apply（只是让加载器能识别它）|
| `package/package.json` | 插件元数据 / `dsh.client` 声明（声明它是 web 客户端插件）|
| `cordis.patch.yml`（目标机）| 让插件每次启动自动加载 |
| `install.ps1` | 一键安装脚本 |

---

## 功能一览（迁移后会得到的功能）

- **随机页签**：随机展示一首中国古典诗词（标题、朝代·作者、体裁、正文），按体裁筛选，简/繁切换。
- **搜索页签**：四个**始终可见**的分类按钮 —— **全文 / 标题 / 内容 / 作者**。
  - 对应在线 API 的 `type=all / title / content / author`
  - 结果**分页浏览**，每条可**点开看全文 / 收起**
  - **智能片段回退**：整句无命中时自动改用「末尾 3 字 → 开头 3 字」重试（避免“搜索本是同根生→没结果”的困惑），并提示用了哪个片段
  - **作者分类**下自动出现一排名家（李白/杜甫/白居易/苏轼/辛弃疾/李清照/王维/陆游）快捷按钮，点一键拉该诗人作品

> 在线 API 的两点已知限制（插件已内置规避策略，无需你处理）：
> - `/api/search` 的 `q` 需 **≥3 字** —— 所以作者分类用「著名诗人快捷」通道（经 `/api/poems/random?author=`）绕开二字姓名无法检索的问题
> - 搜索接口限流 **≈8 次/分钟/IP** —— 插件的片段回退每次搜索最多发 3 个请求，不会打爆限流

---

## 在目标电脑上安装（3 步）

1. **把整个 `dsh-poetry-deploy` 文件夹拷到目标电脑**（U 盘 / 网络 / 网盘都行）。

2. **打开 PowerShell**，进入该文件夹，运行一键安装：
   ```powershell
   cd C:\path\to\dsh-poetry-deploy
   powershell -ExecutionPolicy Bypass -File .\install.ps1 -DshRoot "<USERPROFILE>\Documents\...\work\dsh"
   ```
   > `-DshRoot` 指向目标机 DSH 的安装目录（就是包含 `node_modules\@deepseek-ai` 的那一层）。
   > 若目标机 DSH 的配置目录不是默认的 `<USERPROFILE>\.dsh`，可加 `-ProfileRoot "D:\dsh-home"`。

3. **重启目标机的 DSH**（或刷新浏览器），侧边栏 Settings 上方应出现「诗词」按钮。

---

## 一个必须满足的前提（否则不显示/不工作）

1. **目标机能访问在线 API `https://poetry.palemoky.com`**（公网域名，一般直连即可；若有公司代理出网，
   请确保浏览器能打开这个域名）。**不需要 token、不需要本地代理、不需要 Docker。**
2. 目标机 DSH 版本与客户端 slot 体系兼容即可（本插件用的是 `sidebar.footer.action`，是 DSH 客户端 slot 标准能力）。

---

## 常用备注

- **改源码后同步**：`@deepseek-ai/dsh-poetry` 以 `file:` 依赖指向 DSH 安装目录的
  `node_modules\@deepseek-ai\dsh-poetry`，所以改代码要改到**那一个目录**，并手动同步到
  `~\.dsh\profiles\web\node_modules\@deepseek-ai\dsh-poetry`（`install.ps1` 每次都会帮你同步）。
- **想换显示位置 / 样式**：改 `package/lib/client.js` 里的 `id`、`order` 和 `.dsh-poetry*` 样式。
- **想让某台机不显示**：把 `~\.dsh\profiles\web\cordis.patch.yml` 里 `dsh-poetry` 那一段（`- insert:` …）删掉即可。
- 本机已有的同类部署包供对照：`dsh-billing-deploy`（余额/消费条）、`dsh-qwen-deploy`（文生图）。

---

## 本机已装好的位置（供参考）
- 源码包：`<DSH_ROOT>\node_modules\@deepseek-ai\dsh-poetry`
- profile 副本：`%USERPROFILE%\.dsh\profiles\web\node_modules\@deepseek-ai\dsh-poetry`
- 启动挂载：`%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`
