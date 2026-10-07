# DSH `subagent_codex` + DeepSeek：操作手册（照着做即可）

> 目标：在 DSH 的 Job Panel 里用 `subagent_codex`（"标准 Codex"子代理模式）后台跑任务，
> 并把 Codex 的模型后端指向 DeepSeek。
> 本手册已在 2026-08-18 验证通过（列目录任务 `[status: completed]`）。
> 下面分 **Codex 侧** 与 **DSH 侧** 两大部分，先做 Codex 侧，再做 DSH 侧。

---

## 0. 这台机器的环境快照（供核对）

| 项 | 现状（2026-08-18） |
|----|---------------------|
| Codex CLI（PATH，`~/.codex/bin/codex.exe`） | 0.142.0-alpha.1 |
| Codex 商店版（`AppData\Local\OpenAI\Codex\bin\...\codex.exe`） | 0.148.0-alpha.15 |
| Codex 模型后端 | `deepseek`（`base_url=https://api.deepseek.com/`，`wire_api=responses`） |
| 有效 DeepSeek key | `[model_providers.deepseek]` 段内（尾号 `1ec253`） |
| 无效/另存的 key | `[model_providers.custom]` 段内（尾号 `4372`，未选用） |

> ⚠️ 重要：DSH 拉起的 codex 用的是 **PATH 里的旧版 0.142**。若你之后更新 PATH 里的 codex，版本会变，行为可能不同。

---

## 1. Codex 侧操作

### 1.1 前置检查（确认状态）

打开任意 PowerShell，依次执行：

```powershell
codex --version

# 看本机是否有有效 deepseek provider、auth 不需要 OpenAI、sandbox 显示 full-access
codex doctor
```

期望结果：
- `codex --version` 有输出即可（版本号无需一致）。
- `codex doctor` 里应看到：
  - `model: deepseek-v4-flash · deepseek`
  - `auth: OpenAI auth is not required for the active model provider`
  - `sandbox:` 显示 **full access**（若显示 `restricted`，说明 sandbox 配置不对，见 1.2）

### 1.2 关键配置（确保 `sandbox_mode = "danger-full-access"`）

文件：`<USERPROFILE>\.codex\config.toml`

这一行是让 `subagent_codex` 能执行 shell 命令的关键：

```toml
sandbox_mode = "danger-full-access"
```

原因：`workspace-write` 在 Windows 下会加载 `codex-windows-sandbox-setup.exe` helper，
但这台机器上 helper 找不到（见下"为什么"），导致任何工具命令都失败。改为
`danger-full-access` 即绕过 Windows 沙箱。

**改法**（若还没改）：

```powershell
# 先备份，再改
Copy-Item "$env:USERPROFILE\.codex\config.toml" "$env:USERPROFILE\.codex\config.toml.bak" -Force
(Get-Content "$env:USERPROFILE\.codex\config.toml" -Raw) -replace 'sandbox_mode\s*=\s*".*?"','sandbox_mode = "danger-full-access"' |
  Set-Content "$env:USERPROFILE\.codex\config.toml" -Encoding UTF8

# 确认已生效
Select-String -Path "$env:USERPROFILE\.codex\config.toml" -Pattern 'sandbox_mode'
```

### 1.3 （可选）其他有利设置

下列不是必需的，但能让 DeepSeek 模型目录更稳：

```toml
model_catalog_json = "C:/Users/<USER>/.codex/models.json"
preferred_auth_method = "apikey"
forced_login_method = "api"
```

> 说明：`models.json` 是本地模型目录，可让 codex 不用每次去解析 DeepSeek `/models` 响应
> （DeepSeek 返回格式与 codex 期望不完全一致，日志里曾出现 `missing field models`）。

### 1.4 auth.json 注意

`subagent_codex`（已配 `apikey` + deepseek provider）**不需要 ChatGPT OAuth 登录**。
若 `~/.codex/auth.json` 存在且是 `chatgpt` 模式并已失效，可移走备份避免干扰；**若 auth.json 不存在则跳过**：
```powershell
# 仅当文件存在时移走（不存在会报错，跳过即可）
if (Test-Path "$env:USERPROFILE\.codex\auth.json") {
  Move-Item "$env:USERPROFILE\.codex\auth.json" "$env:USERPROFILE\.codex\auth.json.off" -Force
}
```
（只要 `codex doctor` 显示 "OpenAI auth is not required"，就不需要人为处理 auth.json。）

---

## 2. DSH 侧操作

### 2.1 启动 DSH Web GUI

确认 DSH web 已在运行：浏览器打开 `http://127.0.0.1:3080`。
（若重启过机器，需先按你们 DSH 的启动方式拉起 web，再从浏览器进入。）

### 2.2 用 `subagent_codex` 后台发起任务

在 DSH 会话里，发起一个后台子代理任务，指定 `subagent_codex` 模式、`run_in_background` 为 true，例如：

> 用 subagent_codex 后台跑：列出当前目录 `D:\LLM\DSH` 下的文件和文件夹。run_in_background = true。

任务会作为一个后台 job 出现在 **Job Panel** 里，状态经历 running → completed。

### 2.3 验证结果

- Job Panel 中该任务变为 `completed`；
- 返回内容应包含 6 个文件夹 + 4 个文件的清单（与 `D:\LLM\DSH` 实际内容一致）；
- 可手动核对：`Get-ChildItem "D:\LLM\DSH"`。

---

## 3. 为什么会有这个问题（简版）

| 现象 | 原因 |
|------|------|
| `subagent_codex` 一直 failed，无输出 | codex 的 Windows 沙箱 helper 找不到 |
| 日志报 `codex-windows-sandbox-setup.exe ... program not found` | `workspace-write` 需要该 helper；它只在 `.plugin-appserver` 下，PATH 版 0.142 找不到 |
| 报 `exec command rejected by user` | 沙箱起不来 → 命令被无人值守审批流拒绝 |

这是 openai/codex 已知问题，非 DSH 问题：
- [Issue #28457](https://github.com/openai/codex/issues/28457)（standalone Windows CLI 找不到 sandbox helper）
- [Issue #30829](https://github.com/openai/codex/issues/30829)（bin junction 导致 helper not found）
- [Issue #9744](https://github.com/openai/codex/issues/9744)（helper 缺失导致命令被拒）
- 官方修复方向：[PR #9707](https://github.com/openai/codex/pull/9707)、[PR #17365](https://github.com/openai/codex/pull/17365)

---

## 4. 回滚 / 恢复

- **还原 sandbox_mode** 为更严格值（例如 `workspace-write`）：
  ```powershell
  Copy-Item "$env:USERPROFILE\.codex\config.toml" "$env:USERPROFILE\.codex\config.toml.bak2" -Force
  (Get-Content "$env:USERPROFILE\.codex\config.toml" -Raw) -replace 'sandbox_mode\s*=\s*".*?"','sandbox_mode = "workspace-write"' |
    Set-Content "$env:USERPROFILE\.codex\config.toml" -Encoding UTF8
  ```
  ⚠️ 注意：还原后 `subagent_codex` 会退回"沙箱 helper 缺失 → 工具命令失败"的状态。
- **恢复 auth.json**：把移走的备份改回原名即可。

---

## 5. 再失败的排查速查

看这两个日志：
- DSH web 端：`<USERPROFILE>\.dsh\logs\dsh-web.err.log`
- codex 沙箱：`<USERPROFILE>\.codex\.sandbox\sandbox.<日期>.log`

搜关键词：
- `codex-windows-sandbox-setup.exe` → 沙箱 helper 问题（见第 3 节）
- `401 Unauthorized` / `api key ... is invalid` → DeepSeek key 无效，检查 config 里
  `model_provider="deepseek"` 对应 `[model_providers.deepseek]` 段的 key（尾号应为 `1ec253`）；
  不要误用 `[model_providers.custom]` 段那个尾号 `4372` 的 key
- `missing field models` → 模型列表格式解析问题（可设 `model_catalog_json` 缓解）

---

## 6. 结论

1. **`subagent_codex` + DeepSeek 可正常跑**，后台任务上 Job Panel 并返回 `completed`。
2. 唯一曾阻塞的原因是 **Codex Windows 沙箱 helper 缺失**，与 DeepSeek / 认证 / DSH 无关。
3. 一次性启动命令是：确保 `sandbox_mode = "danger-full-access"` 后，用
   `subagent_codex` + `run_in_background=true` 发起任务即可。
