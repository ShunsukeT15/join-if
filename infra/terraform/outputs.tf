output "site_url" {
  value = "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "web_bucket" {
  value = aws_s3_bucket.web.bucket
}

output "api_function_name" {
  value = aws_lambda_function.api.function_name
}

output "db_endpoint" {
  value = aws_db_instance.main.address
}
