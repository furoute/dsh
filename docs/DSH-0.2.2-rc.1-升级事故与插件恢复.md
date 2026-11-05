# DSH 桌面版升级 0.2.2-rc.1 事故处置记录（2026-11-05 实测）

> **事故摘要**：桌面版从 **0.2.1-rc.2** 升到 **0.2.2-rc.1** 后启动失败，报「2 个必需插件未激活」，
> 侧边栏全部自研插件消失。
>
> 和上一轮（0.2.1-rc.2）**是同一类问题，但修法反过来了**：
> 上一次是「把 `mode` 改成 `native`」，这一次是「把 `mode` 整段删掉」。
> 照着旧文档修会直接踩坑 —— 这是本文最想留下的教训。
>
> 另有一处独立问题：`llm-deepseek-account` 的 `models` 字段也被废弃。

---

## 一、事故现象

启动桌面版，弹错误框：

```
DeepSeek Harness 无法使用
应用无法启动或已意外停止。

agent-loop (required)          tools
tool-working-directory         tools
timeout-policy                 tools
spill-policy                   tools
session-checkpoint-policy      tools
mcp-resources                  tools
cordis-host-runner             tools
cordis-inspect-providers       cordisInspect, tools
```

弹窗给了四个按钮：`退出` / `重启` / **`禁用第三方插件、备份 profile patch 并重启`** / `获取诊断报告`。

**⚠️ 不要点「禁用第三方插件」。** 那一键会把 `cordis.patch.yml` 重建成极简版，
自研插件（billing / find / poetry / work-mode）的 insert 段会被整段清掉 —— 本次就是这样丢的。
真正要改的只是两行配置。

---

## 二、真正的报错（在崩溃日志里）

路径：`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-<ISO时间>-host.log`

```
DesktopHostFatalError: dsh: startup failed: 2 required plugins did not activate

Failed plugins (2):
  tools
    Package: @deepseek-ai/dsh-tools
    ValidationError: invalid config:
      - $.mode expected nullable but got native (at mode)

  llm-deepseek-account
    Package: @deepseek-ai/dsh-llm-deepseek-account
    Error: llm-deepseek-account: models is no longer configurable;
           the account /models listing supplies the catalog.
           Remove models from this entry and adjust single models with modelOverrides.<model id>
```

**两条错误，两个字段，同一轮废弃。**

---

## 三、根因

### 3.1 `tools.mode` 从「收紧枚举」变成「完全废弃」

| 版本 | `mode` 合法值 |
|:--|:--|
| 0.2.0 及更早 | `native` / `ptc` / `both` |
| 0.2.1-rc.2 | `native` / `ptc`（`both` 报错） |
| **0.2.2-rc.1** | **只能不写（null）** |

报错原文 `expected nullable but got native` 就是「这个字段只接受空值」的意思。

而 2026-10-17 为了修 0.2.1-rc.2 的问题，我们**主动把 `mode: native` 写进了三个 profile 的补丁层**
（当时是正解）。升级到 0.2.2-rc.1 后，这段「正解」直接变成致命错误。

**这是给所有 agent 的提醒：修 bug 时写进配置的「兼容值」，下次升级可能就是新的坑。**

### 3.2 `llm-deepseek-account.models` 废弃

新版模型目录由账号 `/models` 接口实时拉取（实测日志：
`[llm-deepseek-api-key] model listing from https://api.deepseek.com/models loaded 2 model(s)`），
不再允许在配置里写 `models`。

**注意：写 `models: []`（空数组）一样报错** —— 校验用的是 `Object.hasOwn`，键存在就检查。

新版替代：

```yaml
- id: llm-deepseek-account
  name: '@deepseek-ai/dsh-llm-deepseek-account'
  config:
    modelOverrides:          # 只能覆盖已有模型，不能新增
      deepseek-flash:
        contextWindow: 524288
        maxTokens: 131072
```

只想用内置目录 → 删掉整段 `models`，什么都不用写。

---

## 四、处置步骤（实际执行顺序）

### 第 1 步：定位崩溃日志

```powershell
Get-ChildItem "$env:APPDATA\@deepseek-ai\dsh-desktop\logs\crash-*.log" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
```

崩溃日志的**前 5000 字符**才是真错误，末尾是插件清单（很长），别在末尾找。

### 第 2 步：干掉 `mode`

三个 profile 都要改：

```powershell
$profiles = @('desktop','web','headless')
foreach ($p in $profiles) {
  $f = "$env:USERPROFILE\.dsh\profiles\$p\cordis.patch.yml"
  Copy-Item $f "$f.bak-before-rc1-$(Get-Date -f yyyyMMdd-HHmmss)" -Force
  # 删掉整个 "- id: tools / config: / mode: xxx" 段（含上方注释）
}
```

删完确认三份都没有 `- id: tools`：

```powershell
Select-String -Path "$env:USERPROFILE\.dsh\profiles\*\cordis.patch.yml" -Pattern '^- id: tools'
# 应该无输出
```

> **headless 里的 `mode:` 不用慌** —— 那是 `sandbox-policy` 的 `mode: danger-full-access`，
> 和 `tools.mode` 是两回事。用 `grep '^\- id: tools'` 判断，不要用 `grep 'mode:'`。

### 第 3 步：确认能启动

```powershell
taskkill /F /IM "DeepSeek Harness.exe" /T
schtasks /run /tn "DSH_Launch"     # 或直接双击打开
Start-Sleep 40
(Get-Process 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count   # 期望 4-6
```

崩溃日志不再新增（看文件 mtime 和文件名时间戳）即为启动成功。

### 第 4 步：恢复被「一键禁用插件」清掉的 insert 段

如果点过那个按钮，`cordis.patch.yml` 会被重建。从最近的备份里把 insert 段捞回来：

```powershell
Get-ChildItem "$env:USERPROFILE\.dsh\profiles\desktop" -Filter 'cordis.patch.yml*'
```

本次实际做法：从 `cordis.patch.yml.bak-1793840646203`（10-29 完整版，13608 字节）里
提取两段 insert，合并进当前 patch：

```
第 88-116 行   billing / poetry
第 258-284 行  find / work-mode
```

只加 insert，**不要**连带 `- id: tools` 和 `llm-deepseek-account` 一起搬过来。

### 第 5 步（可选）：清掉重复的模型分组

模型下拉里出现两组同内容（「DeepSeek 账号」+「DeepSeek」）时：

```yaml
- id: llm-deepseek-account
  disabled: true
```

只影响 desktop；headless 是另一套 profile，凭据通道不受影响。

---

## 五、验证清单

| # | 检查项 | 期望 |
|:--|:--|:--|
| 1 | 桌面进程数 | 4-6 |
| 2 | 崩溃日志 | 无新增（文件名时间戳不变） |
| 3 | `profiles/*/cordis.patch.yml` 里 `- id: tools` | 0 处 |
| 4 | 侧边栏四个自研插件 | billing / find / poetry / work-mode 都在 |
| 5 | 模型下拉 | 只剩一组，无重复分组 |
| 6 | `dsh --profile headless "只回复两个字：正常"` | 返回「正常」（验 CI 通道） |

---

## 六、★ 走过的弯路

| 查过 / 做过什么 | 结论 | 为什么是弯路 |
|:--|:--|:--|
| 以为又是 `DSH_TOOLS_MODE` 环境变量 | **不是** | 三处（User / Machine / 进程）全是 null。上一轮的凶手这次不存在 |
| 照 0.2.1-rc.2 的文档把 `mode` 改成 `native` | **反而更错** | 那正是本次报错的原因。旧文档不能无条件复用 |
| 想着「桌面版起不来，CI 肯定也起不来」 | **错** | headless 是独立 profile，实测 3.6 秒就回话。**遇到桌面版故障先跑一条 headless 验证，再决定谁干活** |
| 点了「禁用第三方插件」按钮 | 插件全丢 | 它会重建 patch。应该直接改那两行 |
| 在崩溃日志末尾找错误 | 找不到 | 真错误在前 5000 字符，末尾是几百行插件清单 |
| 用 `grep 'mode:'` 判断是否清干净 | 误判 | headless 的 `sandbox-policy.mode` 会命中。要用 `^- id: tools` 判断 |

---

## 七、遗留事项

1. **`subagent-codex` / `computer-use` 与宿主版本不匹配**
   包是 `0.2.1-rc.2`，宿主 `0.2.2-rc.1`（peer 要求 `cordis ~4.0.5`，实际 `4.1.0`）。
   静态 API 核对通过、实测能启动，但属于「兼容性侥幸」，下次升级要重新验证。
   其中 `computer-use` 是独占注册服务，**原生驱动崩溃可能直接终止宿主进程**。

2. **`ui-settings-general.welcomeNoticeVersion` 需要精确等于当前版本号**
   写旧值会让欢迎提示重新弹出。当前应为 `2026-09-28.1`。

3. **不要在升级时点「禁用第三方插件」**
   它会把 patch 重建成极简版。宁可手动改两行，再重启。

---

## 八、给下一次的一句话

```
升级后起不来 → 先读崩溃日志前 5000 字符 → 看 ValidationError 说的是哪个字段
            → 那个字段在新版里是「换了合法值」还是「整个废了」
               换了值的 → 改值
               废了的   → 整段删
            → 改完重启，再看日志有没有新增
```

**不要沿用上一个版本的修法。版本号变了，字段语义就可能反过来了。**
