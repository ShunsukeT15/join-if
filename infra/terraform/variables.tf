variable "region" {
  type    = string
  default = "ap-northeast-1"
}

variable "env" {
  description = "Environment name, used in resource names"
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_engine_version" {
  description = "PostgreSQL major version (minor upgrades are automatic)"
  type        = string
  default     = "17"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 20
}

variable "db_backup_retention_days" {
  type    = number
  default = 7
}

variable "db_deletion_protection" {
  description = "Set to false before `terraform destroy`"
  type        = bool
  default     = true
}

variable "lambda_memory_mb" {
  type    = number
  default = 512
}

variable "lambda_runtime" {
  type    = string
  default = "nodejs22.x"
}

variable "lambda_zip_source_dir" {
  description = "Output of `npm run build:lambda -w @himitsu/api`"
  type        = string
  default     = "../../apps/api/dist/lambda"
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "budget_alert_email" {
  description = "If set, a monthly AWS Budget with email alerts is created"
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  type    = number
  default = 40
}

variable "budget_alert_threshold_percent" {
  description = "Notify when forecast / actual spend exceeds this percentage of the budget"
  type        = number
  default     = 100
}

variable "github_repository" {
  description = "owner/name of the GitHub repository allowed to deploy the frontend"
  type        = string
  default     = "ShunsukeT15/join-if"
}

variable "github_oidc_repository" {
  description = "Repository as it appears in GitHub's OIDC subject: owner@ownerId/repo@repoId (see CloudTrail AssumeRoleWithWebIdentity events)"
  type        = string
  default     = "ShunsukeT15@84225335/join-if@1458620122"
}

variable "github_deploy_branch" {
  type    = string
  default = "main"
}

variable "create_github_oidc_provider" {
  description = "false if the account already has the GitHub OIDC provider (created by another project)"
  type        = bool
  default     = true
}
