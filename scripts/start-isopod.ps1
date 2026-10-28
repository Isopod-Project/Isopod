# Starts Isopod with Docker Compose and opens the dashboard in the default browser once it responds.
# Usage (from the repository root): powershell -ExecutionPolicy Bypass -File scripts\start-isopod.ps1

param(
    [string]$ComposeFile = "isopod-compose.yml",
    [string]$DashboardUrl = "http://localhost:8000",
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

docker compose -f $ComposeFile up -d --build
if ($LASTEXITCODE -ne 0) {
    throw "docker compose failed with exit code $LASTEXITCODE"
}

Write-Host "Waiting for Isopod at $DashboardUrl ..."
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        Invoke-WebRequest -Uri $DashboardUrl -UseBasicParsing -TimeoutSec 5 | Out-Null
        $ready = $true
        break
    } catch [System.Net.WebException] {
        # Any HTTP response (even an error status) means the server is up; only connection failures keep waiting.
        if ($_.Exception.Response) { $ready = $true; break }
        Start-Sleep -Seconds 2
    } catch {
        Start-Sleep -Seconds 2
    }
}

if (-not $ready) {
    throw "Isopod did not respond at $DashboardUrl within $TimeoutSeconds seconds."
}

Start-Process $DashboardUrl
Write-Host "Opened $DashboardUrl"
