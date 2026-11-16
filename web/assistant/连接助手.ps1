# ============================================================
#  心动镜 · 本机连接助手（Bridge）v2
#  作用：让网页能读到这台电脑上的聊天记录来源
#  安全模型：随机 Token 鉴权 + 精确 Origin 白名单 + 配对码
#           只监听 127.0.0.1，默认只扫投递箱，不上传任何数据
# ============================================================
#Requires -Version 5.1
[CmdletBinding()]
param(
  [int]$Port = 17321,
  [switch]$Check,
  # 只跑路径边界回归测试（不监听端口），用于排查"扫描根目录被同名前缀目录穿透"的问题
  [switch]$SelfTest,
  # 显式开启后才会额外扫描 下载 / 桌面 / 文档（默认只扫投递箱）
  [switch]$ScanUserFolders,
  # 额外允许的网页来源，例如 -AllowOrigin "https://example.com"
  [string[]]$AllowOrigin = @()
)

$ErrorActionPreference = 'Continue'
$Version = '2.0.0'
$UserHome = $env:USERPROFILE
$Inbox = Join-Path $UserHome 'Documents\心动镜导入'
$Script:StartedAt = (Get-Date)
$Script:ReqCount = 0

$TextExt = @('.txt', '.json', '.csv', '.log', '.md')

# ---------- 随机凭据 ----------
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$tb = New-Object byte[] 24
$rng.GetBytes($tb)
$Script:Token = -join ($tb | ForEach-Object { $_.ToString('x2') })
$cb = New-Object byte[] 4
$rng.GetBytes($cb)
$Script:PairCode = ([BitConverter]::ToUInt32($cb, 0) % 1000000).ToString('000000')

# ---------- 允许的网页来源 ----------
$Script:Origins = @('https://crushlens.app.workbuddy.host')
foreach ($o in $AllowOrigin) {
  if (-not [string]::IsNullOrWhiteSpace($o)) { $Script:Origins += $o.Trim().TrimEnd('/').ToLower() }
}

function Test-OriginAllowed([string]$origin) {
  if ([string]::IsNullOrWhiteSpace($origin)) { return $false }
  $o = $origin.Trim().TrimEnd('/').ToLower()
  # 本机开发源（localhost / 127.0.0.1 任意端口）
  if ($o -match '^https?://(localhost|127\.0\.0\.1)(:\d+)?$') { return $true }
  foreach ($a in $Script:Origins) { if ($o -eq $a) { return $true } }
  return $false
}

# ---------- 扫描范围（默认只扫投递箱） ----------
$ScanRoots = @(
  @{ path = $Inbox; depth = 3; label = '投递箱' }
)
if ($ScanUserFolders) {
  $ScanRoots += @{ path = (Join-Path $UserHome 'Downloads'); depth = 1; label = '本机文件' }
  $ScanRoots += @{ path = (Join-Path $UserHome 'Desktop');   depth = 1; label = '本机文件' }
  $ScanRoots += @{ path = (Join-Path $UserHome 'Documents'); depth = 1; label = '本机文件' }
}

$Script:IdMap = @{}

# ---------- 初始化 ----------
if (-not (Test-Path -LiteralPath $Inbox)) {
  try { New-Item -ItemType Directory -Path $Inbox -Force | Out-Null } catch { }
}

function Write-Log($msg, $color = 'Gray') {
  $t = (Get-Date).ToString('HH:mm:ss')
  Write-Host ("  [" + $t + "] " + $msg) -ForegroundColor $color
}

function Get-FileId([string]$path) {
  $sha = [System.Security.Cryptography.SHA1]::Create()
  $h = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($path.ToLower()))
  return (-join ($h | ForEach-Object { $_.ToString('x2') })).Substring(0, 20)
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

      # 对外只暴露不可逆 id，不返回任何本机绝对路径
      $fid = Get-FileId $f.FullName
      $Script:IdMap[$fid] = $f.FullName

      $items += [pscustomobject]@{
        id       = $fid
        app      = 'files'
        name     = (Get-DisplayName $f)
        platform = $plat
        source   = $root.label
        count    = $cnt
        size     = $f.Length
        modified = $f.LastWriteTime.ToString('o')
        mtime    = [int64]($f.LastWriteTime.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds
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
$StatusText = @{
  200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 401 = 'Unauthorized'
  403 = 'Forbidden'; 404 = 'Not Found'; 405 = 'Method Not Allowed'; 429 = 'Too Many Requests'
}

function Get-CorsLine([string]$origin) {
  if (-not (Test-OriginAllowed $origin)) { return @() }
  return @(
    "Access-Control-Allow-Origin: $origin",
    'Vary: Origin',
    'Access-Control-Allow-Methods: GET, POST, OPTIONS',
    'Access-Control-Allow-Headers: Content-Type, X-Bridge-Token',
    'Access-Control-Allow-Private-Network: true',
    'Access-Control-Max-Age: 600'
  )
}

function Send-Body($stream, [string]$body, [string]$ctype = 'application/json; charset=utf-8', [int]$code = 200, [string]$origin = '') {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $phrase = $StatusText[$code]
  if (-not $phrase) { $phrase = 'OK' }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append("HTTP/1.1 $code $phrase`r`n")
  [void]$sb.Append("Content-Type: $ctype`r`n")
  [void]$sb.Append("Content-Length: $($bytes.Length)`r`n")
  foreach ($line in (Get-CorsLine $origin)) { [void]$sb.Append("$line`r`n") }
  [void]$sb.Append("Cache-Control: no-store`r`n")
  [void]$sb.Append("X-Content-Type-Options: nosniff`r`n")
  [void]$sb.Append("Connection: close`r`n`r`n")
  $head = [System.Text.Encoding]::UTF8.GetBytes($sb.ToString())
  $stream.Write($head, 0, $head.Length)
  if ($bytes.Length -gt 0) { $stream.Write($bytes, 0, $bytes.Length) }
  $stream.Flush()
}

function Send-Json($stream, $obj, [int]$code = 200, [string]$origin = '') {
  $json = $obj | ConvertTo-Json -Depth 8 -Compress
  if ($null -eq $json) { $json = '{}' }
  Send-Body $stream $json 'application/json; charset=utf-8' $code $origin
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
  $sep = [System.IO.Path]::DirectorySeparatorChar
  foreach ($r in $ScanRoots) {
    $rf = [System.IO.Path]::GetFullPath($r.path).ToLower()
    # 必须补目录分隔符边界，否则 C:\Users\x\DownloadsEvil\a.txt 会命中 Downloads 根
    if ($full -eq $rf -or $full.StartsWith($rf + $sep)) { return $true }
  }
  return $false
}

function Resolve-ChatId([string]$id) {
  if ([string]::IsNullOrWhiteSpace($id)) { return $null }
  if (-not $Script:IdMap.ContainsKey($id)) { return $null }
  $p = $Script:IdMap[$id]
  if (-not (Test-AllowedPath $p)) { return $null }
  return $p
}

# ---------- 路径边界自测 ----------
if ($SelfTest) {
  $base = Join-Path $env:TEMP ('clst_' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  $evil = $base + 'Evil'
  New-Item -ItemType Directory -Path $base -Force | Out-Null
  New-Item -ItemType Directory -Path $evil -Force | Out-Null
  $pIn = Join-Path $base 'ok.txt'
  $pOut = Join-Path $evil 'bad.txt'
  $pExt = Join-Path $base 'bad.exe'
  foreach ($f in @($pIn, $pOut, $pExt)) {
    Set-Content -LiteralPath $f -Value 'x' -Encoding UTF8
  }
  $savedRoots = $ScanRoots
  $ScanRoots = @(@{ path = $base; depth = 1; label = 'selftest' })
  $cases = @(
    @{ name = '根目录内的文本文件应放行'; got = (Test-AllowedPath $pIn);  want = $true },
    @{ name = '同名前缀的邻目录应拒绝';   got = (Test-AllowedPath $pOut); want = $false },
    @{ name = '非文本扩展名应拒绝';       got = (Test-AllowedPath $pExt); want = $false },
    @{ name = '不存在的文件应拒绝';       got = (Test-AllowedPath (Join-Path $base 'none.txt')); want = $false }
  )
  # Origin 白名单：任意第三方页面必须被拒
  $ocases = @(
    @{ name = '白名单来源应放行';           got = (Test-OriginAllowed 'https://crushlens.app.workbuddy.host'); want = $true },
    @{ name = '本机开发来源应放行';         got = (Test-OriginAllowed 'http://localhost:5500');                want = $true },
    @{ name = '任意第三方来源应拒绝';       got = (Test-OriginAllowed 'https://evil.example.com');             want = $false },
    @{ name = '伪装同名的来源应拒绝';       got = (Test-OriginAllowed 'https://crushlens.app.workbuddy.host.evil.io'); want = $false },
    @{ name = '缺少 Origin 的请求应拒绝';   got = (Test-OriginAllowed '');                                     want = $false }
  )
  $ScanRoots = $savedRoots
  $fail = 0
  foreach ($c in ($cases + $ocases)) {
    if ($c.got -eq $c.want) {
      Write-Host ('  [PASS] ' + $c.name) -ForegroundColor Green
    } else {
      $fail++
      Write-Host ('  [FAIL] ' + $c.name + ' (期望 ' + $c.want + '，实际 ' + $c.got + ')') -ForegroundColor Red
    }
  }
  Remove-Item -LiteralPath $base, $evil -Recurse -Force -ErrorAction SilentlyContinue
  if ($fail -eq 0) {
    Write-Host '  selftest=ok' -ForegroundColor Green
    exit 0
  }
  Write-Host ('  selftest=fail (' + $fail + ')') -ForegroundColor Red
  exit 1
}

# ---------- 自检 ----------
if ($Check) {
  $running = Get-RunningNames
  $apps = Get-AppList $running
  $chats = Get-ChatFiles
  Write-Host ('apps=' + $apps.Count + ' chats=' + $chats.Count + ' inbox=' + $Inbox) -ForegroundColor Green
  Write-Host ('scanRoots=' + ($ScanRoots | ForEach-Object { $_.path }) -join '; ')
  Write-Host ('origins=' + ($Script:Origins -join ','))
  Write-Host ('paircode=' + $Script:PairCode)
  exit 0
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try {
  $listener.Start()
} catch {
  Write-Host ''
  Write-Host ('  端口 ' + $Port + ' 被占用了，可能助手已经在运行。') -ForegroundColor Yellow
  Write-Host '  请关掉之前的助手窗口，再重新双击启动。' -ForegroundColor Yellow
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
Write-Host ('   配对码    ' + $Script:PairCode) -ForegroundColor Yellow
Write-Host '             ↑ 回到网页「直连本机」，把这 6 位数字填进去' -ForegroundColor DarkGray
Write-Host ''
Write-Host ('   监听地址  http://127.0.0.1:' + $Port) -ForegroundColor Cyan
Write-Host ('   投递箱    ' + $Inbox) -ForegroundColor Cyan
if ($ScanUserFolders) {
  Write-Host '   扫描范围  投递箱 + 下载 / 桌面 / 文档（已显式开启）' -ForegroundColor DarkYellow
} else {
  Write-Host '   扫描范围  仅投递箱（想额外扫桌面/下载，加 -ScanUserFolders 启动）' -ForegroundColor DarkGray
}
Write-Host ''
Write-Host '   配对码只在本次运行有效；关掉窗口即清空，下次启动会换新的。' -ForegroundColor Gray
Write-Host '   数据不会离开这台电脑。' -ForegroundColor DarkGray
Write-Host ''

$runningCache = @()
$runningAt = [datetime]::MinValue
$chatCache = @()
$chatAt = [datetime]::MinValue
$pairFails = 0
$pairLockUntil = [datetime]::MinValue

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

    $headers = @{}
    while ($true) {
      $h = $sr.ReadLine()
      if ($null -eq $h -or $h -eq '') { break }
      $ci = $h.IndexOf(':')
      if ($ci -gt 0) {
        $hk = $h.Substring(0, $ci).Trim().ToLower()
        $hv = $h.Substring($ci + 1).Trim()
        $headers[$hk] = $hv
      }
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

    $origin = ''
    if ($headers.ContainsKey('origin')) { $origin = $headers['origin'] }
    $originOk = Test-OriginAllowed $origin

    # 预检
    if ($method -eq 'OPTIONS') {
      if ($originOk) { Send-Body $stream '' 'text/plain' 204 $origin }
      else { Send-Body $stream '{"ok":false,"error":"origin not allowed"}' 'application/json; charset=utf-8' 403 '' }
      $client.Close(); continue
    }

    # 带 Origin 但不是白名单来源 → 直接拒绝（浏览器侧攻击的主要入口）
    if (-not [string]::IsNullOrWhiteSpace($origin) -and -not $originOk) {
      Send-Json $stream ([ordered]@{ ok = $false; error = '来源未授权' }) 403 ''
      $client.Close(); continue
    }

    $Script:ReqCount = $Script:ReqCount + 1

    $needToken = $true
    if ($pathOnly -eq '/api/ping' -or $pathOnly -eq '/api/pair') { $needToken = $false }

    if ($needToken -and $pathOnly.StartsWith('/api/')) {
      $tk = ''
      if ($headers.ContainsKey('x-bridge-token')) { $tk = $headers['x-bridge-token'] }
      if ($tk -ne $Script:Token) {
        Send-Json $stream ([ordered]@{ ok = $false; error = 'unauthorized' }) 401 $origin
        $client.Close(); continue
      }
    }

    switch ($pathOnly) {
      '/api/ping' {
        Send-Json $stream ([ordered]@{ ok = $true; version = $Version; pair = $true }) 200 $origin
      }
      '/api/pair' {
        if ($method -ne 'POST') {
          Send-Json $stream ([ordered]@{ ok = $false; error = 'method not allowed' }) 405 $origin
        } elseif ((Get-Date) -lt $pairLockUntil) {
          Send-Json $stream ([ordered]@{ ok = $false; error = '尝试过于频繁，请稍后再试' }) 429 $origin
        } else {
          $q = Get-Query $target
          $code = ''
          if ($q.ContainsKey('code')) { $code = $q['code'] }
          if ($code -eq $Script:PairCode) {
            $pairFails = 0
            Write-Log '网页配对成功' 'Green'
            Send-Json $stream ([ordered]@{ ok = $true; token = $Script:Token }) 200 $origin
          } else {
            $pairFails = $pairFails + 1
            if ($pairFails -ge 5) {
              $pairLockUntil = (Get-Date).AddMinutes(1)
              $pairFails = 0
              Write-Log '配对码连续输错，锁定 1 分钟' 'Yellow'
            }
            Send-Json $stream ([ordered]@{ ok = $false; error = '配对码不对' }) 403 $origin
          }
        }
      }
      '/api/hello' {
        if ($method -ne 'GET') {
          Send-Json $stream ([ordered]@{ ok = $false; error = 'method not allowed' }) 405 $origin
        } else {
          $obj = [ordered]@{
            ok          = $true
            version     = $Version
            host        = $env:COMPUTERNAME
            user        = $env:USERNAME
            os          = [System.Environment]::OSVersion.VersionString
            inbox       = $Inbox
            scanScope   = if ($ScanUserFolders) { 'inbox+userfolders' } else { 'inbox' }
            startedAt   = $Script:StartedAt.ToString('o')
            uptime      = [int]((Get-Date) - $Script:StartedAt).TotalSeconds
            requests    = $Script:ReqCount
          }
          Send-Json $stream $obj 200 $origin
        }
      }
      '/api/apps' {
        if ($method -ne 'GET') {
          Send-Json $stream ([ordered]@{ ok = $false; error = 'method not allowed' }) 405 $origin
        } else {
          if (((Get-Date) - $runningAt).TotalSeconds -gt 4) {
            $runningCache = Get-RunningNames
            $runningAt = Get-Date
          }
          Send-Json $stream ([ordered]@{ apps = @(Get-AppList $runningCache); at = (Get-Date).ToString('o') }) 200 $origin
        }
      }
      '/api/contacts' {
        if ($method -ne 'GET') {
          Send-Json $stream ([ordered]@{ ok = $false; error = 'method not allowed' }) 405 $origin
        } else {
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
              inboxOnly = (-not $ScanUserFolders)
            }) 200 $origin
        }
      }
      '/api/messages' {
        if ($method -ne 'GET') {
          Send-Json $stream ([ordered]@{ ok = $false; error = 'method not allowed' }) 405 $origin
        } else {
          $q = Get-Query $target
          $id = ''
          if ($q.ContainsKey('id')) { $id = $q['id'] }
          $file = Resolve-ChatId $id
          if ($null -eq $file) {
            Send-Json $stream ([ordered]@{ ok = $false; error = '文件不存在或不在允许的目录内' }) 404 $origin
          } else {
            $txt = ''
            try { $txt = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8) } catch {
              try { $txt = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::GetEncoding('GB18030')) } catch { }
            }
            $fi = Get-Item -LiteralPath $file
            Send-Json $stream ([ordered]@{
                ok       = $true
                text     = $txt
                name     = (Get-DisplayName $fi)
                size     = $fi.Length
                modified = $fi.LastWriteTime.ToString('o')
              }) 200 $origin
          }
        }
      }
      '/api/open-inbox' {
        if ($method -ne 'POST') {
          Send-Json $stream ([ordered]@{ ok = $false; error = 'method not allowed' }) 405 $origin
        } else {
          try { Start-Process explorer.exe -ArgumentList ('"' + $Inbox + '"') } catch { }
          Send-Json $stream ([ordered]@{ ok = $true; inbox = $Inbox }) 200 $origin
        }
      }
      '/api/shutdown' {
        if ($method -ne 'POST') {
          Send-Json $stream ([ordered]@{ ok = $false; error = 'method not allowed' }) 405 $origin
        } else {
          Send-Json $stream ([ordered]@{ ok = $true }) 200 $origin
          $loop = $false
        }
      }
      '/' {
        Send-Body $stream 'CrushLens Bridge OK' 'text/plain; charset=utf-8' 200 $origin
      }
      default {
        Send-Json $stream ([ordered]@{ ok = $false; error = 'not found' }) 404 $origin
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
