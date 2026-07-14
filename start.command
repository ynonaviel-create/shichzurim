#!/bin/bash
# הפעלת האתר מקומית. לחיצה כפולה על הקובץ הזה פותחת את הארכיון בדפדפן.
cd "$(dirname "$0")" || exit 1

PORT=8765

# אם כבר רץ שרת על הפורט הזה, פשוט פותחים את הדפדפן
if lsof -i ":$PORT" >/dev/null 2>&1; then
  open "http://localhost:$PORT"
  exit 0
fi

echo ""
echo "  🧬  ארכיון השחזורים רץ עכשיו"
echo "      http://localhost:$PORT"
echo ""
echo "  להפסקה: סגור את החלון הזה (או Ctrl+C)"
echo ""

sleep 1 && open "http://localhost:$PORT" &
python3 -m http.server "$PORT" --bind 127.0.0.1
