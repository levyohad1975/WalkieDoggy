$ErrorActionPreference = "Continue"

$env:NODE_OPTIONS="--use-system-ca"
$env:EXPO_UNSTABLE_TUNNEL_V2="1"

while ($true) {
    Write-Host ""
    Write-Host "Starting Expo Tunnel v2..." -ForegroundColor Cyan
    Write-Host "Press Ctrl+C to stop permanently." -ForegroundColor DarkGray

    npx expo start --tunnel

    $exitCode = $LASTEXITCODE

    Write-Host ""
    Write-Host "Expo stopped with exit code $exitCode." -ForegroundColor Yellow
    Write-Host "Restarting in 5 seconds..." -ForegroundColor Yellow

    Start-Sleep -Seconds 5
}
