param(
    [switch]$SelfTest
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$buildDir = Join-Path $root "build"
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

$frameworkDir = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319"
$csc = Join-Path $frameworkDir "csc.exe"
if (-not (Test-Path $csc)) {
    $frameworkDir = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319"
    $csc = Join-Path $frameworkDir "csc.exe"
}
if (-not (Test-Path $csc)) {
    throw ".NET Framework 4.x C# compiler was not found. Install .NET Framework 4.8 first."
}

$refs = @(
    "System.dll",
    "System.Core.dll",
    "System.Drawing.dll",
    "System.Windows.Forms.dll",
    "System.Web.Extensions.dll",
    "System.Security.dll",
    "System.Net.Http.dll"
) | ForEach-Object { "/reference:" + (Join-Path $frameworkDir $_) }

$sources = Get-ChildItem (Join-Path $root "src") -Filter "*.cs" | ForEach-Object { $_.FullName }
$exe = Join-Path $buildDir "CrushLens.exe"

$args = @(
    "/nologo",
    "/target:winexe",
    "/platform:anycpu",
    "/optimize+",
    "/codepage:65001",
    ("/win32icon:" + (Join-Path $root "assets\app.ico")),
    ("/win32manifest:" + (Join-Path $root "app.manifest")),
    ("/out:" + $exe)
) + $refs + $sources

& $csc @args
if ($LASTEXITCODE -ne 0) { throw "Compilation failed." }

$hash = (Get-FileHash $exe -Algorithm SHA256).Hash
Write-Host ("Built: " + $exe)
Write-Host ("SHA256: " + $hash)

if ($SelfTest) {
    & $exe "--selftest"
    Start-Sleep -Milliseconds 800
    $log = Join-Path $root "build\CrushLens_Data\selftest.log"
    if (Test-Path $log) { Get-Content $log -Encoding UTF8 }
    else { Write-Host "Self-test log not found." }
}
