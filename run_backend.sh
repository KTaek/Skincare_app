#!/usr/bin/env bash
# SkinScan 백엔드 실행 스크립트
#   1) FastAPI(server.py) 를 uvicorn 으로 8000 포트에 띄우고
#   2) cloudflared 빠른 터널로 공개 URL(*.trycloudflare.com) 을 발급받은 뒤
#   3) 그 URL 을 앱의 API_BASE(src/screens/ScanLoadingScreen.js) 에 자동 반영한다.
#
# 사용법:  bash run_backend.sh
# 종료:    Ctrl+C  (uvicorn·cloudflared 모두 정리됨)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PORT=8000
# cloudflared 바이너리 경로: 환경변수 > PATH > 프로젝트 루트에 내려받아 둔 것 순으로 탐색
CF="${CLOUDFLARED:-cloudflared}"
command -v "$CF" >/dev/null 2>&1 || { [ -x /home/work/MINJI/cloudflared ] && CF=/home/work/MINJI/cloudflared; }
APP_FILE="$HERE/src/screens/ScanLoadingScreen.js"
LOG_DIR="$(mktemp -d)"

command -v "$CF" >/dev/null 2>&1 || {
  echo "❌ cloudflared 가 없습니다. CLOUDFLARED=/경로/cloudflared 로 지정하거나 설치하세요."; exit 1; }

cleanup() { echo; echo "🧹 종료 중..."; kill "${UVICORN_PID:-}" "${CF_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "🚀 (1/3) FastAPI 서버 기동 (port $PORT)..."
( cd "$HERE" && python3 -m uvicorn server:app --host 0.0.0.0 --port "$PORT" ) > "$LOG_DIR/uvicorn.log" 2>&1 &
UVICORN_PID=$!

# 서버가 응답할 때까지 대기(모델 로딩 포함, 최대 ~120초)
for i in $(seq 1 60); do
  if curl -sf "http://localhost:$PORT/" >/dev/null 2>&1; then echo "   ✅ 서버 준비 완료"; break; fi
  sleep 2
  if [ "$i" = 60 ]; then echo "   ❌ 서버 기동 실패. 로그:"; cat "$LOG_DIR/uvicorn.log"; exit 1; fi
done

echo "🌐 (2/3) cloudflared 터널 여는 중..."
"$CF" tunnel --url "http://localhost:$PORT" --no-autoupdate > "$LOG_DIR/cf.log" 2>&1 &
CF_PID=$!

URL=""
for i in $(seq 1 30); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/cf.log" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 2
done
[ -n "$URL" ] || { echo "   ❌ 터널 URL 발급 실패. 로그:"; cat "$LOG_DIR/cf.log"; exit 1; }
echo "   ✅ 공개 URL: $URL"

echo "✏️  (3/3) 앱 API_BASE 갱신: $APP_FILE"
python3 - "$APP_FILE" "$URL" <<'PY'
import re, sys
path, url = sys.argv[1], sys.argv[2]
src = open(path, encoding='utf-8').read()
new = re.sub(r"const API_BASE = '[^']*';", f"const API_BASE = '{url}';", src, count=1)
open(path, 'w', encoding='utf-8').write(new)
print("   ✅ API_BASE =", url)
PY

echo
echo "🎉 백엔드 준비 완료!  다른 터미널에서 앱을 실행하세요:"
echo "   cd \"$HERE\" && npx expo start --tunnel"
echo "   (앱을 이미 켜뒀다면 Expo Go 에서 흔들어 Reload 하면 새 주소가 반영됩니다)"
echo
echo "이 창은 켜 둔 채로 유지하세요. Ctrl+C 로 서버·터널을 종료합니다."
wait
