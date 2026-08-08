variable "aws_region" {
  description = "리소스를 배포할 리전"
  type        = string
  default     = "ap-northeast-2"
}

variable "environment" {
  description = "환경 식별자 (태그에 사용)"
  type        = string
  default     = "prod"
}

variable "project_name" {
  description = "모든 리소스 이름의 접두사"
  type        = string
  default     = "threatwatch"
}

variable "alert_email" {
  description = "에스컬레이션 알림을 받을 이메일. 구독 확인 메일을 클릭해야 활성화됩니다."
  type        = string
}

# --- Lambda ---

variable "lambda_memory_mb" {
  description = "Lambda 메모리(MB). CPU 배분과 연동됩니다."
  type        = number
  default     = 512
}

variable "lambda_timeout_sec" {
  description = "Lambda 타임아웃(초). SQS 가시성 타임아웃의 1/6 이하여야 합니다."
  type        = number
  default     = 60
}

variable "lambda_reserved_concurrency" {
  description = "예약 동시성. LLM 호출 폭주로 인한 비용 사고를 막습니다."
  type        = number
  default     = -1
}

variable "lambda_package_path" {
  description = "build.sh가 생성한 배포 zip 경로"
  type        = string
  default     = "../lambda-package.zip"
}

# --- SQS ---

variable "sqs_visibility_timeout_sec" {
  description = <<-EOT
    가시성 타임아웃(초). Lambda 타임아웃의 최소 6배로 유지해야 합니다.
    짧으면 처리 중인 메시지가 다시 보이면서 중복 실행이 발생합니다.
  EOT
  type        = number
  default     = 360

  validation {
    condition     = var.sqs_visibility_timeout_sec >= 360
    error_message = "Lambda 타임아웃 60초의 6배 이상이어야 합니다."
  }
}

variable "sqs_max_receive_count" {
  description = "이 횟수만큼 처리 실패하면 DLQ로 격리합니다."
  type        = number
  default     = 3
}

variable "sqs_batch_size" {
  description = "Lambda가 한 번에 처리할 메시지 수. LLM 호출 시간을 고려해 작게 유지합니다."
  type        = number
  default     = 5
}

# --- API Gateway ---

variable "api_throttle_rate" {
  description = "초당 요청 수 제한"
  type        = number
  default     = -1
}

variable "api_throttle_burst" {
  description = "버스트 허용량"
  type        = number
  default     = 10
}

variable "api_quota_per_day" {
  description = "일일 요청 한도. 키 유출 시 피해 규모를 제한합니다."
  type        = number
  default     = 1000
}

# --- 시크릿 (Terraform이 관리하지 않음) ---

variable "anthropic_key_ssm_path" {
  description = <<-EOT
    Anthropic API 키가 저장된 SSM 파라미터 경로.
    파라미터 자체는 Terraform으로 관리하지 않습니다.
    상태 파일에 평문 시크릿이 기록되는 것을 피하기 위해 CLI로 수동 관리합니다.
  EOT
  type        = string
  default     = "/threatwatch/anthropic-api-key"
}

variable "demo_mode" {
  description = "true면 LLM을 호출하지 않고 모의 응답을 사용합니다."
  type        = bool
  default     = false
}
