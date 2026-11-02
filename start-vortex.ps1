<#
  Vortex Android Recorder - start from PowerShell.
    .\start-vortex.ps1 -Out C:\Projects\my-mobilewright-project\tests -Pkg com.yourname.tradehub
    .\start-vortex.ps1 -Mock          # try it without a phone
    .\start-vortex.ps1 -Doctor        # only run the setup check
#>
param(
  [string]$Out = "",
  [string]$Pkg = "",
  [int]$Port = 0,
  [switch]$Mock,
  [switch]$Doctor
)
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js was not found. Install Node.js 24 LTS from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS), then open a new PowerShell." -ForegroundColor Red
  exit 1
}
$v = (node -p "process.versions.node").Trim()
$parts = $v.Split(".") | ForEach-Object { [int]$_ }
if ($parts[0] -lt 22 -or ($parts[0] -eq 22 -and $parts[1] -lt 18)) {
  Write-Host "Note: Node.js $v is older than 22.18. MobileWright runs, reports and benchmarks need 22.18 or newer." -ForegroundColor Yellow
}
$doctorArgs = @("src/doctor.js")
if ($Out) { $doctorArgs += @("--out", $Out) }
& node @doctorArgs
if ($Doctor) { exit 0 }
$serverArgs = @("src/server.js")
if ($Out) { $serverArgs += @("--out", $Out) }
if ($Pkg) { $serverArgs += @("--pkg", $Pkg) }
if ($Port -gt 0) { $serverArgs += @("--port", "$Port") }
if ($Mock) { $serverArgs += "--mock" }
Write-Host ""
Write-Host "Starting Vortex Android Recorder. Press Ctrl+C to stop." -ForegroundColor Cyan
& node @serverArgs
