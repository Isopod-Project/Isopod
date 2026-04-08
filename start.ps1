# start.ps1
# Isopod Start Script for Windows (PowerShell)
# This script automates the setup and startup of the Isopod application
# by ensuring the persistent data directory exists before running Docker Compose.

# Define the directory name for persistent server data
$DATA_DIR = "servers"

Write-Host "========================================="
Write-Host "🚀 Isopod Setup and Startup Script (Windows)"
Write-Host "==============================================="

# 1. Check for and create the necessary persistent data directory
if (-not (Test-Path -Path $DATA_DIR -PathType Container)) {
    Write-Host "✅ Detected missing persistent data directory: '$DATA_DIR'."
    Write-Host "   Creating directory now..."
    try {
        New-Item -Path $DATA_DIR -ItemType Directory -Force | Out-Null
        Write-Host "✅ Directory '$DATA_DIR' created successfully."
    } catch {
        Write-Host "❌ ERROR: Failed to create the '$DATA_DIR' directory. $($_.Exception.Message)"
        Write-Host "Please run this script with appropriate permissions or ensure you can write to this location."
        exit 1
    }
} else {
    Write-Host "✅ Persistent data directory '$DATA_DIR' found. No action needed."
}

# 2. Start the application using Docker Compose
Write-Host ""
Write-Host "============================================================="
Write-Host "🚀 Starting Isopod services via Docker Compose..."
Write-Host "   This may take a few minutes on the first run as images are pulled."
Write-Host "====================================================================="

# Run docker compose up in detached mode (-d)
# This assumes 'docker compose' is available in the system PATH.
docker compose up -d

# 3. Final status check
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "============================================================="
    Write-Host "🎉 Success!"
    Write-Host "Isopod services have been started successfully."
    Write-Host "You can access the dashboard at: http://localhost:8000"
    Write-Host "============================================================="
} else {
    Write-Host ""
    Write-Host "============================================================="
    Write-Host "🚨 FAILURE!"
    Write-Host "Docker Compose failed to start services. Please check the error messages above."
    Write-Host "Ensure Docker Desktop is running and you have network connectivity."
    Write-Host "=============================================================="
}
