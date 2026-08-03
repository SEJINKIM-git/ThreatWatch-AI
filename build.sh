#!/usr/bin/env bash
#
# Lambda 배포 패키지 생성
# 대상: python3.12 / arm64
#
# boto3는 Lambda 런타임에 이미 포함되어 있으므로 번들하지 않습니다.
# gspread/google-auth도 제외합니다 (Lambda 경로에서는 사용하지 않음).

set -euo pipefail

BUILD_DIR="build"
ZIP_FILE="lambda-package.zip"

rm -rf "$BUILD_DIR" "$ZIP_FILE"
mkdir -p "$BUILD_DIR"

echo "==> 의존성 설치 (manylinux aarch64)"
pip install \
  --target "$BUILD_DIR" \
  --platform manylinux2014_aarch64 \
  --python-version 3.12 \
  --implementation cp \
  --only-binary=:all: \
  --quiet \
  anthropic pydantic python-dotenv

echo "==> 애플리케이션 코드 복사"
cp lambda_handler.py config.py models.py scenarios.py "$BUILD_DIR/"
mkdir -p "$BUILD_DIR/data" && cp data/demo-scenarios.json "$BUILD_DIR/data/"
mkdir -p "$BUILD_DIR/modules"
cp modules/*.py "$BUILD_DIR/modules/"

echo "==> 불필요한 파일 정리"
find "$BUILD_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$BUILD_DIR" -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
find "$BUILD_DIR" -type d -name "*.dist-info" -exec rm -rf {} + 2>/dev/null || true

echo "==> 압축"
(cd "$BUILD_DIR" && zip -qr "../$ZIP_FILE" .)

echo "==> 완료: $ZIP_FILE ($(du -h "$ZIP_FILE" | cut -f1))"
