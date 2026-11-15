# ============================================================
#  心动镜 · 本机连接助手（Bridge）
#  作用：让网页能读到这台电脑上的聊天记录来源
#  特点：零安装、只监听 127.0.0.1、不上传任何数据
# ============================================================
#Requires -Version 5.1
[CmdletBinding()]
param(
  [int]$Port = 17321,
  [switch]$Check
)

$ErrorActionPreference = 'Continue'
$Version = '1.1.0'
$UserHome = $env:USERPROFILE
$Inbox = Join-Path $UserHome 'Documents\心动镜导入'
$Script:StartedAt = (Get-Date)
$Script:ReqCount = 0

$TextExt = @('.txt', '.json', '.csv', '.log', '.md')
$ScanRoots = @(
  @{ path = $Inbox;                                  depth = 3 },
  @{ path = (Join-Path $UserHome 'Downloads');       depth = 1 },
  @{ path = (Join-Path $UserHome 'Desktop');         depth = 1 },
  @{ path = (Join-Path $UserHome 'Documents');       depth = 1 }
)

# ---------- 初始化 ----------
if (-not (Test-Path -LiteralPath $Inbox)) {
  try { New-Item -ItemType Directory -Path $Inbox -Force | Out-Null } catch { }
}

function Write-Log($msg, $color = 'Gray') {
  $t = (Get-Date).ToString('HH:mm:ss')
  Write-Host ("  [" + $t + "] " + $msg) -ForegroundColor $color
}

# ---------- 文本文件判定 ----------
function Read-TextHead([string]$file, [int]$maxBytes = 400000) {
  try {
    $fs = [System.IO.File]::Open($file, 'Open', 'Read', 'ReadWrite')
    $len = [Math]::Min($fs.Length, $maxBytes)
    $buf = New-Object byte[] $len
    [void]$fs.Read($buf, 0, $len)
    $fs.Close()
    $txt = [System.Text.Encoding]::UTF8.GetString($buf)
    # 出现替换字符说明可能不是 UTF-8，回退到 GB18030（QQ 导出的常见编码）
    if ($txt.Contains([char]0xFFFD)) {
      try {
        $gb = [System.Text.Encoding]::GetEncoding('GB18030')
        $txt = $gb.GetString($buf)
      } catch { }
    }
    return $txt
  } catch {
    return ''
  }
}

function Get-Platform([string]$txt) {
  if ($txt -match '\[(\d{1,2})/(\d{1,2})/(\d{2,4}),\s*\d{1,2}:\d{2}:\d{2}\s*(AM|PM|am|pm)\]') { return 'whatsapp' }
  if ($txt -match '\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?\]') { return 'dingtalk' }
  if ($txt -match '\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}') { return 'wechat' }
  if ($txt -match '(?m)^\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s') { return 'qq' }
  if ($txt -match '\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2}') { return 'qq' }
  return 'unknown'
}

function Get-TsPattern([string]$platform) {
  switch ($platform) {
    'wechat'   { return '\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}' }
    'dingtalk' { return '\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?\]' }
    'whatsapp' { return '\[\d{1,2}/\d{1,2}/\d{2,4},\s*\d{1,2}:\d{2}:\d{2}' }
    default    { return '(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?)|(\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})' }
  }
}

function Get-DisplayName([System.IO.FileInfo]$f) {
  $n = $f.BaseName
  $n = $n -replace '(的)?(微信|wechat|QQ|qq|钉钉|dingtalk)?\s*聊天记录', ''
  $n = $n -replace '(聊天|对话|记录|导出)', ''
  $n = $n -replace '[（(]\s*\d+\s*[)）]', ''
  $n = $n -replace '^[\d\-_\.\s]+', ''
  $n = $n.Trim(' ', '-', '_', '.', '·')
  if ([string]::IsNullOrWhiteSpace($n)) { $n = $f.BaseName }
  if ($n.Length -gt 24) { $n = $n.Substring(0, 24) }
  return $n
}

function Get-ChatFiles {
  $items = @()
  $seenPath = @{}
  foreach ($root in $ScanRoots) {
    $rp = $root.path
    if (-not (Test-Path -LiteralPath $rp)) { continue }
    $files = @()
    try {
      $files = Get-ChildItem -LiteralPath $rp -File -ErrorAction SilentlyContinue
      if ($root.depth -gt 1) {
        $files += Get-ChildItem -LiteralPath $rp -File -Recurse -Depth ($root.depth - 1) -ErrorAction SilentlyContinue
      }
    } catch { }
    foreach ($f in $files) {
      if ($null -eq $f) { continue }
      if ($TextExt -notcontains $f.Extension.ToLower()) { continue }
      if ($f.Length -lt 120 -or $f.Length -gt 12MB) { continue }
      if ($seenPath.ContainsKey($f.FullName)) { continue }
      $seenPath[$f.FullName] = 1

      $txt = Read-TextHead $f.FullName
      if ([string]::IsNullOrWhiteSpace($txt)) { continue }
      $plat = Get-Platform $txt
      if ($plat -eq 'unknown') { continue }

      $pat = Get-TsPattern $plat
      $cnt = ([regex]::Matches($txt, $pat)).Count
      if ($cnt -lt 3) { continue }

      $items += [pscustomobject]@{
        id       = $f.FullName
        app      = 'files'
        name     = (Get-DisplayName $f)
        platform = $plat
        source   = if ($f.DirectoryName -eq $Inbox) { '投递箱' } else { '本机文件' }
        count    = $cnt
        size     = $f.Length
        modified = $f.LastWriteTime.ToString('o')
        mtime    = [int64]($f.LastWriteTime.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds
        path     = $f.FullName
        folder   = $f.DirectoryName
      }
    }
  }

  # 同名只保留最新的一份
  $byName = @{}
  foreach ($it in ($items | Sort-Object mtime -Descending)) {
    $k = $it.name
    if (-not $byName.ContainsKey($k)) { $byName[$k] = $it }
  }
  return @($byName.Values | Sort-Object mtime -Descending)
}

# ---------- App 检测 ----------
function Get-RunningNames {
  try {
    return @(Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessName.ToLower() })
  } catch { return @() }
}

function Test-DbState([string]$dir) {
  $cands = @(
    (Join-Path $dir 'Msg\MicroMsg.db'),
    (Join-Path $dir 'Msg\Multi\MSG0.db'),
    (Join-Path $dir 'Msg3.0.db'),
    (Join-Path $dir 'db_storage\message\message_0.db')
  )
  foreach ($c in $cands) {
    if (Test-Path -LiteralPath $c) {
      try {
        $fs = [System.IO.File]::Open($c, 'Open', 'Read', 'ReadWrite')
        $b = New-Object byte[] 16
        [void]$fs.Read($b, 0, 16)
        $fs.Close()
        $sig = [System.Text.Encoding]::ASCII.GetString($b, 0, 15)
        if ($sig -eq 'SQLite format 3') { return 'plain' } else { return 'encrypted' }
      } catch { return 'locked' }
    }
  }
  return 'none'
}

function Get-AppList($running) {
  $specs = @(
    @{
      key = 'wechat'; label = '微信'; color = '#07c160'
      procs = @('wechat', 'weixin')
      dataDirs = @((Join-Path $UserHome 'Documents\WeChat Files'), (Join-Path $UserHome 'Documents\xwechat_files'))
      installs = @("$env:ProgramFiles\Tencent\WeChat", "${env:ProgramFiles(x86)}\Tencent\WeChat", "$env:ProgramFiles\Tencent\Weixin", "${env:ProgramFiles(x86)}\Tencent\Weixin")
      hint = '微信电脑版的聊天数据库是加密的（SQLCipher），任何程序都不能直接读。把聊天记录导出成 txt 放进投递箱，或让助手读取你已导出的文件。'
    },
    @{
      key = 'qq'; label = 'QQ'; color = '#12b7f5'
      procs = @('qq', 'qqnt')
      dataDirs = @((Join-Path $UserHome 'Documents\Tencent Files'), (Join-Path $UserHome 'Documents\Tencent\QQ'), (Join-Path $UserHome 'AppData\Roaming\Tencent\QQ'))
      installs = @("$env:ProgramFiles\Tencent\QQNT", "${env:ProgramFiles(x86)}\Tencent\QQ")
      hint = 'QQ 的消息库同样加密。用 QQ 的「消息管理器」导出成 txt/mht，放进投递箱即可。'
    },
    @{
      key = 'dingtalk'; label = '钉钉'; color = '#3f7dff'
      procs = @('dingtalk')
      dataDirs = @((Join-Path $UserHome 'AppData\Roaming\DingTalk'), (Join-Path $UserHome 'Documents\DingTalk'))
      installs = @("$env:ProgramFiles\DingDing", "${env:ProgramFiles(x86)}\DingDing", "$env:ProgramFiles\DingTalk", "${env:ProgramFiles(x86)}\DingTalk")
      hint = '钉钉没有开放本地消息读取。可以在钉钉里选中消息复制粘贴，或使用「导出聊天记录」后放进投递箱。'
    }
  )

  $out = @()
  foreach ($sp in $specs) {
    $installed = $false
    foreach ($p in $sp.installs) { if ($p -and (Test-Path -LiteralPath $p)) { $installed = $true; break } }
    $dataDir = $null
    foreach ($d in $sp.dataDirs) { if ($d -and (Test-Path -LiteralPath $d)) { $dataDir = $d; break } }
    if ($dataDir) { $installed = $true }
    $isRunning = $false
    foreach ($p in $sp.procs) { if ($running -contains $p) { $isRunning = $true; break } }

    $dbState = 'none'
    if ($dataDir) {
      # 微信/QQ 的用户目录一般是一层 wxid/uins，往下找一层
      $dbState = Test-DbState $dataDir
      if ($dbState -eq 'none') {
        try {
          $subs = Get-ChildItem -LiteralPath $dataDir -Directory -ErrorAction SilentlyContinue |
            Sort-Object @{ Expression = { if ($_.Name -match '^(wxid_|u_|[0-9]+$|nt_qq)') { 0 } else { 1 } } }, Name |
            Select-Object -First 10
          foreach ($s in $subs) {
            $st = Test-DbState $s.FullName
            if ($st -ne 'none') { $dbState = $st; break }
          }
        } catch { }
      }
    }

    $out += [pscustomobject]@{
      key       = $sp.key
      label     = $sp.label
      color     = $sp.color
      installed = $installed
      running   = $isRunning
      dataDir   = $dataDir
      dbState   = $dbState
      readable  = ($dbState -eq 'plain')
      hint      = $sp.hint
    }
  }
  return $out
}

# ---------- 响应 ----------
function Send-Body($stream, [string]$body, [string]$ctype = 'application/json; charset=utf-8', [int]$code = 200) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append("HTTP/1.1 $code OK`r`n")
  [void]$sb.Append("Content-Type: $ctype`r`n")
  [void]$sb.Append("Content-Length: $($bytes.Length)`r`n")
  [void]$sb.Append("Access-Control-Allow-Origin: *`r`n")
  [void]$sb.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS`r`n")
  [void]$sb.Append("Access-Control-Allow-Headers: *`r`n")
  [void]$sb.Append("Access-Control-Allow-Private-Network: true`r`n")
  [void]$sb.Append("Access-Control-Max-Age: 600`r`n")
  [void]$sb.Append("Cache-Control: no-store`r`n")
  [void]$sb.Append("Connection: close`r`n`r`n")
  $head = [System.Text.Encoding]::UTF8.GetBytes($sb.ToString())
  $stream.Write($head, 0, $head.Length)
  if ($bytes.Length -gt 0) { $stream.Write($bytes, 0, $bytes.Length) }
  $stream.Flush()
}

function Send-Json($stream, $obj) {
  $json = $obj | ConvertTo-Json -Depth 8 -Compress
  if ($null -eq $json) { $json = '{}' }
  Send-Body $stream $json
}

function Get-Query([string]$target) {
  $q = @{}
  $i = $target.IndexOf('?')
  if ($i -lt 0) { return $q }
  $qs = $target.Substring($i + 1)
  foreach ($kv in ($qs -split '&')) {
    if ([string]::IsNullOrWhiteSpace($kv)) { continue }
    $parts = $kv -split '=', 2
    $k = [System.Uri]::UnescapeDataString($parts[0])
    $v = ''
    if ($parts.Count -gt 1) { $v = [System.Uri]::UnescapeDataString($parts[1].Replace('+', ' ')) }
    $q[$k] = $v
  }
  return $q
}

function Test-AllowedPath([string]$p) {
  if ([string]::IsNullOrWhiteSpace($p)) { return $false }
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { return $false }
  $ext = [System.IO.Path]::GetExtension($p).ToLower()
  if ($TextExt -notcontains $ext) { return $false }
  $full = [System.IO.Path]::GetFullPath($p).ToLower()
  foreach ($r in $ScanRoots) {
    $rf = [System.IO.Path]::GetFullPath($r.path).ToLower()
    if ($full.StartsWith($rf)) { return $true }
  }
  return $false
}

# ---------- 主循环 ----------
if ($Check) {
  $running = Get-RunningNames
  $apps = Get-AppList $running
  $chats = Get-ChatFiles
  Write-Host ('apps=' + $apps.Count + ' chats=' + $chats.Count + ' inbox=' + $Inbox) -ForegroundColor Green
  exit 0
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try {
  $listener.Start()
} catch {
  Write-Host ''
  Write-Host ('  端口 ' + $Port + ' 被占用了，可能助手已经在运行。') -ForegroundColor Yellow
  Write-Host ('  你可以直接用：http://127.0.0.1:' + $Port + '/api/hello') -ForegroundColor Yellow
  Write-Host ''
  Read-Host '  按回车退出'
  exit 1
}

Clear-Host
Write-Host ''
Write-Host '  ┌───────────────────────────────────────────────┐' -ForegroundColor Magenta
Write-Host '  │        心动镜 · 本机连接助手 已就绪           │' -ForegroundColor Magenta
Write-Host '  └───────────────────────────────────────────────┘' -ForegroundColor Magenta
Write-Host ''
Write-Host ('   监听地址  http://127.0.0.1:' + $Port) -ForegroundColor Cyan
Write-Host ('   投递箱    ' + $Inbox) -ForegroundColor Cyan
Write-Host ''
Write-Host '   现在回到浏览器里的「直连本机」页面，会自动连上。' -ForegroundColor Gray
Write-Host '   关掉这个窗口 = 断开连接。数据不会离开这台电脑。' -ForegroundColor DarkGray
Write-Host ''

$runningCache = @()
$runningAt = [datetime]::MinValue
$chatCache = @()
$chatAt = [datetime]::MinValue

$loop = $true
while ($loop) {
  $client = $null
  try {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $stream.ReadTimeout = 4000
    $sr = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $false, 4096, $true)
    $reqLine = $sr.ReadLine()
    if ([string]::IsNullOrWhiteSpace($reqLine)) { $client.Close(); continue }
    while ($true) {
      $h = $sr.ReadLine()
      if ($null -eq $h -or $h -eq '') { break }
    }

    $seg = $reqLine.Split(' ')
    $method = $seg[0]
    $target = '/'
    if ($seg.Length -gt 1) { $target = $seg[1] }
    $pathOnly = $target
    $qi = $target.IndexOf('?')
    if ($qi -ge 0) { $pathOnly = $target.Substring(0, $qi) }
    $pathOnly = $pathOnly.TrimEnd('/')
    if ([string]::IsNullOrWhiteSpace($pathOnly)) { $pathOnly = '/' }

    if ($method -eq 'OPTIONS') {
      Send-Body $stream '' 'text/plain' 204
      $client.Close(); continue
    }

    $Script:ReqCount = $Script:ReqCount + 1

    switch ($pathOnly) {
      '/api/hello' {
        $obj = [ordered]@{
          ok        = $true
          version   = $Version
          host      = $env:COMPUTERNAME
          user      = $env:USERNAME
          os        = [System.Environment]::OSVersion.VersionString
          inbox     = $Inbox
          startedAt = $Script:StartedAt.ToString('o')
          uptime    = [int]((Get-Date) - $Script:StartedAt).TotalSeconds
          requests  = $Script:ReqCount
        }
        Send-Json $stream $obj
      }
      '/api/apps' {
        if (((Get-Date) - $runningAt).TotalSeconds -gt 4) {
          $runningCache = Get-RunningNames
          $runningAt = Get-Date
        }
        Send-Json $stream ([ordered]@{ apps = @(Get-AppList $runningCache); at = (Get-Date).ToString('o') })
      }
      '/api/contacts' {
        if (((Get-Date) - $chatAt).TotalSeconds -gt 8) {
          $chatCache = Get-ChatFiles
          $chatAt = Get-Date
        }
        $q = Get-Query $target
        $list = $chatCache
        if ($q.ContainsKey('app') -and $q['app'] -ne 'files' -and $q['app'] -ne '') {
          $list = @()
        }
        Send-Json $stream ([ordered]@{
            contacts  = @($list)
            inbox     = $Inbox
            scannedAt = (Get-Date).ToString('o')
            inboxOnly = $false
          })
      }
      '/api/messages' {
        $q = Get-Query $target
        $id = ''
        if ($q.ContainsKey('id')) { $id = $q['id'] }
        if (-not (Test-AllowedPath $id)) {
          Send-Body $stream '{"ok":false,"error":"文件不存在或不在允许的目录内"}' 'application/json; charset=utf-8' 404
        } else {
          $txt = ''
          try { $txt = [System.IO.File]::ReadAllText($id, [System.Text.Encoding]::UTF8) } catch {
            try { $txt = [System.IO.File]::ReadAllText($id, [System.Text.Encoding]::GetEncoding('GB18030')) } catch { }
          }
          $fi = Get-Item -LiteralPath $id
          Send-Json $stream ([ordered]@{
              ok       = $true
              text     = $txt
              name     = (Get-DisplayName $fi)
              path     = $id
              size     = $fi.Length
              modified = $fi.LastWriteTime.ToString('o')
            })
        }
      }
      '/api/open-inbox' {
        try { Start-Process explorer.exe -ArgumentList ('"' + $Inbox + '"') } catch { }
        Send-Json $stream ([ordered]@{ ok = $true; inbox = $Inbox })
      }
      '/api/shutdown' {
        Send-Json $stream ([ordered]@{ ok = $true })
        $loop = $false
      }
      '/' {
        Send-Body $stream 'CrushLens Bridge OK' 'text/plain; charset=utf-8' 200
      }
      default {
        Send-Body $stream '{"ok":false,"error":"not found"}' 'application/json; charset=utf-8' 404
      }
    }
  } catch {
    # 单个请求出错不影响整体服务
  } finally {
    if ($null -ne $client) {
      try { $client.Close() } catch { }
    }
  }
}

try { $listener.Stop() } catch { }
Write-Host ''
Write-Host '  助手已停止。' -ForegroundColor Yellow
Start-Sleep -Milliseconds 400
