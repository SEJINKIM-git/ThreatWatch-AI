# =============================================================
# Lambda - 트리아지 처리
# =============================================================

# 로그 그룹을 명시적으로 만듭니다.
# Lambda가 자동 생성하도록 두면 보존 기간이 "무기한"이 되어 로그 비용이 계속 쌓입니다.
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.prefix}-triage"
  retention_in_days = 30
}

resource "aws_lambda_function" "triage" {
  function_name = "${local.prefix}-triage"
  role          = aws_iam_role.lambda.arn

  filename         = var.lambda_package_path
  source_code_hash = filebase64sha256(var.lambda_package_path)

  handler       = "lambda_handler.handler"
  runtime       = "python3.12"
  architectures = ["arm64"]

  memory_size = var.lambda_memory_mb
  timeout     = var.lambda_timeout_sec

  # 예약 동시성. LLM 호출이 병렬로 폭주하는 것을 막습니다.
  # 큐가 폭주해도 동시 실행이 이 값을 넘지 않습니다.
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  environment {
    variables = {
      TABLE_NAME        = aws_dynamodb_table.cases.name
      TOPIC_ARN         = aws_sns_topic.escalations.arn
      S3_AUDIT_BUCKET   = aws_s3_bucket.audit.id
      DEMO_MODE         = tostring(var.demo_mode)
      STATE_MACHINE_ARN = aws_sfn_state_machine.approval.arn
      STATE_MACHINE_ARN = aws_sfn_state_machine.approval.arn
    }
  }

  depends_on = [
    aws_iam_role_policy.lambda,
    aws_iam_role_policy_attachment.lambda_logs,
    aws_cloudwatch_log_group.lambda,
  ]
}

# =============================================================
# SQS → Lambda 트리거
# =============================================================

resource "aws_lambda_event_source_mapping" "alerts" {
  event_source_arn = aws_sqs_queue.alerts.arn
  function_name    = aws_lambda_function.triage.arn

  batch_size                         = var.sqs_batch_size
  maximum_batching_window_in_seconds = 10

  # 핸들러가 반환하는 batchItemFailures를 Lambda가 존중하게 만듭니다.
  # 이게 없으면 배치 5건 중 1건 실패 시 5건 전부 재시도되어
  # 이미 성공한 건의 LLM 호출 비용이 낭비됩니다.
  function_response_types = ["ReportBatchItemFailures"]
}

