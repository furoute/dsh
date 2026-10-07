# 安全说明

本仓库归档的是个人 DSH 扩展与文档。**归档前已执行强制脱敏与审计**，
本文件说明做法与边界，便于复核者核验。

## 一、已剔除的内容

以下内容**从未进入本仓库**：

| 类别 | 原因 |
|---|---|
| API Key / 平台 Token | 私有凭据 |
| `$DSH_HOME/.credentials.yaml` | DSH 凭据库，含全部密钥引用 |
| ACP-Lite 身份私钥（`identity.json` 的 `priv`） | 签名私钥 |
| 收件箱 / 审计流水（`inbox/`、`audit.jsonl`） | 含第三方真实对话 |
| 依赖目录、备份残留、日志、缓存 | 无归档价值且体积大 |

## 二、脱敏规则

归档管线 [`scripts/sanitize-copy.ps1`](../scripts/sanitize-copy.ps1) 对文本文件执行：

| 原始模式 | 替换为 |
|---|---|
| `sk-` 开头的密钥 | `<YOUR_API_KEY>` |
| GitHub Token（`gho_` / `ghp_`） | `<YOUR_GITHUB_TOKEN>` |
| AWS Access Key | `<YOUR_AWS_KEY>` |
| 本机用户名 | `<USER>` |
| 用户目录绝对路径 | `<USERPROFILE>` |

白名单式复制：只收集显式列出的文件，不做整目录搬运，从机制上避免误带。

## 三、审计闸门

[`scripts/audit-secrets.ps1`](../scripts/audit-secrets.ps1) 对所有文件做阻断式扫描，
命中即返回非零退出码，**阻止推送**。检查项包括：

- `sk-*` / `gh[opsu]_*` / `AKIA*` / `AIza*` / `xox[abprs]-*`
- PEM 私钥块（`-----BEGIN ... PRIVATE KEY-----`）
- 长 Bearer 令牌
- 疑似密钥赋值（`api_key`/`secret`/`token`/`password` 后跟 20+ 字符字面量）
- 残留本机用户名与他人用户目录路径

### 复现校验

```powershell
pwsh -File scripts\audit-secrets.ps1
# 期望输出：✅ 通过：未发现任何敏感信息
```

## 四、特殊情况说明

### 1. 占位符是正常的

`plugins/dsh-billing/config.json` 内容为：

```json
{ "token": "<YOUR_DEEPSEEK_PLATFORM_TOKEN>" }
```

这是**故意的空模板**，请填入你自己的令牌后本地使用。
`.gitignore` 已将该文件排除，避免你填好后被误提交。

### 2. 文档中的 `<USER>` / `<USERPROFILE>`

文档记录的是真实操作过程，为避免暴露本机路径，用户名与家目录已替换为占位符。
按你的实际环境替换即可，不影响理解。

### 3. 归档管线脚本本身

`scripts/` 下的脚本包含脱敏**规则表**（即"什么模式会被替换"）。
这是方法论而非凭据，公开无风险，反而便于复核者验证脱敏是否可信。

## 五、发现问题的处理

若你认为本仓库仍存在敏感信息泄露，请**不要公开提 issue**，
直接通过仓库主页的联系方式私下告知，我会立即处理并考虑改写历史。
