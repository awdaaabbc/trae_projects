# 同步远端，避免 push 被拒
git pull --rebase

# 暂存所有改动（包含 data/）
git add -A

# 可选：确认暂存了哪些文件
git status

# 没有可提交内容就退出；有就提交+推送
if git diff --cached --quiet; then
  echo "Nothing to commit."
else
  git commit -m "新增前端切换安卓或web的功能"
  git push
fi

# 最终确认
git status
git log -1 --oneline