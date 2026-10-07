# DSH 实验性 Computer Use 安装与测评报告

> **版本基线**：DSH v0.1.6-alpha.1 · Cua Driver 0.28.0 · Windows 11 (build 26200) x64
> **实测日期**：2026-09-17
> **实测环境**：管理员权限（High 完整性）、屏幕 1707×1067 @1x
> **报告性质**：DSH 侧实测 + Codex 侧只读核对
> **修订**：**v2** —— 经 Codex 两轮 ACP 会审后修订（见[附录 C](#附录-c会审记录)）

---

## 目录

- [一、这是什么](#一这是什么)
- [二、安装步骤（可照抄）](#二安装步骤可照抄)
- [三、验证清单（分三层）](#三验证清单分三层)
- [四、实测记录](#四实测记录)
- [五、踩坑清单（重要）](#五踩坑清单重要)
- [六、DSH vs Codex 对比（修正版）](#六dsh-vs-codex-对比修正版)
- [七、共享桌面并发风险（已修正）](#七共享桌面并发风险已修正)
- [八、回滚方法](#八回滚方法)
- [附录 A：工具清单](#附录-a工具清单)
- [附录 B：关键路径速查](#附录-b关键路径速查)
- [附录 C：会审记录](#附录-c会审记录)

---

## 一、这是什么

DSH v0.1.6-alpha.1 新增的**实验性 Computer Use 支持**，底座是 [trycua/cua](https://github.com/trycua/cua) 的 Cua Driver，让模型能感知并操作本机桌面。

**关键认知（容易误解）**：

1. **这两个包没有随 dsh 一起安装**。dsh 主包的 `dependencies` 里完全没有 computer-use 相关项，必须手动装。
2. 发布形态是 **`注册服务` + `可替换提供方`** 两层，不是 Codex 那种开箱即用插件。
3. **同一时刻只能启用一个提供方**（独占注册），第二个会激活失败。
4. 发布说明只提"操作本机、获取截图"，**实际能力远超**：实测注册 56 个工具，含完整浏览器自动化（Browser Use）。

### 两条技术路线

| 路线 | 包名 | 机理 | 隔离性 | 额外依赖 |
|---|---|---|---|---|
| **原生**（推荐入门） | `dsh-experimental-computer-use-cua-driver-native` | 内置 `@trycua/cua-driver` npm SDK，跑在 **DSH 宿主进程内** | ⚠️ 无。原生崩溃可能终止宿主 | 无 |
| **MCP** | `dsh-experimental-computer-use-cua-driver-mcp` | 调用外部安装的 `cua-driver` 可执行程序 | ✅ 独立进程持有权限 | 需装 `cua-driver` CLI |

两者都依赖核心注册服务 `@deepseek-ai/dsh-computer-use`（**该包本身不提供任何模型可见工具**）。

> **选型建议**：先跑原生路线验证能力；若追求稳定或需隔离权限，再换 MCP 路线。

---

## 二、安装步骤（可照抄）

### 前置条件

- DSH 已装且 `dsh web` 可正常启动
- 用于启动 DSH 的终端/应用**以管理员身份运行**（实测 `elevated=true` 时权限充足）
- Windows 需 x64 或 arm64（npm 可选依赖提供对应二进制）

### 步骤 1：备份（务必先做）

```powershell
$p = "$env:USERPROFILE\.dsh\profiles\web"
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item "$p\package.json"      "$p\package.json.bak-cua-$stamp"
Copy-Item "$p\cordis.patch.yml"  "$p\cordis.patch.yml.bak-cua-$stamp"
```

### 步骤 2：安装两个包

```powershell
cd $env:USERPROFILE\.dsh\profiles\web

dsh plugin --profile web add @deepseek-ai/dsh-computer-use@0.1.6-alpha.1
dsh plugin --profile web add @deepseek-ai/dsh-experimental-computer-use-cua-driver-native@0.1.6-alpha.1
```

> **预期警告**：两条命令都会打印
> `declares no dsh.bundle — installed as a plain dependency, not a profile layer`
> **这是正常的**。它们靠 `cordis.patch.yml` 挂载，不是 profile bundle。
>
> 安装过程中若出现 `Packages: +N -M` 的负数，那是 pnpm 清理孤儿依赖，正常。

### 步骤 3：挂载到组合

往 `~/.dsh/profiles/web/cordis.patch.yml` **末尾追加**：

```yaml
# -- 实验性 Computer Use（Cua Driver 原生驱动）------------------------------
# 说明：dsh-computer-use 是独占注册服务，同一时刻只能启用一个提供方。
# 原生驱动跑在 DSH 宿主进程内，操作本机桌面；若原生崩溃可能终止宿主进程。
# 如遇问题，把下面整段注释掉并重启 DSH 即可回滚。
- insert:
    - id: computer-use
      name: '@deepseek-ai/dsh-computer-use'
    - id: cua-driver-native
      name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'
```

> **若走 MCP 路线**，第二项换成：
> ```yaml
>     - id: cua-driver-mcp
>       name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp'
>       config:
>         command: cua-driver
>         args: [mcp]
> ```
> 需先按[上游指南](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.0/libs/cua-driver/README.md)装好 `cua-driver`。

### 步骤 4：重启前先验证配置树（关键！）

**不要直接重启**，先用 dump 检查配置能否解析：

```powershell
cd $env:USERPROFILE\.dsh\profiles\web
dsh --profile web --dump-config | Select-String -Pattern 'computer-use|cua-driver'
```

能正常输出两个 id 且**无 error/cannot/failed** 才算安全。

### 步骤 5：重启 DSH

关掉原 `dsh web` 进程，重新启动。验证新进程：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'dsh.*bin\.js.*web' } |
  Select-Object ProcessId, CreationDate

Get-NetTCPConnection -LocalPort 3080 -State Listen |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

---

## 三、验证清单（分三层）

### 第 1 层：原生库是否真的加载 ⭐ 最硬的证据

这一步比任何日志都可靠 —— 直接看进程加载了什么 DLL：

```powershell
$pid_web = (Get-NetTCPConnection -LocalPort 3080 -State Listen).OwningProcess
Get-Process -Id $pid_web | Select-Object -ExpandProperty Modules |
  Where-Object { $_.ModuleName -match 'cua' } | Select-Object ModuleName, FileName
```

**预期输出**：

```
cua_driver_node_runtime.node
cua_driver_sdk.dll          ← 约 25 MB
```

看到这两个就说明驱动真的在宿主进程里跑起来了。

### 第 2 层：工具是否注册到模型

最直接的验证：**在新会话里直接调用**

```
get_screen_size
```

若返回 `✅ Main display: <宽>x<高> pixels`，说明整条链路已通。
（在 Web GUI 里，工具名会显示为 `cua_driver_native__*`。）

### 第 3 层：权限与能力体检

```
check_permissions
health_report
```

**本机实测输出**：

```json
{
  "elevated": true,
  "integrity_level": "High",
  "uia": true,
  "post_message": true
}
```

`health_report` 关键项：

| 检查项 | 结果 |
|---|---|
| binary_version | cua-driver 0.28.0 |
| platform_supported | Windows 10.0.26200 (x86_64) |
| ax_capability | UIAutomation 可达 |
| screen_capture_capability | **D3D11 可达，用 Windows Graphics Capture** |

> 屏幕捕获走 **Windows Graphics Capture（GPU 加速）**，不是老式 GDI 抓屏。

---

## 四、实测记录

| 能力 | 结果 | 证据 |
|---|---|---|
| 工具注册 | ✅ **56 个** | 完整清单见附录 A |
| 屏幕尺寸 | ✅ 1707×1067 @1x | `get_screen_size` |
| 桌面截图 | ✅ 323 KB PNG | 截到 DSH 自身界面，确认闭环 |
| 应用枚举 | ✅ 183 个（7 运行中） | `list_apps` |
| 窗口枚举 | ✅ 8 个，标题可读 | `list_windows` |
| 剪贴板往返 | ✅ 写入后原样读回 | `clipboard_write` → `clipboard_read` |
| 启动应用 | ✅ 拉起记事本 | `launch_app` |
| 新建标签页 | ✅ 标签数 8 → 9 | UIA Invoke（坐标点击无效，见坑 2） |
| 写入文本 | ✅ 2,222 字符 | `set_value`（UIA ValuePattern） |
| 取证录制 | ✅ 4 回合 / 37 文件 / 4.1 MB | `start_recording` |
| 轨迹回放 | ✅ attempted=2 succeeded=1 failed=1 | `replay_trajectory` |

### 取证录制产出的目录结构

```
turn-00001/
  ├── action.json        ← 工具名、参数、时间戳、耗时
  ├── before.png         ← 操作前截图
  ├── after.png          ← 操作后截图
  ├── before_state.json  ← 操作前 UIA 树
  ├── after_state.json   ← 操作后 UIA 树
  ├── evidence.json      ← 证据链状态
  ├── app_state.json
  └── screenshot.png
```

### `action_truth` —— 驱动的内部决策链（本方案最有价值的特性）

`action.json` 里的 `action_truth` 字段记录了**投递真相**：

```json
{
  "effect": "refused",                  // 最终效果
  "requested_delivery": "background",   // 请求的投递方式
  "actual_delivery": null,              // 实际投递
  "route": "accessibility",             // 选择的路由
  "transport": "windows_uia_value",     // 最终传输通道
  "fallbacks": [],                      // 是否降级
  "escalation": null
}
```

**连失败都如实记录**，且精确到"用了哪条传输通道"。

### 因果链证据实例

`bring_to_front` 那次的 `evidence.json`：

```json
{
  "before": { "screenshot": { "status": "unavailable",
                              "classification": "target_minimized" } },
  "after":  { "screenshot": { "status": "captured" } }
}
```

翻译：**操作前窗口最小化截不了图 → 操作后截到了**。
且该回合目录里确实只有 `after.png`、没有 `before.png` —— **文件存在性与声明完全自洽**。

这就是可审计性：不是"我说我唤醒了窗口"，而是留下不可伪造的因果证据。

### 一个重要的机制限制 ⚠️

**录制只捕获通过工具调用层的操作。**

用独立 Node 脚本直接调 SDK 执行的操作**完全不会进录制**（首次录制只录到 1 个回合即因此）。

> **结论**：录制是"审计**模型行为**"，不是"审计**进程行为**"。

---

## 五、踩坑清单（重要）

### 坑 1：WinUI3 / XAML 应用忽略 PostMessage 键盘消息

**现象**：对现代记事本调 `hotkey(["ctrl","n"])` 或 `press_key`，报错：

```
hotkey on a modern XAML / UWP target ... could not find a UIA AcceleratorKey
... PostMessage WM_KEYDOWN/UP is ignored by this target's input pipeline.
```

**原因**：WinUI3 的 CoreInput 分发器只消费系统输入队列的事件。

**对策**：必须走 UIA 路线 —— 先 `get_window_state` 取快照拿 `element_index` + `snapshot_id`，再走 UIA Invoke。

---

### 坑 2：坐标空间不统一（实测两例 + 一处推断）⭐

这是最容易翻车的地方：

| 应用类型 | `frame` 坐标含义 | 坐标点击 | 依据 |
|---|---|---|---|
| WinUI3（记事本） | 与视觉位置**对不上** | ❌ 无效 | ✅ 实测 |
| Tauri（Clash Verge） | **屏幕绝对坐标** | ⚠️ 可用但需换算 | ✅ 实测 |
| 传统 Win32 | window-local 像素 | ✅ 可用 | ⚠️ **推断，无实测样本** |

**实测教训**：对记事本按截图上看到的 `+` 号位置点了两次（x=784,y=53），界面纹丝不动；真实 frame 是 `(1047, 347)`。

**⚠️ 归因未定（经 Codex 会审指出）**：
上游 GUIDANCE 与 README 原文只说
`"Use element_token from that snapshot, or coordinates from its screenshot."`，
**并未定义坐标系**。因此 WinUI3 / Tauri 的差异也可能是**截图裁剪范围 + DPI 缩放**导致的现象，
而非"坐标系本身不同"。**此为待确认项，上表第三行的"坐标含义"结论请勿当作定论。**

**对策（这部分成立，不受归因影响）**：
- **优先 `element_index` + `snapshot_id` 走 UIA**，别赌坐标 —— 这是唯一稳妥路径
- 非要用坐标，先读 `get_window_state` 返回的 `frame` 和 `window_bounds` 做换算

---

### 坑 3：快照 token 生命周期极严格

**现象**：

```
element_token is stale; call get_window_state again to refresh
```

**三条规则**：
1. 任何**新快照**都会作废旧 token
2. token **不跨驱动实例复用**（独立脚本取的 token，在 MCP 工具里用必然失败）
3. 正确姿势：**同一驱动实例、同一轮内**完成"取快照 → 调用"

**踩坑实例**：在脚本里取快照拿 token，再拿到 MCP 工具里用 → 100% 失败。

---

### 坑 4：点击成功 ≠ 操作生效 ⭐

驱动文档反复强调，实测确认：

> "A delivered click alone does not prove the outcome."

**实例**：点「添加新标签页」返回 `✅ Posted click to pid 24976`，但**标签数没变**。

**对策**：**每次操作后必须回读状态验证**（本次靠标签数 8→9 才算数）。

---

### 坑 5：`start_minimized` 后台启动可能被拒

**现象**：

```
Background minimized launch is unavailable because Windows did not grant
the foreground lock required to prevent the new process from activating.
No process was started.
```

**这是好行为** —— 驱动**干脆不启动任何进程**，而不是"启动了但抢焦点"。

**对策**：改用普通启动（会有一次焦点切换）。

---

### 坑 6：截图数据在 `content` 数组里，不在 `structuredContent`

MCP 格式的图像走 `content[].data`（base64）；`structuredContent` 只有元数据（宽高、mime、platform）。

**对策**：解析结果时两个字段都要看。

---

### 坑 7：CRLF 导致"内容不匹配"误判

WinUI3 记事本会把 `\n` 存成 `\r\n`。逐字符比对会报"不匹配"，但内容其实完全正确。

**对策**：比对前统一换行符，或只比对语义。

---

## 六、DSH vs Codex 对比（修正版）

> **本节已经过 Codex 两轮核对纠正**。
> 原始版本有 3 处误读；第二轮会审后，又收窄了 1 处措辞并修正了第七节的风险模型。

### 架构对照

| 维度 | Codex（`@oai/cua-repl`） | DSH（`cua-driver-native`） |
|---|---|---|
| **交互范式** | JavaScript REPL | 工具调用（MCP 式） |
| **模型可见工具数** | **3 个**（`js`/`js_reset`/`turn_ended`） | **56 个** |
| **状态** | REPL 变量跨调用**持久** | 无状态，每次独立 |
| **多会话并发语义** | 多会话各自 REPL **可并存** | provider **独占注册** |
| **故障半径** | 独立进程，崩溃**不波及宿主** | 宿主进程内，原生崩溃**可终止宿主** |
| **输入通道** | **CDP 协议级**（不抢系统队列） | UIA / SendInput（系统级注入） |
| **中间态可见性** | 可任意 `write` / `emitImage` | 结构化 MCP 返回 |
| **运行权限/完整性** | ⚠️ 未查证，标"待确认" | `elevated: true`（High） |
| **依赖与升级** | 应用管理 + manifest | 用户 npm/pnpm 安装 |
| **结果体积上限** | `output_token_limit: 25000` | ⚠️ 未知，标"待确认" |
| **版本** | cua-repl 0.1.0 / `@oai/cua` 0.2.4 | cua-driver 0.28.0 |
| **进程模型** | 独立进程 + MCP stdio | 宿主进程内原生模块 |
| **启动约束** | `startup_timeout_sec: 120` | 无 |
| **能力裁剪** | `CUA_REPL_ENABLED_SURFACES` 环境变量 | provider 独占注册 |

### 最根本的差异：REPL vs 工具

**Codex 只给模型一个工具 `js`**，模型写代码而非选工具：

```javascript
let app = await cua.getApp("记事本");
await app.click(12);                 // elementIndex 或 [x,y]
await app.typeText("你好");
await app.setValue(3, "新值");
await app.getAXStateAndScreenshot();
```

**DSH 是逐工具调用**：

```
cua_driver_native__launch_app  { name: "notepad" }
cua_driver_native__click       { x, y, element_token }
cua_driver_native__type_text   { text }
```

**效率差异**（⚠️ 此处原报告有误，已修正）：

- 约束原文是「On your **first call, or after a reset**, execute exactly one of the API calls」（**只限首次调用 / reset 之后**）
- ~~原报告误读为"每次调用都只能一个 API"~~ → **REPL 的效率优势成立**，一次往返可跑多步（循环/条件/批量）
- 实践上限受单次 25000 token 输出约束
- 原报告"Codex 效率优势被理想化"的**修正本身才是错的**

### 能力重合与互补

**重合**：点击、输入、滚动、拖拽、AX 树、截图 —— 核心操作高度重合。

**Codex 独有**（`Target` 接口 12 方法中的 3 个）：

| API | 作用 | DSH 对应 |
|---|---|---|
| `getAXStateAndScreenshot()` | 一次同时拿树 + 截图 | 需两次调用 |
| `selectText(prefix, suffix)` | 语义化选中文本 | 无（只能坐标/全选） |
| `paste(text)` | 直接粘贴 | 走 `type_text` 逐字注入 |

**DSH 独有**：

- 浏览器自动化全家桶（`browser_*` 十几个）
- 取证录制 + 轨迹回放（`start_recording` / `replay_trajectory`）
- 形式化断言（`verify_state`）
- `invoke_menu`、`zoom`、`install_ffmpeg`

### 指令注入方式

| | Codex | DSH |
|---|---|---|
| 形式 | 分平台 Markdown（windows/macos/linux × 4 类） | 单段硬编码 GUIDANCE |
| 平台适配 | ✅ 按 `process.platform` 读取 | ❌ 全平台一致（含 macOS 专属提示） |
| 动态拼装 | ✅ 按"已启用面"拼接（disabled 档替换） | — |
| 侧重点 | **优先级**：有 API/CLI 就别点鼠标 | **操作纪律**：background 优先、拒绝≠授权前台重试、点击≠目标达成 |

Codex 还明确**禁止绕道**：

> "Do not use other technologies besides `cua_repl` ... (e.g. AppleScript, osascript, JXA, System Events, CGEvent synthesis)."

DSH 的 GUIDANCE 原文（来自插件源码）：

> "Prefer background delivery. A refusal does not authorize a foreground retry.
> Verify the requested outcome from fresh state after an action; a delivered click alone does not prove the outcome."

### ⚠️ 重大修正：Codex 当前 native 能力是**关闭**的

**原报告的判断有基础性漏洞** —— 把"它具备的能力"当成了"它正在用的能力"。

Codex 回信指出：其当前会话工具说明含

> `Native computer APIs are disabled.`

**已实测验证**（全部成立）：

| 验证项 | 结果 |
|---|---|
| `instructions\computer-disabled.md` 内容 | 正是 `Native computer APIs are disabled.` |
| `CUA_REPL_ENABLED_SURFACES` 环境变量 | **未设置** |
| 配置文件中该变量 | 搜不到 |
| 机制说明 | 文档按"已启用面"**动态拼装**，读到的是模板 |

**含义（⚠️ 措辞已经 Codex 二次会审收窄）**：

> **`本次对话所连的 Codex 会话`为浏览器-only（native 关、浏览器面开）**，
> 无法原生点击或读 AX 树。上述对比中"Codex 的原生能力"属 **native 开启后的配置**，
> 不是该会话的实时状态。

**不要写成对 Codex 的全局结论**。Codex 指出：运行时**同时存在**
`browser-disabled.md` 与 `computer-disabled.md` 两个档，说明**浏览器面同样可被裁剪**；
因此"浏览器面在所有会话都启用"**不成立**。

| 判断 | 状态 |
|---|---|
| 本次对话的 Codex 会话 = 浏览器-only | ✅ 已确认 |
| 浏览器面在所有会话都启用 | ⚠️ **待确认** |
| 那 3 个 `cua-repl` 进程各自的启用面 | ⚠️ **待确认**（Codex 自称无法确认） |

### 另一处修正：路径

原报告写 `plugin\.mcp.template.json` 和 `instructions\` 在 `runtimes\cua_node\<hash>\` 根下 —— **错误**。

```
根目录实际只有:  bin\   manifest.json
instructions 实际在:  bin\node_modules\@oai\cua-repl\instructions\
```

### Codex 侧补充的精确信息

```
@oai/cua-repl 0.1.0
enabled_tools = ["js","js_reset","turn_ended"]
startup_timeout_sec = 120
模板 enabled = false
omit_tools_from = ["code_mode","deferred"]
js.output_token_limit = 25000

manifest.json:
  node_version = 24.20.0
  target = windows-x64
  runtime_archive_version = 0.0.11/20260909002225
```

### 一句话总结

| 维度 | 谁更强 |
|---|---|
| 单次往返效率 | **Codex**（REPL 可批量，已修正确认） |
| 工具丰富度 | **DSH**（56 vs 1 动词 + 对象模型） |
| 隔离性 | **Codex**（独立进程）；DSH 可用 MCP 路线换取 |
| 平台指令细致度 | **Codex**（分平台 + 动态拼装） |
| 可审计 / 可回放 | **DSH**（独家：投递真相 + 轨迹回放） |
| 浏览器自动化 | **DSH**（内置 `browser_*`） |

> **Codex 像"给一个 JS 沙盒自己去操作"，DSH 像"给一箱精密工具逐个用"。**
> 前者赢在表达力与效率，后者赢在可控性与可观测性。

---

## 七、共享桌面并发风险（已由 Codex 补实测，风险模型已修正）

> **本节经 Codex 补充关键实测数据后大幅修订。**
> 原版判断"双方输入注入会互相竞争"—— **这个判断是错的**。

### ⭐ 关键实测：Codex 浏览器自动化不抢系统输入队列

Codex 补充：其浏览器自动化走 **CDP 协议级输入**（`Input.dispatchMouseEvent` /
`Input.dispatchKeyEvent` / `Runtime.evaluate`），**全库无系统级注入**。

**DSH 已独立验证该说法**（在 `browser-service.mjs` 中逐项计数）：

| 方法 | 命中次数 |
|---|---|
| `dispatchMouseEvent` | 7 |
| `dispatchKeyEvent` | 7 |
| `Runtime.evaluate` | 17 |
| `Input.insertText` | 2 |
| `Page.captureScreenshot` | 3 |
| **`SendInput`** | **0** ✅ |
| **`mouse_event`** | **0** ✅ |
| **`keybd_event`** | **0** ✅ |

**结论：Codex 的浏览器操作不经过系统输入队列，与 DSH 的原生输入注入
`不会在输入层面互相竞争`。**

### 修正后的风险模型

| 层面 | 是否竞争 | 依据 |
|---|---|---|
| **输入注入竞争** | ❌ **不竞争** | Codex 走 CDP（已实测验证）；DSH 走 UIA/SendInput |
| **窗口状态竞争** | ✅ **会竞争** | 双方操作同一窗口时，会互相改变页面/DOM 状态 |

**具体的状态级冲突场景**：

- DSH 原生操作**同一个 Chrome 窗口**时，其点击/导航会在 Codex 的 CDP 脚本执行**中途**
  改变页面/DOM 状态；反之亦然
- Codex 窗口内的 **in-app 浏览器（iab）**同理

即：**"读到的状态"与"基于该状态的动作"之间不再原子** —— 冲突源是**状态**，不是输入通道。

### 双方其他表述

| 来源 | 表述 |
|---|---|
| DSH 官方文档 | "多个 Session 共享一个桌面；注册不会串行化 Session 的操作" |
| Codex | 输入层不竞争（实测）；状态层会竞争（机制推理） |

### 本机实际状况

- Codex 侧：3 个 `cua-repl` 进程（启动于 09:01 / 10:09 / 13:09），本次会话 native 关闭
- DSH 侧：原生驱动活着，`elevated: true`

### 建议约定（已按 Codex 建议改写）✅

> **避免同时操作同一个应用窗口**（不同 app 或错时）。
> **输入注入本身不竞争，窗口状态会竞争。**

这比原版的"同一时间只允许一方操作桌面"更精准 —— 原版限制过严（没必要禁止
"DSH 操作记事本 + Codex 操作 Chrome"这种不同窗口的并行）。

---

## 八、回滚方法

### 快速回滚（推荐）

注释掉 `cordis.patch.yml` 里新增的整段，重启 DSH：

```yaml
# - insert:
#     - id: computer-use
#       name: '@deepseek-ai/dsh-computer-use'
#     - id: cua-driver-native
#       name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'
```

### 完整回滚

```powershell
$p = "$env:USERPROFILE\.dsh\profiles\web"
# 1) 恢复配置（换成实际备份的 stamp）
Copy-Item "$p\package.json.bak-cua-<stamp>"     "$p\package.json" -Force
Copy-Item "$p\cordis.patch.yml.bak-cua-<stamp>" "$p\cordis.patch.yml" -Force
# 2) 重启 DSH
```

### 卸载包

```powershell
cd $env:USERPROFILE\.dsh\profiles\web
dsh plugin --profile web remove @deepseek-ai/dsh-experimental-computer-use-cua-driver-native
dsh plugin --profile web remove @deepseek-ai/dsh-computer-use
```

---

## 附录 A：工具清单

实测注册 **56 个**，命名空间 `cua_driver_native__`。

### 桌面感知

| 工具 | 作用 |
|---|---|
| `list_apps` | 枚举应用（含运行状态） |
| `list_windows` | 枚举窗口（含标题、bounds、z-index） |
| `get_window_state` | **核心**：UIA 树 + 截图 + element_token |
| `get_accessibility_tree` | 桌面级无障碍树快照 |
| `get_desktop_state` | 全屏截图（含 GPU 加速抓屏） |
| `get_screen_size` | 屏幕尺寸与缩放因子 |
| `debug_window_info` | 窗口类名、exe、UIA 模式诊断 |

### 输入控制

`click` · `double_click` · `right_click` · `drag` · `type_text` · `press_key` · `hotkey` · `set_value` · `scroll` · `move_cursor` · `get_cursor_position`

### 剪贴板

`clipboard_read` · `clipboard_write`

### 窗口管理

`launch_app` · `kill_app` · `bring_to_front` · `set_window_frame` · `invoke_menu`

### 校验与取证

`verify_state` · `zoom` · `start_recording` · `stop_recording` · `get_recording_state` · `replay_trajectory` · `install_ffmpeg`

### 浏览器自动化（Browser Use）

`browser_prepare` · `browser_navigate` · `browser_click` · `browser_type` · `browser_pointer` · `browser_dialog` · `browser_set_input_files` · `browser_download` · `get_browser_state` · `page`

### 会话与权限

`start_session` · `end_session` · `get_session` · `list_sessions` · `get_session_state` · `escalate_session` · `check_permissions` · `health_report` · `get_config` · `set_config`

### 光标覆盖层（Agent Cursor）

`set_agent_cursor_enabled` · `set_agent_cursor_motion` · `set_agent_cursor_theme` · `get_agent_cursor_state`

---

## 附录 B：关键路径速查

### DSH 侧

```
profile 目录      %USERPROFILE%\.dsh\profiles\web\
组合配置          %USERPROFILE%\.dsh\profiles\web\cordis.patch.yml
插件包            %USERPROFILE%\.dsh\profiles\web\node_modules\@deepseek-ai\
原生二进制        ...\node_modules\@trycua\cua-driver-win32-x64-msvc\
                    ├── cua_driver_node_runtime.node   (~630 KB)
                    └── cua_driver_sdk.dll             (~25 MB)
日志              %USERPROFILE%\.dsh\logs\dsh-web.{out,err}.log
```

### Codex 侧（仅供对照）

```
运行时根          %LOCALAPPDATA%\OpenAI\Codex\runtimes\cua_node\<hash>\
  ├── manifest.json
  └── bin\
      ├── node.exe / node_repl.exe
      └── node_modules\@oai\
          ├── cua\          (@oai/cua 0.2.4)
          ├── cua-repl\     (@oai/cua-repl 0.1.0)
          ├── browser-desktop\
          └── sky\
```

---

## 附录 C：会审记录

本文档经 Codex 通过 ACP 两轮会审。**保留全部纠错过程**，供后续参考。

### 第一轮（ACP 消息编号从略）

DSH 提交对比结论后，Codex 指出 **3 处错误，全部成立**（DSH 已逐条实测验证）：

| # | 我方错误 | 性质 | 验证方式 |
|---|---|---|---|
| 1 | 把"Codex 具备的能力"当成"正在用的能力" | **基础性漏洞** | `computer-disabled.md` 内容、环境变量未设置 |
| 2 | `instructions\` 路径写错 | 不够严谨 | 根目录实际只有 `bin\` + `manifest.json` |
| 3 | 误读 Q1 约束原文，反向"纠正"对方 | **自作聪明** | 原文限定词 `On your first call, or after a reset` |

**第 3 条的教训**：DSH 当时自信地写"你把 REPL 的效率优势说得偏理想化了"，
实为漏看限定词。**结论：REPL 的效率优势成立。**

### 第二轮（ACP 消息编号从略）

| # | Codex 意见 | 处理 |
|---|---|---|
| 1 | "只能驱动浏览器"应限定为**本次会话**，非全局结论 | ✅ 已收窄措辞，补 3 项"待确认" |
| 2 | 坑 2 的"传统 Win32 = window-local"**属推断**，建议标注或删除 | ✅ 已标"推断，无实测样本"，并补充归因未定说明 |
| 3 | **浏览器走 CDP 协议级输入，不抢系统队列** | ✅ DSH 已独立验证（见第七节计数表），**风险模型已修正** |
| 4 | 建议补 6 个对比维度 | ✅ 已并入第六节架构对照表 |

**第 3 条的价值最大**：它推翻了本文档原版的核心风险判断
（原版认为"双方输入注入会互相竞争"）。修正后：
**输入层不竞争，状态层会竞争** —— 建议约定也随之改写。

### 方法论备注

- 双方均遵守"**实测与推断分离**"：未实测处一律标"待确认"，不写成事实
- 对方的纠错**不悄悄抹除**，用删除线或对照表保留（见第六节 Q1 处）
- 所有验证均在 **只读** 前提下完成，未改动对方任何文件

---

## 附：给 Codex 的复核要点

若需把本文档再次发给 Codex 复核，建议重点核对：

1. **第七节的 CDP 计数表**是否可复现（在 `browser-service.mjs` 中）
2. **坑 2 的归因**（坐标系 vs 截图裁剪 + DPI 缩放）是否有新证据
3. 对比表中 **3 项"待确认"** 是否已可落实：
   - Codex 侧运行权限/完整性
   - DSH 侧结果体积上限
   - 浏览器面是否在所有会话都启用
4. 是否有新增的踩坑或维度

---

*本文档由 DSH 整理，经 Codex 通过 ACP 两轮核对纠正后定稿（v2）。*
*实测数据全部来自本机只读探查与工具调用，未杜撰；未实测处均已标注。*
