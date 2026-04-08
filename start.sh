#!/bin/bash

# ==============================================================================
# Isopod Start Script
# This script automates the setup and startup of the Isopod application
# by ensuring the persistent data directory exists before running Docker Compose.
# ==============================================================================

# Define the directory name for persistent server data
DATA_DIR="servers"

echo "============================================================="
echo "🚀 Isopod Setup and Startup Script"
echo "============================================================="

# 1. Check for and create the necessary persistent data directory
if [ ! -d "$DATA_DIR" ]; then
    echo "✅ Detected missing persistent data directory: '$DATA_DIR'."
    echo "   Creating directory now..."
    mkdir -p "$DATA_DIR"
    if [ $? -ne 0 ]; then
        echo "❌ ERROR: Failed to create the '$DATA_DIR' directory. Check your permissions."
        echo "Please run this script with appropriate permissions or ensure you can write to this location."
        exit 1
    fi
else
    echo "✅ Persistent data directory '$DATA_DIR' found. No action needed."
fi

# 2. Start the application using Docker Compose
echo ""
echo "============================================================="
echo "🚀 Starting Isopod services via Docker Compose..."
echo "   This may take a few minutes on the first run as images are pulled."
echo "============================================================="

# Run docker compose up in detached mode (-d)
# This command assumes 'docker-compose' or 'docker compose' is in the system PATH.
docker compose up -d

# 3. Final status check
if [ $? -eq 0 ]; then
    echo ""
    echo "============================================================="
    echo "🎉 Success!"
    echo "Isopod services have been started successfully."
    echo "You can access the dashboard at: http://localhost:8000"
    echo "============================================================="
else
    echo ""
    echo "============================================================="
    echo "🚨 FAILURE!"
    echo "Docker Compose failed to start services. Please check the error messages above."
    echo "Ensure Docker Desktop is running and you have network connectivity."
    echo "============================================================="
fi
