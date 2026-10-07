# 桌面版 DSH 部署与迁移总结（可跨宿主机复用）

> **用途**：在其它终端/宿主机上部署「桌面版 DSH」并从 npm 版迁移插件时，按本文件操作可少踩坑。
> **成文日期**：2026-09-28（初稿 2026-09-27，2026-09-28 补入「打开文件夹」修复与反思）
> **验证环境**：Windows 11 (10.0.26200) / DSH 桌面版内核 `0.1.7-rc.2` / npm 版 `0.1.6-alpha.2`

---

## 目录

- [一、先记住这五条](#一先记住这五条)
- [二、环境事实（本机实测）](#二环境事实本机实测)
- [三、迁移流程（六步）](#三迁移流程六步)
- [四、踩坑实录（按危害排序）](#四踩坑实录按危害排序)
- [五、验证清单](#五验证清单)
- [六、日常运维](#六日常运维)
- [七、附录：常用命令](#七附录常用命令)
- [八、修复实录：「用文件资源管理器打开」按钮打不开文件夹（2026-09-28）](#八修复实录用文件资源管理器打开按钮打不开文件夹2026-09-28)

---

## 一、先记住这五条

如果只记五条，记这些：

| # | 铁律 | 一句话理由 |
|---|---|---|
| 1 | **`$DSH_HOME` 不变**，变的只是 profile | mailbox/skills/AGENTS.md 等 `$DSH_HOME` 级资产天然共享，不随切换丢失 |
| 2 | **插件版本必须跟着内核走** | 0.1.6 的插件 peer 不满足 0.1.7，须整批升到匹配版本 |
| 3 | **pnpm `file:` 依赖是硬链接，改源文件不会自动同步** | 这是**最阴的坑**，表现为「改了代码、重启无数次、界面毫无变化」 |
| 4 | **客户端插件只能 require 基座表内模块** | 基座外的模块解析不到，装了包也没用 |
| 5 | **改 `.ps1` 必须带 UTF-8 BOM** | 无 BOM 时 PowerShell 5.1 按 ANSI 解码中文 → 语法错 → 整个脚本不执行 |

### 再加三条「动手前」的铁律（2026-09-28 用代价换来的）

| # | 铁律 | 一句话理由 |
|---|---|---|
| 6 | **诊断未确证前，不要动手修** | 先做 **A/B 区分性实验**。本次因归因错误，白写了一个插件，还搞坏了 DSH 自身（见第八节） |
| 7 | **改宿主全局状态前，必须评估全局依赖** | `process.env`、全局单例、进程级开关都属此类。删一个环境变量就可能停掉整个命令执行 |
| 8 | **用户的现场描述是线索，不是证据** | 可作假设来源，**须实验确证**后才能当因果依据。本次据此提出的"状态累积"假设被反证推翻 |

---

## 二、环境事实（本机实测）

### 2.1 两套安装并存

| | 桌面版（主力） | npm 版（保留） |
|---|---|---|
| 内核版本 | **0.1.7-rc.2** | 0.1.6-alpha.2 |
| profile 名 | `desktop` | `web` / `headless` |
| 安装位置 | `%LOCALAPPDATA%\Programs\DeepSeek Harness` | `%APPDATA%\npm\node_modules\@deepseek-ai\dsh` |
| 宿主入口 | `app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host` | `lib/bin.js` |
| CLI | ❌ 无 | ✅ `dsh` |
| 占用 | 约 1010 MB / 9767 文件 | 约 560 MB / 26537 文件 |

> **重要**：二者**并存不冲突**，且是**刻意设计**（npm 版启动器里有
> `if (profile === "desktop") program.error('...managed exclusively by the Electron application')`）。
> 参照 Codex 侧的「ChatGPT 桌面应用 + codex CLI」并存模式。

### 2.2 关键路径

```
$DSH_HOME            = <USERPROFILE>\.dsh          ← 两套共享，切换不动
profile 目录          = $DSH_HOME\profiles\desktop
profile 依赖清单      = $DSH_HOME\profiles\desktop\package.json
profile 补丁层        = $DSH_HOME\profiles\desktop\cordis.patch.yml
自研插件（本地包）    = $DSH_HOME\local-plugins\<插件名>
profile 内插件副本    = $DSH_HOME\profiles\desktop\node_modules\@deepseek-ai\<插件名>
桌面版安装目录        = %LOCALAPPDATA%\Programs\DeepSeek Harness
桌面版内置 runtime    = <安装目录>\resources\runtime   （node 24.18.1 / pnpm 11.7.0）
桌面版应用数据        = %APPDATA%\@deepseek-ai\dsh-desktop
```

### 2.3 npm dist-tags 陷阱 ⚠️

```
latest = 0.1.5-rc.3     ← 比 0.1.6-alpha.2 还老！
alpha  = 0.1.7-alpha.2
next   = 0.1.7-rc.2     ← 与桌面版同内核，要用这个
```

> **裸敲 `npm i -g @deepseek-ai/dsh` = 版本倒退**。必须显式指定标签：
> `npm i -g @deepseek-ai/dsh@next`

---

## 三、迁移流程（六步）

### 步骤 0：摸清现状（**别跳过**）

```powershell
# 当前 profile 与内核
$env:DSH_PROFILE
Get-Content "$env:DSH_HOME\profiles\$env:DSH_PROFILE\package.json" -Raw

# 桌面版内核版本（在 app.asar 里，需特殊方法读，见附录）
# 已知桌面版 = 0.1.7-rc.2，npm 版 = 0.1.6-alpha.2

# 列出 npm 版装了哪些插件
npm ls -g --depth=0
Get-Content "$env:DSH_HOME\profiles\web\package.json" -Raw
Get-Content "$env:DSH_HOME\profiles\web\cordis.patch.yml" -Raw
```

**产出**：一份「插件清单 + 各自版本 + peer 要求」。

### 步骤 1：备份（**强制**）

```powershell
$dst = "$env:DSH_HOME\profiles\desktop"
$bak = "$dst\backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Force -Path $bak | Out-Null
Copy-Item "$dst\*.json","$dst\*.yml","$dst\*.yaml" $bak -Force
```

### 步骤 2：确定目标版本

检查每个插件在 npm 上的可用版本，**必须与桌面版内核匹配**：

```powershell
foreach ($n in @('dsh-computer-use','dsh-subagent-codex')) {
  npm view "@deepseek-ai/$n" versions --json
}
```

> **原则**：插件 peer 要求 `^0.1.7-rc.2` 就用 `0.1.7-rc.2`。
> **例外**：本机自研插件（`file:` 本地包）的 peer 声明可能滞后，**代码可能仍然兼容**，
> 需实测验证（见步骤 6）。

### 步骤 3：写入 profile 依赖

编辑 `$DSH_HOME\profiles\desktop\package.json`：

```json
{
  "name": "dsh-profile-desktop",
  "private": true,
  "dependencies": {
    "@deepseek-ai/dsh-billing": "file:C:/Users/<用户>/.dsh/local-plugins/dsh-billing",
    "@deepseek-ai/dsh-poetry": "file:C:/Users/<用户>/.dsh/local-plugins/dsh-poetry",
    "@deepseek-ai/dsh-qwen": "file:C:/Users/<用户>/.dsh/local-plugins/dsh-qwen",
    "@deepseek-ai/dsh-computer-use": "0.1.7-rc.2",
    "@deepseek-ai/dsh-experimental-computer-use-cua-driver-native": "0.1.7-rc.2",
    "@deepseek-ai/dsh-subagent-codex": "0.1.7-rc.2"
  }
}
```

> `file:` 路径用**正斜杠**；本机自研插件直接引用 `local-plugins` 原目录，不必复制。

### 步骤 4：安装

用**桌面版自带的 node + pnpm**（版本与宿主一致，最稳）：

```powershell
$base = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources"
$node = "$base\runtime\primary-runtime\dependencies\node\bin\node.exe"
$pnpm = "$base\runtime\pnpm\bin\pnpm.cjs"

$env:HTTP_PROXY = "http://127.0.0.1:<PORT>"   # 按需
$env:HTTPS_PROXY = "http://127.0.0.1:<PORT>"

& $node $pnpm install --dir "$env:DSH_HOME\profiles\desktop"
```

### 步骤 5：写 `cordis.patch.yml` 注册插件

在 `$DSH_HOME\profiles\desktop\cordis.patch.yml` **追加**（保留原有内容）：

```yaml
- insert:
    - id: dsh-billing
      name: '@deepseek-ai/dsh-billing'
- insert:
    - id: llm-qwen
      name: '@deepseek-ai/dsh-qwen'
- insert:
    - id: dsh-poetry
      name: '@deepseek-ai/dsh-poetry'
- insert:
    - id: subagent-codex
      name: '@deepseek-ai/dsh-subagent-codex'
      config:
        env:
          PATH: !!js process.env.APPDATA + '\\npm;' + process.env.PATH
- insert:
    - id: computer-use
      name: '@deepseek-ai/dsh-computer-use'
    - id: cua-driver-native
      name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'
```

### 步骤 6：验证（见第五节）+ 重启

---

## 四、踩坑实录（按危害排序）

### 🔴 坑 1：pnpm `file:` 硬链接 —— 最阴的一个

**现象**：
- 修改了 `local-plugins` 下的插件代码
- 重启桌面版**无数次**，界面**毫无变化**
- `pnpm install --force` **也没用**（它认为"已是最新"）

**成因**：
`pnpm` 的 `file:` 依赖用**硬链接**。编辑器保存文件时通常是"**替换**"而非"原地写入"，
硬链接随即断裂 —— **profile 里的副本永远停留在旧版本**。

**诊断**：

```powershell
$n = "dsh-poetry"
$src = "$env:DSH_HOME\local-plugins\$n\lib\client.js"
$dst = "$env:DSH_HOME\profiles\desktop\node_modules\@deepseek-ai\$n\lib\client.js"
"源:      $((Get-Item $src).Length) bytes, $((Get-Item $src).LastWriteTime)"
"profile: $((Get-Item $dst).Length) bytes, $((Get-Item $dst).LastWriteTime)"
# 大小/时间不同 = 断链了
```

**解决**：手动同步（**不要指望 pnpm**）

```powershell
$n = "dsh-poetry"
Copy-Item "$env:DSH_HOME\local-plugins\$n\*" `
          "$env:DSH_HOME\profiles\desktop\node_modules\@deepseek-ai\$n\" `
          -Recurse -Force
```

> ⚠️ 删掉副本再 `pnpm install` **也不重建**（pnpm 判定"已是最新"）。
> 最可靠是上面的 `Copy-Item`。

---

### 🔴 坑 2：客户端插件的模块解析边界

**现象**：插件装了、host 侧也加载了，但**界面里就是不出现**。

**成因**：DSH 客户端插件（`dsh.client`）的 bundle 在浏览器侧运行，
**只能解析「基座表（`PLATFORM_MODULES`）」内的模块**（react 等）。
基座之外的模块必须：

- 由**消费方**在 `package.json` 的 `dsh.client.external` 中声明，**或**
- 作为「**插件行**」被图接纳 —— 即该包自己有 `lib/client.js` + `dsh.client` 声明

**纯库**（只有 `lib/index.js`，无 `dsh.client`）两条路都不走 —— **装了包也解析不到**。

**诊断**：

```javascript
// 看 client.js 实际 require 了什么
const txt = require('fs').readFileSync('.../lib/client.js', 'utf8');
console.log([...txt.matchAll(/require\(["']([^"']+)["']\)/g)].map(m => m[1]));
// 基线：require("react")                  → ✅ 基座表内，安全
// 危险：require("某个纯库")               → ❌ 解析不到
```

**解决**（二选一）：
1. **首选**：把依赖内联进插件（如把图标 SVG 直接写进 `client.js`）—— 彻底消除外部依赖，最干净
2. 让被依赖的包**自己有 `dsh.client` 声明**，成为"插件行"

> **判别方法**：看目标包有没有 `lib/client.js`。
> 有 → 插件行（可作依赖）；无 → 纯库（**不能**作客户端依赖）。

---

### 🟠 坑 3：图标命名规范随版本变更

**现象**：模块解析成功，但图标渲染为空白/报 `undefined`。

**成因**：`0.1.6` → `0.1.7` 图标命名规范变了：

| 版本 | 命名 |
|---|---|
| 0.1.6-alpha.2 | `IconListPenOutline16`（**81** 个） |
| 0.1.7-rc.2 | `IconListPenOutlineMedium` / `...Regular`（**188** 个） |

**解决**：内联 SVG artwork（同坑 2 的解法），一劳永逸。

---

### 🟠 坑 4：`.ps1` 丢 UTF-8 BOM → PowerShell 5.1 下整个脚本不执行

**现象**：
```
Unexpected token 'dsh' ...
PATH 鍙В鏋?             ← 中文变乱码
```
**整个脚本无法执行**（不是部分失败）。

**成因**：无 BOM 时 Windows PowerShell 5.1 按 **ANSI** 解码文件 → 中文字符串被破坏 →
引号被乱码吃掉 → 语法错误。**PowerShell 7 不受影响**（默认 UTF-8），所以容易漏测。

**诊断**：

```powershell
foreach ($f in @('verify.ps1','setup.ps1')) {
  $b = [System.IO.File]::ReadAllBytes($f)
  $hasBom = ($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)
  "$(if ($hasBom) {'[有 BOM]'} else {'[无 BOM]'}) $f"
}
```

**解决**（写回带 BOM）：

```powershell
$p = 'verify.ps1'
$c = [System.IO.File]::ReadAllText($p, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($p, $c, [System.Text.UTF8Encoding]::new($true))
```

**预防**：在脚本末尾加自检（**注意**：不能用 `Get-Content -Encoding Byte`，
PS 7 已移除该参数会**静默失败**；改用 .NET）：

```powershell
$fs = [System.IO.File]::OpenRead($self)
try { $buf = New-Object byte[] 3; $n = $fs.Read($buf, 0, 3) } finally { $fs.Close() }
$hasBom = ($n -eq 3 -and $buf[0] -eq 0xEF -and $buf[1] -eq 0xBB -and $buf[2] -eq 0xBF)
```

---

### 🟡 坑 5：误以为「桌面版不能跑 headless」

**我犯的错**：看到 `DeepSeek Harness.exe --profile headless` 报
`bad option: --profile`，就断定"桌面版没有无头能力"。

**真相**：宿主进程本身就是用 **Electron 的 node 模式**跑的：

```
"DeepSeek Harness.exe" --expose-internals <asar内脚本> <asar根> <profile> ...
```

加上 `--expose-internals` 后，`app.asar` 内的模块**完全可以加载**：

| 验证项 | 结果 |
|---|---|
| `dsh-headless` 模块解析 | ✅ |
| `dsh-app-boot` 加载 | ✅ 导出 `boot` / `PROFILE_TEMPLATES` / `PROFILES_DIR` |
| `PROFILE_TEMPLATES.headless` | ✅ 存在 |
| `~/.dsh/profiles/headless` | ✅ 已存在 |

**结论**：`dsh --profile headless` 本质只是「**加载一个 profile 配置**」，
桌面版具备全部零件。若确实需要，可基于 `dsh-app-boot` 的 `boot()` 自建启动器。

> **教训**：这是「**观测不到 ≠ 不存在**」的典型。
> 遇到"某能力不可用"时，先问：**它靠什么启动？我用的方式对吗？**

---

### 🟡 坑 6：误以为「可以卸载 npm 版 CLI」

**我犯的错**：发现桥的 `dshCmd="dsh"` 在当前手动用法下是**死代码**，
就推断"可以卸载 CLI 省 560 MB"。

**为什么错**：

1. CLI 是**自动唤起路径**（`dsh --profile headless`）的**前提** —— 卸了连前提都没了
2. **"现在用不到" ≠ "应该删掉"**
3. 恢复路径未经验证（裸装会版本倒退，见 2.3）

**正解**：**保留 CLI，与桌面版并存**（同 Codex 侧模式）。
若要与桌面版对齐内核，用 `npm i -g @deepseek-ai/dsh@next`。

> **固化规则（处置性结论三问）**：
> ① 收益多大？ ② 恢复成本多少？ ③ **恢复路径是否已验证**？
> **三问都能答，才够格下处置性结论（删除/卸载/废弃/退休）。**

---

## 五、验证清单

### 5.1 静态检查（不启动应用）

```powershell
# ① 插件实体完整性
$pn = "$env:DSH_HOME\profiles\desktop\node_modules\@deepseek-ai"
foreach ($n in @('dsh-billing','dsh-poetry','dsh-qwen','dsh-computer-use',
                 'dsh-experimental-computer-use-cua-driver-native','dsh-subagent-codex')) {
  $dir = "$pn\$n"
  if (Test-Path $dir) {
    $pj = Get-Content "$dir\package.json" -Raw | ConvertFrom-Json
    "[OK] $n v$($pj.version)"
  } else { "[缺失] $n" }
}

# ② 自研插件 源 vs 副本 同步（防坑 1）
foreach ($n in @('dsh-billing','dsh-poetry','dsh-qwen')) {
  $s = "$env:DSH_HOME\local-plugins\$n"
  $d = "$pn\$n"
  Get-ChildItem $s -Recurse -File | Where-Object { $_.Name -notmatch '\.bak-' } | ForEach-Object {
    $rel = $_.FullName.Substring($s.Length)
    $dp = Join-Path $d $rel
    $st = if (Test-Path $dp) { (Get-Item $dp).Length } else { -1 }
    if ($st -ne $_.Length) { "[不同步] $n$rel" }
  }
}

# ③ YAML 语法
# （用 node + yaml 包解析 cordis.patch.yml，注意 !!js 标签会告警属正常）
```

### 5.2 重启后验证

```powershell
# ④ 宿主进程（PID 应变化 = 真重启了）
Get-CimInstance Win32_Process -Filter "Name like '%DeepSeek%'" |
  Where-Object { $_.CommandLine -match 'dsh-desktop-host' } |
  Select-Object ProcessId, CreationDate

# ⑤ Cua 驱动是否加载（证明 computer-use 生效）
$p = Get-Process -Id <宿主PID>
$p.Modules | Where-Object { $_.FileName -match 'cua_driver' }

# ⑥ billing 服务是否实时（数据文件应在数分钟内更新）
$d = "$env:DSH_HOME\profiles\desktop\node_modules\@deepseek-ai\dsh-billing\lib\.last-data.json"
"距今 $([math]::Round(((Get-Date) - (Get-Item $d).LastWriteTime).TotalMinutes,1)) 分钟"
```

### 5.3 界面验证（**必须肉眼确认**）

| 插件 | 预期位置 |
|---|---|
| `dsh-billing` | **底部**状态栏：「充值余额 / 今日消费」 |
| `dsh-poetry` | **侧边栏底部、设置项上方**：「诗词」按钮（列表+笔图标） |
| `dsh-qwen` | 模型选择器里的 qwen 系列 |

> 桌面版的侧边栏是**可折叠**的。用自动化点击"打开侧边栏"按钮可能反而把它**收起**，
> 界面项**建议人工确认**。

---

## 六、日常运维

### 6.1 修改自研插件后（**必做**）

```powershell
$n = "dsh-poetry"   # 换成实际插件名
Copy-Item "$env:DSH_HOME\local-plugins\$n\*" `
          "$env:DSH_HOME\profiles\desktop\node_modules\@deepseek-ai\$n\" `
          -Recurse -Force
# 然后重启桌面版
```

### 6.2 何时需要重启

| 改动 | 需要重启？ |
|---|---|
| `profile\package.json`（依赖） | ✅ **必须** |
| `profile\cordis.patch.yml`（插件注册） | ✅ **必须** |
| 插件代码（`local-plugins\*`） | ✅ 必须（且**先同步副本**） |
| ACP 套件文件（桥脚本、配置） | ❌ **不需要** —— 与桌面版无关 |
| `AGENTS.md` / skills | ❌ 一般不需要 |

> **要点**：只有「**启动时读一次的插件加载配置**」才需要重启。
> ACP 套件对桌面版来说只是磁盘上的文件，桌面版根本不加载它们。

### 6.3 卸载 npm 版之前

**先做处置性结论三问**（见坑 6）：
1. 收益多大？（560 MB，是否紧急）
2. 恢复成本多少？
3. **恢复路径是否已验证？**（能否装回、装哪个版本 —— 注意 `@next` 陷阱）

**并且**：CLI 是自动唤起路径的前提，**建议保留**。

---

## 七、附录：常用命令

### 7.1 读取 `app.asar` 内的文件（桌面版内核信息）

Electron 的 asar 补丁会拦截 `fs` 调用，**Node 读不了**，要用 .NET：

```powershell
$asar = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\app.asar"
$fs = [System.IO.File]::OpenRead($asar)

function Read-At([int64]$off, [int]$size) {
  $buf = New-Object byte[] $size
  $fs.Position = $off
  $read = 0
  while ($read -lt $size) { $n = $fs.Read($buf,$read,$size-$read); if ($n -le 0) {break}; $read += $n }
  return ,$buf
}

# 头 16 字节：JSON 长度在 offset 12
$head = Read-At 0 16
$jsonLen = [BitConverter]::ToUInt32($head, 12)
$dataStart = 8 + $jsonLen

# 导出头部 JSON（列出所有文件与 offset）
$jb = Read-At 16 $jsonLen
[System.IO.File]::WriteAllBytes("$env:TEMP\asar-header.json", $jb)

# 之后可用 Node 解析头部、按 offset 取任意文件
$fs.Close()
```

### 7.2 用桌面版的 node/pnpm

```powershell
$base = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources"
$node = "$base\runtime\primary-runtime\dependencies\node\bin\node.exe"   # v24.21.0
$pnpm = "$base\runtime\pnpm\bin\pnpm.cjs"                                # v11.7.0

& $node --version
& $node $pnpm --version
```

### 7.3 用 Electron 的 node 模式执行脚本（可访问 asar）

```powershell
$exe = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\DeepSeek Harness.exe"
$asarDsh = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\app.asar\dsh"

& $exe --expose-internals "$env:TEMP\my-script.js" $asarDsh
```

> **`--expose-internals` 是关键**，缺了它模块解析会失败（`MODULE_NOT_FOUND`）。

### 7.4 完整卸载（**仅在你确实决定后**）

```powershell
npm uninstall -g @deepseek-ai/dsh
# 注意：这会让桥的自动唤起路径（dsh --profile headless）失效
```

---

## 八、修复实录：「用文件资源管理器打开」按钮打不开文件夹（2026-09-28）

> 本节记录一个**已确证并已修复**的桌面版缺陷，以及 DSH 为此走的一段弯路。
> 前者可直接复用；**后者的教训比修复本身更值钱**。

### 8.1 现象

点击会话右上角的「**用 文件资源管理器 打开**」（快捷键 `Ctrl+Alt+O`）后，
**桌面上看不到任何窗口**，形似"点了没反应"。

但**任务栏里能找到**对应的文件夹窗口 —— 说明**文件夹其实被打开了**。

> 补充：同一入口的「用 VS Code 打开」当时报「**操作失败，请重试**」。
> 这是**另一个独立缺陷**（见 8.5），当时被混在一起排查，加剧了混乱。

### 8.2 真根因（实测确认）

**调用链**：

```
按钮 → @deepseek-ai/dsh-host-open-in-app（win32 适配器声明 shell-open）
     → openNativePath → openExplorer → runNativeCommand('explorer.exe', [文件URI])
```

**病因**：`@deepseek-ai/dsh-native-command` 的 `runNativeCommand()` **固定写死**：

```javascript
execFile(command, args, { encoding: "utf8", signal, windowsHide: true }, ...)
//                                                        ^^^^^^^^^^^^^^^^
```

`windowsHide: true` 本意是给 `reg.exe` 这类**控制台工具**「别闪黑框」用的。
但 **`explorer.exe` 是 GUI 启动器**，它继承 `SW_HIDE` ⇒
**文件夹窗口被创建出来，但 `WS_VISIBLE=0`（不可见）**。

**A/B 实测**（同一调用只改该参数，目标 `<DSH_ROOT>`）：

| 参数 | 结果 |
|---|---|
| `windowsHide: true` | 窗口计数 3→4，**可见 0**，隐藏 +1（复现缺陷） |
| `windowsHide: false` | 窗口计数 4→5，**可见 +1**（窗口正常出现） |

### 8.3 修复方案（一行级）

**最小改动**：让 GUI 启动器不隐藏，其余维持原样。

```javascript
// 新增
const shouldHide = (c) => !/explorer\.exe$/i.test(c);

// 调用点
windowsHide: true                    →    windowsHide: shouldHide(command)
```

⇒ 只有 `explorer.exe` 不隐藏；`reg.exe`、`powershell`（图标提取）、`wslpath`
仍按原样隐藏，**不会引入黑框闪烁**。

**落地方式**（桌面版是打包好的 `app.asar`，无法直接改源码）：

- 目标：`<安装目录>\resources\app.asar` 内
  `dsh/node_modules/@deepseek-ai/dsh-native-command/lib/index.js`
- 方式：**等长原地修补**（改动前后字节数完全一致 40419）
  ⇒ `asar` 头部与全部 offset 继续有效，无需重建
- 校验：`asar` 总大小不变（117445671）；补丁后从 `asar` 重新读出与补丁内容**逐字节一致**；`node --check` 语法通过

**两点须知**：

1. 头部 `integrity` 字段**刻意未改**（改头部影响整头部校验，风险更大）
   ⇒ 该条目的 per-file hash 现已过期，**属预期，不是损坏**
2. **app 升级会覆盖 `app.asar`**，此补丁随之失效
   ⇒ 需重打补丁，或等官方修复

### 8.4 定位偏移的正确方法（别用记下来的数字）

修补前必须**从 `asar` 头部实时解析**目标文件的 `size` / `offset`，
**不要用过期的硬编码偏移**（本机实测：先前记录的 offset 与实际相差约 3.3 MB，
若照旧改会写坏别的文件）。

```powershell
$asar = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\app.asar"
$fs = [System.IO.File]::OpenRead($asar)
$head = New-Object byte[] 16
$fs.Position = 0; $null = $fs.Read($head, 0, 16)
$jsonLen  = [BitConverter]::ToUInt32($head, 12)   # 头部 JSON 长度
$dataStart = 8 + $jsonLen                          # 文件数据的起始绝对偏移
$jb = New-Object byte[] $jsonLen
$fs.Position = 16; $null = $fs.Read($jb, 0, $jsonLen)
$json = [System.Text.Encoding]::UTF8.GetString($jb)
$fs.Close()

# 在头部 JSON 里搜目标包，取其 index.js 的 size/offset
$i = $json.IndexOf('"dsh-native-command"')
$seg = $json.Substring($i, 2500)
$m = [regex]::Match($seg, '"index\.js":\{"size":(\d+),"offset":"(\d+)"')
"size=$($m.Groups[1].Value)  offset=$($m.Groups[2].Value)"
# 绝对位置 = $dataStart + offset
```

### 8.5 同时发现的另一独立缺陷：Electron 系应用无法启动

**现象**：点「用 VS Code 打开」报「操作失败，请重试」。
实测 `Code.exe "<DSH_ROOT>"` **退出码 1、进程数 0 —— 应用根本没启动**。

**根因**：桌面版自带 `<安装目录>\resources\runtime\bin\node.cmd` 里有

```cmd
set ELECTRON_RUN_AS_NODE=1
"%DSH_DESKTOP_NODE_EXECUTABLE%" --expose-internals %*
```

（DSH 用它把 Electron 主程序当 Node 跑，本身合理。）

该变量**留在宿主进程环境里**，被 `spawn` 的子进程继承。
**Electron 系应用**（VS Code / Cursor / Windsurf / Zed …）的启动器一看到它就
**进入 Node 模式**，把传来的路径当 JS 脚本加载：

```
Error: Cannot find module '<DSH_ROOT>'
  code: 'MODULE_NOT_FOUND'      (Node.js v24.18.0)
exit code: 1
```

**为什么内置的 `scrubbedParentEnv()` 没拦住**：它只清理两类 ——
① `DSH_*` 前缀；② 匹配 `/KEY|PASSWORD|SECRET|TOKEN/i` 的敏感变量。
`ELECTRON_RUN_AS_NODE` **两类都不属于**，于是被原样传给子进程。

**A/B 实测**：

| `ELECTRON_RUN_AS_NODE` | 结果 |
|---|---|
| `=1` | VS Code 退出码 1，**进程数 0（未启动）** |
| 未设置 | VS Code **正常打开**「欢迎 - DSH」 |

**⚠️ 修复时的重大注意事项（本节最重要的教训）**

**不要**在宿主插件里 `delete process.env["ELECTRON_RUN_AS_NODE"]` ——
虽然能修好 Electron 系应用，但会**破坏 DSH 自身的命令执行**：

```
subprocess-local: Windows Job runner exited with exit code 0
                  before proving its managed range empty
```

表现为 DSH **无法执行任何命令**（`pwsh` / `run_code` 全部报错），
连带依赖 `subprocess` 的插件（如 `dsh-billing` 余额面板）**停止刷新**。

⇒ **DSH 的 `dsh-subprocess-local`（Windows Job runner）自身依赖该变量**
以 node 模式启动内部进程。**动它等于拆自己的地基。**

**正确方向**（若官方未修）：**只清理传给特定子进程的环境**，
例如在 `open-in-app` 的 `spawn` 处**逐进程剔除**该变量，
而**不是**修改宿主的全局 `process.env`。

### 8.6 ★诊断反思：DSH 本次连错三处（教训比修复更值钱）

| # | 错误 | 真相 | 错因 |
|---|---|---|---|
| 1 | 归因「**前台窗口锁**」 | 失效窗口 `IsIconic=false`、DWM `cloaked=0`、坐标尺寸正常，**仅可见位被清**；前台锁不会清 `WS_VISIBLE` | 只测了 `SetForegroundWindow` 返回 `false` 就下结论，**没查 `IsIconic` / DWM cloaked** |
| 2 | 采信「**鼓捣完之后才出现**」并提出「状态累积」假设 | 窗口由 shell 委托创建，**每点一次新增一个**，与累积状态无关 | 用户描述属**偶发观察**，不足以支撑因果；未做区分性实验即采信 |
| 3 | 为错误归因**写了整个插件**（koffi + user32 轮询 + `ShowWindow`） | 方向整体作废 | **诊断未确证就动手修** |

**更严重的**：因在插件里**错误地修改宿主全局 `process.env`**，
**搞坏了 DSH 自身的命令执行能力**（见 8.5 注意事项）。

**⇒ 本次固化三条规则**（与既有「观测有效性五则」「处置性结论三问」并列）：

1. **诊断未确证前，不要动手修** —— 先做**区分性实验**（A/B 对照），再决定方案
2. **改宿主全局状态前，必须评估全局依赖** —— `process.env`、全局单例、进程级开关都属此类
3. **用户的现场描述是线索，不是证据** —— 可作假设来源，须实验确证后才能作为因果依据

### 8.7 复用要点（换宿主机时照做）

1. 若遇到「点了没反应但任务栏有窗口」⇒ 优先怀疑 **`windowsHide`**，用 8.2 的 A/B 法验证
2. 若遇到 Electron 系应用「操作失败」⇒ 检查宿主环境是否有 **`ELECTRON_RUN_AS_NODE`**
3. 打补丁前**实时解析 `asar` 头部取偏移**（见 8.4），不要用记下来的数字
4. 打补丁**务必等长**，并备份原始字节 + 偏移 + sha256
5. **app 升级会覆盖 `app.asar`** ⇒ 升级后需重新检查该补丁是否还在

---

## 变更记录

| 日期 | 内容 |
|---|---|
| 2026-09-27 | 初稿。基于 npm 版 0.1.6-alpha.2 → 桌面版 0.1.7-rc.2 的实际迁移经验。 |
| 2026-09-28 | 补入**第八节**：「用文件资源管理器打开」按钮打不开文件夹的完整修复实录（真根因 = `runNativeCommand` 的 `windowsHide: true`）、同批发现的 `ELECTRON_RUN_AS_NODE` 缺陷与其**危险修法**、以及 DSH 连错三处的诊断反思。标题日期同步更新为 20260928。 |

---

## 致谢

本文件的多个关键事实由 **Codex**（同机另一 Agent，经 ACP 文件通道）独立实测提供，
包括：**npm dist-tags 重装陷阱**、**`.ps1` BOM 回归**、**共享状态的版本隔离分析**，
以及 **2026-09-28 的 `windowsHide` 真根因定位**（第八节）——后者还附带了
对 DSH 两个错误猜测的**反证**，把一段走偏的排查拉回了正轨。
DSH 负责复核与落实。
