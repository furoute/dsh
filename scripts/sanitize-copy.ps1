<#
  脱敏归档复制脚本 — 白名单式收集 DSH 自建资产
  设计原则：
    1. 白名单复制（只收明确列出的文件），绝不整目录搬运
    2. 复制即净化：文本类文件按规则替换私有信息
    3. 排除一切依赖目录（node_modules）、备份残留、日志、缓存
  用法：pwsh -File sanitize-copy.ps1
#>

$ErrorActionPreference = 'Stop'
$Stage   = 'D:\LLM\DSH\work\_dsh-archive'
$Plugins = "$env:USERPROFILE\.dsh\local-plugins"
$DsRoot  = 'D:\LLM\DSH'

# ---------- 净化规则：正则 → 替换文本 ----------
$Redactions = @(
  # 真实 API Key / Token 一律替换为占位符
  @{ Pattern = 'sk-[A-Za-z0-9]{16,}';                                  Repl = '<YOUR_API_KEY>' }
  @{ Pattern = 'gho_[A-Za-z0-9]{20,}';                                 Repl = '<YOUR_GITHUB_TOKEN>' }
  @{ Pattern = 'ghp_[A-Za-z0-9]{20,}';                                 Repl = '<YOUR_GITHUB_TOKEN>' }
  @{ Pattern = 'AKIA[0-9A-Z]{16}';                                     Repl = '<YOUR_AWS_KEY>' }
  # 本机用户名 / 绝对路径脱敏
  @{ Pattern = [regex]::Escape($env:USERPROFILE);                      Repl = '<USERPROFILE>' }
  @{ Pattern = [regex]::Escape($env:USERNAME);                         Repl = '<USER>' }
  @{ Pattern = 'Tian' + '_Tian';                                        Repl = '<USER>' }
  # 常见 iCloud / OneDrive 个人目录
  @{ Pattern = '[A-Za-z]:\\Users\\[^\\\s"'']+';                        Repl = '<USERPROFILE>' }
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
  $src = Join-Path $Plugins $p
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
$work = Join-Path $DsRoot 'work'
foreach ($f in @('dsh-search.mjs','dsh-search-window.js','dsh-session-search.js',
                 'DSH会话搜索-功能建议.md','verify-fts-chinese.mjs','verify-multilog.js')) {
  Copy-Sanitized (Join-Path $work $f) "tools\$f"
}
# asar 解析小工具
foreach ($f in @('parse-asar.js','list-files.js','extract.js')) {
  Copy-Sanitized (Join-Path $work "asar-search-extract\$f") "tools\asar\$f"
}

Write-Host "`n===== 4. 收集文档素材 =====" -ForegroundColor Cyan
$Docs = @(
  @{ S='report\DSH-思维链中文配置记录.md';                        D='docs\DSH-思维链中文配置记录.md' }
  @{ S='report\DSH思维链中文化-复用步骤.md';                      D='docs\DSH思维链中文化-复用步骤.md' }
  @{ S='report\DSH-启用run_code-PTC模式-操作手册.md';             D='docs\DSH-启用run_code-PTC模式-操作手册.md' }
  @{ S='report\DSH-Computer-Use-安装与测评报告.md';               D='docs\DSH-Computer-Use-安装与测评报告.md' }
  @{ S='report\subagent-codex-deepseek-windows-sandbox.md';       D='docs\DSH-Windows沙箱调研.md' }
  @{ S='report\桌面版DSH部署与迁移总结-20260928.md';              D='docs\桌面版DSH部署与迁移总结.md' }
  @{ S='report\Agent产物归类方法.md';                             D='docs\Agent产物归类方法.md' }
  @{ S='report\pwd-Is-bug.md';                                    D='docs\pwd-Is-bug.md' }
  @{ S='upgrade\DSH-快速升级手册.md';                             D='docs\DSH-快速升级手册.md' }
  @{ S='report\dsh-security-architecture.svg';                    D='docs\dsh-security-architecture.svg' }
)
foreach ($x in $Docs) { Copy-Sanitized (Join-Path $DsRoot $x.S) $x.D }

Write-Host "`n===== 完成 =====" -ForegroundColor Green
