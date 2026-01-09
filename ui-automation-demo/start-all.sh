#!/bin/bash

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to log messages
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 1. Environment Check
log_info "Checking environment..."
if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed. Please install Node.js first."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    log_error "npm is not installed. Please install npm first."
    exit 1
fi

# 2. Dependency Check
if [ ! -d "node_modules" ]; then
    log_warn "node_modules not found. Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        log_error "Failed to install dependencies."
        exit 1
    fi
    log_info "Dependencies installed successfully."
else
    log_info "node_modules found. Skipping installation."
fi

# 3. Port Handling (3002 for Backend, 5173 for Frontend)
check_and_kill_port() {
    local port=$1
    local pid=$(lsof -t -i:$port)
    if [ -n "$pid" ]; then
        log_warn "Port $port is in use (PID: $pid). Attempting to free it..."
        kill -9 $pid
        if [ $? -eq 0 ]; then
            log_info "Successfully freed port $port."
        else
            log_error "Failed to free port $port. Please manually kill PID $pid."
            exit 1
        fi
    else
        log_info "Port $port is free."
    fi
}

check_and_kill_port 3002
check_and_kill_port 5173

# 4. Start Services
log_info "Starting Frontend and Backend services..."
log_info "Logs will be streamed below. Press Ctrl+C to stop."

# Use npm run dev which uses concurrently
npm run dev
