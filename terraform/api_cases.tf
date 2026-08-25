# =============================================================
# 케이스 조회 API
#
# GET /cases              최근 케이스 목록
# GET /cases/{alert_id}   단건 상세
#
# 읽기 전용이므로 HMAC 서명을 요구하지 않습니다.
# 서명은 요청의 진위와 신선도를 보장하기 위한 것인데,
# 조회는 상태를 바꾸지 않으므로 재전송 방어가 의미를 갖지 않습니다.
# 접근 통제와 사용량 제한은 API 키가 담당합니다.
# =============================================================

resource "aws_iam_role" "case_api" {
  name               = "${local.prefix}-case-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "case_api" {
  # 읽기만 허용합니다. PutItem이나 UpdateItem은 주지 않습니다.
  statement {
    sid    = "ReadCases"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ]
    resources = [
      aws_dynamodb_table.cases.arn,
      "${aws_dynamodb_table.cases.arn}/index/*",
    ]
  }
}

resource "aws_iam_role_policy" "case_api" {
  name   = "${local.prefix}-case-api"
  role   = aws_iam_role.case_api.id
  policy = data.aws_iam_policy_document.case_api.json
}

resource "aws_iam_role_policy_attachment" "case_api_logs" {
  role       = aws_iam_role.case_api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "archive_file" "case_api" {
  type        = "zip"
  source_file = "${path.module}/../case_api.py"
  output_path = "${path.module}/.build/case_api.zip"
}

resource "aws_cloudwatch_log_group" "case_api" {
  name              = "/aws/lambda/${local.prefix}-case-api"
  retention_in_days = 14
}

resource "aws_lambda_function" "case_api" {
  function_name = "${local.prefix}-case-api"
  role          = aws_iam_role.case_api.arn

  filename         = data.archive_file.case_api.output_path
  source_code_hash = data.archive_file.case_api.output_base64sha256

  handler       = "case_api.handler"
  runtime       = "python3.12"
  architectures = ["arm64"]
  memory_size   = 256
  timeout       = 10

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.cases.name
    }
  }

  depends_on = [
    aws_iam_role_policy.case_api,
    aws_cloudwatch_log_group.case_api,
  ]
}

# =============================================================
# API Gateway 리소스
# =============================================================

resource "aws_api_gateway_resource" "cases" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "cases"
}

resource "aws_api_gateway_resource" "case_detail" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.cases.id
  path_part   = "{alert_id}"
}

resource "aws_api_gateway_method" "get_cases" {
  rest_api_id      = aws_api_gateway_rest_api.main.id
  resource_id      = aws_api_gateway_resource.cases.id
  http_method      = "GET"
  authorization    = "NONE"
  api_key_required = true

  request_parameters = {
    "method.request.querystring.risk_level" = false
    "method.request.querystring.limit"      = false
  }
}

resource "aws_api_gateway_method" "get_case_detail" {
  rest_api_id      = aws_api_gateway_rest_api.main.id
  resource_id      = aws_api_gateway_resource.case_detail.id
  http_method      = "GET"
  authorization    = "NONE"
  api_key_required = true

  request_parameters = {
    "method.request.path.alert_id" = true
  }
}

resource "aws_api_gateway_integration" "cases" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.cases.id
  http_method = aws_api_gateway_method.get_cases.http_method

  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.case_api.invoke_arn
}

resource "aws_api_gateway_integration" "case_detail" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.case_detail.id
  http_method = aws_api_gateway_method.get_case_detail.http_method

  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.case_api.invoke_arn
}

resource "aws_lambda_permission" "case_api" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.case_api.function_name
  principal     = "apigateway.amazonaws.com"

  # 두 경로 모두 같은 함수를 호출하므로 와일드카드로 묶습니다.
  source_arn = "${aws_api_gateway_rest_api.main.execution_arn}/*/GET/cases*"
}
