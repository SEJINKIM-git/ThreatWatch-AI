# =============================================================
# IAM - 서비스별 역할 분리
#
# 각 역할은 자기 작업에 필요한 액션만, 특정 리소스에만 갖습니다.
# 사람이 쓰는 관리자 권한과 서비스가 쓰는 실행 역할은 성격이 다릅니다.
# =============================================================

# --- 신뢰 정책 (누가 이 역할을 맡을 수 있는가) ---

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "apigw_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["apigateway.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "glue_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["glue.amazonaws.com"]
    }
  }
}

# =============================================================
# Lambda 실행 역할
# =============================================================

resource "aws_iam_role" "lambda" {
  name               = "${local.prefix}-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "lambda" {
  # SQS: 메시지를 받고, 처리 후 직접 삭제합니다.
  # DeleteMessage가 없으면 처리는 되는데 메시지가 계속 재전달되어 DLQ로 빠집니다.
  statement {
    sid    = "ConsumeAlertQueue"
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.alerts.arn]
  }

  # DynamoDB: 조건부 쓰기만 필요합니다. 읽기도 삭제도 주지 않습니다.
  statement {
    sid       = "StoreCase"
    effect    = "Allow"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.cases.arn]
  }

  # S3: cases/ 접두사에만 쓰기. 읽기 권한은 주지 않습니다.
  statement {
    sid       = "WriteAuditLog"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit.arn}/cases/*"]
  }

  statement {
    sid       = "PublishEscalation"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.escalations.arn]
  }

  # SSM: /threatwatch/ 아래 파라미터만 조회. 시크릿은 여기서 옵니다.
  statement {
    sid       = "ReadSecrets"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter/${var.project_name}/*"]
  }
}

resource "aws_iam_role_policy" "lambda" {
  name   = "${local.prefix}-lambda"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda.json
}

# CloudWatch 로그 권한. 없으면 함수는 돌아가는데 로그가 안 남아 디버깅이 불가능합니다.
resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# =============================================================
# API Gateway 역할
# =============================================================

resource "aws_iam_role" "apigw" {
  name               = "${local.prefix}-apigw-role"
  assume_role_policy = data.aws_iam_policy_document.apigw_assume.json
}

data "aws_iam_policy_document" "apigw" {
  # 게이트웨이는 큐에 넣기만 합니다. 액션 하나, 리소스 하나.
  statement {
    sid       = "EnqueueAlert"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.alerts.arn]
  }
}

resource "aws_iam_role_policy" "apigw" {
  name   = "${local.prefix}-apigw"
  role   = aws_iam_role.apigw.id
  policy = data.aws_iam_policy_document.apigw.json
}

# =============================================================
# Glue 크롤러 역할
# =============================================================

resource "aws_iam_role" "glue" {
  name               = "${local.prefix}-glue-role"
  assume_role_policy = data.aws_iam_policy_document.glue_assume.json
}

data "aws_iam_policy_document" "glue" {
  # 크롤러는 스키마를 추론하기만 하므로 읽기 전용입니다.
  statement {
    sid    = "ReadAuditData"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.audit.arn,
      "${aws_s3_bucket.audit.arn}/cases/*",
    ]
  }
}

resource "aws_iam_role_policy" "glue" {
  name   = "${local.prefix}-glue-s3"
  role   = aws_iam_role.glue.id
  policy = data.aws_iam_policy_document.glue.json
}

resource "aws_iam_role_policy_attachment" "glue_service" {
  role       = aws_iam_role.glue.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSGlueServiceRole"
}
