# Launch the installed Minerva Coach with WebView2 remote debugging enabled.
#
# After launch, open Chrome or Edge to http://localhost:9230 and click "inspect"
# next to a window to attach DevTools. Verbose Chromium logs are written to
# %USERPROFILE%\webview2.log for diagnosing browser-process crashes.
#
# Env-var changes are scoped to this PowerShell session only.

$ErrorActionPreference = 'Stop'

$exe = 'C:\Program Files\Minerva Coach\minerva-desktop.exe'
$logFile = Join-Path $env:USERPROFILE 'webview2.log'
$port = 9230

if (-not (Test-Path $exe)) {
    throw "Minerva not found at $exe"
}

if (Get-Process minerva-desktop -ErrorAction SilentlyContinue) {
    throw 'Minerva is already running. Quit it first (tray icon -> Quit) before launching with debug.'
}

if (Test-Path $logFile) {
    Remove-Item $logFile -Force
}

$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port --remote-allow-origins=* --enable-logging --v=1 --log-file=$logFile"

Write-Host "Launching Minerva with WebView2 debug..."
Write-Host "  DevTools : http://localhost:$port"
Write-Host "  Log file : $logFile"
Write-Host ''

& $exe
