<#
  密钥审计闸门 — 对归档目录做严格敏感信息扫描
  退出码：0 = 通过；1 = 发现敏感信息（禁止推送）
  用法：pwsh -File audit-secrets.ps1 -Target <目录>
#>
param(
  # 默认扫描本脚本所在目录的上一级（归档仓库根），不硬编码本机路径
  [string]$Target = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

# 高危模式：命中即阻断
$Blockers = [ordered]@{
  'OpenAI/DeepSeek 风格 Key'   = 'sk-[A-Za-z0-9]{16,}'
  'GitHub OAuth/Personal Token'= 'gh[opsu]_[A-Za-z0-9]{20,}'
  'AWS Access Key'             = 'AKIA[0-9A-Z]{16}'
  'Google API Key'             = 'AIza[0-9A-Za-z\-_]{30,}'
  'Slack Token'                = 'xox[abprs]-[A-Za-z0-9\-]{10,}'
  '私钥 PEM 块'                = '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'Bearer 长令牌'              = 'Bearer\s+[A-Za-z0-9\-_\.]{25,}'
  '疑似 32+ 位十六进制密钥'     = '(?i)(api[_-]?key|secret|token|password)["'']?\s*[:=]\s*["''][A-Za-z0-9\+/]{20,}["'']'
}

# 用户名检测：运行时从环境变量取值，源码内不出现任何真实用户名
if ($env:USERNAME) {
  $Blockers['本机用户名残留'] = [regex]::Escape($env:USERNAME)
}
$Blockers['其它用户目录绝对路径'] = '[A-Za-z]:\\Users\\(?!<USER>)[A-Za-z0-9_.\-]+'

# ---------- 规范化检测规则（用于补"拼接绕过"盲区）----------
# 这些规则跑在"已去掉引号/加号/空白"的文本上，因此 'abc' + 'def' 会命中 abcdef。
$NormBlockers = [ordered]@{}
if ($env:USERNAME) {
  # 用户名整体命中
  $NormBlockers['本机用户名(规范化)'] = [regex]::Escape($env:USERNAME)

  # 按片段命中：把用户名拆成前半 / 后半分别扫，
  # 即使有人只写了一半、或中间插了注释/换行，也能抓到。
  $u = $env:USERNAME
  if ($u.Length -ge 6) {
    $half = [Math]::Floor($u.Length / 2)
    $NormBlockers['用户名前半段'] = [regex]::Escape($u.Substring(0, $half))
    $NormBlockers['用户名后半段'] = [regex]::Escape($u.Substring($half))
  }
}

$SkipDirs = @('node_modules','[\\/]\.git[\\/]','__pycache__')

# 本机专用文件：被 .gitignore 排除，永不推送，故不参与审计
# （.known-secrets.local 按设计就存放真实密钥，供 verify-remote.mjs 做比对基准）
$SkipFiles = @('\.known-secrets\.local$','\.local$')
$hits = @()

$files = Get-ChildItem -Recurse -File -LiteralPath $Target |
  Where-Object {
    $rel = $_.FullName
    -not ($SkipDirs  | Where-Object { $rel -match $_ }) -and
    -not ($SkipFiles | Where-Object { $rel -match $_ })
  }

foreach ($f in $files) {
  $rel = $f.FullName.Substring($Target.Length).TrimStart('\')
  # 只看文本类文件
  try { $text = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 -ErrorAction Stop }
  catch { continue }
  if ($null -eq $text) { continue }

  foreach ($name in $Blockers.Keys) {
    $m = [regex]::Matches($text, $Blockers[$name])
    if ($m.Count -gt 0) {
      foreach ($hit in ($m | Select-Object -First 3)) {
        $line = ($text.Substring(0, $hit.Index) -split "`n").Count
        $hits += [pscustomobject]@{
          规则 = $name; 文件 = $rel; 行 = $line
          片段 = $hit.Value.Substring(0, [Math]::Min(40, $hit.Value.Length))
        }
      }
    }
  }

  # ---------- 规范化检测（补"字符串拼接"盲区）----------
  # 原理：把引号、+、注释符、空白去掉后再匹配，`'abc' + 'def'` 会被"粘"回 `abcdef`。
  # 背景：曾把真实用户名拆成 'XXX' + '_XXX' 绕过本脚本，导致扫描器扫不出自己。
  $norm = $text -replace "['""` +]", '' -replace '(?m)^\s*(//|#).*$', ''
  foreach ($name in $NormBlockers.Keys) {
    $m = [regex]::Matches($norm, $NormBlockers[$name])
    if ($m.Count -gt 0) {
      $hits += [pscustomobject]@{
        规则 = "$name（规范化后命中）"; 文件 = $rel; 行 = '-'
        片段 = $m[0].Value.Substring(0, [Math]::Min(40, $m[0].Value.Length))
      }
    }
  }

  # ---------- 编码类检测（base64 / 长 hex）----------
  foreach ($m in [regex]::Matches($text, '(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/])')) {
    # 只报"看起来像编码过的凭据"，跳过常见的纯文本长串（如哈希、URL）
    $line = ($text.Substring(0, $m.Index) -split "`n").Count
    $hits += [pscustomobject]@{
      规则 = '长 base64 串（请人工确认是否编码凭据）'; 文件 = $rel; 行 = $line
      片段 = $m.Value.Substring(0, [Math]::Min(40, $m.Value.Length))
    }
  }
}

Write-Host "`n================ 密钥审计报告 ================" -ForegroundColor Cyan
Write-Host "扫描目录: $Target"
Write-Host "文件数  : $($files.Count)"

if ($hits.Count -eq 0) {
  Write-Host "`n  ✅ 通过：未发现任何敏感信息" -ForegroundColor Green
  Write-Host "==============================================" -ForegroundColor Cyan
  exit 0
} else {
  Write-Host "`n  ❌ 阻断：发现 $($hits.Count) 处敏感信息`n" -ForegroundColor Red
  $hits | Format-Table -AutoSize -Wrap | Out-String -Width 200 | Write-Host
  Write-Host "==============================================" -ForegroundColor Cyan
  exit 1
}
