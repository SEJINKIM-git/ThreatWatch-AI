# =============================================================
# CloudWatch 알람
#
# 알림 전용 토픽을 따로 둡니다.
# 에스컬레이션(보안 사고)과 운영 알람(시스템 장애)은 성격이 다르고,
# 수신자도 다를 수 있습니다.
# =============================================================

resource "aws_sns_topic" "ops_alerts" {
  name = "${local.prefix}-ops-alerts"
}

resource "aws_sns_topic_subscription" "ops_email" {
  topic_arn = aws_sns_topic.ops_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# =============================================================
# DLQ 적재 - 가장 중요한 알람
#
# DLQ에 메시지가 들어왔다는 것은 알림 한 건이 3회 재시도 후에도
# 처리되지 못했다는 뜻입니다. 보안 알림 파이프라인에서 이것은
# 사고를 놓쳤을 가능성을 의미합니다.
# =============================================================

resource "aws_cloudwatch_metric_alarm" "dlq_messages" {
  alarm_name        = "${local.prefix}-dlq-not-empty"
  alarm_description = "DLQ에 처리 실패 알림이 있습니다. 원인 확인이 필요합니다."

  namespace   = "AWS/SQS"
  metric_name = "ApproximateNumberOfMessagesVisible"
  statistic   = "Maximum"
  period      = 300

  dimensions = {
    QueueName = aws_sqs_queue.dlq.name
  }

  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1

  # 메시지가 없으면 SQS가 데이터를 보고하지 않습니다.
  # missing을 notBreaching으로 두지 않으면 알람이 INSUFFICIENT_DATA에 머뭅니다.
  treat_missing_data = "notBreaching"

  alarm_actions = [aws_sns_topic.ops_alerts.arn]
  ok_actions    = [aws_sns_topic.ops_alerts.arn]
}

# =============================================================
# Lambda 오류
# =============================================================

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name        = "${local.prefix}-lambda-errors"
  alarm_description = "트리아지 Lambda에서 오류가 반복되고 있습니다."

  namespace   = "AWS/Lambda"
  metric_name = "Errors"
  statistic   = "Sum"
  period      = 300

  dimensions = {
    FunctionName = aws_lambda_function.triage.function_name
  }

  comparison_operator = "GreaterThanThreshold"
  threshold           = 2
  evaluation_periods  = 1

  treat_missing_data = "notBreaching"

  alarm_actions = [aws_sns_topic.ops_alerts.arn]
}

# 스로틀은 오류와 별개로 봅니다.
# 오류는 코드 문제, 스로틀은 용량 문제이므로 대응이 다릅니다.
resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  alarm_name        = "${local.prefix}-lambda-throttles"
  alarm_description = "Lambda가 동시성 한도에 걸리고 있습니다."

  namespace   = "AWS/Lambda"
  metric_name = "Throttles"
  statistic   = "Sum"
  period      = 300

  dimensions = {
    FunctionName = aws_lambda_function.triage.function_name
  }

  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1

  treat_missing_data = "notBreaching"

  alarm_actions = [aws_sns_topic.ops_alerts.arn]
}

# =============================================================
# 큐 적체
#
# 메시지가 쌓이고 있다면 Lambda가 유입 속도를 따라가지 못하는 상태입니다.
# LLM 호출이 건당 수 초 걸리므로 트래픽 급증 시 발생할 수 있습니다.
# =============================================================

resource "aws_cloudwatch_metric_alarm" "queue_backlog" {
  alarm_name        = "${local.prefix}-queue-backlog"
  alarm_description = "알림 큐가 적체되고 있습니다. 처리 용량을 확인하세요."

  namespace   = "AWS/SQS"
  metric_name = "ApproximateNumberOfMessagesVisible"
  statistic   = "Average"
  period      = 300

  dimensions = {
    QueueName = aws_sqs_queue.alerts.name
  }

  comparison_operator = "GreaterThanThreshold"
  threshold           = 50
  evaluation_periods  = 2

  treat_missing_data = "notBreaching"

  alarm_actions = [aws_sns_topic.ops_alerts.arn]
}

# =============================================================
# API Gateway
#
# 4xx는 정상 동작일 수 있습니다. 스키마 검증이 잘못된 요청을 막는 것도 4xx입니다.
# 임계값을 높게 두어 스캔이나 오용 패턴만 잡습니다.
# 5xx는 임계값 0입니다. 게이트웨이나 SQS 통합 자체의 문제를 뜻합니다.
# =============================================================

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name        = "${local.prefix}-api-5xx"
  alarm_description = "API Gateway에서 서버 오류가 발생했습니다."

  namespace   = "AWS/ApiGateway"
  metric_name = "5XXError"
  statistic   = "Sum"
  period      = 300

  dimensions = {
    ApiName = aws_api_gateway_rest_api.main.name
    Stage   = aws_api_gateway_stage.prod.stage_name
  }

  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1

  treat_missing_data = "notBreaching"

  alarm_actions = [aws_sns_topic.ops_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_4xx_spike" {
  alarm_name        = "${local.prefix}-api-4xx-spike"
  alarm_description = "거부된 요청이 비정상적으로 많습니다. 오용 가능성을 확인하세요."

  namespace   = "AWS/ApiGateway"
  metric_name = "4XXError"
  statistic   = "Sum"
  period      = 300

  dimensions = {
    ApiName = aws_api_gateway_rest_api.main.name
    Stage   = aws_api_gateway_stage.prod.stage_name
  }

  comparison_operator = "GreaterThanThreshold"
  threshold           = 20
  evaluation_periods  = 1

  treat_missing_data = "notBreaching"

  alarm_actions = [aws_sns_topic.ops_alerts.arn]
}
