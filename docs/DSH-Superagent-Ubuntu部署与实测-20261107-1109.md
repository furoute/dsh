# 在 Ubuntu 上部署 dsh-superagent 并跑通全流程（2026-11-07 ~ 11-09 实录）

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
两种认亲方式，按你手上有什么信息选：

**知道 MAC → 用 ARP 扫（快，一个 /24 一两秒）**

`lan-find.sh` 在 ACP-Lite 仓库根目录：

```bash
./lan-find.sh aa:bb:cc:dd:ee:ff              # → 192.168.1.42
./lan-find.sh aa:bb:cc:dd:ee:ff 192.168.0    # 指定网段
```

**只知道 hostname → 用 SSH 探测（慢些，但跨网段也能用，且不怕 MAC 随机化）**

`host-find.sh` 同样在 ACP-Lite 仓库根目录：

```bash
./host-find.sh <hostname>                       # 默认扫 192.168.0 / 192.168.1 / 10.0.0
./host-find.sh <hostname> <ssh-user>            # 指定 SSH 用户
./host-find.sh <hostname> <ssh-user> 192.168.0  # 指定网段
```

原理：并发探 22 端口，再对每个开着的地址跑一次 `ssh ... hostname` 比对。
一个 /24 约 2-11 秒。

> 两个脚本都在 `furoute/acp-lite` 仓库里，README 的 Q13b 有完整说明。
> 如果你的环境只需要认一台常开机器，也可以在自己机器上放个缓存版（先查缓存，
> 失效再重扫），但不建议把这类脚本散落到各个项目里 —— 统一从 ACP-Lite 拿。

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
dsh web: &lt;起始地址与一次性凭据会打印在下面这行&gt;
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
# 然后在本地浏览器打开那个地址（凭据见笔记本上那次启动的日志）
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

## 十六、第三个实测：一次开放式研究任务，看它会不会自己爬起来

前两次任务都是「改 README、加一节」这种确定动作。这一次换成**开放式研究任务**：
没有现成答案，要自己找资料、自己判断、自己写报告。目的是看它在**第一次失败之后**会不会自己继续。

### 任务怎么下的

在监听仓库开一个 issue，正文第一行 `@fujun-agent`，说明：

- 这是研究任务，**不改代码、不提 PR**
- 两个方向：BGP 的 path attribute TLV 能不能承载 agent 信令；区块链能不能承载 agent 微支付
- 每个关键结论要带可点来源
- 最后给一个判断：哪条更现实

### 第一次触发失败，原因值得记

```
Error: The prepare command failed: fatal: 无法访问
'https://github.com/fujun-agent/superagent-test.git/'：
GnuTLS recv error (-110): The TLS connection was non-properly terminated
```

**它自己没"坏"**，是这台机器访问 GitHub 要走代理，而 orchestrator 派出的 worker 子进程没有继承代理。

两次尝试都是在 `git clone` 这一步挂掉：

| 尝试 | 开始 | 报错时间 | 结果 |
|---|---|---|---|
| 1 | 02:36:07 | 02:37:37 | failed（GnuTLS） |
| 2 | 02:37:42 | 02:39:32 | failed（同一个错） |
| 3 | 02:40:37 | — | **ready**，02:53:57 交付 |

**更正（查源码后）**：源码 `src/executor/dsh.ts` 明确写着 **prepare 失败不会自动重试**——
「a failed prepare command is not retried automatically ... the ticket is marked failed and
waits until new human input or an explicit retry arrives」。
理由很实在：prepare 失败会在目录里留下半成品，自动重试会把它当成已准备好的工作区。

记录里那两次的 `endedReason` 是 `retried`，而源码里 `retried` 的语义是
**「Retried by a person」**（`core/reasons.ts`）。所以这两次是服务重启触发的重新排队，
**不是它自己判断后重试**。

### 第三次为什么成了

中间我只做了一件事：给 web 进程注入 `HTTPS_PROXY / HTTP_PROXY / ALL_PROXY` 并重启。
第三次尝试**是服务重启后重新排队的**，随后克隆成功、进入研究阶段。

> 注意：worker 子进程未必继承父进程环境。这次能通，是因为重启让整棵进程树都带上了代理。
> 更稳的做法是给 git 自己配代理（`git config --global http.proxy ...`），但那会影响所有 git 操作，需权衡。

### 它自己干了什么

```
目录结构（worker 的工作区）
work/bgp-payment-research-<hash>/
├── .git
├── README.md
├── report.md                    27 KB，两万多字
├── urls.txt                     待抓清单
└── research/                    75 份抓下来的原始资料
```

**⇒ 75 份资料**，包括 RFC 原文、APNIC 的 BGPsec 实测博客、x402/AP2/ACP 官方文档、
BIS 年报、GENIUS Act 原文、MiCA 监管文本、Visa TAP 新闻稿、Bitcoin 白皮书。

**⇒ 报告结构**（自己分的章节，没人给提纲）：

```
结论先行
一、BGP 信令      1.1 TLV 怎么扩 → 1.2 六个先例 → 1.3 怎么放 → 1.4 卡在哪 → 1.5 小结
二、区块链支付    2.1 方案地图 → 2.2 解决了什么 → 2.3 没解决什么 → 2.4 现实约束 → 2.5 小结
三、判断          3.1 BGP → 3.2 支付 → 3.3 更现实的架构 → 3.4 最终判断
主要来源
```

**⇒ 它还给了一个五层表**（发现 / 通信 / 授权 / 结算 / 追索），逐层说 BGP 和支付各能覆盖哪层。
没人要求做这个表。

### 结论本身（供判断能力参考）

```
BGP 信令      字节塞得进去，agent 互联跑不起来（只解决可达性）
区块链支付    结算层能跑，但不是完整答案
哪条更现实    支付
一句话        发现用 A2A/MCP/DNS，授权用 AP2/TAP，
              结算用 x402/L402/稳定币，BGP 只负责可达性
```

**⇒ 它还写了「研究局限」：没做 BGP 抓包实测、没做生产压测、没做商户访谈。**

**⇒ 这是它自己承认的边界，不是被要求写的。**

### 自检清单：这次证明了什么

| 能力 | 证据 |
|---|---|
| **失败后按设计停下** | 两次 GnuTLS 失败后标 failed 等人工，不盲目重试（避免半成品目录被当已准备） |
| **卡住时能定位** | 报错停在 `git clone` 那一步，没有假装继续 |
| **自主规划** | 没人给提纲，自己分三章 + 五层表 |
| **主动收集证据** | 抓 75 份原始资料，不是凭记忆写 |
| **核验来源** | 43 个链接，自述逐条验过 HTTP 200 |
| **守边界** | 明确「不改代码、不开 PR」，issue 保持 open |
| **承认局限** | 自己写了「没做实测」那一段 |
| **交付** | 27 KB 报告作为 issue 评论发布 |

### 没能证明的

- **网络不通的时候它救不了自己** —— 第一次失败是环境问题，它只能重试到耗尽，不能自己配代理
- **重试有上限** —— 第三次能成是因为外部环境变了，不是它解决了问题
- **内容新颖性** —— 报告质量不错，但这些概念在公开资料里都有；它擅长的是**查阅、结构化、判断**，不是原创


### 案例三（附带）：私有仓库本身就是白名单，未授权访问一律 404

这次的研究报告贴在**私有仓库**的 issue 里，于是碰上一个很典型的现象：

```
台式机（已登录 furoute）      点得开
笔记本（已登录 furoute）      点得开
微信里直接点                  404
未登录 curl 访问仓库/issue    404
```

**这不是链接坏了，是白名单在正常工作。**

GitHub 对**无权访问**私有仓库的请求返回 `404` 而不是 `403` —— 故意如此：
连「这个仓库存在」都不告诉你，避免泄露仓库清单。这就是**隐式拒绝**（implicit deny）。

**⇒ 机制很简单：私有仓库 + 协作者名单 = 白名单。**

```
昨天名单里只有 furoute（主号）        → 只有主号能看
把某个特定账号加进协作者              → 那个账号也能看
名单外的任何人（含微信内置浏览器）      → 一律 404
```

**⇒ 和 ACP-Lite 的三区模型是同一个思路：默认拒绝，明确授权才放行。**

```
ACP-Lite  UNTRUST 区只给只读 + 单一收信口，名单外的 peer 收不到任何东西
GitHub    私有仓库名单外的账号，连存在性都看不到
```

**⇒ 顺便说明一件事：想分享私有仓库里的内容，不是「发个链接」就行。**

```
要么  把对方加进协作者（等于授权）
要么  把内容搬到公开仓库 / 公开 Gist
要么  截图或导出文本发给对方
```

发链接而不加人，对方一定 404 —— 这正是它有价值的地方。

### 结论一句话

**给它一个开放式需求，它不会问「你希望我怎么做」，而是直接开工、失败重试、自己找资料、自己下判断。**
**人只需要在环境层面（网络、凭据、代理）把它送过起跑线。**

---

## 十七、和「普通 DSH」的区别：三个案例看下来

前面三个实测（改 README、加一节、开放式研究），把一件事说清楚了：
**super agent 不是「更聪明的 DSH」，是另一种东西。**

### 一句话区别

```
普通 DSH       你发一条消息 → 它做一轮 → 结束。人始终在回路里。
super agent    那边有事件进来 → 它自己判断要不要接 → 接了派给 worker
               → worker 干完自己回报 → 它把结果贴回原处。人可以不看。
```

**⇒ 一个是「被调用」，一个是「订阅 + 派单」。**

### 三个案例的对照

| | 案例一 改 README | 案例二 加「快速开始」 | 案例三 开放式研究 |
|---|---|---|---|
| 触发 | issue @ 它 | issue @ 它 | issue @ 它 |
| 谁规划步骤 | 它自己 | 它自己 | 它自己，**含章节结构** |
| 谁找资料 | 仓库内 | 仓库内 | **自己上网抓 75 份一手资料** |
| 谁核验 | 它（`gh pr diff`） | 它 | 它（43 个链接验 HTTP 200） |
| 谁交付 | 提 PR | 提 PR | 贴 issue 评论 |
| 人介入 | 0 次 | 0 次 | 只在环境层面（代理） |
| 产出规模 | 1 行 | 1 节 | 27 KB 报告 |

**⇒ 案例三是分水岭**：前两个是「执行指令」，第三个是「交付判断」。

### 真正的差别在「编排」，不在「模型」

**⇒ 一样的 DeepSeek 模型，普通 DSH 做不到这些。差别全在编排层：**

```
工单（ticket）      把「一条需求」变成有状态、可暂停、可重派的对象
派单（assignment）  每次执行是一次独立记录，失败/成功/重试都留痕
决策（decision）    记录「为什么接这一条」，带 policy 版本号
出站（outbox）      回复是持久队列，失败会重试到送达
评估（eval）        先判断该不该接，再接
健康（health）      八九个维度，哪个环节卡住一眼看得见
```

**⇒ 这些都是**外面那层壳**提供的能力，模型本身不负责。**

**⇒ 所以「换个更强的模型」不会让普通 DSH 变成 super agent。**

### 但它的边界也很清楚

**⇒ 三个案例都暴露了同一件事：**

```
✅ 任务内的自主        规划、找料、核验、交付，全自己来
❌ 环境内的自主        网络、代理、凭据、磁盘，出问题只能等人工
❌ 故障恢复自主        prepare 失败明确「不自动重试」，标 failed 等人
```

**⇒ 设计者的取舍是**宁可停下也不乱来**。**

**⇒ prepare 失败会留下半成品目录，自动重试会把半成品当成已准备好的工作区——**

**⇒ 所以它选择**停下等人**，而不是**猜着重试**。**

### 用一句话概括

**⇒ 普通 DSH 是**一把好刀**：你给我材料，我给你成品。**

**⇒ super agent 是**一个值班的徒弟**：事情来了自己看着办，办完回来汇报；**

**⇒ 但工具坏了、网络断了、钥匙找不到，它会站在原地等你。**

**⇒ 现阶段人该做的不是教它干活，而是**把它脚下的路铺好**——**

**⇒ 网络、代理、凭据、磁盘，这些铺平了，它就能连着干三个不重样的活。**

---

## 十七·补、三次实操后的总结：它到底特殊在哪

三次实测做完，飞书接入之前，先把这个东西的本质说清楚。

### 它不只是「更聪明的 DSH」

```
普通 DSH       收到一条消息 → 做一轮 → 结束（无痕）
super agent    事件进来 → 判断接不接 → 立项（工单+授权书）
               → 派工（可多次）→ 跟踪关联事项 → 结案（留原因）
```

**⇒ 一个是被调用，一个是订阅加派单。**

### 关键的那几步，一样都不能少

这是它和「普通 agent」真正的分界，**不是模型强弱，是有没有这几步**：

| 步骤 | 它做了什么 | 少了会怎样 |
|---|---|---|
| **评估** | 先判断该不该接，记下理由和策略版本 | 什么都接，疲于奔命 |
| **立项** | 生成不可变的授权书（who / 范围 / 依据） | 干着干着范围越做越大 |
| **派工** | 每次执行独立成档：谁干、干成没、为什么结束 | 出错查不出是哪一轮 |
| **跟踪** | 绑上自己开的 PR、引用的 issue，没关完不算完 | 提完就不管了 |
| **结案** | 记录谁结的、什么结论、什么原因 | 无从复盘 |

**⇒ 这五步是「项目制」的骨架，也是它可被审计、可被追责的前提。**

### 它巧妙地借了 GitHub

真正省力的地方在于：GitHub 把五样基础设施现成摆着——

```
身份（账号）·事件源（通知/issue）·协作界面（评论）
变更记录（commit/PR）·权限（仓库白名单）
```

**⇒ 这五样自己搭要半年，借来就免费，还自带审计。**

**⇒ 它只补了 GitHub 没有的那一层：谁该接、接几个、什么时候算完。**

**⇒ 所以「媒介」是借的，「编排」是自己的——和 ACP-Lite 借 Syncthing 当邮局是同一个思路。**

### 真正稀缺的是「显性」

Claude Code 这类工具内部也有派单、也有多步执行，但那套东西**藏在对话里**：

```
它派了子任务    看不到派工记录
它想了几步      看不到决策依据
它干到哪了      只能等它说
```

**⇒ 那是隐性的编排，靠上下文承载。**

**⇒ 这里把同样的东西摆到台面上：工单有编号有状态、派工有独立档案、**
**决策有理由、健康有八个维度。**

**⇒ 差别不在能不能做，在能不能查。**

**⇒ 一句话：隐性编排让 agent 更顺手，显性编排让 agent 可以被管。**

**⇒ 前者给个人用，后者给「背后要有人负责」的场景用。**

### 这套东西能不能移植

**⇒ 能移植的是中间那层抽象：**

```
保留     工单 / 派单 / 授权 / 跟踪 / 结案   ← 与平台无关
替换     事件源、身份、协作界面、变更记录   ← 与平台绑定
```

**⇒ 所以真要在国内落地，顺序是**先把项目制建起来，再选承载平台**：**

```
研发场景    Gitee / GitCode（接口像 GitHub，改动最小）
业务场景    飞书多维表格 + 审批（工单=记录，派单=审批，结案=状态流转）
```

**⇒ 第三个要换的是执行器**——现在它只会写代码，规则也只认
copy / visual / docs / deps 四类。换成业务场景，规则和执行器都得重写。

**⇒ 这是最容易被低估的一步。**

### 一句话收尾

**⇒ 它的价值不在「能自己干活」，而在「干的活看得见、查得到、说得清」。**

**⇒ 模型可以换，平台可以换，这套显性的项目结构才是它真正的资产。**

---

## 十八、飞书通道打通实录：从零到群里直接派活

super agent 原生支持两个来源：GitHub 和飞书。GitHub 那边开箱即用，
飞书要多几步——而且**坑集中在前置条件和权限上**，不是代码问题。

这一节记录完整过程，照着做能复现。

### 为什么选飞书

```
微信      留给蓝莓（Hermes）
钉钉      留给蛋糕（OpenClaw）
飞书      super agent 自己用，互不打架
```

super agent 的代码里飞书是**一等公民**：`feishu-channel` / `feishu-trigger` /
`feishu-read` / `feishu-image` / `feishu-loops` 全都有实现。

### 第一步：建应用（这步只能人做）

到开放平台 <https://open.feishu.cn/app> 建一个**自建应用**，开机器人能力。

需要的最小权限集：

```
im:message                   收发消息
im:message:send_as_bot       以机器人身份发
im:chat:readonly             读群信息
im:chat.group_info:readonly  读群资料
im:chat.members:read         读群成员（拿 open_id）
```

**改完权限必须「发布版本」，否则不生效。** 这一步最容易漏——
权限申请了但没发布，接口照样报 `app_scope_not_applied`。

拿到的 **App ID / App Secret 是凭据**：不要贴进聊天、不要写进仓库。
本文档里一律用 `<APP_ID>` / `<APP_SECRET>` 代替。

### 第二步：装 lark-cli

super agent **不直接调飞书 API**，而是通过官方 CLI 转发：

```
它的配置项只有一个：机器人的 lark-cli（命令名或绝对路径）
```

官方仓库是 [larksuite/cli](https://github.com/larksuite/cli)，npm 包名 `@larksuite/cli`。

```bash
# 全局 npm 目录常常没写权限，装到用户目录更省事
npm install -g @larksuite/cli --prefix ~/.local
~/.local/bin/lark-cli --version      # 实测 1.0.99
```

### 第三步：配机器人身份（关键：必须独立配置目录）

```bash
export LARKSUITE_CLI_CONFIG_DIR="$HOME/.lark-cli-dsh-superagent"

# secret 从 stdin 读，不落命令行历史
lark-cli config init --app-id <APP_ID> --app-secret-stdin

# 锁成「只许机器人身份」，不允许冒充用户
lark-cli config strict-mode bot --global
```

**为什么必须独立目录**：`lark-cli` 一个 App ID 只允许一个本地 profile。
如果这个应用你也登录过个人身份，会冲突。super agent 也**拒绝**一个能当用户的 CLI。

然后做个包装脚本，把这些环境变量固化下来：

```bash
cat > ~/.local/bin/lark-bot <<'EOF'
#!/bin/sh
export LARKSUITE_CLI_CONFIG_DIR="$HOME/.lark-cli-dsh-superagent"
exec lark-cli "$@"
EOF
chmod +x ~/.local/bin/lark-bot
```

验证：

```bash
lark-bot auth status
# "identities": { "bot": { "status": "ready", "available": true } }
```

### 第四步：把机器人拉进群

在飞书里建群 → 群设置 → 群机器人 → 添加你刚建的应用。

加完用机器人身份验证：

```bash
lark-bot im +chat-list
# 应该能看到刚拉进去的那个群，拿到 chat_id（oc_ 开头）
```

### 第五步：启用源（最容易卡住的一步）

**飞书源在 super agent 的上游 bundle 里默认是 `disabled: true`。**
所以刚装好时面板里**只有 GitHub，根本没有飞书卡片，也没有「添加来源」按钮**。

看上游 `cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-superagent-github
      name: dsh-superagent/github-watch
    # Optional Feishu Source; requires configuring a bot CLI after enabling.
    - id: dsh-superagent-feishu
      name: dsh-superagent/feishu-watch
      disabled: true          # ← 就是这里
```

在 profile 的 patch 里覆盖它：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: dsh-superagent-feishu
  disabled: false
```

重启 `dsh --profile web`，飞书就出现在来源列表里了。

### 第六步：在面板上填配置

启用后飞书卡片会出现，但状态是 `paused`：

```json
{ "state": "paused", "detail": "The Source is on, and its bot lark-cli is not set",
  "code": "feishuCliUnset" }
```

**这个字段只能从面板保存**——`settings/source:feishu` 这个路由对 PUT 返回 404，
没有对应的写接口。所以必须界面上填：

| 字段 | 填什么 |
|---|---|
| 机器人的 lark-cli | `/home/fujun/.local/bin/lark-bot`（绝对路径） |
| 能发起工作的飞书用户 | 你的 `open_id`（`ou_` 开头） |
| 群 | 那个测试群的 `chat_id`（`oc_` 开头），接收方式选「全部消息」 |
| 私聊 | 开 |
| 其他群 | 「仅 @」 |

保存后它会自动重启并检查机器人。`state` 变成 `ready`、
`detail: Listening for bot events` 就通了。

### 第七步：评估模式要切到 auto

默认是 `observe`——**看懂、能回话，但不派工**：

```json
{ "mode": "observe" }
```

可选的只有三档（不是 `act`，我第一次就猜错了）：

```
off       完全关掉评估
observe   只看不派（默认）
auto      判断该接就建工单派 worker
```

改成 `auto`：

```bash
# PUT /orchestrator/api/settings/eval
{ "value": { "mode": "auto", "timeoutSeconds": 120, "model": null }, "revision": <当前> }
```

### 第八步：测试

**注意：配置变更只对新消息生效，之前被过滤的消息不会重放。** 改完必须重发。

**闲聊类**（只要回答，不派工）：

```
@<机器人> 只回复三个字：收到了
→ 回复「收到了」，不建工单            ← 正确行为
```

**可执行类**（落在 copy / visual / docs / deps 四类里）：

```
@<机器人> 请在 README.md 末尾加一行：Feishu test passed
→ 建工单 → 派 worker → 改文件 → 提 PR #8 → 群里回报
→ PR 被合并后，它自己又发了一条「PR #8 已成功合并」
```

**⇒ 从发消息到 PR 提出来约 90 秒；到合并通知约 4 分钟。全程人没介入。**

### 一个反向验证：查询类不派工

在群里问一句「某游戏的最新战况」，它会**联网查了并回答**，
但**不建工单**——因为规则只有那四类，查询不在其中。

**这不是漏判，恰恰是评估层在工作。**

### 踩过的坑汇总

| 现象 | 原因 | 处理 |
|---|---|---|
| 面板里没有飞书，也没有「添加」按钮 | 上游默认 `disabled: true` | 在 profile patch 里覆盖 |
| `app_scope_not_applied`，缺一堆 `im:chat*` | 权限申请了但没发布版本 | 开放平台「版本管理与发布」点发布 |
| `The Source is on, and its bot lark-cli is not set` | `cli` 字段为空 | 面板填绝对路径 |
| `chat_not_allowed`，消息收到却被过滤 | 群不在允许清单里 | 面板加上该群 `chat_id` |
| 机器人看不见群 | 没拉进群 | 群设置里添加机器人 |
| `mode: act` 报 Invalid option | 只有 off / observe / auto | 用 `auto` |
| 改完配置测试没反应 | 旧消息不重放 | 重新发一条 |

### 脱敏提醒

```
App ID / App Secret   不进文档、不进仓库、不贴聊天
open_id / chat_id     也算标识符，公开文档里用占位符
lark-cli 配置目录      含凭据，权限收好
```

真要用在公开仓库里，App ID 这种东西一律写成 `<APP_ID>`。

---

### 案例四：飞书里下研究题，换成 LightVela 模型跑完

前三个案例走的是 GitHub issue，模型都是 DeepSeek。
第四个换两样：**入口换成飞书群，模型换成另一个 OpenAI 兼容网关**（LightVela）。

> 这一例的意义是：**换入口、换模型，编排那一层完全不动，行为一样。**

#### 怎么下的题

在飞书群里 @ 机器人，一句话说清要求：

```
看看笔记本的「下载」目录，有一个 .md 文件，请结合下面记录我们实践的仓库链接：
https://github.com/.../DSH-Superagent-Ubuntu部署与实测-20261107-1108.md
进行讨论和分析，主要实现「解放人的注意力」，不用编写具体代码，只提出构想即可。
```

#### 有意思的是：第一次它拒绝了

第一遍它判定 **`ignore`**，原话是：

```
请求是阅读本地下载目录的 .md 与仓库文档后做开放式的讨论与构想（不写代码），
不是文案纠错、样式修复、带明确目标的文档新增或依赖升级，
不符合任何已启用规则；按观察式采纳策略不建工单。
```

**⇒ 这是**评估层在正确工作**——规则只覆盖 copy / visual / docs / deps 四类，**

**⇒ 开放式研究不在其中，它没有硬塞，而是明确说了「不符合哪一条」。**

**⇒ 把需求换成「产出文档」之后，它按 `docs` 规则接了单。**

#### 模型确实换了

在 profile 里加了一条 OpenAI 兼容网关路由（`dsh-llm-pi-ai`，密钥走环境变量），

```
routableProviders   deepseek-official, lightvela
default             provider=lightvela, model=auto
```

**⇒ 生效后 `models` 接口里能看到两个 provider，面板上可切。**

#### 它怎么干的（从会话日志看）

```
orchestrator_ack      先回一句「我去读」
orchestrator_read     读 trigger 原文
bash                  找下载目录：ls ~/下载 ~/Downloads
read                  读那两份 .md
…                     中间若干步
write                 写报告
edit                  改一处引用表述
orchestrator_report   回报结果
```

**⇒ 全过程 25 次工具调用，没有绕远路。**

#### 产出

一份 13 KB 的分析，七章：

```
一、先算账：注意力消耗在哪些环节（表格逐项对照实测）
二、实测已证明的三个解放机理
三、四个注意力黑洞：现状证据与构想
四、反方向：哪些注意力不该被解放
五、统一框架：L0 / L1 / L2 分层
六、落地优先级建议
结语
```

**⇒ 最实在的是第一章那张表**——把「接活 / 规划 / 执行 / 监督 / 交付 / 运维 / 兜底 / 判断」

**⇒ 八个环节逐项标注「已解放 / 未解放 / 有意保留」，每条都挂实测证据。**

**⇒ 结论一句：**

```
过程性注意力已经解放
运维性与兜底性注意力是当前黑洞
判断性注意力被设计保留给人
```

**⇒ 第四章尤其难得：大多数讲「解放」的文章只讲怎么解放，它专门划了不该解放的边界。**

#### 这一例证明了什么

| 维度 | 结论 |
|---|---|
| **换模型** | 换成第三方 OpenAI 兼容网关，编排层零改动，行为一致 |
| **换入口** | 从 GitHub issue 换成飞书群，跑的是同一套工单流程 |
| **评估层** | 不符合规则就明确拒绝并说明理由，不硬凑 |
| **执行** | 25 次工具调用，读文件→分析→写报告→自校准，无人工干预 |

**⇒ 换句话说：模型和入口都是**可替换件**，项目制那层才是它自己的东西。**

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
