# DSH 桌面版升级 0.2.1-rc.2 事故处置记录（2026-10-17 实测）

> **事故摘要**：桌面版从 0.2.0-rc.2 升到 **0.2.1-rc.2** 后启动失败，报「dsh-tools 配置非法」，
> 连带 8 个插件全挂。**真凶是一个用户级环境变量 `DSH_TOOLS_MODE=both`**，
> 与自研插件（billing/find/poetry）、ACP-lite、SSH 通道**全部无关**。
>
> 排障耗时约 3 小时（走了很多弯路），根因确认只要 5 秒。本文把弯路也记下来，免得下次重走。

---

## 一、事故现象

启动 DeepSeek Harness 桌面版，弹出错误框：

```
DeepSeek Harness is unavailable
The application could not start or stopped unexpectedly.

agent-loop (required)      tools
tool-working-directory     tools
timeout-policy             tools
spill-policy               tools
session-checkpoint-policy  tools
mcp-resources              tools
cordis-host-runner         tools
cordis-inspect-providers   cordisInspect, tools
```

界面提供三个按钮：`Exit` / `Restart` / **`Disable third-party plugins, back up profile patch, and restart`**。

**看起来像是「插件冲突」——这是第一个误导。**

---

## 二、真正的报错（在崩溃日志里）

路径：`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-<ISO时间>-host.log`

```
DesktopHostFatalError: dsh: startup failed: 1 required plugin did not activate

Failed plugins (1):
  tools
    Package: @deepseek-ai/dsh-tools
    ValidationError: invalid config:
      - $.mode expected "native" | "ptc" but got "both" (at mode)
```

**一句话：`tools` 插件的 `mode` 配置值是 `both`，新版只认 `native` / `ptc`。**

`tools` 是核心服务，它起不来 → 上面那 8 个插件全在「等 tools 服务」→ 启动审计判定失败。

---

## 三、根因：环境变量

新版 profile 的 `dsh-tools` 配置行（`dsh --profile web --dump-config` 第 389 行附近）：

```yaml
- id: tools
  name: '@deepseek-ai/dsh-tools'
  config:
    mode: !!js process.env.DSH_TOOLS_MODE      # ← 值来自环境变量
```

实测本机：

```powershell
[Environment]::GetEnvironmentVariable('DSH_TOOLS_MODE', 'User')
# → both          ← 2026-10-12 手工设的，当时版本吃这个值
```

**0.2.1-rc.2 的 `dsh-tools` 把 `mode` 的枚举收紧了，`both` 不再合法，且没有兼容/迁移提示。**

---

## 四、处置步骤（实际执行顺序）

### 第 1 步（治本）：改环境变量

```powershell
# native = 传统原生工具调用；ptc = PTC 运行时模式（0.2.x 新增）
[Environment]::SetEnvironmentVariable('DSH_TOOLS_MODE', 'native', 'User')
```

> **注意**：环境变量是「新建进程才读」，改完必须**完全退出 DSH 再启动**，
> 不是重启窗口、也不是 Restart 按钮，要确保进程全退。

### 第 2 步：版本对齐（本次顺带修掉的隐患）

升级桌面版时，**全局 CLI 和 profile 依赖没有跟着升**，实测差 6 个版本：

| 组件 | 事故前 | 处置后 |
|---|---|---|
| 桌面版应用 | 0.2.0-rc.2 | **0.2.1-rc.2** |
| 全局 `@deepseek-ai/dsh` | **0.1.6-alpha.2**（8月的） | **0.2.1-rc.2** |
| `profiles/desktop/package.json` | 0.2.0-rc.2 | **0.2.1-rc.2** |
| `profiles/node_modules`（共享层） | 252 个 junction 指向 8 月旧源码 | **已移除**（见下） |

```powershell
# 全局 CLI
npm install -g @deepseek-ai/dsh@0.2.1-rc.2

# profile 依赖：先把 package.json 里的 0.2.0-rc.2 全部改成 0.2.1-rc.2，再重装
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm install --no-frozen-lockfile
```

### 第 3 步：清掉悬空的共享 node_modules

`%USERPROFILE%\.dsh\profiles\node_modules\` 下曾有 **252 个 junction**，全部指向
`Documents\Codex\2026-08-14\deepseek-harness-github-2\work\dsh\node_modules\`（已成旧源码，0.1.6-alpha.2）。

**junction 必须用 `rmdir` 删链接本身**，`Remove-Item -Recurse` 会跟到目标里去删真文件：

```powershell
$nm = "$env:USERPROFILE\.dsh\profiles\node_modules"
Get-ChildItem $nm -Force | ForEach-Object {
  if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { cmd /c rmdir "$($_.FullName)" }
}
Remove-Item $nm -Recurse -Force   # 剩下空壳目录
```

### 第 4 步：恢复 profile 的 patch 层（插件配置）

崩溃后 `profiles/desktop/cordis.patch.yml` 被重置成了空的 `[]`，**自研插件因此从侧边栏消失**。

从备份恢复（本次用的是 `cordis.patch.yml.bak-1792241842052`，10-15 的完整版）：

```powershell
Copy-Item "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml.bak-1792241842052" `
          "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml" -Force
```

**⇒ 恢复后 billing / find / poetry 三个插件全部回到侧边栏。**

---

## 五、验证清单（照抄即可）

```powershell
# 1. 环境变量
[Environment]::GetEnvironmentVariable('DSH_TOOLS_MODE','User')     # 应为 native

# 2. 全局版本
dsh -V                                                             # 应为 0.2.1-rc.2

# 3. 进程存活（正常 4~5 个进程）
(Get-Process | Where-Object { $_.ProcessName -like '*eepSeek*' }).Count

# 4. 崩溃日志时间戳（应停在修复之前，不再新增）
Get-ChildItem "$env:APPDATA\@deepseek-ai\dsh-desktop\logs" -Filter crash-*.log |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 Name,LastWriteTime

# 5. SSH / CI 通道没被波及
sc query sshd | findstr STATE                                      # RUNNING
ssh <user>@<host> "dsh -V"                                         # 能返回版本号
```

---

## 六、走过的弯路（不要再走）

按耗时排序，这些都不该查：

| 排查方向 | 结论 | 为什么是弯路 |
|---|---|---|
| 第三方插件冲突 | ❌ 不是 | 错误框引导你去点「禁用第三方插件」，其实是核心 `tools` 起不来 |
| `cordis.patch.yml` 里有 `mode: both` | ❌ 不是 | 全文搜过，patch 层里没有 |
| `dsh-base` / `dsh-web-app` 的 bundle 默认值 | ❌ 不是 | 包内 patch 里也没有 |
| `app.asar` 二进制里硬编码 | ❌ 不是 | `mode: both`、`mode:both`、`mode=both` 全部 `-1` |
| `AGENTS.md` / `settings.yaml` | ❌ 不是 | 无 `mode` 字段 |
| 悬空 junction 导致包加载失败 | ⚠️ 是隐患但不是本次症状 | 包确实断了，但报的是「配置非法」不是「包找不到」 |

**⇒ 下次见到 `ValidationError: invalid config ... at <字段名>`，第一反应应该是
`dsh --profile <可 dump 的 profile> --dump-config | grep <字段名>`，
看这个字段是不是 `!!js process.env.XXX` —— 是的话直接查环境变量，5 秒定位。**

---

## 七、连带故障：CLI（headless）报 MISSING_CREDENTIAL

桌面版修好之后，**用 SSH 唤醒 CLI 的自动通道仍然不通** —— 这是同一轮升级暴露的第二个坑，与 `mode` 无关。

### 现象

```powershell
dsh --profile headless "只回复两个字：正常"
```

```
dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official";
store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it),
or export DEEPSEEK_API_KEY in the launching environment
```

**注意：桌面版 GUI 一切正常，只有 CLI 挂。** 这就排除了「key 丢了/过期」的可能。

### 根因

`~/.dsh/.credentials.yaml` 里的 `DEEPSEEK_API_KEY` **还在**（`refs` 段存在，只是显示为 `sk-1f2...cf27` 的脱敏占位）。
真正的原因是：**新版 `@deepseek-ai/dsh-headless` bundle 的补丁层把凭据服务显式禁用了。**

`dsh --profile headless --dump-config` 里能看到：

```yaml
- id: credentials
  name: '@deepseek-ai/dsh-credentials-local'
  disabled: true          # ← headless bundle 干的
```

而 `desktop` / `web` 档都没禁用，所以 GUI 一直正常。
`llm-deepseek` 依赖凭据服务取 key → 服务没加载 → 直接抛 `MISSING_CREDENTIAL`。

### 修法：在用户补丁层覆盖回启用

补丁层优先级高于 bundle 层，追加到 `~/.dsh/profiles/headless/cordis.patch.yml` 末尾：

```yaml
# 让 CLI(headless) 复用桌面版已保存的 API 凭据
# 根因：dsh-headless bundle 把 credentials 设为 disabled: true
- id: credentials
  disabled: false
```

验证：

```powershell
dsh --profile headless --dump-config | Select-String -Pattern 'id: credentials' -Context 0,2
# 期望：disabled: false

dsh --profile headless "只回复两个字：正常"
# 期望：正常
```

实测：**5.7 秒返回，无需设任何环境变量。**

> ⚠️ 另一条官方给出的备用路（导出 `DEEPSEEK_API_KEY` 环境变量）也有效，但**只在当前进程有效**：
> 必须与 `dsh` 在**同一进程内**设置，`set X=Y && dsh ...` 这种链式传递实测会导致 headless 静默不干活。
> 且 DSH 宿主 spawn 子进程时会清洗匹配 `KEY|PASSWORD|SECRET|TOKEN` 的环境变量，在「DSH 内部再起 dsh」场景下不可见 —— 所以**改 profile 更稳**。

---

## 八、彻底治理：把 `DSH_TOOLS_MODE` 从环境变量搬进 profile

`mode` 从环境变量读（`mode: !!js process.env.DSH_TOOLS_MODE`）有个隐患：
**用户级环境变量是全局的，会同时注入 desktop / web / headless 三个 profile**，
将来某个 profile 想用 `ptc` 就得连累其他两个。

**改法：三个 profile 各自的 `cordis.patch.yml` 末尾显式写死，然后删掉环境变量。**

```yaml
- id: tools
  config:
    mode: native          # 想用 PTC 就改 ptc，互不影响
```

```powershell
[Environment]::SetEnvironmentVariable('DSH_TOOLS_MODE', $null, 'User')
```

验证（实测通过）：

| 验证项 | 结果 |
|---|---|
| `DSH_TOOLS_MODE` User / Machine | 均已删除 |
| `dsh --profile headless --dump-config` | 解析出 `mode: native`，无报错 |
| `dsh --profile web --dump-config` | 解析出 `mode: native` |
| 删环境变量后跑 headless | 返回「正常」，5.7 秒 |
| 桌面版重启 | 5 个进程正常，崩溃日志无新增 |

---

## 九、遗留事项

- **headless 的 `credentials: disabled: false` 是本地私改**：官方若改插件名或补丁语义，会复发 `MISSING_CREDENTIAL`，升级后**必须复验这一项**。
- **千问（dsh-qwen）**：2026-10-01 已退役。0.2.0-rc.1 起 LLM provider 改由**设置界面**驱动
  （设置 → 模型 → 自定义模型 API），插件目录里的 `dsh-qwen` 是残留，不再加载，留着无害。
- **npm dist-tag 陷阱**：`latest` 仍指向 0.2.0-rc.2，`next` 才是 0.2.1-rc.2。
  执行 `npm i -g @deepseek-ai/dsh` 会**回退**版本 —— 必须显式写 `@0.2.1-rc.2`。
- **`profiles/node_modules-list-backup-20261017.txt`**：清 junction 前留的 41KB 纯文本清单，
  无引用，确认无事后可删。
- **桌面版升级必须连带升级 CLI 与 profile 依赖**，否则会出现「应用是新版、依赖是旧版」的隐性错配。

---

*本记录由蓝莓（Hermes）在 2026-10-17 夜间依据实机处置过程整理。涉及版本：0.2.0-rc.2 → 0.2.1-rc.2；
主机：DESKTOP-6KDMR6C（Windows）。*
