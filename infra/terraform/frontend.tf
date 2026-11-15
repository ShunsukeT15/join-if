# ---------- Static site bucket (private, served only through CloudFront) ----------

resource "aws_s3_bucket" "web" {
  bucket        = "${local.name}-web-${data.aws_caller_identity.current.account_id}"
  force_destroy = true # contents are build artifacts
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.web.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.main.arn } }
    }]
  })
}

# ---------- CloudFront ----------

resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${local.name}-s3"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "lambda" {
  name                              = "${local.name}-lambda"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

# Forward only what the API needs. Never the Host header (it would break the function URL).
resource "aws_cloudfront_origin_request_policy" "api" {
  name = "${local.name}-api"
  cookies_config {
    cookie_behavior = "none"
  }
  query_strings_config {
    query_string_behavior = "none"
  }
  headers_config {
    header_behavior = "whitelist"
    headers {
      items = [
        "Content-Type",
        "X-Admin-Token",
        "X-Invite-Token",
        "X-Member-Token",
        "CloudFront-Viewer-Address",
      ]
    }
  }
}

locals {
  csp = join("; ", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ])
}

resource "aws_cloudfront_response_headers_policy" "security" {
  name = "${local.name}-security"
  security_headers_config {
    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      override                   = true
    }
    content_security_policy {
      content_security_policy = local.csp
      override                = true
    }
  }
}

# SPA routing: paths without a file extension serve /index.html.
# (Not done with custom error responses, which would also rewrite API 404s.)
resource "aws_cloudfront_function" "spa" {
  name    = "${local.name}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
    function handler(event) {
      var req = event.request;
      var last = req.uri.split('/').pop();
      if (last.indexOf('.') === -1) req.uri = '/index.html';
      return req;
    }
  JS
}

locals {
  api_origin_domain = trimsuffix(trimprefix(aws_lambda_function_url.api.function_url, "https://"), "/")
}

resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  comment             = "${local.name} web + api"
  default_root_object = "index.html"
  price_class         = "PriceClass_200" # includes Japan
  http_version        = "http2and3"
  is_ipv6_enabled     = true

  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin {
    origin_id                = "api"
    domain_name              = local.api_origin_domain
    origin_access_control_id = aws_cloudfront_origin_access_control.lambda.id
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }
  }

  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = "api"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id   = aws_cloudfront_origin_request_policy.api.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
