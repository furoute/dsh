# dsh-billing-deploy · 把“余额/消费条”复用/搬到另一台 DSH

这是一个**自包含**的部署包：把一个在聊天窗口下方显示
**「充值余额 + 今日消费」** 的 DSH 持久化插件，复制并安装到**另一台电脑**的 DSH 上。

---

## 它由什么组成

| 文件 | 作用 |
| --- | --- |
| `package/lib/index.js` | Host 半区：定时用登录 token 拉官方接口，提供 `/billing/data` |
| `package/lib/client.js` | Client 半区：在输入框下方渲染「充值余额 / 今日消费」 |
| `package/lib/fetch-helper.js` | Node 抓取脚本（走本地 Clash 代理） |
| `package/config.json` | 里面放 DeepSeek 平台的登录 token |
| `package/package.json` | 插件元数据 / client 声明 |
| `cordis.patch.yml`（目标机）| 让插件每次启动自动加载 |
| `install.ps1` | 一键安装脚本 |

---

## 在目标电脑上安装（3 步）

1. **把整个 `dsh-billing-deploy` 文件夹拷到目标电脑**（U 盘 / 网络 / 网盘都行）。

2. **打开 PowerShell**，进入该文件夹，运行一键安装：
   ```powershell
   cd C:\path\to\dsh-billing-deploy
   powershell -ExecutionPolicy Bypass -File .\install.ps1 -DshRoot "<USERPROFILE>\Documents\...\work\dsh"
   ```
   > `-DshRoot` 指向目标机 DSH 的安装目录（就是包含 `node_modules\@deepseek-ai` 的那一层）。
   > 安装过程会提示你输入 DeepSeek 平台的登录 token。

3. **重启目标机的 DSH**，即可在聊天窗口下方看到余额 / 今日消费。

---

## 三个必须满足的前提（否则不显示）

1. **目标机也要能访问 `platform.deepseek.com`**——若需代理，请通过环境变量配置（见下）。
   - 代理通过环境变量 `HTTPS_PROXY` / `HTTP_PROXY` 读取，**不硬编码端口**；
   - 无需改代码：设置环境变量即可，例如 `$env:HTTPS_PROXY = "http://127.0.0.1:<端口>"`；未设置时直连。

2. **DeepSeek 平台的登录 token**（不是 API Key）：从 `https://platform.deepseek.com/usage` → F12 → Network → 任一 `/api/` 请求 → 请求头 `Authorization: Bearer <token>` 复制。
   - token 是**跟你 DeepSeek 账号绑定**的，不绑定某台电脑；同一账号在家/办公室都可用你的 token；
   - token 会过期，失效时重新填到 `config.json`（两台机各改各的）。

3. **token 存在各机自己的 `config.json`**，装完各自填一次即可。

---

## 常用备注

- **改源码后同步**：`@deepseek-ai/dsh-billing` 以 `file:` 依赖指向 DSH 安装目录的 `node_modules\@deepseek-ai\dsh-billing`，所以改代码要改到**那一个目录**，并手动同步到 `~\.dsh\profiles\web\node_modules\@deepseek-ai\dsh-billing`（`install.ps1` 每次都会帮你同步）。
- **想换个显示位置 / 样式**：改 `package/lib/client.js` 里的 `id`、`order` 和 `.dsh-billing*` 样式。
- **想让某台机不显示**：把 `~\.dsh\profiles\web\cordis.patch.yml` 里 `dsh-billing` 那一段（`- insert:` …）删掉即可。

---

## 本机已装好的位置（供参考）
- 源码包：`<DSH_ROOT>\node_modules\@deepseek-ai\dsh-billing`
- profile 副本：`%USERPROFILE%\.dsh\profiles\web\node_modules\@deepseek-ai\dsh-billing`
- 启动挂载：`%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`
