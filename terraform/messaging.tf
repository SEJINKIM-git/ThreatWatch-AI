# =============================================================
# SQS - 알림 수신 버퍼와 실패 격리
# =============================================================

# DLQ를 먼저 정의합니다. 메인 큐의 redrive 정책이 이 ARN을 참조합니다.
resource "aws_sqs_queue" "dlq" {
  name = "${local.prefix}-dlq"

  # 실패 원인을 분석할 시간이 필요하므로 최대치(14일)로 둡니다.
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "alerts" {
  name = "${local.prefix}-alerts"

  visibility_timeout_seconds = var.sqs_visibility_timeout_sec
  message_retention_seconds  = 345600 # 4일

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.sqs_max_receive_count
  })
}

# DLQ가 어느 큐로부터 메시지를 받을지 명시합니다.
# 없어도 동작하지만, 콘솔에서 재처리(redrive) 기능을 쓸 수 있게 해줍니다.
resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.alerts.arn]
  })
}

# =============================================================
# SNS - 에스컬레이션 알림
# =============================================================

resource "aws_sns_topic" "escalations" {
  name = "${local.prefix}-escalations"
}

# 이메일 구독은 수신자가 확인 링크를 클릭해야 활성화됩니다.
# Terraform은 PendingConfirmation 상태로 생성만 하고 대기하지 않습니다.
resource "aws_sns_topic_subscription" "escalation_email" {
  topic_arn = aws_sns_topic.escalations.arn
  protocol  = "email"
  endpoint  = var.alert_email
}
