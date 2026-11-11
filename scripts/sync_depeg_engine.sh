#!/usr/bin/env bash
# 디페그 엔진(risk_score.py)을 실시간 분석 함수(api/depeg-live.py)용으로 복사한다.
# 엔진 코드를 다시 쓰지 않고 그대로 복사해, 리플레이와 실시간 화면이 같은 공식을 쓰게 한다.
# 사용: scripts/sync_depeg_engine.sh ../depeg-early-warning
set -euo pipefail
REPO="${1:?depeg-early-warning 경로를 넘겨주세요}"
# main 브랜치의 커밋된 엔진만 복사한다 (작업 중인 브랜치나 저장 안 한 변경이 섞이지 않게)
BRANCH="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ] && [ "${ALLOW_NON_MAIN:-0}" != "1" ]; then
  echo "엔진 저장소가 main이 아닙니다 ($BRANCH). main으로 바꾸거나 ALLOW_NON_MAIN=1 을 주세요." >&2; exit 1
fi
if ! git -C "$REPO" diff --quiet HEAD -- src/engine/risk_score.py; then
  echo "src/engine/risk_score.py 에 커밋되지 않은 변경이 있습니다." >&2; exit 1
fi
COMMIT="$(git -C "$REPO" rev-parse --short HEAD)"
OUT="api/_depeg/risk_score.py"
{
  echo "# AUTO-COPIED from depeg-early-warning/src/engine/risk_score.py @${COMMIT}"
  echo "# 직접 고치지 말 것 — 엔진 저장소에서 고친 뒤 scripts/sync_depeg_engine.sh 로 다시 복사"
  git -C "$REPO" show HEAD:src/engine/risk_score.py
} > "$OUT"
echo "synced engine @${COMMIT} -> ${OUT}"
