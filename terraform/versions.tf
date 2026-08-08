terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }

  # 백엔드 설정은 변수를 쓸 수 없습니다.
  # 계정 ID를 저장소에 남기지 않기 위해 backend.hcl(gitignored)로 주입합니다:
  #   terraform init -backend-config=backend.hcl
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "ThreatWatch"
      ManagedBy = "Terraform"
      Env       = var.environment
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  prefix     = var.project_name

  audit_bucket = "${var.project_name}-audit-${local.account_id}"
}
