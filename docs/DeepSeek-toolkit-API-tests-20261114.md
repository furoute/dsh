# DeepSeek 全家桶 API 逐项实测

> 测试时间：2026-11-14
> 账号：个人账号
> Key 从环境变量取：`export DEEPSEEK_API_KEY=<你的 Key>`（各自配各自的，勿写入代码）
> 全部用 curl 直连 `https://api.deepseek.com`，可复现
> 结论：**11 项全部实测通过，配置零改动，用哪个计哪个的费**

---

## 一、清单与实测结果

| # | 能力 | 接口 | 实测 | 耗时 |
|---|---|---|---|---|
| 1 | **Search** 网页搜索 | `POST /v1/tools/search` | ✅ 通 | 0.4s |
| 2 | **Fetch** 网页抓取 | `POST /v1/tools/fetch` | ✅ 通 | 0.2s |
| 3 | **OCR** 文字识别 | `POST /v1/tools/ocr` | ✅ 通 | 2.2s |
| 4 | **TTS** 语音合成 | `POST /v1/tools/tts` | ✅ 通 | 1.7s |
| 5 | **ASR** 语音识别 | `POST /v1/tools/asr` | ✅ 通 | 1.0s |
| 6 | **Files API** 上传文件 | `POST /files` | ✅ 通 | 2.3s |
| 7 | **文件解析** 对话引用 | `file_id` 引用 | ✅ 通 | 0.7s |
| 8 | **联网工具** 服务端搜索 | `deepseek_web_search` | ✅ 通 | 2.1s |
| 9 | **阅读链接** | `deepseek_read_url` | ✅ 通 | 2.3s |
| 10 | **图像理解** | `image_url` (base64) | ✅ 通 | 0.8s |
| 11 | **模型内容安全** | `safety.enabled` | ✅ 通 | 1.3s |

---

## 二、逐项详情

### 1. Search 网页搜索

```bash
curl https://api.deepseek.com/v1/tools/search \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"query":"DeepSeek V4.1 发布","count":3,"need_content":false}'
```

**返回**：`results[]`，含 `title` / `url` / `summary`（600-800字）/ `snippet` / `authority`(0-4) / `rerank_score`(0-3) / `date`。

**实测**：查到韩联社、环球时报等外媒报道，`authority: 4`，`rerank_score: 2.34`。

**关键参数**：

| 参数 | 说明 |
|---|---|
| `count` | 1-50，默认 10 |
| `need_content` | **true 时直接返回网页正文**，不用再调 Fetch |
| `ori_question` | 用户原始问题，提升搜索意图理解 |
| `localization` | IP 地址，优先返回本地化结果 |

**搜索语法**：`site:` / `-site:` / `-` / `"精确"` / `lang:zh,en` / `after:2025` / `before:2026`

### 2. Fetch 网页抓取

```bash
curl https://api.deepseek.com/v1/tools/fetch \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://api-docs.deepseek.com/zh-cn/updates"}'
```

**返回**：`{title, content}`，content 是 Markdown 正文。

**实测**：抓到全家桶发布当天的更新日志原文，Markdown 格式干净。

### 3. OCR 文字识别

```bash
curl https://api.deepseek.com/v1/tools/ocr \
  -H "Authorization: Bearer $KEY" \
  -F purpose="text_recognition" -F file="@test.png"
```

**支持**：PDF / Word(DOC/DOCX) / PPT(PPTX) / PNG / JPEG / WebP / GIF / BMP / TIFF

**两种 purpose**：

| purpose | 行为 |
|---|---|
| `text_recognition` | 纯文字提取，文档里的图丢弃 |
| `rich_layout_recognition` | 逐页识别，**保留 `<｜ref｜>`/`<｜box｜>` 标记和坐标** |

**坐标格式**：`[[x1,y1,x2,y2]]`，归一化到 0-1000，原点左上角。**能据此定位文字、裁切图片。**

**实测**：一张 800×400 的测试图，识别出 `DeepSeek OCR TEST 12345` 和 `Hello World 2026`，2.2 秒返回，第 1 页 `finish_reason: stop`。

**限制**：单文件 100 MiB / 1000 页 / 180 秒内完成。

**计费**：按识别**成功的页数**计，失败或超时不计费。单价见官方价格页。

### 4. TTS 语音合成

```bash
curl https://api.deepseek.com/v1/tools/tts \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"text":"你好，我是蓝莓","voice_id":"stella"}' --output speech.wav
```

**音色**：`stella`（海星，女声，默认）/ `tide`（暗潮，男声）

**语种**：自动识别，支持 10 种（中/粤/英/日/韩/马来/阿拉伯/印尼/泰/越）

**格式**：`wav`（默认）/ `pcm`（24kHz 16bit 单声道）

**实测**：合成 20 字中文，返回 209 KB 的 wav，1.7 秒。

**限制**：单次最多 10,000 计费字符 / 30 分钟音频 / 不支持调节语速。

### 5. ASR 语音识别

```bash
curl https://api.deepseek.com/v1/tools/asr \
  -H "Authorization: Bearer $KEY" -F file="@speech.wav"
```

**格式**：16 位 PCM WAV 或 Ogg Opus，单/双声道（双声道只认左声道）

**支持 21 种语言**，自动识别。

**实测闭环**：**把 TTS 刚合成的音频喂给 ASR，转回来一字不差**：

```
原文  你好，我是蓝莓，正在测试 DeepSeek 的语音合成接口。
转写  你好，我是蓝莓，正在测试 DeepSeek 的语音合成接口。
```

**计费**：按音频**时长**计，精确到秒，不足 1 秒按 1 秒计。单价见官方价格页。

**限制**：8 MiB / 120 秒 / 不支持流式。

### 6-7. Files API + 文件解析

**两步走**：

```bash
# 第一步：上传并解析
curl https://api.deepseek.com/files \
  -H "Authorization: Bearer $KEY" \
  -F purpose="text_recognition" -F file="@doc.png"
# → {"id":"file-api-xxx", ...}

# 第二步：对话中引用
{
  "model": "deepseek-flash",
  "messages": [{"role":"user","content":[
    {"type":"file","file_id":"file-api-xxx"},
    {"type":"text","text":"这张图里有哪些文字？"}]}]
}
```

**实测**：上传测试图后，模型正确读出 `DeepSeek OCR TEST 12345` / `Hello World 2026`，还带 `===== Page 1 =====` 分页标记。用量 94 tokens。

**三种 purpose**：

| purpose | 适用于 | 是否收费 |
|---|---|---|
| `user_data` | 图片、纯文本、表格、电子书 | **免费** |
| `text_recognition` | PDF/Word/PPT/图片，只提文字 | 按页 |
| `rich_layout_recognition` | 图文混排，图也交给模型 | 按页 |

**注意**：`purpose` 必须写在 `file` 字段**之前**，否则 400。

### 8. 联网工具（服务端搜索）

```bash
curl https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" -H "Content-Type: application/json" \
  -d '{
  "model": "deepseek-flash",
  "thinking": {"type": "disabled"},
  "tools": [{"type": "deepseek_web_search"}],
  "messages": [{"role":"user","content":"全家桶哪天发布的？"}]
}'
```

**实测**：问「DeepSeek 全家桶应用 API 是哪天发布的」，答 **2026年11月13日**（正确）。

**用量**：`server_tool_use.tool_search: 4`，`prompt_tokens: 6604`。

**两种模式**：

| 思考模式 | 行为 |
|---|---|
| 关闭 | 模型判断是否搜，附引用作答 |
| 开启 | **深度思考搜索**：多步搜索 → 打开网页 → 页内查找，最多约 20 次工具调用 |

**注意**：`tool_choice` **不能**指定这两个工具，否则 400 —— 搜不搜由模型决定。

### 9. 阅读链接

```bash
curl https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" -H "Content-Type: application/json" \
  -d '{
  "model": "deepseek-flash",
  "thinking": {"type": "disabled"},
  "tools": [{"type": "deepseek_read_url"}],
  "messages": [{"role":"user","content":"读一下 https://api-docs.deepseek.com/zh-cn/updates ，最新一条更新标题是什么？"}]
}'
```

**实测**：给一个 URL，问更新标题，答「**发布全家桶应用 API**」（正确）。

**用量**：`tool_fetch: 1`。

**细节**：只识别最后一条用户消息里的 URL，最多前 10 个；网页正文**加密放在 `signature` 里**，不回传就丢了上下文。

### 10. 图像理解

```bash
# 把图片转成 base64 再拼进请求（不能传 file:// 的 file_id）
B64=$(base64 -w0 截图.png)
curl https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" -H "Content-Type: application/json" \
  -d "{
  \"model\": \"deepseek-flash\",
  \"thinking\": {\"type\": \"disabled\"},
  \"messages\": [{\"role\":\"user\",\"content\":[
    {\"type\":\"image_url\",\"image_url\":{\"url\":\"data:image/png;base64,${B64}\"}},
    {\"type\":\"text\",\"text\":\"这张图里写的什么？\"}]}]
}"
```

**实测**：base64 传图，正确读出第一行文字。

**踩坑**：传 `file://file-api-xxx` 报 `Unsupported image_url format`，**必须用 base64 或 http(s) URL**。

**注意**：`deepseek-flash` 支持图像，`deepseek-v4-pro` 不支持。

### 11. 模型内容安全

```bash
curl https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" -H "Content-Type: application/json" \
  -d '{
  "model": "deepseek-flash",
  "thinking": {"type": "disabled"},
  "safety": {"enabled": true},
  "messages": [{"role":"user","content":"你好，简单介绍下自己"}]
}'
```

**实测**：开启后正常对话不受影响，返回正常。

**作用**：OCR 裁出的图、读取的网页都要过审，未通过的返回 `url_not_allowed`。

---

## 三、收费

**本文不列价格。** 我们不是官方，不代为报价 —— 各接口的当前单价一律以官方价格页为准：

**https://api-docs.deepseek.com/zh-cn/quick_start/pricing**

几处计价规则（规则不随价格变动，可以照用）：

- 搜索、抓取、OCR、语音识别都**按次数 / 页数 / 时长**计，不按 token
- **`count`（返回条数）不影响单价**，搜 1 条和搜 50 条一个价
- 搜索无结果、抓取失败、OCR 超时、识别失败，**均不计费**

---

## 四、对现有配置的影响

**结论：零改动。**

| 位置 | 需要改吗 | 原因 |
|---|---|---|
| 上网本（Hermes） | ❌ 不用 | 纯 curl，有 Key 就能调 |
| 台式机 DSH | ❌ 不用 | 搜索早就内置，服务端直接处理 |
| 本地 llama-server | ❌ 不用 | 两套系统完全独立 |

**DSH 里已经在用的**：`deepseek_web_search`、`deepseek_read_url`、图像理解。

**DSH 里用不上但可以手工调的**：OCR、TTS、ASR、Files API。**这几项得自己写脚本。**

---

## 五、最值得用的三个

### ① OCR —— 批量转文字

**场景**：手写服务报告、扫描件、老 PDF 批量转文字。

**优势**：`rich_layout_recognition` 还带坐标，能定位文字位置。

**对比本地**：本地 OCR 要装 rapidocr，折腾且慢；这个一次请求搞定。

### ② ASR —— 录音转写

**场景**：会议录音转写、微信语音转文字。

**实测闭环**：TTS → ASR 一字不差，说明准确率可用。

**优势**：21 种语言自动识别。

### ③ Search + Fetch —— 给 agent 加联网

**场景**：给任何 agent 加联网能力。

**省钱技巧**：`need_content: true` 一次调用就能同时拿到搜索结果和正文，**省掉一次 Fetch 调用**。

---

## 六、踩过的坑

| 现象 | 原因 | 修法 |
|---|---|---|
| `Unsupported image_url format` | 传了 `file://file-id` | 用 base64 data URL 或 http(s) 链接 |
| Files 上传报 400 | `purpose` 写在 `file` 之后 | 顺序调过来 |
| `tool_choice` 报 400 | 指定了 `deepseek_web_search` | 这个不能指定，由模型判断 |
| OCR 返回 error 对象 | 状态码 200 但识别失败 | 检查响应体里有没有 `error` 字段 |
| 密码保护的 PDF 失败 | 文件加密 | 先去掉密码 |
| 1000 页以上失败 | 超页数限制 | 拆分上传 |

---

## 附：环境

```
API       https://api.deepseek.com
鉴权      Authorization: Bearer $DEEPSEEK_API_KEY
模型      deepseek-flash（V4.1-Flash-1017，1M 上下文，384K 输出）
测试机    Ubuntu 24.04
代理      视网络环境而定（访问 api.deepseek.com 需要）
```

---

## 附：官方文档地址

**接口和价格若有调整，一律按官方文档为准 —— agent 可以据此自行更新本文件。**

| 内容 | 地址 |
|---|---|
| **更新日志**（看有没有新能力） | https://api-docs.deepseek.com/zh-cn/updates |
| **模型 & 价格**（收费调整看这里） | https://api-docs.deepseek.com/zh-cn/quick_start/pricing |
| **网页搜索与抓取** Search / Fetch | https://api-docs.deepseek.com/zh-cn/guides/search |
| **OCR 文字识别** | https://api-docs.deepseek.com/zh-cn/guides/ocr |
| **文件解析**（Files + 对话引用） | https://api-docs.deepseek.com/zh-cn/guides/document_parsing |
| **Files API** | https://api-docs.deepseek.com/zh-cn/guides/files_api |
| **联网工具**（服务端搜索 / 阅读链接） | https://api-docs.deepseek.com/zh-cn/guides/web_tools |
| **图像理解** | https://api-docs.deepseek.com/zh-cn/guides/vision |
| **语音合成 TTS** | https://api-docs.deepseek.com/zh-cn/guides/tts |
| **语音识别 ASR** | https://api-docs.deepseek.com/zh-cn/guides/asr |
| **模型内容安全** | https://api-docs.deepseek.com/zh-cn/guides/safety |
| **API 参考**（完整 schema） | https://api-docs.deepseek.com/zh-cn/api/create-chat-completion |
| **错误码** | https://api-docs.deepseek.com/zh-cn/quick_start/error_codes |
| **限速与隔离** | https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit |

**更新方式**：先看「更新日志」有没有新接口；价格一律查上面的官方价格页；其余按上表逐项对照。
