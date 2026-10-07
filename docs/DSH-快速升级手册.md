# DSH 升级快车道手册（Windows · pnpm + npmmirror）

> 适用：本机（2026-08 实测 rc.7 → rc.8 → 0.1.1-rc.1 → 0.1.1-rc.2 四连升，主体安装 16~20 秒完成）。
> 核心结论：**不要用 npm install，改用 pnpm + 国内镜像直连**。

## 为什么以前会“卡死在网络”

1. `registry.npmjs.org` 直连被墙；走 Clash 代理虽然能通，但**慢到离谱**（实测一个 ping 要 6.9 秒），npm 的依赖解析器（arborist）在 500+ 包的大图上会长时间空转、零磁盘写入。
2. 国内镜像 `registry.npmmirror.com` **直连 150ms 内响应**，是正常速度的几十倍。
3. 换 pnpm 的另一个好处：pnpm 不清理 `node_modules` 里非托管目录，**三个自装插件（poetry/billing/qwen）不会被升级冲掉**；npm 每次都会把它们当“多余包”删掉。

---

## 前置准备（公司笔记本一次性配好）

- Node.js **22.19+ 或 24.x**（`node -v`）
- pnpm **11.x**（`pnpm -v`；没有就 `npm i -g pnpm`）
- DSH 检出目录，结构应包含：
  - `package.json`（三个依赖：`@deepseek-ai/dsh`、`dsh-subagent-codex`、`dsh-subagent-claude-code`）
  - `pnpm-workspace.yaml`（至少含下面“关键内容”）
  - `node_modules`（旧版可留，升级时 pnpm 会自动替换）
- 后台管理脚本：`dsh-web-tools\dsh-web.ps1`
- 插件备份目录（习惯：`work\_plugins-xxx-backup`，虽然 pnpm 一般不删，但保险）

`pnpm-workspace.yaml` 关键内容（其余行 pnpm 会自动补充，不用管）：

```yaml
allowBuilds:
  '@deepseek-ai/dsh-subprocess-local': true
  '@google/genai': true
  'koffi': true
  'node-pty': true
  'protobufjs': true
  'sharp': true
```

---

## 升级四步走（以后每次照抄）

### 第 0 步：确认新版本号

```powershell
# 注意：npm 的 latest 标签可能滞后（如子代理包显示 0.0.1-rc.1），
# 以 versions 列表里的最高版为准
npm view @deepseek-ai/dsh versions --json --registry=https://registry.npmmirror.com | Select-Object -Last 5
```

### 第 1 步：停 DSH + 备份插件

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dsh-web-tools\dsh-web.ps1 stop
Copy-Item -Path node_modules\@deepseek-ai\dsh-poetry,node_modules\@deepseek-ai\dsh-billing,node_modules\@deepseek-ai\dsh-qwen -Destination work\_plugins-backup -Recurse -Force
```

### 第 2 步：改版本号

把 `package.json` 的 `dependencies` 三个版本改成目标版（例如 `^0.1.1-rc.2`）：

```json
"@deepseek-ai/dsh": "^0.1.1-rc.2",
"@deepseek-ai/dsh-subagent-claude-code": "^0.1.1-rc.2",
"@deepseek-ai/dsh-subagent-codex": "^0.1.1-rc.2"
```

> 必须显式改版本号！依赖范围已满足时，pnpm/npm 都不会自动升。

### 第 3 步：pnpm install（关键命令）

```powershell
# 关键点：清掉代理环境变量，直连国内镜像
Remove-Item Env:http_proxy,Env:https_proxy,Env:HTTP_PROXY,Env:HTTPS_PROXY -ErrorAction SilentlyContinue
pnpm install --config.node-linker=hoisted --registry=https://registry.npmmirror.com --reporter=append-only
```

预期：10~30 秒装完。**退出码 1 是正常的**，只要日志里看到 `resolved ... done` 且版本号对即可（见“哪些警告不用管”）。

---

## 第 4 步：验证（30 秒）

### 4.1 版本核对

```powershell
$base = 'node_modules\@deepseek-ai'
foreach ($p in 'dsh','dsh-subagent-codex','dsh-subagent-claude-code','dsh-llm-deepseek') {
  (Get-Content "$base\$p\package.json" -Raw | ConvertFrom-Json).version
}
```

### 4.2 原生依赖补丁 + 加载测试

```powershell
# dsh-subprocess-local 的 helper（每次升级后补跑）
Push-Location node_modules\@deepseek-ai\dsh-subprocess-local
node .\scripts\ensure-spawn-helper.mjs
Pop-Location

# 原生依赖加载测试
node --input-type=module -e "for (const n of ['koffi','node-pty','sharp','@deepseek-ai/dsh-subprocess-local']) { try { await import(n); console.log('OK ' + n) } catch(e) { console.log('ERR ' + n + ': ' + e.message.split(String.fromCharCode(10))[0]) } }"
```

全部 `OK` 即可。

### 4.3 插件在位检查（如缺失则从备份恢复）

```powershell
foreach ($p in 'dsh-poetry','dsh-billing','dsh-qwen') {
  if (Test-Path "node_modules\@deepseek-ai\$p") { "OK $p" } else { "MISSING $p" }
}
```

### 4.4 兼容自检（沿用 rc.7 的脚本即可，检查项跨版本有效）

```powershell
node D:\LLM\DSH\upgrade\0.1.0-rc.7\verify-plugins-rc7.mjs --dshroot <DSH根目录>
```

### 4.5 启动 + 冒烟

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dsh-web-tools\dsh-web.ps1 start
Start-Sleep -Seconds 12
powershell -NoProfile -ExecutionPolicy Bypass -File .\dsh-web-tools\dsh-web.ps1 status
powershell -NoProfile -ExecutionPolicy Bypass -File .\dsh-web-tools\dsh-web.ps1 logs   # err.log 应为空

# 页面 + 默认预设
Invoke-WebRequest -Uri http://127.0.0.1:3080/ -UseBasicParsing | Select-Object StatusCode
```

浏览器打开 `http://127.0.0.1:3080`，确认：模型选择器正常、三个插件 UI 正常。

---

## 哪些警告/退出码不用管

| 现象 | 解释 |
|---|---|
| 退出码 1 + `ERR_PNPM_IGNORED_BUILDS` | pnpm 默认不跑“非必要”包的构建脚本；我们的原生依赖是预编译包（koffi/node-pty/sharp 自带二进制），不构建也能用 |
| `UND_ERR_DESTROYED` / 超时（linux/darwin/arm64 等 tgz） | 镜像拉**其它平台**的可选包抖动，与 win32-x64 运行时无关 |
| pnpm 自动往 `pnpm-workspace.yaml` 塞一堆 `set this to true or false` 占位符 | pnpm 11 的自动生成行为，不影响功能，想整洁可以手动清掉，只留上面的 6 条 |
| `dsh web: opening the default browser` | rc.8+ 新特性，正常 |

## 公司笔记本特别提醒

1. **网络差异**：如果公司网络连 npmmirror 都慢/不通，先试 `Invoke-WebRequest https://registry.npmmirror.com/-/ping`；不通的话再给 pnpm 挂公司代理（`--proxy` 参数），但记住 npmjs 直连大概率仍然很慢。
2. **杀毒软件**：如果安装很慢且 CPU 被 Defender 占满，把 DSH 检出目录加进 Defender 排除项（`设置 → 病毒和威胁防护 → 排除项`），能显著提速。
3. **要随身带的东西**（U 盘/网盘）：
   - DSH 检出目录里：`package.json`、`pnpm-workspace.yaml`
   - `%USERPROFILE%\.dsh\profiles\web\`（package.json、cordis.patch.yml）
   - `%USERPROFILE%\.dsh\.agent-presets\standard-codex\agent.cordis.yml`（如启用 Codex 子代理）
   - `dsh-web-tools\dsh-web.ps1`、`upgrade\0.1.0-rc.7\verify-plugins-rc7.mjs`
   - 三个插件目录 `dsh-poetry / dsh-billing / dsh-qwen`
4. **升级后必查**：`dsh-llm-deepseek` 的版本要跟上（视觉模型等新特性都在里面）。

## 0.1.6 起的结构性变化与「半升级」事故处置（2026-09-19 实测）

### A. 自装插件已迁出 work/dsh（重要）

自 0.1.6 那轮升级起，web profile 的 `package.json` 把三个自装插件指向了**新位置**：

```json
"@deepseek-ai/dsh-poetry":  "file:C:/Users/<用户>/.dsh/local-plugins/dsh-poetry",
"@deepseek-ai/dsh-billing": "file:C:/Users/<用户>/.dsh/local-plugins/dsh-billing",
"@deepseek-ai/dsh-qwen":    "file:C:/Users/<用户>/.dsh/local-plugins/dsh-qwen"
```

- 即插件实体在 `~\.dsh\local-plugins\`，**work/dsh/node_modules 里不再有它们**（这是正常的，不要再往那儿恢复）
- 备份/同步插件时改从 `~\.dsh\local-plugins\` 取；qwen 的 alpha 兼容补丁与 `config.json` 都在该目录内
- profile 同时新增了 `dsh-computer-use`、`dsh-experimental-computer-use-cua-driver-native`、`dsh-subagent-codex` 等 npm 依赖

### B. 「半升级」事故：锁文件混版（本次卡住的真因）

**现象**：升级后 DSH 能启动，但版本树混版——230 个包是新版、21 个包（`dsh-settings` / `dsh-fs` / `dsh-jobs` / `dsh-workflow` / `dsh-ptc-runtime` / `dsh-sandbox` / `dsh-shell` 等）停在上一版；且**项目锁里就解析成旧版**（不是 node_modules 没同步那么简单）。

**排查命令**（一眼看出版本分布）：

```powershell
$base = 'node_modules\@deepseek-ai'
Get-ChildItem $base -Directory | Where-Object Name -like 'dsh-*' |
  ForEach-Object { (Get-Content "$($_.FullName)\package.json" | ConvertFrom-Json).version } |
  Group-Object | Sort-Object Name | Format-Table Count, Name -AutoSize
```

**处置**（与既有 B 步相同，双锁清空后全新解析）：

```powershell
Move-Item pnpm-lock.yaml pnpm-lock.yaml.mixed-bak -Force
Move-Item node_modules\.pnpm\lock.yaml node_modules\.pnpm\lock.yaml.mixed-bak -Force
pnpm install --config.node-linker=hoisted --registry=https://registry.npmmirror.com --reporter=append-only
```

清完双锁后本次 251 个包全部落到目标版本。**结论：凡看到版本分布有多个版本号，一律先清双锁重装，不要逐个 patch。**

### C. 升级后的标准核对清单（含 0.1.6 新增）

- 版本分布**只有一个版本号**（除 `dsh-poetry/billing/qwen` 的 0.1.0 与已知孤儿目录）
- `~\.dsh\local-plugins\` 三插件在位；qwen 补丁（`ToolCallId as CallId` + `installSection`）完好、`config.json` 在
- profile `package.json` 的 file: 依赖指向存在；profile `node_modules` 有 computer-use 等新依赖
- 原生依赖 4/4；四插件 import 冒烟通过
- `~\.dsh\settings.yaml` 模型配置与 persona `prefix` 未变
- 启动后 err.log 为 0 字节、token URL HTTP 200

### D. 用户级 preset 引用了被删除的包（「新对话开不了」的真因）

**现象**：DSH 能启动、err.log 也是 0 字节，但**新建对话失败**（或会话 resume 失败）。

**原因**：用户级 preset（`~\.dsh\.agent-presets\<名称>\agent.cordis.yml`）是内置 preset 的**旧副本**，里面的包引用会随官方改名而失效。0.1.6 的典型案例：

| 旧引用（已删除） | 新引用 |
|---|---|
| `@deepseek-ai/dsh-workflow-worker-thread` | `@deepseek-ai/dsh-workflow-ptc` |

同类还有 PTC 家族改名（`dsh-code-runtime*` → `dsh-ptc-runtime*`）、`agent/session-start` → `agent/created`、Session 同步读取接口弃用等。

**排查（一行搞定：把 preset 里引用的包逐个试导入）**：

```powershell
$preset = "$env:USERPROFILE\.dsh\.agent-presets\standard-codex\agent.cordis.yml"
$names = Select-String -Path $preset -Pattern "name:\s*'(@deepseek-ai/[^']+)'" |
  ForEach-Object { $_.Matches[0].Groups[1].Value } | Sort-Object -Unique
$names | Out-File -Encoding utf8 "$env:TEMP\preset-names.txt"
Push-Location "$env:USERPROFILE\.dsh\profiles\web"
node --input-type=module -e "import { readFileSync } from 'node:fs'; const names = readFileSync(process.env.TEMP + '/preset-names.txt','utf8').split(/\r?\n/).filter(Boolean); for (const n of names) { try { await import(n) } catch(e) { console.log('FAIL ' + n) } }"
Pop-Location
```

输出里出现任何 `FAIL` 就是它——把该行换成新版名称即可（或直接以新版内置 preset 为基座重建，再叠加自己的定制项）。

**注意**：官方内置 preset 里 `disabled: true` 的行（如 `@deepseek-ai/dsh-plugin-manager/tools`）本机可能没有模块链接，若试导入报 FAIL，删掉该行即可（它本来也不加载）。

**验证**：修完用上面的 YAML 解析检查结构，再重启 DSH 试新建对话。

---

## alpha 线升级补充（0.1.2-alpha.x，2026-08-31 实测）

> rc 线（0.1.1-rc.2 及之前）按上面的四步走即可；**alpha 线（0.1.2-alpha.x）有 3 个额外关键点**，缺一就会“重启后进不去 WebUI”。

### A. 升级前：先在 `pnpm-workspace.yaml` 加 overrides（治本）

alpha 版各子包声明的依赖范围过宽，pnpm 会把大量 `@deepseek-ai/dsh-*` 解析回旧版（rc.8/rc.2），旧版代码用了被 alpha 改名的 API，启动必崩。用 overrides 强制钉在 alpha：

```yaml
overrides:
  '@deepseek-ai/dsh-*': 0.1.2-alpha.2
```

> pnpm 11 的 overrides 放 `pnpm-workspace.yaml`，**不再读 package.json 的 `pnpm` 字段**（会警告忽略）。

### B. 升级后：若依赖树仍有旧版残留，清两个锁再重装

pnpm 11 会在 `node_modules\.pnpm\lock.yaml` 存一份锁副本；只删项目根的 `pnpm-lock.yaml` 没用，它会拿副本当“最新”。残留检查与清理：

```powershell
# 检查：出现 0.1.0-rc.8 / 0.1.1-rc.2 即有问题
$base = 'node_modules\@deepseek-ai'
foreach ($p in 'dsh','dsh-llm','dsh-session','dsh-attachment','dsh-session-title-llm','dsh-sandbox','dsh-settings','dsh-invariants','dsh-scope','dsh-fs','dsh-jobs','dsh-workflow') {
  "$p -> $((Get-Content "$base\$p\package.json" | ConvertFrom-Json).version)"
}

# 清理：把两个锁都改名（可恢复），再重装
Move-Item pnpm-lock.yaml pnpm-lock.yaml.bak -Force
Move-Item node_modules\.pnpm\lock.yaml node_modules\.pnpm\lock.yaml.bak -Force
pnpm install --config.node-linker=hoisted --registry=https://registry.npmmirror.com --reporter=append-only
```

### C. 自定义插件适配（dsh-qwen）

alpha 把 `dsh-llm` 的 `CallId` 改名为 `ToolCallId`、设置面板 API 重构。`dsh-qwen@0.1.0` 需打两处补丁（checkout 与 profile 两份都要改，详见 `upgrade\0.1.2-alpha.2\alpha2-qwen-patch.md`）：

1. `import { CallId }` → `import { ToolCallId as CallId }`
2. `installSettingsSection` / `settingsNamespace` → `ctx.inject(["settings"])` + `settings.installSection`（NS 直接为字符串）

另外 alpha 的 `dsh-attachment-local` 漏声明了 `dsh-attachment` 依赖，需在 `package.json` 显式加 `"@deepseek-ai/dsh-attachment": "0.1.2-alpha.2"`，否则解析回旧 rc.2。

### C-2. dsh-qwen 模型配置（config.json）——最容易踩的坑（2026-08-31 实测）

> 即使 C 的代码补丁全打了，**模型选择器里仍可能看不到 Qwen / 默认模型不可用**，根因在 `config.json` 的 `models` 格式不是插件期望的对象数组。

**目标文件（两份）**：
- `%USERPROFILE%\.dsh\profiles\web\node_modules\@deepseek-ai\dsh-qwen\config.json`
- checkout 对应的 `node_modules\@deepseek-ai\dsh-qwen\config.json`

**❌ 错误格式（字符串数组）——schema 校验不过，provider 注册失败**：
```json
{
  "apiKey": "sk-...",
  "models": ["qwen3.8-max", "qwen-plus", "qwen-turbo", "qwen-max"]
}
```

**✅ 正确格式（对象数组，需含 `contextWindow` / `maxTokens`）**：
```json
{
  "apiKey": "<YOUR_DASHSCOPE_API_KEY>",
  "models": [
    { "id": "qwen3.8-max", "name": "Qwen3.8-Max", "contextWindow": 128000, "maxTokens": 8192 },
    { "id": "qwen3.7-max", "name": "Qwen3.7-Max", "contextWindow": 128000, "maxTokens": 8192 },
    { "id": "qwen3.7-plus", "name": "Qwen3.7-Plus", "contextWindow": 128000, "maxTokens": 8192 },
    { "id": "qwen-plus",   "name": "Qwen-Plus",   "contextWindow": 128000, "maxTokens": 8192 },
    { "id": "qwen-turbo",  "name": "Qwen-Turbo",  "contextWindow": 128000, "maxTokens": 8192 },
    { "id": "qwen-max",    "name": "Qwen-Max",    "contextWindow": 128000, "maxTokens": 8192 }
  ]
}
```

**注意**：`settings.yaml` 的默认模型（如 `qwen3.7-plus`）**必须**出现在 config.json 的 `models` 里，否则实际对话会因找不到该模型而失败。

**改完必须重启 DSH**；然后可直接用 DashScope OpenAI 兼容端点实测（`qwen3.7-max` 已跑通）：

```powershell
$cfg = Get-Content "$env:USERPROFILE\.dsh\profiles\web\node_modules\@deepseek-ai\dsh-qwen\config.json" | ConvertFrom-Json
$body = @{ model='qwen3.7-plus'; messages=@(@{role='user';content='说"可用"'}); max_tokens=50 } | ConvertTo-Json -Depth 3
Invoke-RestMethod -Method POST -Uri 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' `
  -Headers @{ Authorization="Bearer $($cfg.apiKey)"; 'Content-Type'='application/json' } -Body $body -TimeoutSec 10 |
  ForEach-Object { $_.choices[0].message.content }
```

### D. 验证

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dsh-web-tools\dsh-web.ps1 start
Start-Sleep -Seconds 30
powershell -NoProfile -ExecutionPolicy Bypass -File .\dsh-web-tools\dsh-web.ps1 status   # RUNNING
powershell -NoProfile -ExecutionPolicy Bypass -File .\dsh-web-tools\dsh-web.ps1 logs    # err.log 应为空
```

err.log 里出现 `does not provide an export named ...` 就是上面 A/B/C 某一步没做。

### E. Qwen 模型可用性验证（C-2 之后必查）

WebUI 模型选择器里能看到 Qwen 模型后，再用 C-2 末尾的命令实测一下 API（同时覆盖 `qwen3.7-max` 和 `qwen3.7-plus`），确保 DashScope key 有效、模型 ID 拼写正确。**这一步是「能选模型」和「真能对话」之间的最后一环**。

---

## 本机网络备忘（Clash Verge，2026-09 记录）

> 本机已装 **Clash Verge**，处于「系统代理」模式（本地回环端口全局接管出网），开关后即可访问外网（GitHub、npm 官方源、Google 等）。

### 决策核心：**npm / 装包升级 = 永远优先「国内源 npmmirror」**
- 国内源**速度快、稳定性好**，是默认首选：

```powershell
pnpm install --registry=https://registry.npmmirror.com
```

### 什么时候才轮到 Clash 代理？
只有两种「国内源办不到」时，才考虑 Clash（挂本地代理端口）去兜底：
1. **国内源连不上某个「特定包」**（如个别包 npmmirror 同步不全/未收录）→ 临时切官方源 + 挂代理拉这一个包；
2. **搜索信息 / 查外网资料**（GitHub release、外文网页、Google 等）。

```powershell
$env:HTTP_PROXY  = 'http://127.0.0.1:<PORT>'   # 需要走 Clash 时临时设上
$env:HTTPS_PROXY = 'http://127.0.0.1:<PORT>'
```

> **一句话**：装包/升级 → npmmirror 国内源直连（不挂代理）；国内源拉不到的特定包 / 查外网资料 → 挂本地代理兜底。DSH 内置搜索访问 Google/GitHub 也不需要手动配置（系统代理已接管）。

---

*备注：本手册由 Codex 在 2026-08-22 依据连续 4 次升级实测整理；第 3 步命令在 rc.1 → rc.2 升级中实测 16 秒完成。alpha 线补充由 2026-08-31 的 0.1.2-alpha.2 升级实测整理（含当日 dsh-qwen 模型配置修复，见 C-2，归档见 `upgrade\0.1.2-alpha.2\`），并在 2026-09-02 的 alpha.2 → alpha.5、2026-09-03 的 alpha.5 → 0.1.2-rc.1、2026-09-09 的 rc.1 → 0.1.5-alpha.1、2026-09-10 的 0.1.5-alpha.1 → 0.1.5-rc.1、2026-09-12 的 0.1.5-rc.1 → 0.1.5-rc.2、2026-09-15 的 0.1.5-rc.2 → 0.1.6-alpha.1 升级中复用验证通过（归档见 `upgrade\0.1.2-alpha.5\`、`upgrade\0.1.2-rc.1\`、`upgrade\0.1.5-alpha.1\`、`upgrade\0.1.5-rc.1\`、`upgrade\0.1.5-rc.2\`、`upgrade\0.1.6-alpha.1\`）。另注：①升级安装命令输出勿用 `Select-Object -First` 截断，会掐断 pnpm 安装阶段；②0.1.5 起 dsh-persona 字段 text 改必填 prefix，升级前需检查用户级 preset（`~\.dsh\.agent-presets\*\agent.cordis.yml`）并预防性改写；③DeepSeek 模型名以官方文档为准（现行 `deepseek-flash` = V4.1 Flash、`deepseek-v4-pro`），可在 `~\.dsh\settings.yaml` 的 `llm-deepseek.models` 覆盖插件默认列表，只保留在用模型（用户级配置不受升级影响）；④自 0.1.6 起每次升级前先做**迁移面排查**——查是否有自定义 DeepSeek 旧根地址（有则改 `https://api.deepseek.com/anthropic`）、查自装插件是否引用被改名/弃用的 API（如 PTC 名称、agent/created、Session 同步读取接口），并留意 PTC 改名会留下预期孤儿目录（不在锁中即无害）。*
