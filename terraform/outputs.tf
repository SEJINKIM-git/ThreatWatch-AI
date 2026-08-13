# =============================================================
# 출력값
#
# 수동으로 관리하던 .env.aws를 대체합니다:
#   terraform output -raw api_url
#   eval "$(terraform output -raw env_exports)"
# =============================================================

output "api_url" {
  description = "알림 수신 엔드포인트"
  value       = "${aws_api_gateway_stage.prod.invoke_url}/${aws_api_gateway_resource.alerts.path_part}"
}

output "api_key_id" {
  description = "API 키 ID. 값 조회: aws apigateway get-api-key --api-key <id> --include-value"
  value       = aws_api_gateway_api_key.main.id
}

output "queue_url" {
  description = "알림 큐 URL"
  value       = aws_sqs_queue.alerts.url
}

output "dlq_url" {
  description = "DLQ URL"
  value       = aws_sqs_queue.dlq.url
}

output "table_name" {
  description = "케이스 테이블 이름"
  value       = aws_dynamodb_table.cases.name
}

output "topic_arn" {
  description = "에스컬레이션 토픽 ARN"
  value       = aws_sns_topic.escalations.arn
}

output "audit_bucket" {
  description = "감사 로그 버킷"
  value       = aws_s3_bucket.audit.id
}

output "lambda_function_name" {
  description = "트리아지 함수 이름"
  value       = aws_lambda_function.triage.function_name
}

# 셸에서 바로 쓸 수 있는 형태.
# API 키 값은 여기 넣지 않습니다. 상태 파일과 출력에 시크릿을 남기지 않기 위해
# 필요할 때 aws apigateway get-api-key로 조회합니다.
output "env_exports" {
  description = "eval \"$(terraform output -raw env_exports)\" 로 환경변수 주입"
  value       = <<-EOT
    export AWS_REGION=${var.aws_region}
    export ACCOUNT_ID=${local.account_id}
    export BUCKET=${aws_s3_bucket.audit.id}
    export S3_AUDIT_BUCKET=${aws_s3_bucket.audit.id}
    export QUEUE_URL=${aws_sqs_queue.alerts.url}
    export DLQ_URL=${aws_sqs_queue.dlq.url}
    export TABLE_NAME=${aws_dynamodb_table.cases.name}
    export TOPIC_ARN=${aws_sns_topic.escalations.arn}
    export API_URL=${aws_api_gateway_stage.prod.invoke_url}/${aws_api_gateway_resource.alerts.path_part}
    export KEY_ID=${aws_api_gateway_api_key.main.id}
  EOT
}
