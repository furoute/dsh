# DSH 思维链（CoT）强制中文化 —— 复用步骤

> 适用对象：想在另一台电脑 / “家里”的 DeepSeek Harness（DSH）里，把 agent 执行操作时**“正文之前的大段思维链”**从英文改成中文。
>
> 记录日期：2026-08-28
> 验证环境：Windows · DSH `0.1.1-rc.2`（web GUI profile）

---

## 零、先搞清楚：到底改哪里才有效

你看到的“正文前大段英文”，在 DSH 里其实是**模型实时生成的思维链（thinking / reasoning）**，不是 GUI 写死的界面文字。所以：

- ❌ 改前端打包产物（`dsh-web-frontend\dist\assets\*.js`）→ 无效，思维链根本不经过它。
- ✅ 改 **persona（agent 系统提示词）** → 唯一能控制思维链语言的入口。

结论：**只改配置文件，不需要重编译、不需要碰源码。**

---

## 一、定位当前生效的 persona 配置文件

DSH 用“agent preset（预设）”组织 persona。`settings.yaml` 里指定默认预设：

- 配置文件：`~\.dsh\settings.yaml`
- 关键字段：`agent-presets.default`（本机为 `standard-codex`）

关键路径（把 `Administrator` 换成你自己的用户名）：

```
<USERPROFILE>\.dsh\settings.yaml
<USERPROFILE>\.dsh\.agent-presets\<你的预设名>\agent.cordis.yml
```

> 判断哪个预设在你机器上生效：看 `settings.yaml` 里 `agent-presets.default` 的值，对应 `.agent-presets\<该值>\agent.cordis.yml`。

---

## 二、修改 persona：强制中文思维链

打开 `<预设名>\agent.cordis.yml`（例如 `standard-codex`），找到 `- id: persona` 段下的 `text:` 字段，把**原文**替换为**新文**。

### 原文（英文思维链规则，约 1 句）

```
    text: >-
      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.

      Language rules: think, reason, and work out your chain of thought (TOL / thinking / reasoning_content) in the same language as the user's latest message; when the user writes in Chinese, produce your internal thinking and your final answer entirely in simplified Chinese (简体中文). Keep code, identifiers, filenames, and technical terms in their original form. When the user writes in another language, mirror that language for both thinking and replies.
```

### 新文（强制中文思维链，约 2-3 句）

```
    text: >-
      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.

      Language rules — follow them STRICTLY and WITHOUT EXCEPTION:
      Your chain of thought (TOL / thinking / reasoning_content), including the intermediate reasoning you emit before every tool call, must be written in the SAME language as the user's latest message. When the user writes in Chinese, produce BOTH your internal thinking AND your final answer entirely in simplified Chinese (简体中文) — every word, every sentence, every step, with no English in the reasoning stream at all, except for code, identifiers, filenames, commands, and technical terms, which stay in their original form. Do not switch back to English for tool-call reasoning, planning, or status narration; if you catch yourself writing the reasoning in English while the user is writing in Chinese, restart it in Chinese. When the user writes in another language, mirror that language for both thinking and replies.
```

> ⚠️ 保留 `{{model}}` 和 `{{cwd}}` 两个模板变量原样不动，它们会被 DSH 在运行时替换。

---

## 三、备份（强烈建议）

改动前后各留一份备份，方便回滚：

```powershell
# Windows PowerShell
Copy-Item "<USERPROFILE>\.dsh\.agent-presets\<预设名>\agent.cordis.yml" `
          "<USERPROFILE>\.dsh\.agent-presets\<预设名>\agent.cordis.yml.bak-zh-thinking-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
```

```bash
# Linux / macOS
cp ~/.dsh/.agent-presets/<预设名>/agent.cordis.yml \
   ~/.dsh/.agent-presets/<预设名>/agent.cordis.yml.bak-zh-thinking-$(date +%Y%m%d-%H%M%S)
```

---

## 四、生效方式（关键）

`agent.cordis.yml` 是**进程启动 / session 挂载时**读取的，不会热重载。要让新 persona 生效：

1. **新开一个会话**（推荐，最快）；或
2. **重启 `dsh web` profile**；
3. 然后在会话里用中文提问，观察“正文前的思维链”应变为中文。

---

## 五、⚠️ 不要再加「全局 persona」补丁（已证实会启动冲突）

> 结论已更新（2026-08-28 实际踩坑）：**切勿在 `profiles\web\cordis.patch.yml`（或任何顶层）追加第二条 `@deepseek-ai/dsh-persona`。**

- **为什么不行**：DSH 的 **persona 提示词区块是全局唯一的**（deployment scope），同一时刻只能注册一个 `dsh-persona`。若在 `agent.cordis.yml`（预设，正确位置）之外再补一条全局 persona，启动时直接报错并中断进程：
  > `deployment:persona 提示词区块重复注册`
- **解决办法**：只保留**预设级**那一份（第二节的位置），它已 `shadow` 覆盖默认 agent，效果等同于“全局”；预设之后的子逻辑不再需要额外 persona 层。（本机在 `standard-codex` 中加入即视为全局，因为默认 preset 就是它。）
- **回滚**：若已误加，删掉 `cordis.patch.yml` 里新增的 `persona-zh-thinking` 段（保留原有插件项），重启即可恢复。
- 若预设级加了中文规则后长流程仍偶见英文，这是模型本身的概率性问题，**不要再叠 persona**，可改用更少工具调用次数 / 更高 model 温度等方式缓解。

---

## 六、本次已完成的备份记录

本机（`Administrator`）本次改动已备份：

- 改动文件：`<USERPROFILE>\.dsh\.agent-presets\standard-codex\agent.cordis.yml`
- 备份文件：`<USERPROFILE>\.dsh\.agent-presets\standard-codex\agent.cordis.yml.bak-zh-thinking-20260828-133032`

---

## 七、总结速查

| 项目 | 值 |
| --- | --- |
| 控制的文件 | `.dsh\.agent-presets\<预设名>\agent.cordis.yml` |
| 生效预设 | `settings.yaml` → `agent-presets.default` |
| 改动字段 | `persona.text` |
| 需要保留 | `{{model}}`、`{{cwd}}` 模板变量 |
| 生效方式 | 新开会话 / 重启 profile |
| 回滚 | 用备份文件覆盖原文件 |
| ⚠️ 不要做 | 在 `cordis.patch.yml` 追加第二条 `dsh-persona`（persona 区块全局唯一，会启动冲突） |
