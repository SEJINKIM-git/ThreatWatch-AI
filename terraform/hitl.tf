# =============================================================
# Human-in-the-Loop 승인 경로
#
# P1 케이스는 자동 알림으로 끝내지 않고 담당자 승인을 기다립니다.
# Step Functions의 waitForTaskToken 패턴을 사용합니다:
# 상태 머신이 토큰과 함께 멈추고, 콜백이 오면 재개됩니다.
#
# 트리아지 Lambda는 그대로 두고 승인 경로만 얹는 구조입니다.
# SQS → Step Functions → Lambda 순으로 뒤집으면 오케스트레이션이 명확해지지만
# 기존 파이프라인 전체를 다시 짜야 하므로 변경 범위를 좁혔습니다.
# =============================================================

# --- 승인 상태 저장소 ---
#
# 케이스 테이블과 분리합니다. 승인은 케이스와 수명주기가 다르고
# (만료, 재발송 등), 콜백 Lambda가 케이스 테이블 전체에
# 접근할 필요가 없습니다.

resource "aws_dynamodb_table" "approvals" {
  name         = "${local.prefix}-approvals"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "approval_id"

  attribute {
    name = "approval_id"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }
}

# =============================================================
# 승인 요청 발송 Lambda
# =============================================================

resource "aws_iam_role" "approval_request" {
  name               = "${local.prefix}-approval-request-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "approval_request" {
  statement {
    sid       = "StoreApproval"
    effect    = "Allow"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.approvals.arn]
  }

  statement {
    sid       = "NotifyApprover"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.escalations.arn]
  }
}

resource "aws_iam_role_policy" "approval_request" {
  name   = "${local.prefix}-approval-request"
  role   = aws_iam_role.approval_request.id
  policy = data.aws_iam_policy_document.approval_request.json
}

resource "aws_iam_role_policy_attachment" "approval_request_logs" {
  role       = aws_iam_role.approval_request.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "archive_file" "approval_request" {
  type        = "zip"
  source_file = "${path.module}/../approval_request.py"
  output_path = "${path.module}/.build/approval_request.zip"
}

resource "aws_cloudwatch_log_group" "approval_request" {
  name              = "/aws/lambda/${local.prefix}-approval-request"
  retention_in_days = 14
}

resource "aws_lambda_function" "approval_request" {
  function_name = "${local.prefix}-approval-request"
  role          = aws_iam_role.approval_request.arn

  filename         = data.archive_file.approval_request.output_path
  source_code_hash = data.archive_file.approval_request.output_base64sha256

  handler       = "approval_request.handler"
  runtime       = "python3.12"
  architectures = ["arm64"]
  memory_size   = 256
  timeout       = 30

  environment {
    variables = {
      APPROVALS_TABLE = aws_dynamodb_table.approvals.name
      TOPIC_ARN       = aws_sns_topic.escalations.arn
      CALLBACK_URL    = "${aws_api_gateway_stage.prod.invoke_url}/approvals"
    }
  }

  depends_on = [
    aws_iam_role_policy.approval_request,
    aws_cloudwatch_log_group.approval_request,
  ]
}

# =============================================================
# 승인 콜백 Lambda
#
# 이메일 링크에서 GET으로 호출됩니다.
# 브라우저는 커스텀 헤더를 붙일 수 없으므로 HMAC 서명을 요구할 수 없습니다.
# 대신 approval_id 자체가 인증 수단입니다:
#   - 추측 불가능한 랜덤 값
#   - 일회용 (조건부 쓰기로 중복 사용 차단)
#   - TTL로 만료
# 링크 유출은 곧 수신자 메일함 유출이므로 별개의 문제로 봅니다.
# =============================================================

resource "aws_iam_role" "approval_callback" {
  name               = "${local.prefix}-approval-callback-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "approval_callback" {
  # 조회 후 상태를 갱신합니다. 조건부 업데이트로 중복 클릭을 막습니다.
  statement {
    sid    = "ConsumeApproval"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
    ]
    resources = [aws_dynamodb_table.approvals.arn]
  }

  # 상태 머신을 재개시킵니다.
  statement {
    sid    = "ResumeWorkflow"
    effect = "Allow"
    actions = [
      "states:SendTaskSuccess",
      "states:SendTaskFailure",
    ]
    resources = ["*"] # task token 기반 호출은 리소스 단위 제한이 불가능합니다
  }
}

resource "aws_iam_role_policy" "approval_callback" {
  name   = "${local.prefix}-approval-callback"
  role   = aws_iam_role.approval_callback.id
  policy = data.aws_iam_policy_document.approval_callback.json
}

resource "aws_iam_role_policy_attachment" "approval_callback_logs" {
  role       = aws_iam_role.approval_callback.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "archive_file" "approval_callback" {
  type        = "zip"
  source_file = "${path.module}/../approval_callback.py"
  output_path = "${path.module}/.build/approval_callback.zip"
}

resource "aws_cloudwatch_log_group" "approval_callback" {
  name              = "/aws/lambda/${local.prefix}-approval-callback"
  retention_in_days = 14
}

resource "aws_lambda_function" "approval_callback" {
  function_name = "${local.prefix}-approval-callback"
  role          = aws_iam_role.approval_callback.arn

  filename         = data.archive_file.approval_callback.output_path
  source_code_hash = data.archive_file.approval_callback.output_base64sha256

  handler       = "approval_callback.handler"
  runtime       = "python3.12"
  architectures = ["arm64"]
  memory_size   = 256
  timeout       = 15

  environment {
    variables = {
      APPROVALS_TABLE = aws_dynamodb_table.approvals.name
    }
  }

  depends_on = [
    aws_iam_role_policy.approval_callback,
    aws_cloudwatch_log_group.approval_callback,
  ]
}

# =============================================================
# 결과 처리 Lambda
#
# 승인/거부/만료 결과를 케이스 테이블에 반영하고 통지합니다.
# =============================================================

resource "aws_iam_role" "approval_finalize" {
  name               = "${local.prefix}-approval-finalize-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "approval_finalize" {
  statement {
    sid       = "UpdateCase"
    effect    = "Allow"
    actions   = ["dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.cases.arn]
  }

  statement {
    sid       = "NotifyOutcome"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.escalations.arn]
  }
}

resource "aws_iam_role_policy" "approval_finalize" {
  name   = "${local.prefix}-approval-finalize"
  role   = aws_iam_role.approval_finalize.id
  policy = data.aws_iam_policy_document.approval_finalize.json
}

resource "aws_iam_role_policy_attachment" "approval_finalize_logs" {
  role       = aws_iam_role.approval_finalize.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "archive_file" "approval_finalize" {
  type        = "zip"
  source_file = "${path.module}/../approval_finalize.py"
  output_path = "${path.module}/.build/approval_finalize.zip"
}

resource "aws_cloudwatch_log_group" "approval_finalize" {
  name              = "/aws/lambda/${local.prefix}-approval-finalize"
  retention_in_days = 14
}

resource "aws_lambda_function" "approval_finalize" {
  function_name = "${local.prefix}-approval-finalize"
  role          = aws_iam_role.approval_finalize.arn

  filename         = data.archive_file.approval_finalize.output_path
  source_code_hash = data.archive_file.approval_finalize.output_base64sha256

  handler       = "approval_finalize.handler"
  runtime       = "python3.12"
  architectures = ["arm64"]
  memory_size   = 256
  timeout       = 30

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.cases.name
      TOPIC_ARN  = aws_sns_topic.escalations.arn
    }
  }

  depends_on = [
    aws_iam_role_policy.approval_finalize,
    aws_cloudwatch_log_group.approval_finalize,
  ]
}

# =============================================================
# 상태 머신
# =============================================================

resource "aws_iam_role" "state_machine" {
  name = "${local.prefix}-states-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "states.amazonaws.com" }
    }]
  })
}

data "aws_iam_policy_document" "state_machine" {
  statement {
    sid     = "InvokeApprovalLambdas"
    effect  = "Allow"
    actions = ["lambda:InvokeFunction"]
    resources = [
      aws_lambda_function.approval_request.arn,
      aws_lambda_function.approval_finalize.arn,
    ]
  }

  # 상태 머신 실행 로그
  statement {
    sid    = "WriteLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogDelivery",
      "logs:GetLogDelivery",
      "logs:UpdateLogDelivery",
      "logs:DeleteLogDelivery",
      "logs:ListLogDeliveries",
      "logs:PutResourcePolicy",
      "logs:DescribeResourcePolicies",
      "logs:DescribeLogGroups",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "state_machine" {
  name   = "${local.prefix}-states"
  role   = aws_iam_role.state_machine.id
  policy = data.aws_iam_policy_document.state_machine.json
}

resource "aws_cloudwatch_log_group" "state_machine" {
  name              = "/aws/vendedlogs/states/${local.prefix}-approval"
  retention_in_days = 14
}

resource "aws_sfn_state_machine" "approval" {
  name     = "${local.prefix}-approval"
  role_arn = aws_iam_role.state_machine.arn

  definition = jsonencode({
    Comment = "P1 케이스 담당자 승인 워크플로"
    StartAt = "RequestApproval"

    States = {
      # waitForTaskToken: 이 상태는 콜백이 올 때까지 멈춰 있습니다.
      # Lambda는 토큰을 저장하고 메일을 보낸 뒤 즉시 종료되지만,
      # 상태 머신은 대기 상태로 남습니다.
      RequestApproval = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke.waitForTaskToken"

        Parameters = {
          FunctionName = aws_lambda_function.approval_request.arn
          Payload = {
            "case.$"   = "$"
            "taskToken.$" = "$$.Task.Token"
          }
        }

        # 승인을 무한정 기다릴 수 없습니다.
        # 아무도 응답하지 않는 것 자체가 대응이 필요한 상황입니다.
        TimeoutSeconds = var.approval_timeout_sec

        Catch = [{
          ErrorEquals = ["States.Timeout"]
          Next        = "MarkExpired"
          ResultPath  = "$.error"
        }]

        Next = "Finalize"
      }

      MarkExpired = {
        Type = "Pass"
        Parameters = {
          "case.$"  = "$"
          "decision" = "expired"
        }
        Next = "Finalize"
      }

      Finalize = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"

        Parameters = {
          FunctionName = aws_lambda_function.approval_finalize.arn
          "Payload.$"  = "$"
        }

        Retry = [{
          ErrorEquals     = ["Lambda.ServiceException", "Lambda.AWSLambdaException", "Lambda.SdkClientException"]
          IntervalSeconds = 2
          MaxAttempts     = 3
          BackoffRate     = 2
        }]

        End = true
      }
    }
  })

  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.state_machine.arn}:*"
    include_execution_data = true
    level                  = "ERROR"
  }
}

# =============================================================
# 트리아지 Lambda가 상태 머신을 시작할 수 있도록 권한 추가
# =============================================================

resource "aws_iam_role_policy" "lambda_start_approval" {
  name = "${local.prefix}-lambda-start-approval"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "states:StartExecution"
      Resource = aws_sfn_state_machine.approval.arn
    }]
  })
}
