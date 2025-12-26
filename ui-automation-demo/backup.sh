#!/bin/bash

# 项目备份脚本
# 功能：将当前项目目录打包备份到 backups/ 目录
# 排除：node_modules, midscene_run, dist, .git

BACKUP_DIR="backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ZIP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.zip"

# 创建备份目录
mkdir -p "$BACKUP_DIR"

echo "========================================"
echo "   正在创建项目备份..."
echo "========================================"
echo "目标文件: $ZIP_FILE"

# 执行压缩
# -r: 递归
# -q: 安静模式
# -x: 排除模式
zip -r "$ZIP_FILE" . \
    -x "node_modules/*" \
    -x "midscene_run/*" \
    -x "dist/*" \
    -x ".git/*" \
    -x "backups/*" \
    -x ".DS_Store"

if [ $? -eq 0 ]; then
    echo "✅ 备份成功！"
    echo "文件大小: $(du -h "$ZIP_FILE" | cut -f1)"
else
    echo "❌ 备份失败！"
    exit 1
fi
