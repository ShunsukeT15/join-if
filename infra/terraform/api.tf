resource "random_bytes" "token_enc_key" {
  length = 32
}

data "archive_file" "api" {
  type        = "zip"
  source_dir  = var.lambda_zip_source_dir
  output_path = "${path.module}/.build/api.zip"
}

resource "aws_iam_role" "api" {
  name = "${local.name}-api"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "api_vpc" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.name}-api"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.name}-api"
  role             = aws_iam_role.api.arn
  runtime          = var.lambda_runtime
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  memory_size      = var.lambda_memory_mb
  timeout          = 15

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      NODE_OPTIONS         = "--enable-source-maps"
      NODE_EXTRA_CA_CERTS  = "/var/runtime/ca-cert.pem" # Amazon RDS CAs for TLS verification
      DATA_STORE           = "postgres"
      DATABASE_URL         = "postgres://${aws_db_instance.main.username}:${urlencode(random_password.db.result)}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${aws_db_instance.main.db_name}"
      DB_SSL               = "verify"
      DB_POOL_MAX          = "2"
      TOKEN_ENC_KEY        = random_bytes.token_enc_key.base64
      RATE_LIMIT           = "postgres"
      CORS_ORIGINS         = "" # same origin via CloudFront
      ORIGIN_VERIFY_HEADER = "X-Origin-Verify"
      ORIGIN_VERIFY_SECRET = random_password.origin_verify.result
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.api.name
  }

  depends_on = [aws_iam_role_policy_attachment.api_vpc, aws_cloudwatch_log_group.api]
}

# Only CloudFront (OAC, SigV4) can call the function URL.
resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "AWS_IAM"
}

resource "aws_lambda_permission" "cloudfront_url" {
  statement_id  = "AllowCloudFrontInvokeFunctionUrl"
  action        = "lambda:InvokeFunctionUrl"
  function_name = aws_lambda_function.api.function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.main.arn
}

resource "aws_lambda_permission" "cloudfront_invoke" {
  statement_id  = "AllowCloudFrontInvokeFunction"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.main.arn
}

# Second layer: a secret header only CloudFront adds.
resource "random_password" "origin_verify" {
  length  = 40
  special = false
}

# Daily purge of expired rooms (spec §7.5).
resource "aws_cloudwatch_event_rule" "purge" {
  name                = "${local.name}-purge"
  schedule_expression = "cron(17 18 * * ? *)" # 03:17 JST
}

resource "aws_cloudwatch_event_target" "purge" {
  rule  = aws_cloudwatch_event_rule.purge.name
  arn   = aws_lambda_function.api.arn
  input = jsonencode({ action = "purge" })
}

resource "aws_lambda_permission" "purge" {
  statement_id  = "AllowEventBridgePurge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.purge.arn
}
