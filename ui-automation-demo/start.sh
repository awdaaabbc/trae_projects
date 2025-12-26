#!/bin/bash

# 确保脚本抛出遇到的错误
set -e

echo "========================================"
echo "   UI Automation Demo - 启动脚本"
echo "========================================"

# 1. 检查 node_modules
echo "正在检查依赖..."
if [ ! -d "node_modules" ]; then
    echo "检测到 node_modules 缺失，正在安装依赖..."
    npm install
else
    echo "依赖已安装."
fi

# 2. 检查 .env
if [ ! -f ".env" ]; then
    echo "警告: 未找到 .env 配置文件，请参照示例配置"
fi

# 3. 启动服务
echo "正在启动服务 (Backend + Frontend)..."
echo "后端端口: 3002, 前端端口: 5173"
echo "请稍候..."

echo "正在构建后端..."
npx tsc -p tsconfig.server.json

# 使用 concurrently 同时启动后端和前端
# server: tsc --watch 编译后端到 dist/server，然后 nodemon 运行编译产物
# dev: 启动 vite 开发服务器
npx concurrently -n "TSC,SERVER,CLIENT" -c "yellow,blue,green" \
  "npx tsc -p tsconfig.server.json --watch" \
  "npx nodemon --config .nodemon.json" \
  "npm run dev"
