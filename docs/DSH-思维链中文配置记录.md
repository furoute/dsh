# DSH：把「思维链 / TOL」输出语言改为中文 —— 配置记录

> 用途：记录本次对 DeepSeek Harness（DSH）本地配置的改动步骤，方便你在**家中的另一台 DSH** 机器上复现。
> 适用条件：DSH 通过 `@deepseek-ai/dsh` 安装，`DSH_HOME`（本地首页）默认为 `~/.dsh`（本机为 `<USERPROFILE>\.dsh`）。

---

## 一、背景 / 改动目标

你想让「每次输出的思维链」（即模型的内部思考 / chain-of-thought / reasoning / "TOL"）和回复都**使用中文（简体中文）**。

关键点：**DSH 没有单独的"思维链语言"开关**。DeepSeek 模型（deepseek-official 路由）思考时的语言，是由 **系统提示词（system prompt / persona）** 引导的。所以正确改法是通过系统提示词（`dsh-persona` 的 `text`）加一条语言规则，而不是改模型路由参数。

> 顺带说明：`settings.yaml` 里的 `reasoningEffort: off` 会关闭"显式思考"。若你想让模型产出可见的思维链，需要把 `off` 改成 `low / high / max`。本配置记录同时覆盖"思考已开启"的情况下的用中文字段。

---

## 二、改动内容（已在本机完成）

### 2.1 改的文件

```
~/.dsh/.agent-presets/standard-codex/agent.cordis.yml
（本机实际路径：<USERPROFILE>\.dsh\.agent-presets\standard-codex\agent.cordis.yml）
```

说明：
- `~/.dsh/settings.yaml` 里 `agent-presets.default: standard-codex`，所以当前默认会话用的是 `standard-codex` 这个**用户自有的本地 preset**。
- preset 里的 `persona` 行（`@deepseek-ai/dsh-persona`）会**覆盖**部署自带的 persona，成为该 agent 的系统提示词第一条。因此往这里加语言规则即可全局约束该 agent 的思考和回复语言。

### 2.2 具体修改

把 `persona` 的 `config.text` 由：

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.
```

改为（追加"语言规则"两段）：

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.

      Language rules: think, reason, and work out your chain of thought (TOL / thinking / reasoning_content) in the same language as the user's latest message; when the user writes in Chinese, produce your internal thinking and your final answer entirely in simplified Chinese (简体中文). Keep code, identifiers, filenames, and technical terms in their original form. When the user writes in another language, mirror that language for both thinking and replies.
```

> 注意：`text: >-` 是 YAML 折行块。空行 = 段落分隔，缩进 4 空格即可继续追加内容，不要破坏缩进。

---

## 三、应用到新的会话

- 该修改对**新起的对话/新 agent 会话**立即生效（persona 在 agent 挂载时组装）。
- 若当前浏览器会话（Web GUI）已开着，需要**新建会话**，或重开页面让 persona 重新组装；已在进行中的旧会话可能仍用旧 persona。

---

## 四、在家中的 DSH 复现步骤

1. **找到同样的本地 preset 目录**（`$DSH_HOME/.agent-presets/standard-codex/`，`$DSH_HOME` 通常是 `~/.dsh`）。
   - 若家中没有 `standard-codex`，则改成你家中默认 preset 对应的 `agent.cordis.yml`（可用 `~/.dsh/settings.yaml` 的 `agent-presets.default` 确认）。
2. **备份原文件**（可先在旁边留一份 `.bak`）。
3. **编辑该 preset 的 `persona.config.text`**：在第 2.2 步那样追加"Language rules"段落（用中文/英文皆可，模型都懂；建议照抄上面原文）。
4. **保存并校验 YAML**：
   - 缩进必须与上一行 `text` 对齐；确认没有用 Tab。
   - 检查方法：可临时把整个文件里的 `!!js` 行除外后交给 YAML 解析器确认 persona 块合法；或直接照抄本记录里的块即可。
5. **新建会话验证**：用中文提问，观察模型思考/回复是否为中文。

> 复制文件更加省事：直接把本机 `~/.dsh/.agent-presets/standard-codex/` 整个目录拷贝到家乡同款位置即可（含 `agent.cordis.yml` 和 `preset.yml`）。

---

## 五、可选：把默认语言写到 `AGENTS.md`（另一种更轻量的做法，供参考）

DSH 的 `dsh-agent-instructions` 插件会自动读取 **`$DSH_HOME/AGENTS.md`**，并在每次会话第一次请求时以 `<system-reminder>` 注入为工作区指令。若你不想动 preset，也可以改用这个文件：

```
~/.dsh/AGENTS.md   （不存在就新建）
```

内容示例：

```markdown
# 语言要求
- 思维链/思考（reasoning_content）与回复均使用与用户消息一致的语言；用户用中文则全程使用简体中文。
- 代码、变量名、文件名、技术术语保持原文。
```

> 注意差异：`AGENTS.md` 注入的是**工作区指令（user 角色）**，权威低于系统提示词；preset 的 `persona`（system 角色）权威更高、更可靠。建议优先用第 2 步的 persona 方案。

---

## 五·二、⚠️ 切勿添加「全局 persona」补丁（已证实会启动冲突）

> 结论已更新（2026-08-28 实际踩坑）：**不要**在 `profiles\web\cordis.patch.yml`（或任何顶层补丁）里追加第二条 `@deepseek-ai/dsh-persona`。

- **为什么不行**：DSH 的 **persona 提示词区块是全局唯一的**（deployment scope），同一时刻只能注册一个 `dsh-persona`。若在 `agent.cordis.yml`（预设，正确位置）之外再补一条全局 persona，启动时直接报错并中断进程：
  > `deployment:persona 提示词区块重复注册`
- **解决办法**：只保留**预设级**那一份（第 2.2 节的位置），它已 `shadow` 覆盖默认 agent，效果等同于“全局”；因为设置里默认 preset 就是 `standard-codex`，所以预设级+=全局。**不需要、也不能再加第二层 persona。**
- **回滚**：若已误加，删掉 `cordis.patch.yml` 里新增的 `persona-zh-thinking` 段（保留原有插件项），重启 DSH Web 即可恢复。
- 若预设级加了中文规则后长流程仍偶见英文，这是模型本身的概率性问题，**不要再叠 persona**，可改用更少工具调用次数 / 更高 model 温度等方式缓解。

---

## 六、本机改动后相关文件清单（供核对）

| 文件 | 状态 |
|---|---|
| `~/.dsh/.agent-presets/standard-codex/agent.cordis.yml` | 已修改（persona.text 追加语言规则） |
| `<DSH_ROOT>\DSH-思维链中文配置记录.md` | 本文档（新建+后续补充） |
| `~/.dsh/settings.yaml` | 未改动（`agent-presets.default: standard-codex`；`reasoningEffort: off`） |
| `~/.dsh/profiles/web/cordis.patch.yml` | 曾误加 `persona-zh-thinking`，已回滚为仅含原插件项 |

---

## 七、回滚方法

把你备份的原始 `agent.cordis.yml` 覆盖回去，或删掉追加的 Language rules 段落即可；新会话即恢复原语言行为。

若当初误加了 `cordis.patch.yml` 里的全局 `persona-zh-thinking`，只需删掉那一段（保留其他插件项）并重启 DSH Web 即可，不必动 `agent.cordis.yml`。
