# 在 Ubuntu 上部署 dsh-superagent 并跑通首个任务（2026-11-07 实录）

> **一句话**：super agent 是 DSH 的一个扩展包。它要求 **POSIX 路径 + loopback Web 服务**，
> 所以 Windows 上跑不起来，Linux 上一装就通。
>
> 本文记录从「笔记本刚开机」到「agent 自动提 PR」的完整过程，含踩过的坑。
> 所有主机名、IP、密钥、账号均已脱敏，按 `<占位符>` 替换即可。

**上游项目**：<https://github.com/deepseek-ai/dsh-superagent-prototype>
（TypeScript / MIT / 研究原型，非官方产品）

---

## 一、为什么选 Ubuntu 而不是 Windows

试过 Windows 桌面版，结论是**跑不起来**：

| 依赖 | Windows 现状 |
|:--|:--|
| POSIX 路径 | `stateDir`、`prepare` 命令里全是 `/home/...` 形式 |
| loopback 检查 | 源码硬校验 `ctx.webServer.host !== '127.0.0.1'` 就抛错 |
| tmux / git worktree / bash | 生态是 Linux 工具链 |

一台装了 Ubuntu 的笔记本（32 线程 / 30 GB / RTX 4060）就足够了。

---

## 二、准备：打开 SSH

在目标机上执行（需要 sudo 密码，一次）：

```bash
sudo apt update && sudo apt install -y openssh-server
sudo systemctl enable --now ssh
systemctl status ssh --no-pager     # 期望 active (running)
sudo ufw status                      # 若是 active，再 sudo ufw allow 22/tcp
```

装公钥（免密登录）：

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo '<你的公钥内容>' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

> `~` 在 Windows 的 CMD 里不展开，`python3` 也可能被应用商店的假快捷方式占用。
> Windows 侧统一用 `py`，路径用 `%USERPROFILE%`。

### 定位一台 IP 会变的机器

笔记本用 DHCP，每次开机 IP 不同（实测见过 `.109` / `.113` / `.119`）。
靠 **hostname + SSH 探测** 认亲，不靠 IP：

```bash
# 扫网段，对每个开着 22 的地址执行 hostname，比对期望主机名
python3 find_laptop.py            # 结果缓存到 ~/.hermes/cache/laptop_ip.txt
python3 find_laptop.py --rescan   # 强制重扫
```

---

## 三、装基础环境

super agent 的 `SETUP.md` 列了硬性门槛，逐项装：

```bash
# git / tmux / python / 编译工具
sudo apt-get install -y git tmux python3-pip build-essential curl

# GitHub CLI
sudo mkdir -p -m 755 /etc/apt/keyrings
wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] \
https://cli.github.com/packages stable main" \
  | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
sudo apt-get update && sudo apt-get install -y gh

# Node 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# pnpm（用 corepack，比 npm -g 稳）
sudo corepack enable pnpm
corepack prepare pnpm@latest --activate
```

**版本要求对照**（SETUP.md 原文）：

```
Node.js  22.19+ 或 24+     ✅ 24.22
pnpm                       ✅ 12.18
git      2.32+             ✅ 2.43
tmux                       ✅ 3.4
Python   3.8+              ✅ 3.12
gh       2.48+             ✅ 2.103
dsh      engines.dsh 范围内 ✅ 0.2.2-rc.1
```

> **坑**：`sudo npm install -g pnpm` 会卡很久（registry 是 npmjs），
> 且装完 `/usr/bin/pnpm` 可能是个断链。改用 `corepack enable pnpm` 一次搞定。
> 走镜像：`--registry=https://registry.npmmirror.com`。

---

## 四、装 DSH CLI

桌面版只有 Windows/macOS 安装包，Linux 上用 npm 装 CLI：

```bash
sudo npm install -g @deepseek-ai/dsh@0.2.2-rc.1 \
  --registry=https://registry.npmmirror.com
dsh --version     # 0.2.2-rc.1
```

首次运行会在 `~/.dsh/` 下生成 profile 骨架（`headless`、`web`）。

### API Key 放哪（踩坑记录）

三个位置试过，只有第三个稳：

| 位置 | 结果 |
|:--|:--|
| `~/.dsh/.credentials.yaml` 手工加 `kind: api-key` | ❌ 格式对了也读不到，headless 仍报 MISSING_CREDENTIAL |
| 网页「设置 → 模型」里填 | 只对 web 服务生效，CLI 读不到 |
| `.bashrc` 里 `export DEEPSEEK_API_KEY=` | ✅ CLI 能读到 |

**但 `.bashrc` 有个陷阱**：Ubuntu 默认 `.bashrc` 开头有

```bash
case $- in
    *i*) ;;
      *) return;;
esac
```

非交互 shell 到这里就 `return` 了，后面全不执行。所以 **export 必须写在文件最前面**，
不能追加到末尾。

> 更好的做法是写进 `headless` profile 的 `cordis.patch.yml`（`- id: credentials / disabled: false`）
> 或用 systemd 环境变量，避免 key 明文留在 shell 配置里。本文为了先跑通，暂时用 `.bashrc`。

---

## 五、拉仓库并编译

```bash
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/deepseek-ai/dsh-superagent-prototype.git dsh-superagent
cd dsh-superagent
pnpm install --registry=https://registry.npmmirror.com
pnpm build      # 必须跑！源码是 TS，没有 lib/ 插件加载不了
```

**`pnpm check` 结果**（typecheck + test + build）：

```
Test Files  2 failed | 57 passed (59)
     Tests  2 failed | 1195 passed (1197)
```

两个失败都是**飞书相关用例**（没有飞书凭据，连不上接口），与本次部署无关。

> **坑**：只 `pnpm install` 不 `pnpm build`，插件加载时会报
> `Cannot find module '.../dsh-superagent/lib/index.js'`。

---

## 六、装进 DSH profile

```bash
cd ~/projects/dsh-superagent
dsh plugin --profile web add ./
```

成功后 `~/.dsh/profiles/web/package.json` 会多出：

```json
"dependencies": { "dsh-superagent": "link:~/projects/dsh-superagent" },
"dsh": { "profile": { "bundles": [ ..., "dsh-superagent" ] } }
```

再在 `~/.dsh/profiles/web/cordis.patch.yml` 末尾补 stateDir：

```yaml
- id: dsh-superagent
  config:
    stateDir: /home/<user>/.dsh/state/superagent
```

---

## 七、启动：必须绑 127.0.0.1

```bash
dsh --profile web --host 127.0.0.1 --port 7788 --no-open
```

启动日志正常时应该有：

```
dsh web: listening on 127.0.0.1 over plain HTTP
dsh web: http://127.0.0.1:7788/  ← 启动日志里会打印完整地址，带一次性凭据
```

**如果 bind 到 `0.0.0.0` 或局域网 IP，会直接启动失败**：

```
Error: Orchestrator management requires a loopback Web server
    at registerHttp (lib/index.js:8730)
```

源码位置（`src/app/http.ts:231`）：

```ts
if (ctx.webServer.host !== '127.0.0.1')
  throw new Error('Orchestrator management requires a loopback Web server')
```

**这是有意为之**：agent 能改代码、能提 PR，暴露到网络等于把遥控器递出去。
要在别的机器上看面板，用 SSH 端口转发：

```bash
ssh -L 7788:127.0.0.1:7788 <user>@<host>
# 然后在本地浏览器开 http://127.0.0.1:7788/ （凭据见笔记本上那次启动的日志）
```

---

## 八、GitHub 账号与授权

### 为什么要专用账号

部署文档原文：

> Create a GitHub user account for the agent and give it write access to the repository.
> **A GitHub App cannot be the agent**, because dsh-superagent reads the account's notifications.

App 没有「通知」这个概念，所以必须是真实的用户账号。

建议命名：`<你的名字>-agent`。注册用一个已有邮箱即可，GitHub 允许一箱多号。

### 登录

```bash
gh auth login
# GitHub.com → HTTPS → Yes → Login with a web browser
```

浏览器里显示一个 8 位一次性码，去 <https://github.com/login/device> 输入，
**用 agent 账号登录**（不是自己的），点 Authorize。

验证：

```bash
gh auth status          # ✓ Logged in to github.com account <name>-agent
gh api user --jq .login
```

需要的 scope：`repo`（提 PR 够了）。

### 给 agent 一个独立的 gh 包装脚本

super agent 的配置里有 `cli` 字段，要求一个**登录成 agent 账号的 gh**。
做法是复制一份配置目录，再包一层：

```bash
cp -r ~/.config/gh ~/.config/gh-agent

cat > ~/.local/bin/gh-agent <<'EOF'
#!/bin/sh
GH_CONFIG_DIR="$HOME/.config/gh-agent" exec /usr/bin/gh "$@"
EOF
chmod +x ~/.local/bin/gh-agent

gh-agent api user --jq .login      # 应输出 agent 账号名
```

### 仓库与协作者

```bash
# 建测试仓库（私有）
gh repo create superagent-test --private --add-readme

# 把自己的账号加成协作者（agent 身份执行）
gh api -X PUT repos/<agent>/superagent-test/collaborators/<you> -f permission=push
```

邀请要**用自己的账号**接受（邮件里的 Accept，或仓库页上的按钮）。

---

## 九、配置（走管理 API，比点界面快）

super agent 提供一个本地 HTTP API，面板和 agent 都用它：

```
http://127.0.0.1:7788/orchestrator/api/
必须带 header:  x-orchestrator-request: 1
```

### 1. Source：监听哪个仓库

```python
PUT settings/source:github
{"value": {"enabled": true, "config": {
    "repository": "<agent>/superagent-test",
    "cli": "/home/<user>/.local/bin/gh-agent",
    "observeIssues": true,
    "observeComments": true,
    "pollSeconds": 60
}}, "revision": 0}
```

### 2. Policy：谁能派活（白名单）

```python
PUT settings/policy
{"value": {"rules": [...], "sources": {"github": {"allowed": [{"id": "<you>"}]}}},
 "revision": 0}
```

**白名单空着 = 任何人都派不了活**，面板会提示「来源名单为空」。

### 3. Executor：在哪干活

先在本地留一份 clone，给 prepare 命令做 worktree：

```bash
git clone https://github.com/<agent>/superagent-test.git ~/src/superagent-test
```

```python
PUT settings/executor
{"value": {
    "directory": "/home/<user>/.dsh/state/superagent/work",
    "maxWorkers": 2,
    "blockedCommands": ["dsh", "codex", "claude"],
    "prepare": (
      'git -C /home/<user>/src/superagent-test fetch --no-tags '
      '"https://github.com/$DSH_SUPERAGENT_GITHUB_REPOSITORY.git" '
      '"${DSH_SUPERAGENT_GITHUB_PR_HEAD:-HEAD}:refs/dsh-superagent/$DSH_SUPERAGENT_TICKET" && '
      'git -C /home/<user>/src/superagent-test worktree add -b '
      '"agent/$DSH_SUPERAGENT_NAME" "$DSH_SUPERAGENT_DIR" '
      '"refs/dsh-superagent/$DSH_SUPERAGENT_TICKET"'
    )
}, "revision": 0}
```

### 4. 确认就绪

```python
GET state
# setup.problem 应为 null，health 里所有项 state 都是 ready
```

---

## 十、规则：它什么时候「自己干」

`policy.rules` 决定哪些需求可以**不问直接做**。默认只有两条：

| id | 名称 | 范围 |
|:--|:--|:--|
| `copy` | Copy fixes | 错别字、措辞、标点、已有翻译 |
| `visual` | Visual fixes | 明确的间距/对齐/溢出/样式修复 |

我们加了两条（本次实测有效）：

| id | 名称 | 范围与约束 |
|:--|:--|:--|
| `docs` | Documentation additions | 明确的文档补充（指定位置和内容）；**只加内容**，不改已有代码与措辞；没说清位置就先问 |
| `deps` | Dependency upgrades | 升级到**指定版本**或修**指定 CVE**；只改版本号和 lockfile；**必须跑测试，失败就停，不提 PR** |

**没写进规则的，它一律先问。** 这是设计选择，不是缺陷 ——
「宁可多问一句，也不擅自改」。

---

## 十一、实测：两次真实任务

### 测试 1：最简单的一行文案

```
Issue #1  README 加一句问候语
正文：@<agent> 请在 README.md 末尾加一行「hello from superagent」，然后提 PR。
```

**结果**：60 秒内 → 建分支 → 改文件 → PR #2 → 回帖。

### 测试 2：走新加的 docs 规则

```
Issue #3  补一节「快速开始」
正文：@<agent> 请在 README.md 里加一节「快速开始」，说明怎么 clone
      这个仓库、怎么运行。放文件末尾就行。
```

**结果**：60 秒内 → PR #4，17 行新增，**一次通过合并**。

PR 正文结构（可以直接学）：

```
This is by an automated agent, not a human.      ← 身份声明

## What changed
Appends a 「快速开始」 section to README.md, covering: ...

## Verification
- git diff --check passes.
- README code fences are balanced (4 fences, 2 blocks) and the file ends with a newline.

Requested in #3.                                  ← 来源引用
```

### 最值得记的一个细节

仓库是空的（只有 README）。要求它写「怎么运行」，很容易编一堆不存在的命令。

它没编：

> 本仓库目前只包含 README 文档，没有可执行程序、依赖或构建脚本。
> 克隆后直接阅读仓库中的文档即可。

**"不给不存在的命令"** —— 这个诚实度是判断 agent 能不能用的第一条标准，
比代码写得漂亮重要得多。

### 已知的正常现象

- 两个 PR 都改 README 末尾 → 后合并的必然冲突。这是并行改同一处的正常结果，不是 bug。
- 首次轮询最多等 60 秒（`pollSeconds`）。

---

## 十二、排障速查

| 现象 | 原因 | 处理 |
|:--|:--|:--|
| `Orchestrator management requires a loopback Web server` | bind 到了非 127.0.0.1 | 用 `--host 127.0.0.1` |
| `Cannot find module '.../lib/index.js'` | 没跑 `pnpm build` | `pnpm build` 后重启 |
| `MISSING_CREDENTIAL`（headless） | key 只在 web 服务内存里 | 写环境变量或 profile 补丁层 |
| 面板「来源名单为空」 | policy.sources.github.allowed 空 | 填白名单 |
| 「GitHub 未设置监听仓库」 | source config.repository 空 | 填 `owner/name` |
| `no pnpm` / `ENOENT: pnpm` | pnpm 是断链 | `corepack enable pnpm` |
| 面板显示 `pending (waiting for service: orchestrator)` | 上面的 loopback 检查失败了 | 同上，先解决 bind |
| 提了 issue 没反应 | 没 @agent，或不在白名单 | 评论里 @ 一次；检查 allowed |

---

## 十三、边界：它能做什么，不能做什么

**能**（当前实现）：

- 入口：GitHub（Issues / PR / 评论 / CI），可选飞书
- 执行：在独立 worktree 里改代码、跑命令、提 PR、回帖
- 面板：工单、执行器负载、来源统计、被过滤/丢弃的消息

**不能**：

- 接 GitHub 之外的自定义入口（微信、钉钉、邮件）—— 需要照着
  `docs/008-cookbook.md` 写一个新的 Source
- 做规则外的设计判断 —— 会先问
- 跑在非 loopback 的 Web 服务上

---

## 十四、下一步

1. 用测试仓库把 `deps` 规则也验一遍（升级一个真依赖，看它会不会跑测试）
2. 稳定后接到真实仓库（建议先在低风险仓库上跑一周）
3. 把 API Key 从 `.bashrc` 挪到 profile 补丁层或 systemd 环境变量
4. 需要飞书入口时，照着 `docs/006-deployment.md` 配 bot CLI

---

## 十五、重启后自恢复：两个「重启就丢」的坑

第一次重启笔记本后，服务起不来，报了两个错。都不是配置写错，是**存的东西不在重启后还在的地方**。

### 坑 1：`gh` 的 token 存在桌面钥匙串里

```
X Failed to log in to github.com account <name> (default)
  - The token in default is invalid.
```

`~/.config/gh/hosts.yml` 里只有用户名，token 在 `gnome-keyring`。
**桌面没登录 → 钥匙串没解锁 → SSH 会话读不到 token。**

这和 SSH 本身无关：SSH 走密钥认证，照样能进；是 gh 读不到凭据。

**修法：把 token 明文写进 `hosts.yml`，绕开 keyring。**

```bash
gh auth login --with-token <<< "$TOKEN"
# 或直接写：
cat > ~/.config/gh/hosts.yml <<EOF
github.com:
    users:
        <agent>:
            oauth_token: <token>
    oauth_token: <token>
    git_protocol: https
    user: <agent>
EOF
chmod 600 ~/.config/gh/hosts.yml
```

**代价**：token 明文落在磁盘（权限 600，只有当前用户能读）。
**取舍**：比「每次开机要登录桌面」划算。介意就跑 `gh auth login` 重建，定期轮换。

### 坑 2：`~/.local/bin` 不在 SSH 会话的 PATH 里

```
gh-agent: 未找到命令
```

`gh-agent` 包装脚本在 `~/.local/bin/`，但那目录不在默认 PATH。

**修法：写进 `.bashrc` 最前面**（同 API Key，必须在非交互 return 之前）：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### 重启后的完整自检

```bash
uptime -p                                            # 确认真的重启了
gh auth status                                       # 应显示 Logged in
bash -c 'source ~/.bashrc; which gh-agent'           # 应找到包装脚本
bash -c 'source ~/.bashrc; dsh --profile web --host 127.0.0.1 --port 7788 --no-open'
# 然后 GET /orchestrator/api/state，setup.problem 应为 null，health 全部 ready
```

实测结果：重启后照此执行，`setup.problem: null`，全部健康项 ready，GitHub 源 ready。

### 决定：不做开机自启

理由和别处一致 —— 多一个常驻配置，将来重装系统容易忘。
代价是每次开机要手动拉一次，接受。

```bash
python3 find_laptop.py                                   # 先定位（IP 每次变）
ssh <user>@<ip>
dsh --profile web --host 127.0.0.1 --port 7788 --no-open # 起服务
```

---

## 附：版本与配置基线（本次实测）

```
OS          Ubuntu 24.04（内核 7.x）
Node        24.22.2
pnpm        12.18.0
git         2.43.0
tmux        3.4
Python      3.12.3
gh          2.103.3
DSH CLI     0.2.2-rc.1
superagent  0.1.0（commit 见上游 main）
Web 端口    127.0.0.1:7788
```
