#!/bin/bash
set -e
COMMIT_MSG="auto sync $(date '+%Y-%m-%d %H:%M:%S')"

echo "=== 森林一目录同步GitHub ==="
git add -A
if git diff --quiet --exit-code --cached;then
    echo "✅无变更，无需提交"
    exit 0
fi
git commit -m "$COMMIT_MSG"
git push -f origin master
echo "🎉同步完成"
