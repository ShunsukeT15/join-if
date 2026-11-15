resource "random_password" "db" {
  length           = 32
  special          = true
  override_special = "-_"
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "main" {
  name   = "${local.name}-pg${var.db_engine_version}"
  family = "postgres${var.db_engine_version}"

  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot" # how AWS reports it; avoids a perpetual diff
  }
  # Never log statement text (it could contain answers).
  parameter {
    name  = "log_statement"
    value = "none"
  }
}

resource "aws_db_instance" "main" {
  identifier     = "${local.name}-db"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage_gb
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = "himitsu"
  username = "himitsu_admin"
  password = random_password.db.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.main.name
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period    = var.db_backup_retention_days
  backup_window              = "18:00-18:30" # 03:00 JST
  maintenance_window         = "sun:19:00-sun:19:30"
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true

  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-db-final"

  performance_insights_enabled = false
  apply_immediately            = true
}
