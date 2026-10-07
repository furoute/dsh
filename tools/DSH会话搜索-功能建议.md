# 功能建议：桌面版 DSH 会话窗口内缺少 Ctrl+F 关键字搜索

> 提交渠道：GitHub Discussions → **Ideas**
> 仓库：https://github.com/deepseek-ai/deepseek-harness
> 日期：2026-10-02（2026-10-03 更新：补充实测数据与可用原型）

**一句话**：底层全文检索引擎已就位，但桌面版既没开启它、也没有 Ctrl+F 入口，
导致用户在"在对话里找一句话"这个最基础的场景上无路可走。
附带的原型插件已在本机实测可跑通，可直接参考实现思路。

---

## 一、问题描述

在桌面版 DSH 的会话窗口中，**无法搜索聊天内容的关键字**：

- ❌ **当前会话内**：按 Ctrl+F 无任何反应，无法在正在浏览的对话里查找/高亮关键字
- ❌ **跨会话**：无法在历史会话中检索正文内容
- ⚠️ 侧边栏的搜索框**只能匹配会话标题和工作区名称**，搜不到消息正文

**期望行为**（与浏览器、办公软件一致的通用交互）：

> 在会话页面按 `Ctrl+F` → 弹出搜索条 → 输入关键字 → 页面内**实时高亮**所有匹配 → 支持上一个/下一个跳转、显示 `第 n / 共 m 处`。

这不是配置问题——新手用户第一反应就是按 Ctrl+F，按下去毫无反馈，会直接判定"DSH 坏了"。

---

## 二、复现步骤

1. 打开桌面版 DSH（`0.2.0-rc.2`，Windows）
2. 进入任意一个内容较多的会话
3. 按 `Ctrl+F`
4. **预期**：出现搜索条并高亮匹配
   **实际**：无任何反应

同理，在侧边栏搜索框输入某个**只出现在消息正文里**的关键词（非标题），结果为空。

---

## 三、根因分析（含源码位置）

我已定位到三处确凿证据，供官方参考：

### 证据 1：主进程未注册 Electron 原生 `find` 菜单角色

`app.asar/lib/main.js` 第 **11930** 行：

```js
const refreshApplicationMenu = () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(
        process.platform === "win32" ? devToolsItems : [ /* macOS 完整菜单 */ ]
    ));
};
```

其中 `devToolsItems` 仅含两项：

```js
const devToolsItems = [
    { role: "toggleDevTools", visible: false },
    { role: "toggleDevTools", visible: false, accelerator: "F12" }
];
```

**Windows 分支只有 DevTools 两项，没有 Electron 标准的 `role: "find"`**。因此 `Ctrl+F` 未被任何处理器接管，`webContents.findInPage()` 也从未被调用。

> 补充：macOS 分支走了 `platformMenus()`，但同样未见 `find` 角色。

### 证据 2：全部可绑定快捷键命令中没有任何搜索命令

`@deepseek-ai/dsh-client-shortcuts` 注册的命令全集（共 14 个）：

```
browser.new            chat.quota-notice      fixed.complementary
fixed.mention          fixed.newline          fixed.send
fixed.slash            page.close             response.stop
settings.open          sidebar.left.toggle    sidebar.right.toggle
terminal.new           workspace.files
```

**没有任何 `search.*` / `find.*` 命令**，因此即便用户想通过「快捷键设置」自行绑定 Ctrl+F 也无从下手。

### 证据 3：全文搜索出厂即关闭，且 Web 侧边栏刻意只搜标题

`@deepseek-ai/dsh-base/cordis.patch.yml` 第 **141–153** 行（官方原文注释）：

```yaml
# Full-text session search is opt-in. `openAt: never` keeps
# ctx.sessionQuery mounted — exact reads, titles, and lineage traces
# (session export, subagent-fork Workspace inheritance) stay available —
# while search calls fail with SESSION_QUERY_SEARCH_DISABLED and SQLite is
# never opened; the Web sidebar search matches titles and workspace names
# only. Deployments enabling content search override `openAt` to
# `first-search` or `startup` in a later patch layer (profile
# cordis.patch.yml or a --patch overlay), typically with a durable `path`.
- id: session-query-sqlite
  name: '@deepseek-ai/dsh-session-query-sqlite'
  config:
    path: ':memory:'
    openAt: never
```

**这是设计如此**：底层 `dsh-session-query` + `dsh-session-query-sqlite`（SQLite FTS5 全文检索）已具备完整能力（`searchSessions` / `searchEvents`，支持分页、摘录、元数据过滤），但默认 `openAt: never` 使其**永不打开**，调用会返回 `SESSION_QUERY_SEARCH_DISABLED`。

---

## 四、值得强调的一点

**底层能力其实是完备的**——`dsh-session-query` 的 README 明确写了：

> `searchSessions(request)` / `searchEvents(request)` — 全文搜索分页结果，由挂载的后端实现
> 既能跨会话搜索，也能在单个会话内搜索，并支持游标分页

也就是说，**缺的不是引擎，而是"界面入口"和"默认开启"**：

| 层面 | 现状 |
|---|---|
| 底层引擎 `dsh-session-query(-sqlite)` | ✅ 已安装，FTS5 全文检索完备 |
| 默认配置 | ❌ `openAt: never`，搜索被关闭 |
| GUI 界面 | ❌ 无 Ctrl+F，无会话内搜索条 |
| 可绑定快捷键命令 | ❌ 无 search 类命令 |
| 面向模型的工具 `dsh-tool-session-query` | ❌ 未随发行版提供（README 有引用但包不存在） |

顺带一提：`dsh-session-query-sqlite` 的 README 里提到该能力面向的使用场景之一正是「**`/resume` 既往工作检索**」，可见会话内检索本就是规划中的能力，只是尚未落到 UI。

---

## 四之二、实测：即使把开关打开，中文依然搜不到（**关键新证据**）

这一节是本建议**最希望官方关注**的部分。

### 实测 1：开关生效了，但索引里没有内容

按官方注释的指引，把 `session-query-sqlite` 从 `openAt: never` 改为 `first-search`，
并给出持久化索引路径：

```yaml
- id: session-query-sqlite
  name: '@deepseek-ai/dsh-session-query-sqlite'
  config:
    path: '<USERPROFILE>\.dsh\cache\session-search.db'
    openAt: first-search
```

重启 DSH 后：

- ✅ 索引库确实被创建了：`~\.dsh\cache\session-search.db`（36 KB）
- ❌ 但库中 **0 个会话、0 条内容**（`persisted_sessions = 0`、`persisted_docs = 0`、`global_generation = 0`）

**即：开关生效、后端启动，但没有把任何历史会话索引进去**，所以搜索必然返回"无匹配会话"。
这一条建议官方排查：桌面版组合下该后端是否缺少索引数据的触发路径（是否只在写入时增量索引、而不会回填历史？）。

### 实测 2：`unicode61` 分词器不适用于中文（**即使索引修好也依然搜不到**）

该后端使用 SQLite FTS5，默认 `unicode61` 分词器，未做中文处理。
用与 DSH 完全相同的表结构复现，并用 `fts5vocab` 导出**真实切出的 token**：

| 被索引的文本 | 查询词 | 结果 |
|---|---|---|
| `这个关键字能不能被搜索到` | `关键字` | ❌ 0 命中 |
| 同上 | `搜索` / `会话` / `当前会话` | ❌ 0 命中 |
| `DSH 的会话搜索：全文检索（FTS5）后端` | `全文检索` | ✅ 1 命中（恰好被 `：` 和 `（` 夹成整词） |
| 同上 | `DSH` / `FTS5` | ✅ 1 命中（英文本身是独立 token） |

`fts5vocab` 显示索引里实际的 token 是：

```
「这个关键字能不能被搜索到」      ← 整句变成一个 token
「我需要的是在当前会话页面里」
「能搜索到关键字的效果」
「的会话搜索」
「全文检索」
「dsh」「fts5」
```

三段中文文本**只切出 8 个 token**。中文只有在"正好等于一整段被标点/空格/英文隔开的文本"时才能命中，
日常"在句子里找一个词"的用法**完全搜不到**。

**⇒ 因此"把侧边栏搜索接上正文召回"这一条建议，必须同时换成分词方案（如中文双字切分 / bigram 后再入索引），
否则即便索引修好、开关打开，中文用户依旧搜不到。**

---

## 四之三、可用原型：已实测跑通的 Ctrl+F 插件

为了验证"这个功能做出来是什么样"，我们用 DSH 自己的**客户端插件机制**做了一个原型
（不改动 DSH 本体，通过 `~/.dsh/profiles/desktop/cordis.patch.yml` 挂载）：

- 位置：`~/.dsh/local-plugins/dsh-find/`（`package.json` + `lib/index.js` 空 host 半 + `lib/client.js` 界面半）
- 走 **DOM 文本级子串匹配**，因此**中文关键词可正常命中**
- 高亮用 **CSS Custom Highlight API**（`::highlight()`），不修改 React 渲染的 DOM，不会被重渲染冲掉
- 查找范围限定在 `[data-slot="conversation.session"]`，取不到时退化为整页
- 流式输出时用 `MutationObserver` + 防抖重算

**本机实测结果（DSH `0.2.0-rc.2` / Windows 11）：**

| 操作 | 结果 |
|---|---|
| `Ctrl+F` | ✅ 弹出查找条并聚焦 |
| 输入中文「搜索」 | ✅ **`1/73`，页面上 73 处全部高亮** |
| `Enter` | ✅ `1/73` → `2/73`，滚动到下一处 |
| `Esc` | ✅ 关闭并清除高亮 |

配套截图见附件 `01-CtrlF搜索栏与高亮.png`、`02-中文搜索73处命中.png`。

这个原型的意义在于：**它证明了"会话内 Ctrl+F 高亮"在现有架构下完全可行**，
而且给出了一个绕开 FTS 中文问题的实现路径。官方若愿意，可直接参考该思路做官方实现；
也可以考虑提供一个面向模型的 `conversation.search` 命令。

---

## 五、建议方案（供参考）

按实现成本从低到高：

1. **最小可用**：在主进程 Windows 菜单补上 Electron 原生 `role: "find"`，或直接拦截 `before-input-event` 中的 `Ctrl+F` 调用 `webContents.findInPage()` —— 即可立刻获得 Chromium 原生的页内查找/高亮，**几乎零 UI 工作量**。

2. **会话内搜索条**：在会话视图内实现搜索条 UI（复用现有 `ctx.shortcuts` 注册一个 `conversation.search` 命令），支持高亮 + 上下跳转。走**文本级匹配**可顺带绕开 FTS 的中文分词问题（见第四节之二实测 2）。

3. **跨会话内容搜索**：将 `session-query-sqlite` 的 `openAt` 默认改为 `first-search`（配合持久化 `path`），让侧边栏搜索支持正文召回；
   **同时**需要把索引管线改为中文可分词的方案（双字切分 / bigram），否则中文召回依然失效。
   另建议排查第四节之二实测 1 中"索引库已创建但 0 条记录"的问题。

---

## 六、环境信息

| 项 | 值 |
|---|---|
| DSH 版本 | `0.2.0-rc.2`（ProductVersion `0.2.0.0`） |
| 操作系统 | Windows 11 (NT 10.0.26300.0) |
| 发行渠道 | nightly |
| 会话数据规模 | 106 个会话 / 约 45 MB（`~/.dsh/sessions/**/session.v4.jsonl.zstd`） |

---

## 七、附：会话数据格式观察（非问题，供参考）

会话以**追加式多帧 zstd** 存储（`session.v4.jsonl.zstd`），单个会话最多可达 2000+ 个独立 zstd 帧。用 Node 24 原生 `zlib.zstdDecompressSync` 逐帧解压可完整还原事件流。

这一格式对「会话内搜索」有兴趣的实现方可能有用：**由于是追加式，增量索引（只解压新增帧）会非常高效**。

---

**一句话总结**：底层全文检索引擎已就位，但桌面版既未开启它、也未提供 Ctrl+F 入口，导致用户在最基础的"在对话里找一句话"场景上无路可走。建议优先补齐 Electron 原生 `find` 角色——这是投入产出比最高的一步。
