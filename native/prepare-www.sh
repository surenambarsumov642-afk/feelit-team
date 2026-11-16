#!/usr/bin/env bash
# Собирает www/ для нативного приложения из ../calories (без тестов, заметок и service worker).
set -euo pipefail
cd "$(dirname "$0")"
rm -rf www && mkdir -p www
cp -R ../calories/. www/
rm -rf www/tests www/sw.js
find www -name '*.md' -delete
echo "www готов: $(du -sh www | cut -f1)"
