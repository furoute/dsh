<#
  密钥审计闸门 — 对归档目录做严格敏感信息扫描
  退出码：0 = 通过；1 = 发现敏感信息（禁止推送）
  用法：pwsh -File audit-secrets.ps1 -Target <目录>
#>
param(
  [string]$Target = 'D:\LLM\DSH\work\_dsh-archive'
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
  '本机用户名残留'              = 'Tian' + '_Tian'
  '其它用户目录绝对路径'        = '[A-Za-z]:\\Users\\(?!<USER>)[A-Za-z0-9_.\-]+'
}

$SkipDirs = @('node_modules','[\\/]\.git[\\/]','__pycache__')
$hits = @()

$files = Get-ChildItem -Recurse -File -LiteralPath $Target |
  Where-Object { $rel = $_.FullName; -not ($SkipDirs | Where-Object { $rel -match $_ }) }

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
