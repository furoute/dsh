# DSH 启用 `run_code`（PTC 模式）操作手册

> **用途**：在任意一台 Windows 机器上，把 DSH 的 `run_code`（程序化工具调用 / PTC）开启。
> **来源**：2026-09-17 深夜 ~ 09-18 凌晨，本机（家用台式机）实战验证通过。
> **目标机器**：办公室笔记本（Win11）。
> **结论先行**：**只需设一个环境变量 + 重启 DSH，不需要装任何包、不需要改任何配置文件。**

---

## 〇、TL;DR（30 秒版）

打开 PowerShell（**新开的窗口**），执行：

```powershell
# 1) 设用户级环境变量（永久生效，一次即可）
[Environment]::SetEnvironmentVariable('DSH_TOOLS_MODE', 'both', 'User')

# 2) 彻底关掉正在运行的 DSH（见下方「关键坑 2」）
Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# 3) 【必须】用新窗口启动 DSH —— 旧窗口不继承新变量
dsh web
```

**验证成功的标志**：新会话的**工具目录里出现 `run_code`**；并且与"同 profile、同插件的改动前会话"相比，**`systemTokens` 明显上升**（本机 2115 → 25973），而 `toolsTokens` 只多出 `run_code` 自己那 **~500**。

> ⚠️ **不要**用"`toolsTokens` 从 7120 涨到 34277"当判据 —— 那个差值主要来自 **Computer Use 插件**，不是 mode（详见 4.B 的更正说明）。

---

## 一、这是什么 / 为什么需要它

### 1.1 `run_code` 是什么

DSH 内部的正式名字是 **PTC 模式**（Programmatic Tool Calling，程序化工具调用）。

普通模式下，模型调工具是「想一步 → 调一次 → 看结果 → 再想」。`run_code` 把这个循环**压缩成一段程序**：

```ts
// 模型写一段 TypeScript，里面可以调用任意工具
const g = await tools.glob({ pattern: "*.ts" });
const hits = await tools.grep({ pattern: "run_code", path: "..." });
// 中间结果留在程序内存里，只有 console.log / return 的内容回到对话
```

**核心价值**：N 次工具调用打包成 **1 次对话往返**，中间数据不占上下文。官方源码描述：

> *"each sub-dispatch is logged for reconstruction, while **only the outer curated result enters model history**."*

### 1.2 三种模式（`ToolPresentationMode`）

| 模式 | 行为 | 建议 |
|---|---|---|
| `native`（默认） | 只发原生工具 schema | 不开 PTC 时 |
| `ptc` | **只发 `run_code`** + 生成的 SDK，原生工具**全部折叠消失** | ⚠️ **不要用** |
| **`both`** | **原生工具 + `run_code` 都发** | ✅ **推荐** |

> **为什么不用 `ptc`**：官方源码注释（`dsh-tools/lib/types/index.d.ts` L530-539）描述了一个真实的踩坑场景 ——
> 没有 `collapseSection` 时，模型读到一份工具目录（prompt 让它用这些工具），但没有任何一句话告诉它"只能调 `run_code`" → 模型发出原生调用 → 收到 `UNKNOWN_TOOL` → **"得出结论：这个部署是坏的"**。
>
> 更实际的问题：`ptc` 会把**所有原生工具从模型目录里移除**，做探索性任务时模型会变笨。`both` 保留两者，可回退。

---

## 二、正确做法（唯一需要的操作）

### 2.1 设环境变量

```powershell
[Environment]::SetEnvironmentVariable('DSH_TOOLS_MODE', 'both', 'User')
```

这会把值写进注册表 `HKCU\Environment`，对所有**新启动**的进程生效。

**验证已写入**：

```powershell
reg query HKCU\Environment /v DSH_TOOLS_MODE
# 应输出：DSH_TOOLS_MODE    REG_SZ    both
```

### 2.2 彻底关掉旧 DSH

**这一步是最大的坑，见第 3.2 节。**

```powershell
# 找到监听 3080 的进程并杀掉
Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# 确认已关
Get-Process -Id (Get-Content "$env:USERPROFILE\.dsh\web-server.pid") -ErrorAction SilentlyContinue
```

### 2.3 用**新窗口**启动

```powershell
# 【关键】必须是新开的 PowerShell 窗口
dsh web
```

**为什么必须新窗口**：环境变量写入后，**已运行的进程不会继承**（Windows 的既定行为）。旧窗口的环境块是启动时冻结的。

---

## 三、踩坑记录（这一节是本文档最值钱的部分）

### 坑 1：以为要「装包」或「改配置」—— 全是错路

**错误推断**：需要安装 `dsh-ptc-runtime-node` 和 `dsh-agent-tool-presentation` 两个包。
**错误推断**：需要在 preset 里加 `presentAs('both')`。

**真相**：

| 项 | 实际情况 |
|---|---|
| `dsh-ptc-runtime-node` | ✅ **早已由 `dsh-base` bundle 装配**（`- id: ptc-runtime`） |
| `dsh-agent-tool-presentation` | ⚠️ 存在，但是**将来**的 per-session API（源码原话："while per-session tool-presentation selection **is being designed**"）—— **现在不用它** |
| 真正的开关 | ✅ **环境变量 `DSH_TOOLS_MODE`** |

**为什么这些包"看起来不存在"**：查 `%USERPROFILE%\.dsh\profiles\web\node_modules\@deepseek-ai\` 只有 11 个包，看不到 `dsh-tools` / `ptc-runtime`。**因为它们由 bundle 层提供，不在 profile 本地目录。**

> **方法论教训**：**不要用局部观察外推全局结论。** 只查 profile 一层就断言"未装配"，是错的 —— 必须往 bundle 层（`dsh-base` / `dsh-web-app`）查。

### 坑 2：⚠️ 最大的坑 —— DSH 在 Win11 上关不干净

**现象**：执行了重启动，新环境变量**依然不生效**。

**原因**：Win11 **没有 Linux 那样的 systemd 守护**，DSH 可能以多种方式常驻：

- 父进程已退出（孤儿进程，但仍持有 3080 端口）
- 有子进程接力（如 `run_code` 运行时、subagent）
- 双击快捷方式启动的，与终端无关联

**关键判据 —— 端口比 PID 更可靠**：

```powershell
# ❌ 不可靠：pid 文件可能是旧的
Get-Process -Id (Get-Content "$env:USERPROFILE\.dsh\web-server.pid")

# ✅ 可靠：谁在监听 3080，谁就是活的
Get-NetTCPConnection -LocalPort 3080 -State Listen |
  Select-Object OwningProcess, LocalAddress, State
```

**然后按端口杀**：

```powershell
Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

**杀掉后必须确认**：

```powershell
Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
# 应该无输出 = 端口已释放
```

### 坑 3：新进程「看不到」环境变量 ≠ 没生效

**现象**：重启后，在 `run_code` 里执行 `process.env.DSH_TOOLS_MODE` 返回 `null`，误判为失败。

**真相**：**`run_code` 的运行时进程做了环境净化**——它连 `DSH_WEB_URL`、`DSH_WEB_MODE` 都看不到（一个 `DSH_*` 变量都没有）。

**所以：子进程看不到 ≠ 主进程没拿到。**

#### ⚠️ 更正：「启动时间晚于写入时间」是**必要非充分**条件

**初版说"启动时间必须晚于你设环境变量的时刻 —— 这是最简单的判据"，这句不够严谨，已更正。**

**为什么不够**：Explorer（或快捷方式）拉起的进程，继承的是 **Explorer 自己那份环境块**，而 Explorer **只在收到 `WM_SETTINGCHANGE` 时才刷新**它。

| 写入方式 | 是否广播 `WM_SETTINGCHANGE` |
|---|---|
| `setx` | ✅ 会广播 → Explorer 刷新 |
| PowerShell `[Environment]::SetEnvironmentVariable(...,'User')` | ❌ **不广播** |
| `reg add HKCU\Environment` | ❌ **不广播** |

⇒ 会出现「DSH 启动时间**明明晚于**写入时间，进程里却**没有**这个变量」。

#### 四级判据（强度从弱到强）

| 级别 | 判据 | 说明 |
|---|---|---|
| ① 弱 | 进程启动时间晚于写入时间 | **可能被旧父进程骗**（见上） |
| ② 中 | 在**新开的窗口**执行 `Get-ChildItem env:DSH_TOOLS_MODE` | 可查出 Explorer 是否刷新 |
| ③ 强 | 读目标进程 **PEB 环境块** | 见下方脚本，直接证实进程拿到了 |
| ④ **最强** | **工具目录里有 `run_code`** | 落到功能，不会误判 |

#### 读目标进程 PEB 环境块（判据③）

PowerShell 无法直接读他进程环境，用 P/Invoke：

```powershell
# 需要与目标进程同会话（或管理员）
Get-CimInstance Win32_Process -Filter "name='node.exe'" |
  Where-Object { $_.CommandLine -like '*dsh*bin.js*' } |
  Select-Object ProcessId, CreationDate, CommandLine
```

拿到 PID 后，用 `ReadProcessMemory` 读 PEB：
（本机实测脚本见 `%USERPROFILE%\.dsh` 相关记录；核心是 x64 偏移
`PEB+0x20 → ProcessParameters`，`+0x80 → Environment`，`+0x3F0 → EnvironmentSize`）

#### ★ 三档启动方式的继承链（办公室笔记本务必对照）

| 启动方式 | 环境变量继承行为 | 应对 |
|---|---|---|
| **Explorer / 快捷方式 / 启动文件夹** | 父进程（Explorer）不刷新就传**旧值** | 设完变量后**重启 explorer**（任务管理器→重启 Windows 资源管理器）或**注销重登** |
| **计划任务（Task Scheduler）** | 每次启动任务时按用户**重新读注册表** | 通常**免重登**（除非它只是拉起旧进程） |
| **Windows 服务（SCM）** | SCM 用**系统**环境构造环境块 | ⚠️ **用户级变量对服务不生效** → 改设**系统环境变量**，或写该服务的 `Environment` 值：`HKLM\SYSTEM\CurrentControlSet\Services\<name>\Environment` |

### 坑 4：以为「必须开新会话」

**现象**：感觉"只有新会话才有 `run_code`"。

**真相**：这是**进程级**设置，不是会话级。准确说法是：

> **配置变更必须重启进程；重启后，进程内创建的所有会话都带上它。**

你观察到的"新会话才有"是对的，但原因不是"会话新旧"，而是"**旧会话持有重启前的工具列表快照**"。

---

## 四、验证成功的三种方法（从易到难）

### 方法 A：环境变量（快，但可能误判）

```powershell
# 在【DSH 内部】的工具里执行，看主进程 —— 注意 run_code 子进程看不到，要用 pwsh 工具
Get-ChildItem env: | Where-Object { $_.Name -match 'DSH_TOOLS_MODE' }
```

⚠️ 注意：在 `run_code` 里读**一定为空**（环境净化）。要用 DSH 的 `pwsh` 工具在**主进程侧**读。

### 方法 B：上下文指标对比（推荐，最可靠）

DSH 每个会话的投影缓存里记录了**三段** token 数：

```
%USERPROFILE%\.dsh\storages\session_projcache\sessions\session-*.json
```

路径：`record.rows.contextBreakdown.val.breakdown.{systemTokens, toolsTokens, messageTokens}`

#### ⚠️ 更正留痕（重要，请勿删）

> **初版把 `7120 → 34277` 的「4.8 倍」归因于 mode，这是错的。**
> 经 Codex 复核 + 本机全量 `session_projcache` 数据复核后更正：
> **该差值主要来自 Computer Use 插件（56 个工具），不是 mode。**
> 保留此段以警示后来者 —— 这正是"混淆两个变量"的典型案例。

#### 判据优先级（从强到弱）

| 优先级 | 判据 | 是否受插件集合影响 |
|---|---|---|
| **①（最强，唯一通用）** | **工具目录里有 `run_code`** | ❌ 不受影响 |
| **②（主判据）** | **`systemTokens` 前后对比**（本机 2115 → 25973，+~2.4 万） | ⚠️ 随注册工具数变化 |
| **③（辅助）** | **`toolsTokens` 前后对比**（**仅 `both` 下成立**，见下） | ⚠️ **其他插件也涨这里** |

> ⚠️ **判据③仅 `both` 适用**：`ptc` 模式下 native schema 被**折叠**，`toolsTokens` 反而会**大幅下降**（见下方源码依据）。

**原理口诀**（含源码依据，非经验归纳）：

```
SDK 声明块            → 进 systemTokens  ← mode 的真正大头
run_code 自己的 schema → 进 toolsTokens   ← 只有 ~500（仅 both）
其他插件（如 Computer Use）→ 也进 toolsTokens
```

**源码依据**（`dsh-tools/lib/index.js`）：

| 位置 | 代码 | 含义 |
|---|---|---|
| **L2703** | `this.defaultMode = config.mode ?? "native"` | 默认值确认 |
| **L2748-2750** | `text: (context) => { if (mode === "native") return ""; ... }` | **SDK 块注册为 `systemPrompt` 的 `"tools:sdk"` section**，native 下渲染空串 → 这正是"SDK 声明块进 systemTokens"的原因 |
| **L2706-2709** | `if (this.defaultMode !== "native") { section(collapseSection); section(sdkSection) }` | 仅非 native 才挂载 |
| **L2832-2835** | `if (mode === "native") return { schemas: [...全部], ... }` | native：全量 |
| **L2838-2841** | `if (mode === "ptc") return { schemas: schemas.filter(s => s.name === RUN_CODE_NAME), knownNames: [RUN_CODE_NAME] }` | ⚠️ **ptc：只留 `run_code`，其余全部从目录消失** |
| **L2842-2845** | `return { schemas, knownNames: [...view.knownNames, RUN_CODE_NAME] }` | both：全量 **+** `run_code` |

**判读表**：

| systemTokens | toolsTokens | 工具目录 | 结论 |
|---|---|---|---|
| **大涨** | 小涨（~500） | 有 `run_code` | ✅ **`both` 生效** |
| **大涨** | **下降** | 有 `run_code` | ✅ **`ptc` 生效**（原生 schema 被折叠，属**预期**） |
| 不变 | **大涨** | 无 `run_code` | ❌ **插件变动，不是 mode** |
| 不变 | 不变 | 无 `run_code` | ❌ 未生效（查继承链） |

> 💡 **判据①（工具目录里有没有 `run_code`）是唯一在所有模式下都通用的判据** ——
> 因为 `both` 让 `toolsTokens` 涨、`ptc` 让它跌，方向相反，只有"目录里有没有"始终可靠。

**判据②的边界**：SDK 声明块按**注册工具数**生成。若某台机器工具数很少，
`systemTokens` 的绝对增量可能只有几千、与噪声不易区分 —— **此时以判据①为准。**

#### 实测数据（本机全量 42 个会话，2026-09-18）

> ⏰ **本文档全部使用本地时间（+08:00）**。若你从 `session_projcache` 的 `createdAt`（毫秒时间戳）自行换算，
> 请注意 `toISOString()` 输出的是 **UTC** —— 需 +8 小时才是下表的时间。

| 时间（本地 +08:00） | 会话数 | systemTokens | toolsTokens | 说明 |
|---|---|---|---|---|
| 08-28 ~ 09-15 | 29 | **1907** | **7120** | native，未装 CU |
| **09-17 22:40** | **2** | **2115** | **33757** | ⚠️ **native + 已装 CU** ← 关键证据 |
| 09-18 02:14 / 09-12 20:31 | 2 | **25973** | **34277** | **both** |

> **决定性对比**：09-17 22:40 那两个会话 `toolsTokens` 已经是 **33757**，但它们**还没开 `both`**（当时是 22:36 刚重启完的 native+CU）——
> 说明 `7120 → 33757` 是 **CU 插件**造成的。
> `both` 的真实增量 = `toolsTokens` **+520**（`run_code` 自身）+ `systemTokens` **+23858**（SDK 声明块）。

#### 快速读取（同时打印三个字段）

```powershell
$dir = "$env:USERPROFILE\.dsh\storages\session_projcache\sessions"
Get-ChildItem $dir -Filter *.json |
  Sort-Object LastWriteTime -Descending | Select-Object -First 8 |
  ForEach-Object {
    $j = Get-Content $_.FullName -Raw | ConvertFrom-Json
    $b = $j.record.rows.contextBreakdown.val.breakdown
    [PSCustomObject]@{
      Session = $_.Name.Substring(0,16)
      System  = $b.systemTokens
      Tools   = $b.toolsTokens
      Message = $b.messageTokens
      Title   = $j.record.rows.title.val
    }
  } | Format-Table -AutoSize
```

### 方法 B-2：怎么在**任意版本 / 任意机器**上标定

**为什么不能照抄数值**：`systemTokens` 随注册工具数变化，`toolsTokens` 随插件集合变化。**不同 profile、不同插件组合，数值完全不同。**

**标定步骤（4 步）**：

1. **固定变量**：确认前后两次用的是**同一个 profile、同一套插件、同一个 preset**。
2. **取改动前**：在**未设** `DSH_TOOLS_MODE` 时开一个会话，记下 `{systemTokens, toolsTokens, messageTokens}`。
3. **取改动后**：设好变量 + 重启 + 开新会话，再记一次。
4. **比三个字段**，按下表判读：

| systemTokens | toolsTokens | 工具目录有 `run_code` | 结论 |
|---|---|---|---|
| 明显上升 | 小涨（几百） | ✅ | **`both` 生效** |
| 明显上升 | **下降** | ✅ | **`ptc` 生效**（原生目录被折叠，属预期） |
| 不变 | 大涨 | ❌ | 插件变动，**不是** mode |
| 不变 | 不变 | ❌ | 未生效 → 查继承链（坑 3） |

> 💡 **提示**：如果只想快速确认，**直接看工具目录有没有 `run_code`** 就够了（判据①）。
> 上下文指标只在你要**量化开销**时才需要。

#### 可选：控制组（control run）—— 仅在排查时使用

> ⚠️ **这不是标准流程的一部分。** 办公室笔记本是一次性部署，**流程越短越不容易出错**。
> 只有当**判据①与判据②互相冲突**、或结果不符合预期时，才做这一步。

**做法**：故意**不改**环境变量，只重启一次 DSH，再开一个会话，确认三个字段**没有变化**。

**它能排除两个混淆因素**：

1. 「**重启本身**」这个动作会不会改变数值
2. 两次采样之间是否发生了**你不知道的变化**（插件升级、HMR 热重载、preset 改动）

> ★ **第 2 条其实更重要**：控制组跑完若数值**变了**，那不是"标定失败"，
> 而是**发现了一个你不知道的变量** —— 这是有价值的告警，应查明后再继续。

### 方法 C：直接看工具列表（最直观）

开一个**新会话**，看工具目录里有没有 `run_code`。

或在会话里直接问模型：「你的工具列表里有 run_code 吗？」

---

## 五、办公室笔记本的完整操作清单

```powershell
# ============ 步骤 1：设环境变量 ============
[Environment]::SetEnvironmentVariable('DSH_TOOLS_MODE', 'both', 'User')
reg query HKCU\Environment /v DSH_TOOLS_MODE
# ✅ 确认输出：DSH_TOOLS_MODE    REG_SZ    both

# ============ 步骤 2：按端口杀干净旧 DSH ============
Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Write-Host "杀 PID $($_.OwningProcess)"; Stop-Process -Id $_.OwningProcess -Force }
Start-Sleep -Seconds 2
Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
# ✅ 确认：无输出 = 端口已释放

# ============ 步骤 3：新窗口启动 ============
# ⚠️ 关掉这个窗口，重新开一个 PowerShell，然后：
dsh web
```

**验证**：

1. 打开 `http://127.0.0.1:3080`
2. 开一个**新会话**
3. 问它：「用 run_code 跑一下 `return process.version`」
4. ✅ 成功 = 能看到返回的 Node 版本

---

## 六、回滚方法

想关掉 `run_code`，两种方式：

```powershell
# 方式 1：删掉环境变量（彻底回滚到 native）
[Environment]::SetEnvironmentVariable('DSH_TOOLS_MODE', $null, 'User')
# 然后重启 DSH

# 方式 2：改成 native（保留变量但关闭）
[Environment]::SetEnvironmentVariable('DSH_TOOLS_MODE', 'native', 'User')
# 然后重启 DSH
```

---

## 七、技术参考（原理与源码位置）

### 7.1 开关的定义位置

`dsh-web-app/cordis.patch.yml` 第 32-38 行：

```yaml
- id: tools
  config:
    # TEMPORARY workaround: DSH_TOOLS_MODE (native|ptc|both) opts a whole dsh
    # process into PTC mode while per-session tool-presentation selection is being
    # designed; unset keeps the schema default (native). Remove the env seam
    # once the web UI owns the choice per session.
    mode: !!js process.env.DSH_TOOLS_MODE
```

**官方注释翻译**：

> **临时方案**：`DSH_TOOLS_MODE`（`native`|`ptc`|`both`）让**整个 dsh 进程**进入 PTC 模式，因为**按会话选择 tool-presentation 的功能还在设计中**；不设置则保持 schema 默认值（native）。等 Web UI 自己拥有这个按会话选择的功能后，移除这个环境变量接缝。

### 7.2 类型定义

`dsh-tools/lib/types/index.d.ts` L448-461：

```ts
export type ToolPresentationMode = 'native' | 'ptc' | 'both';

export interface Config {
    /**
     * Model presentation. `native` (default) sends every visible schema; `ptc`
     * sends only `run_code` plus a generated SDK prompt and collapses the
     * executor to the same surface (a model-direct call may only name
     * `run_code`; `run_code` SDK sub-dispatches keep every visible tool);
     * `both` sends both forms. PTC mode requires a `ctx.codeRuntime` whose
     * `language` has a registered SDK renderer (TypeScript or Python) and fail
     * prompt assembly when it is absent or has no renderer.
     */
    mode?: ToolPresentationMode;
}
```

### 7.3 `run_code` 的实现契约

`dsh-tools/lib/types/ptc.d.ts` L1-7：

```ts
/**
 * PTC mode `run_code` transport. Programs call the registry's agent-visible
 * tools through nested executions scheduled under the native concurrency
 * contract; each sub-dispatch is logged for reconstruction, while only the
 * outer curated result enters model history.
 * @module @deepseek-ai/dsh-tools/src/ptc
 */
```

### 7.4 ⚠️ 防混淆：`workflow-ptc` ≠ `ptc-runtime`（最容易踩的认知陷阱）

`dsh-base/cordis.patch.yml`（约 369-375 行）：

```yaml
    - id: ptc-runtime
      name: '@deepseek-ai/dsh-ptc-runtime-node'

    - id: workflow-ptc
      name: '@deepseek-ai/dsh-workflow-ptc'
      config:
        provider: spawn
```

**两者名字像，作用完全不同 —— 对照表：**

| | `dsh-ptc-runtime-node` | `dsh-workflow-ptc` |
|---|---|---|
| **作用** | `run_code` 的**执行底座** | **workflow 引擎** |
| **装配位置** | host 平面（跨 preset 共享） | preset 层自带 |
| **是否被 disable** | ❌ **从未被 disable** | ✅ `dsh-web-app/cordis.patch.yml:459-463` 关掉了它 |
| **缺了会怎样** | 调 `run_code` 报错：<br>`mode ... requires a PTC runtime` | **workflow 工具挂不上，与 `run_code` 无关** |

**★ 为什么一个被 disable、一个没有（这才是陷阱的根）**：

- `dsh-web-app` 关掉 `workflow-ptc`，是因为 **preset 层自带了 workflow 引擎**
  （`standard-codex` 用 `workflow-worker-thread`）—— 重复装配会冲突。
- `ptc-runtime` **留在 host 平面、从未被 disable**，因为它是**跨 preset 的执行底座** ——
  每个 preset 的 `run_code` 都要用它。

> **一句话记忆**：**`workflow-ptc` 是"某个 preset 的零件"，`ptc-runtime` 是"整台机器的地基"。**
> 所以排查 `run_code` 时，**不要**去动 `workflow-ptc`。

### 7.5 支持的语言

`ptc.d.ts` L25：

```ts
export type PtcSdkLanguage = 'typescript' | 'python';
```

`run_code` 的 `code` 参数支持 TypeScript 和 Python 两种。

---

## 八、FAQ

**Q1：我设了变量，为什么新会话还是没 `run_code`？**
A：按顺序检查四件事：

1. 是否用了**新开的**终端窗口启动 DSH（旧窗口环境块已冻结）
2. 旧 DSH 是否真的**关干净了**（用**端口**判据，不是 PID —— 见坑 2）
3. 如果是**快捷方式/启动文件夹**启动的：Explorer 可能没刷新环境，
   → **重启 explorer**（任务管理器 → 重启「Windows 资源管理器」）或**注销重登**
4. 是否开了**新会话**（旧会话持有重启前的工具列表快照）

**Q2：`ptc` 和 `both` 到底怎么选？**
A：**永远选 `both`**。`ptc` 会移除所有原生工具，是降级。`both` 保留两者可回退。

**Q3：开 `both` 会变慢/变贵吗？**
A：**真实开销 = `systemTokens` +约 2.4 万（SDK 声明块，随注册工具数增长）+ `toolsTokens` +约 500。**

- **大头是 `systemTokens`**（本机 2115 → 25973），因为 SDK 声明块被注入到 **system prompt**（源码依据：非 native 模式下 `ctx.systemPrompt.section(this.sdkSection())`）。
- `toolsTokens` 只涨 `run_code` 自己那 ~500。

> ⚠️ **更正**：初版说"工具 schema 从 ~7120 涨到 ~34277（多约 27K）"是**错误口径** ——
> 那 2.7 万主要来自 **Computer Use 插件**，不是 `both`。详见 4.B 的更正留痕。

每轮请求都要发这些内容（有 KV Cache 时会便宜些）。**相比 `run_code` 带来的批量能力，这点开销通常值得。**

**Q4：办公室笔记本的 DSH 版本不同怎么办？**
A：先确认版本一致（本机 `0.1.6-alpha.1`）。不同版本请重新核对 `dsh-web-app/cordis.patch.yml` 里 `id: tools` 那一行的写法是否还是 `!!js process.env.DSH_TOOLS_MODE`。

**Q5：这个开关将来会变吗？**
A：会。官方注释明确说这是"**TEMPORARY workaround**"，将来 Web UI 会自己拥有 per-session 选择功能，届时这个环境变量接缝会被移除。

---

## 九、相关历史

本机（家用台式机）的实测时间线：

| 时间 | 事件 |
|---|---|
| 2026-09-17 深夜 | 上个会话与 Codex 讨论此事，Codex 纠正「PTC 装了，缺的是 mode」 |
| 2026-09-17 22:35 | 装 Computer Use 插件，22:36 重启 |
| 2026-09-17 22:40 | native + CU 会话：`systemTokens=2115 / toolsTokens=33757` |
| 2026-09-17 | 设 `DSH_TOOLS_MODE=both`，重启（PID 2496） |
| 2026-09-18 02:13 | DSH 进程 PID 2496 |
| 2026-09-18 02:27 | **再次重启 → PID 9608** |
| 2026-09-18 | **验证通过**：`systemTokens=25973 / toolsTokens=34277`，且工具目录有 `run_code` ✅ |
| 2026-09-18 02:33 | Codex 复核，**纠正证据 2 的归因错误**（4.8 倍主要来自 CU 插件，非 mode） |
| 2026-09-18 02:34 | Codex 派任务：请 DSH 修本手册（6 项改动）→ **已全部落实** |

**踩坑次数**：本机过程中走了**三次**错路，均由交叉验证纠正（不淡化）：

1. 以为要装包（`dsh-ptc-runtime-node` + `dsh-agent-tool-presentation`）→ 实为环境变量
2. 以为要改 preset 用 `presentAs('both')` → 那是**将来**的 per-session API
3. ★ **把 `toolsTokens` 的 4.8 倍归因于 mode** → 实为 **Computer Use 插件**造成（Codex 复核纠正）

> **共同教训**：三次都是**"混淆变量 / 用局部观察外推全局结论"**。
> **本手册已含全部更正，办公室笔记本照做即可，不会踩这些坑。**

---

*文档生成：2026-09-18 · DSH（deepseek-flash）· 基于 `0.1.6-alpha.1` 源码交叉验证*
*修订：2026-09-18 02:4x · 按 Codex 复核意见修订 6 处（证据归因、判据优先级、标定法、四级判据、防混淆表、开销口径）*

---

*文档生成：2026-09-18 · DSH（deepseek-flash）· 基于 `0.1.6-alpha.1` 源码交叉验证*
