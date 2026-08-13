# =============================================================
# GitHub Actions OIDC
#
# 액세스 키를 GitHub Secrets에 저장하지 않습니다.
# GitHub가 발급한 단기 토큰으로 이 역할을 맡는 구조이므로
# 유출될 장기 자격증명이 존재하지 않습니다.
# =============================================================

resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  # GitHub의 OIDC 인증서 지문. 회전될 수 있으므로 변경 시 갱신이 필요합니다.
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # 특정 저장소로 제한합니다. 이 조건이 없으면
    # GitHub의 어떤 저장소든 이 역할을 맡을 수 있습니다.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:*"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${local.prefix}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
}

# 이 프로젝트의 인프라를 관리하려면 광범위한 권한이 필요합니다.
# 실무에서는 리소스 태그나 이름 접두사로 조건을 걸지만,
# Terraform이 다루는 서비스 범위가 넓어 학습 환경에서는 서비스 단위로 부여합니다.
data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid    = "ManageInfrastructure"
    effect = "Allow"
    actions = [
      "apigateway:*",
      "athena:*",
      "cloudwatch:*",
      "dynamodb:*",
      "glue:*",
      "lambda:*",
      "logs:*",
      "s3:*",
      "sns:*",
      "sqs:*",
    ]
    resources = ["*"]
  }

  # IAM은 별도 문으로 분리해 어떤 액션이 필요한지 명시합니다.
  statement {
    sid    = "ManageServiceRoles"
    effect = "Allow"
    actions = [
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:GetOpenIDConnectProvider",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:TagRole",
      "iam:PassRole",
    ]
    resources = ["*"]
  }

  # 시크릿 값은 읽지 못하게 합니다.
  # SSM 파라미터는 CLI로 수동 관리하므로 CI에서 읽을 이유가 없습니다.
  statement {
    sid    = "DenySecretAccess"
    effect = "Deny"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
    ]
    resources = ["arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter/${var.project_name}/*"]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "${local.prefix}-github-deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}
