#!/usr/bin/env bash
# 디페그 엔진(risk_score.py)을 실시간 분석 함수(api/depeg-live.py)용으로 복사한다.
# 엔진 코드를 다시 쓰지 않고 그대로 복사해, 리플레이와 실시간 화면이 같은 공식을 쓰게 한다.
# 사용: scripts/sync_depeg_engine.sh ../depeg-early-warning
set -euo pipefail
REPO="${1:?depeg-early-warning 경로를 넘겨주세요}"
COMMIT="$(git -C "$REPO" rev-parse --short HEAD)"
OUT="api/_depeg/risk_score.py"
{
  echo "# AUTO-COPIED from depeg-early-warning/src/engine/risk_score.py @${COMMIT}"
  echo "# 직접 고치지 말 것 — 엔진 저장소에서 고친 뒤 scripts/sync_depeg_engine.sh 로 다시 복사"
  cat "$REPO/src/engine/risk_score.py"
} > "$OUT"
echo "synced engine @${COMMIT} -> ${OUT}"
