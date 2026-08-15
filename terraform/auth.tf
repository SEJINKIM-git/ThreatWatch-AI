# =============================================================
# HMAC 요청 서명 검증 (v2 인증)
#
# API 키의 한계를 보완합니다. 키는 헤더에 평문으로 실리고 요청의
# 진위나 신선도를 보장하지 않습니다. AWS 문서도 API 키를 인증 수단이 아니라
# 사용량 식별자로 규정합니다.
#
# 이 레이어가 추가하는 것:
#   - 발신자 인증: 공유 시크릿을 가진 쪽만 유효한 서명을 만들 수 있음
#   - 재전송 방지: 논스 1회성 + 타임스탬프 창
#
# 보장하지 않는 것:
#   - 본문 무결성. REST API의 REQUEST authorizer는 본문을 받지 못하므로
#     서명 대상에 포함할 수 없습니다. HTTPS와 스키마 검증에 의존합니다.
# =============================================================

# --- 논스 저장소 ---

resource "aws_dynamodb_table" "nonces" {
  name         = "${local.prefix}-nonces"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "nonce"

  attribute {
    name = "nonce"
    type = "S"
  }

  # TTL로 만료된 논스가 자동 삭제됩니다.
  # 허용 시간 창을 벗어난 요청은 타임스탬프 검사에서 걸리므로
  # 그 시점까지만 보관하면 충분합니다.
  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }
}

# --- Authorizer 실행 역할 ---

resource "aws_iam_role" "authorizer" {
  name               = "${local.prefix}-authorizer-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "authorizer" {
  statement {
    sid       = "ReadHmacSecret"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter${var.hmac_secret_ssm_path}"]
  }

  # 논스는 쓰기만 하면 됩니다. 조건부 쓰기가 중복을 걸러내므로
  # 읽기 권한이 필요 없습니다.
  statement {
    sid       = "ConsumeNonce"
    effect    = "Allow"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.nonces.arn]
  }
}

resource "aws_iam_role_policy" "authorizer" {
  name   = "${local.prefix}-authorizer"
  role   = aws_iam_role.authorizer.id
  policy = data.aws_iam_policy_document.authorizer.json
}

resource "aws_iam_role_policy_attachment" "authorizer_logs" {
  role       = aws_iam_role.authorizer.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# --- Authorizer 함수 ---

# 트리아지 함수와 달리 의존성이 없습니다(표준 라이브러리 + 런타임 boto3).
# 별도 빌드 없이 소스에서 직접 패키징합니다.
data "archive_file" "authorizer" {
  type        = "zip"
  source_file = "${path.module}/../authorizer.py"
  output_path = "${path.module}/.build/authorizer.zip"
}

resource "aws_cloudwatch_log_group" "authorizer" {
  name              = "/aws/lambda/${local.prefix}-authorizer"
  retention_in_days = 14
}

resource "aws_lambda_function" "authorizer" {
  function_name = "${local.prefix}-authorizer"
  role          = aws_iam_role.authorizer.arn

  filename         = data.archive_file.authorizer.output_path
  source_code_hash = data.archive_file.authorizer.output_base64sha256

  handler       = "authorizer.handler"
  runtime       = "python3.12"
  architectures = ["arm64"]

  memory_size = 256

  # 서명 검증은 밀리초 단위 작업입니다.
  # 짧게 두어 문제 발생 시 빠르게 실패하도록 합니다.
  timeout = 5

  environment {
    variables = {
      HMAC_SECRET_PARAM = var.hmac_secret_ssm_path
      NONCE_TABLE       = aws_dynamodb_table.nonces.name
    }
  }

  depends_on = [
    aws_iam_role_policy.authorizer,
    aws_cloudwatch_log_group.authorizer,
  ]
}

# --- API Gateway 연결 ---

resource "aws_iam_role" "authorizer_invoke" {
  name               = "${local.prefix}-authorizer-invoke"
  assume_role_policy = data.aws_iam_policy_document.apigw_assume.json
}

resource "aws_iam_role_policy" "authorizer_invoke" {
  name = "${local.prefix}-authorizer-invoke"
  role = aws_iam_role.authorizer_invoke.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.authorizer.arn
    }]
  })
}

resource "aws_api_gateway_authorizer" "hmac" {
  name        = "${local.prefix}-hmac"
  rest_api_id = aws_api_gateway_rest_api.main.id
  type        = "REQUEST"

  authorizer_uri         = aws_lambda_function.authorizer.invoke_arn
  authorizer_credentials = aws_iam_role.authorizer_invoke.arn

  # identity_source가 지정되면 그 헤더들이 캐시 키가 됩니다.
  # 논스는 매 요청 달라지므로 캐시가 사실상 무의미하고,
  # 캐시가 동작하면 재전송 방지가 무력화됩니다. 반드시 0으로 둡니다.
  identity_source                  = "method.request.header.x-tw-signature"
  authorizer_result_ttl_in_seconds = 0
}
