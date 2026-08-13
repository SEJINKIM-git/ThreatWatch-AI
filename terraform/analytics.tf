# =============================================================
# Glue - S3 감사 로그에 스키마 부여
#
# s3_logger.py가 cases/dt=YYYY-MM-DD/ 형태로 쓰기 때문에
# 크롤러가 dt를 파티션 키로 인식합니다.
# 파티션이 있으면 WHERE dt = '...' 조건에서 해당 폴더만 스캔합니다.
# Athena는 스캔한 바이트로 과금하므로 이것이 비용과 직결됩니다.
# =============================================================

resource "aws_glue_catalog_database" "main" {
  name        = var.project_name
  description = "ThreatWatch AI audit data"
}

resource "aws_glue_crawler" "cases" {
  name          = "${local.prefix}-cases-crawler"
  role          = aws_iam_role.glue.arn
  database_name = aws_glue_catalog_database.main.name

  s3_target {
    path = "s3://${aws_s3_bucket.audit.id}/cases/"
  }

  schema_change_policy {
    update_behavior = "UPDATE_IN_DATABASE"

    # 원본 데이터가 사라져도 테이블 정의는 남깁니다.
    # 감사 목적상 "과거에 이런 스키마가 있었다"는 기록이 필요합니다.
    delete_behavior = "LOG"
  }

  configuration = jsonencode({
    Version = 1.0
    Grouping = {
      TableLevelConfiguration = 2
    }
  })

  depends_on = [aws_iam_role_policy.glue]
}

# =============================================================
# Athena
# =============================================================

resource "aws_athena_workgroup" "main" {
  name = var.project_name

  configuration {
    enforce_workgroup_configuration = true

    # 워크그룹에 결과 위치를 고정하면 쿼리마다 지정할 필요가 없습니다.
    result_configuration {
      output_location = "s3://${aws_s3_bucket.audit.id}/athena-results/"

      encryption_configuration {
        encryption_option = "SSE_S3"
      }
    }

    # 실수로 대량 스캔 쿼리를 던지는 것을 막습니다.
    bytes_scanned_cutoff_per_query = 1073741824 # 1GB

    publish_cloudwatch_metrics_enabled = true
  }

  force_destroy = true
}
