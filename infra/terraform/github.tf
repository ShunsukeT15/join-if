# CI/CD: GitHub Actions deploys the frontend with short-lived credentials (OIDC),
# so no AWS access keys are stored in GitHub.

# Only one provider per URL can exist in an account. Set create_github_oidc_provider = false
# if another project already created it; the existing one is then looked up.
resource "aws_iam_openid_connect_provider" "github" {
  count           = var.create_github_oidc_provider ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = []

  # AWS fills in the thumbprint itself (and no longer uses it for GitHub); avoid a perpetual diff.
  lifecycle {
    ignore_changes = [thumbprint_list]
  }
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

locals {
  github_oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
}

resource "aws_iam_role" "github_web_deploy" {
  name        = "${local.name}-github-web-deploy"
  description = "GitHub Actions (${var.github_repository}, main) uploads the SPA to S3 and invalidates CloudFront"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.github_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          # Only workflows running on the main branch of this repository. GitHub's subject
          # includes immutable ids ("owner@ownerId/repo@repoId"), so a renamed or re-created
          # repository with the same name cannot assume this role.
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_oidc_repository}:ref:refs/heads/${var.github_deploy_branch}"
        }
      }
    }]
  })
  max_session_duration = 3600
}

# Least privilege: the web bucket and this distribution only. No Lambda / RDS / IAM.
resource "aws_iam_role_policy" "github_web_deploy" {
  name = "web-deploy"
  role = aws_iam_role.github_web_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.web.arn
      },
      {
        Sid      = "WriteObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.web.arn}/*"
      },
      {
        Sid      = "Invalidate"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
        Resource = aws_cloudfront_distribution.main.arn
      },
    ]
  })
}
