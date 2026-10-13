<#
  脱敏归档复制脚本 — 白名单式收集 DSH 自建资产
  设计原则：
    1. 白名单复制（只收明确列出的文件），绝不整目录搬运
    2. 复制即净化：文本类文件按规则替换私有信息
    3. 排除一切依赖目录（node_modules）、备份残留、日志、缓存
  用法：pwsh -File sanitize-copy.ps1
  来源根目录在不同机器上命名不一致（report/reports、local-plugins/plugins、work/tools），
  脚本自动从候选名中取第一个存在的那个
#>

$ErrorActionPreference = 'Stop'

# 路径全部动态推断，不硬编码本机目录（否则泄露目录结构，且换机器即失效）
#   $Stage  = 本脚本所在目录的上一级（即归档仓库根）
#   $DsRoot = DSH 工作区根。环境变量 DSH_WORKSPACE 可用分号/逗号列多个根
#             （两台电脑的根都列上，一次运行即同时脱敏两种写法）；
#             取材取「第一个存在的根」，全部根都用于 <DSH_ROOT> 脱敏
$Stage = Split-Path -Parent $PSScriptRoot

# 候选根自适应：按顺序取第一个存在的路径
function Resolve-Root([string[]]$Candidates) {
  foreach ($c in $Candidates) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
  return @($Candidates)[0]
}

$RootCandidates = @()
if ($env:DSH_WORKSPACE) {
  $RootCandidates += ($env:DSH_WORKSPACE -split '[,;]' | ForEach-Object { $_.Trim() })
}
$RootCandidates += (Split-Path -Parent (Split-Path -Parent $Stage))
$RootCandidates = @($RootCandidates | ForEach-Object { if ($_) { $_.TrimEnd('\') } } |
                    Where-Object { $_ } | Select-Object -Unique)
$DsRoot = Resolve-Root $RootCandidates

$PluginsRoot = Resolve-Root @("$env:USERPROFILE\.dsh\local-plugins", "$env:USERPROFILE\.dsh\plugins")
$ReportsRoot = Resolve-Root @("$(Join-Path $DsRoot 'report')", "$(Join-Path $DsRoot 'reports')")
$ToolsRoot   = Resolve-Root @("$(Join-Path $DsRoot 'work')", "$(Join-Path $DsRoot 'tools')")

# 工作区根脱敏：每个根各出「反斜杠 / 正斜杠」两种写法；
# 形如 X:\dir 之外的根一律跳过（避免把空值/盘符根当模式误替换）
$RootRedactions = @()
foreach ($r in $RootCandidates) {
  if ($r -match '^[A-Za-z]:\\[^\\]') {
    $RootRedactions += @{ Pattern = [regex]::Escape($r);                     Repl = '<DSH_ROOT>' }
    $RootRedactions += @{ Pattern = [regex]::Escape(($r -replace '\\', '/')); Repl = '<DSH_ROOT>' }
  } else {
    Write-Warning "跳过不合法的工作区根（不用于 <DSH_ROOT> 脱敏）: $r"
  }
}

# 本地代理端口脱敏：
#   ① 从本机代理环境变量里取端口号（进程级 + 用户级都看——DSH 会话环境被净化，不继承）
#   ② 兜住「端口 1234 / port:1234」这类写死的写法
# 只针对本机真实端口取值，不去匹配 host:port 通用形式（否则会误伤
# 127.0.0.1:<DSH 自身默认端口> 这类公开默认值）
$ProxyPorts = @()
foreach ($n in @('HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','https_proxy','http_proxy','all_proxy')) {
  foreach ($scope in @('Process','User')) {
    $v = [Environment]::GetEnvironmentVariable($n, $scope)
    if ($v -match ':(\d{2,5})(?![\d])') { $ProxyPorts += $Matches[1] }
  }
}
$ProxyPorts = @($ProxyPorts | Sort-Object -Unique)

# 关键词写法：中文「端口」可带空格（如「默认端口 1234」）；
# 英文 port 必须有 : 或 = 作分隔，否则会误伤 `-LocalPort 3080` 这类公开默认端口
$PortRedactions = @(
  @{ Pattern = '(端口)\s*[:：=]?\s*\d{2,5}';        Repl = '$1 <PORT>' }
  @{ Pattern = '(?i)\bport\b\s*[:=]\s*\d{2,5}';    Repl = 'port: <PORT>' }
)
foreach ($port in $ProxyPorts) {
  $PortRedactions += @{ Pattern = "(?<![\d.])$port(?![\d])"; Repl = '<PORT>' }
}

# ---------- 净化规则：正则 → 替换文本 ----------
$Redactions = @(
  # 真实 API Key / Token 一律替换为占位符
  @{ Pattern = 'sk-[A-Za-z0-9]{16,}';                                  Repl = '<YOUR_API_KEY>' }
  @{ Pattern = 'gho_[A-Za-z0-9]{20,}';                                 Repl = '<YOUR_GITHUB_TOKEN>' }
  @{ Pattern = 'ghp_[A-Za-z0-9]{20,}';                                 Repl = '<YOUR_GITHUB_TOKEN>' }
  @{ Pattern = 'AKIA[0-9A-Z]{16}';                                     Repl = '<YOUR_AWS_KEY>' }
) + $RootRedactions + $PortRedactions + @(
  # 本机用户名 / 绝对路径脱敏（排在 <DSH_ROOT> 之后：否则 C:\Users\<用户>\...\DSH
  # 会先被替换成 <USERPROFILE>\...\DSH，看不出这是工作区根）
  # 说明：一律用环境变量动态取值，绝不在源码里硬编码真实用户名
  # （硬编码会让脱敏工具自身成为泄露源，且换机器即失效）
  @{ Pattern = [regex]::Escape($env:USERPROFILE);                      Repl = '<USERPROFILE>' }
  @{ Pattern = [regex]::Escape($env:USERNAME);                         Repl = '<USER>' }
  # 他人 / 其它机器的用户目录：正反斜杠都算（原来是只认反斜杠，正斜杠写法会漏）
  @{ Pattern = '[A-Za-z]:[\\/]Users[\\/][^\\/\s"'']+';                 Repl = '<USERPROFILE>' }
)

# ---------- 需要整体排除的文件名/路径特征 ----------
$DenyPatterns = @(
  'node_modules', '\\\.git\\', '__pycache__',
  '\.bak', '\.backup', '\\tmp\\', '\\logs?\\',
  '\.last-data\.json$', '\.log$', '\.tmp$',
  'pnpm-lock\.yaml', 'package-lock\.json',
  '\\dist\\', '\\build\\', '\.map$'
)

# ---------- 文本类扩展名（需要净化） ----------
$TextExt = @('.js','.mjs','.cjs','.ts','.json','.md','.txt','.ps1','.cmd','.bat',
             '.yml','.yaml','.html','.css','.svg','.py','.sh','.toml','.gitignore')

function Test-Denied([string]$rel) {
  foreach ($p in $DenyPatterns) { if ($rel -match $p) { return $true } }
  return $false
}

function Copy-Sanitized([string]$Src, [string]$DstRel) {
  if (-not (Test-Path -LiteralPath $Src)) { Write-Warning "缺少源文件: $Src"; return }
  if (Test-Denied $DstRel) { Write-Host "  [跳过-规则] $DstRel"; return }

  $dst = Join-Path $Stage $DstRel
  New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null

  $ext = [IO.Path]::GetExtension($Src).ToLower()
  if ($TextExt -contains $ext) {
    $content = Get-Content -LiteralPath $Src -Raw -Encoding UTF8
    $before  = $content
    foreach ($r in $Redactions) { $content = [regex]::Replace($content, $r.Pattern, $r.Repl) }
    # 统一换行，避免 CRLF/LF 混杂
    $content = $content -replace "`r`n", "`n"
    [IO.File]::WriteAllText($dst, $content, [Text.UTF8Encoding]::new($false))
    $flag = if ($before -ne $content) { ' [已脱敏]' } else { '' }
    Write-Host "  [复制]$flag $DstRel"
  } else {
    Copy-Item -LiteralPath $Src -Destination $dst -Force
    Write-Host "  [二进制复制] $DstRel"
  }
}

Write-Host "===== 1. 收集自建插件 =====" -ForegroundColor Cyan
# 入选的 4 个插件（dsh-qwen 按用户指示排除，官方已支持第三方模型）
$Chosen = @('dsh-billing','dsh-poetry','dsh-find','dsh-electron-env-sanitizer')
foreach ($p in $Chosen) {
  $src = Join-Path $PluginsRoot $p
  if (-not (Test-Path $src)) { Write-Warning "插件不存在: $p"; continue }
  Get-ChildItem -Recurse -File -LiteralPath $src | ForEach-Object {
    $rel = $_.FullName.Substring($src.Length).TrimStart('\')
    Copy-Sanitized $_.FullName "plugins\$p\$rel"
  }
}

Write-Host "`n===== 2. 收集部署包（install.ps1 / README） =====" -ForegroundColor Cyan
foreach ($d in @('dsh-billing-deploy','dsh-poetry-deploy')) {
  $src = Join-Path $DsRoot $d
  if (-not (Test-Path $src)) { continue }
  Get-ChildItem -Recurse -File -LiteralPath $src | ForEach-Object {
    $rel = $_.FullName.Substring($src.Length).TrimStart('\')
    Copy-Sanitized $_.FullName "deploy\$d\$rel"
  }
}

Write-Host "`n===== 3. 收集会话搜索工具 =====" -ForegroundColor Cyan
foreach ($f in @('dsh-search.mjs','dsh-search-window.js','dsh-session-search.js',
                 'DSH会话搜索-功能建议.md','verify-fts-chinese.mjs','verify-multilog.js')) {
  Copy-Sanitized (Join-Path $ToolsRoot $f) "tools\$f"
}
# asar 解析小工具
foreach ($f in @('parse-asar.js','list-files.js','extract.js')) {
  Copy-Sanitized (Join-Path $ToolsRoot "asar-search-extract\$f") "tools\asar\$f"
}

Write-Host "`n===== 4. 收集文档素材 =====" -ForegroundColor Cyan
# S = 候选源路径数组，取第一个存在的。
# 只对「同一份文档换个目录」的情况给候选；版本化的旧稿（如 upgrade\<版本>\...）不作候选，
# 避免用旧版覆盖归档。
$Docs = @(
  @{ S=@("$ReportsRoot\DSH-思维链中文配置记录.md");                  D='docs\DSH-思维链中文配置记录.md' }
  @{ S=@("$ReportsRoot\DSH思维链中文化-复用步骤.md");                D='docs\DSH思维链中文化-复用步骤.md' }
  @{ S=@("$ReportsRoot\DSH-启用run_code-PTC模式-操作手册.md");       D='docs\DSH-启用run_code-PTC模式-操作手册.md' }
  @{ S=@("$ReportsRoot\DSH-Computer-Use-安装与测评报告.md");         D='docs\DSH-Computer-Use-安装与测评报告.md' }
  @{ S=@("$ReportsRoot\subagent-codex-deepseek-windows-sandbox.md"); D='docs\DSH-Windows沙箱调研.md' }
  @{ S=@("$ReportsRoot\桌面版DSH部署与迁移总结-20260928.md");        D='docs\桌面版DSH部署与迁移总结.md' }
  @{ S=@("$ReportsRoot\Agent产物归类方法.md",
         "$env:USERPROFILE\_agents\Agent产物归类方法.md");           D='docs\Agent产物归类方法.md' }
  @{ S=@("$ReportsRoot\pwd-Is-bug.md");                              D='docs\pwd-Is-bug.md' }
  @{ S=@("$(Join-Path $DsRoot 'upgrade\DSH-快速升级手册.md')");      D='docs\DSH-快速升级手册.md' }
  @{ S=@("$ReportsRoot\dsh-security-architecture.svg");              D='docs\dsh-security-architecture.svg' }
)
foreach ($x in $Docs) {
  $src = $null
  foreach ($cand in $x.S) { if (Test-Path -LiteralPath $cand) { $src = $cand; break } }
  if (-not $src) { Write-Warning "缺少文档源: $($x.S -join ' | ')"; continue }
  Copy-Sanitized $src $x.D
}

Write-Host "`n===== 完成 =====" -ForegroundColor Green
