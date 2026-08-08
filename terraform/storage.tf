# =============================================================
# S3 - 감사 로그 및 Athena 쿼리 결과
# =============================================================

resource "aws_s3_bucket" "audit" {
  bucket = local.audit_bucket
}

resource "aws_s3_bucket_public_access_block" "audit" {
  bucket = aws_s3_bucket.audit.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id

  # Athena 쿼리 결과는 재생성 가능하므로 30일 후 삭제합니다.
  rule {
    id     = "expire-athena-results"
    status = "Enabled"

    filter {
      prefix = "athena-results/"
    }

    expiration {
      days = 30
    }
  }

  # 감사 로그는 보존하되, 조회 빈도가 낮아지는 시점에 저렴한 클래스로 옮깁니다.
  rule {
    id     = "tier-audit-logs"
    status = "Enabled"

    filter {
      prefix = "cases/"
    }

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }
  }
}

# =============================================================
# DynamoDB - 케이스 상태 저장소
# =============================================================

resource "aws_dynamodb_table" "cases" {
  name         = "${local.prefix}-cases"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "alert_id"

  # alert_id를 파티션 키로 두면 조건부 쓰기로 멱등성을 보장할 수 있습니다.
  # SQS는 at-least-once 전달이므로 중복 메시지가 들어올 수 있고,
  # attribute_not_exists(alert_id) 조건이 두 번째 쓰기를 막습니다.
  attribute {
    name = "alert_id"
    type = "S"
  }

  attribute {
    name = "risk_level"
    type = "S"
  }

  # timestamp는 DynamoDB 예약어라 표현식에서 우회가 필요합니다.
  # 처음부터 created_at으로 두어 그 문제를 피합니다.
  attribute {
    name = "created_at"
    type = "S"
  }

  # "P1 케이스를 최신순으로" 같은 조회는 파티션 키만으로는 불가능합니다.
  global_secondary_index {
    name            = "risk-level-index"
    hash_key        = "risk_level"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }
}
