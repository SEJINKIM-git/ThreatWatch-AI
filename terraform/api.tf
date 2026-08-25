# =============================================================
# API Gateway - REST, SQS 직접 통합
#
# Lambda를 진입점에 두지 않는 이유:
# 게이트웨이가 큐에 직접 넣으면 수신 단계에서 컴퓨팅 비용이 발생하지 않고,
# 트래픽 급증 시에도 큐가 버퍼 역할을 합니다.
# =============================================================

resource "aws_api_gateway_rest_api" "main" {
  name        = "${local.prefix}-api"
  description = "ThreatWatch AI alert ingestion"

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_resource" "alerts" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "alerts"
}

# =============================================================
# 요청 스키마 검증
#
# required 목록은 lambda_handler.py의 REQUIRED_FIELDS와 일치합니다.
# 게이트웨이에서 먼저 막히므로 핸들러의 InvalidPayload 경로는 이중 안전장치입니다.
#
# maxLength / maxItems는 단순한 위생 처리가 아닙니다.
# description에 대용량 문자열이 들어오면 그대로 LLM 프롬프트에 실려
# 토큰 비용이 발생합니다. enum 제약도 같은 맥락입니다.
# =============================================================

resource "aws_api_gateway_model" "alert_request" {
  rest_api_id  = aws_api_gateway_rest_api.main.id
  name         = "AlertRequest"
  content_type = "application/json"

  schema = jsonencode({
    "$schema" = "http://json-schema.org/draft-04/schema#"
    title     = "AlertRequest"
    type      = "object"
    required  = ["incident_type", "severity"]

    properties = {
      alert_id = {
        type      = "string"
        maxLength = 128
      }
      incident_type = {
        type      = "string"
        minLength = 1
        maxLength = 128
      }
      severity = {
        type = "string"
        enum = ["low", "medium", "high", "critical"]
      }
      asset_criticality = {
        type = "string"
        enum = ["low", "medium", "high"]
      }
      pii_flag = {
        type = "boolean"
      }
      user_role = {
        type      = "string"
        maxLength = 64
      }
      indicators = {
        type     = "array"
        items    = { type = "string" }
        maxItems = 50
      }
      description = {
        type      = "string"
        maxLength = 2000
      }
    }
  })
}

resource "aws_api_gateway_request_validator" "body" {
  rest_api_id                 = aws_api_gateway_rest_api.main.id
  name                        = "validate-body"
  validate_request_body       = true
  validate_request_parameters = false
}

# =============================================================
# POST /alerts
# =============================================================

resource "aws_api_gateway_method" "post_alerts" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.alerts.id
  http_method   = "POST"
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.hmac.id

  # v1 인증은 API 키입니다. 키는 헤더에 평문으로 실리고 본문 무결성을 보장하지 않으므로
  # AWS도 이를 인증 수단이 아닌 사용량 식별자로 규정합니다.
  # v2에서 Lambda Authorizer + HMAC 서명 검증으로 대체할 예정입니다.
  api_key_required = true

  request_validator_id = aws_api_gateway_request_validator.body.id

  request_models = {
    "application/json" = aws_api_gateway_model.alert_request.name
  }
}

resource "aws_api_gateway_integration" "sqs" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.alerts.id
  http_method = aws_api_gateway_method.post_alerts.http_method

  type                    = "AWS"
  integration_http_method = "POST"
  credentials             = aws_iam_role.apigw.arn
  uri                     = "arn:aws:apigateway:${var.aws_region}:sqs:path/${local.account_id}/${aws_sqs_queue.alerts.name}"

  # SQS 쿼리 API는 폼 인코딩을 받습니다. JSON을 그대로 넘기면 파싱되지 않습니다.
  request_parameters = {
    "integration.request.header.Content-Type" = "'application/x-www-form-urlencoded'"
  }

  # urlEncode가 없으면 JSON 본문의 & 와 = 가 폼 파라미터 구분자로 오인됩니다.
  request_templates = {
    "application/json" = "Action=SendMessage&MessageBody=$util.urlEncode($input.body)"
  }

  # 정의된 템플릿이 없으면 거부합니다.
  # 변환을 거치지 않은 본문은 Action 파라미터가 없어 SQS가 처리할 수 없으므로
  # 우회 경로를 열어두지 않습니다.
  passthrough_behavior = "WHEN_NO_TEMPLATES"
}

# =============================================================
# 응답 매핑
#
# 기본 상태로 두면 SQS의 XML 응답이 클라이언트에 그대로 노출됩니다.
# 내부 구현을 감추고 일관된 JSON을 반환합니다.
# =============================================================

resource "aws_api_gateway_method_response" "accepted" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.alerts.id
  http_method = aws_api_gateway_method.post_alerts.http_method
  status_code = "202"

  response_models = {
    "application/json" = "Empty"
  }
}

resource "aws_api_gateway_integration_response" "accepted" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.alerts.id
  http_method = aws_api_gateway_method.post_alerts.http_method
  status_code = aws_api_gateway_method_response.accepted.status_code

  # 202를 쓰는 이유: 요청을 접수했을 뿐 트리아지는 아직 끝나지 않았습니다.
  # 200은 처리 완료를 의미하므로 비동기 파이프라인에는 맞지 않습니다.
  response_templates = {
    "application/json" = jsonencode({
      status  = "accepted"
      message = "Alert queued for triage"
    })
  }

  depends_on = [aws_api_gateway_integration.sqs]
}

# =============================================================
# 배포
# =============================================================

resource "aws_api_gateway_deployment" "main" {
  rest_api_id = aws_api_gateway_rest_api.main.id

  # 메서드나 통합이 바뀌면 재배포가 필요합니다.
  # 스테이지는 배포 시점의 스냅샷이므로, 재배포 없이는 변경이 반영되지 않습니다.
  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.alerts,
      aws_api_gateway_method.post_alerts,
      aws_api_gateway_integration.sqs,
      aws_api_gateway_integration_response.accepted,
      aws_api_gateway_model.alert_request,
      aws_api_gateway_request_validator.body,
      aws_api_gateway_authorizer.hmac,
      aws_api_gateway_resource.approvals,
      aws_api_gateway_method.get_approvals,
      aws_api_gateway_integration.approvals,
      aws_api_gateway_resource.cases,
      aws_api_gateway_resource.case_detail,
      aws_api_gateway_method.get_cases,
      aws_api_gateway_method.get_case_detail,
      aws_api_gateway_integration.cases,
      aws_api_gateway_integration.case_detail,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "prod" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  deployment_id = aws_api_gateway_deployment.main.id
  stage_name    = var.environment
}

# =============================================================
# API 키와 사용량 제한
#
# 키 유출 시 피해 규모를 결정하는 것은 인증이 아니라 이 쿼터입니다.
# LLM 호출이 연결되어 있어 무제한이면 비용 사고로 직결됩니다.
# =============================================================

resource "aws_api_gateway_api_key" "main" {
  name    = "${local.prefix}-key"
  enabled = true
}

resource "aws_api_gateway_usage_plan" "main" {
  name = "${local.prefix}-plan"

  api_stages {
    api_id = aws_api_gateway_rest_api.main.id
    stage  = aws_api_gateway_stage.prod.stage_name
  }

  throttle_settings {
    rate_limit  = var.api_throttle_rate
    burst_limit = var.api_throttle_burst
  }

  quota_settings {
    limit  = var.api_quota_per_day
    period = "DAY"
  }
}

resource "aws_api_gateway_usage_plan_key" "main" {
  key_id        = aws_api_gateway_api_key.main.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.main.id
}

