#!/bin/bash
set -e

echo "----------------------------------------------------"
echo "🚀 Isopod Development Mode Starting..."
echo "----------------------------------------------------"

# 1. Sync Python Dependencies
echo "📦 Checking Python dependencies..."
if [ -f "backend/requirements.txt" ]; then
    # Using default cache location which is mapped to a volume
    pip install -r backend/requirements.txt
fi

# 2. Build Frontend (if source exists)
if [ -d "frontend" ]; then
    echo "🏗️ Checking Frontend..."
    cd frontend
    
    # Only install if node_modules is missing
    if [ ! -d "node_modules" ]; then
        echo "📥 Installing Node modules (first time only)..."
        npm install
    fi
    
    echo "🔨 Building frontend (Dev Mode)..."
    VITE_DEV_BUILD=true npm run build
    cd ..
fi

# 3. Start Backend with Auto-Reload
echo "🔥 Starting FastAPI backend with reload enabled..."
echo "----------------------------------------------------"

# Note: We use --reload-dir to focus only on backend changes
exec uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir backend
