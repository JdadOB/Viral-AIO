##############################################################################
# Viral-AIO — AWS Infrastructure (Terraform)
#
# Architecture:
#   ECR repository  →  ECS Fargate task  →  ALB (port 443/80)
#   EFS file system →  mounted at /data  →  SQLite persistence
#
# NOTE: This configuration runs a SINGLE Fargate task. Horizontal scaling
# requires migrating from SQLite to RDS PostgreSQL (the scheduler and session
# store also need to be made stateless). Until that migration, min_count and
# max_count should remain 1.
#
# Prerequisites:
#   1. An existing VPC with at least 2 public subnets
#   2. An ACM certificate for HTTPS
#   3. Secrets supplied via terraform.tfvars (never committed — add to .gitignore)
##############################################################################

terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Recommended: store state in S3 + DynamoDB for team use
  # backend "s3" {
  #   bucket         = "your-tfstate-bucket"
  #   key            = "viral-aio/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region
}

##############################################################################
# Data sources — reference existing VPC/subnets rather than creating new ones
##############################################################################

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "public" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_caller_identity" "current" {}

##############################################################################
# ECR — container image registry
##############################################################################

resource "aws_ecr_repository" "app" {
  name                 = var.app_name
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { Name = var.app_name }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

##############################################################################
# EFS — persistent volume for SQLite database
##############################################################################

resource "aws_efs_file_system" "data" {
  encrypted        = true
  performance_mode = "generalPurpose"

  tags = { Name = "${var.app_name}-data" }
}

resource "aws_security_group" "efs" {
  name        = "${var.app_name}-efs"
  description = "Allow NFS from ECS tasks"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  tags = { Name = "${var.app_name}-efs" }
}

resource "aws_efs_mount_target" "data" {
  for_each = toset(data.aws_subnets.public.ids)

  file_system_id  = aws_efs_file_system.data.id
  subnet_id       = each.value
  security_groups = [aws_security_group.efs.id]
}

##############################################################################
# Security groups
##############################################################################

resource "aws_security_group" "alb" {
  name        = "${var.app_name}-alb"
  description = "Public traffic to ALB"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.app_name}-alb" }
}

resource "aws_security_group" "ecs_tasks" {
  name        = "${var.app_name}-ecs"
  description = "ECS tasks — inbound from ALB only"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.app_name}-ecs" }
}

##############################################################################
# ALB
##############################################################################

resource "aws_lb" "app" {
  name               = var.app_name
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.public.ids

  tags = { Name = var.app_name }
}

resource "aws_lb_target_group" "app" {
  name        = var.app_name
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "ip"

  health_check {
    path                = "/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }

  tags = { Name = var.app_name }
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# Uncomment after creating an ACM certificate and setting the ARN below:
# resource "aws_lb_listener" "https" {
#   load_balancer_arn = aws_lb.app.arn
#   port              = 443
#   protocol          = "HTTPS"
#   ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
#   certificate_arn   = "arn:aws:acm:us-east-1:ACCOUNT:certificate/CERT-ID"
#
#   default_action {
#     type             = "forward"
#     target_group_arn = aws_lb_target_group.app.arn
#   }
# }

##############################################################################
# IAM — ECS task execution role
##############################################################################

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "${var.app_name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow execution role to pull images from ECR
resource "aws_iam_role_policy" "ecr_pull" {
  name = "ecr-pull"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
      ]
      Resource = "*"
    }]
  })
}

# Task role — what the running container itself can do (separate from execution role)
resource "aws_iam_role" "ecs_task" {
  name               = "${var.app_name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

##############################################################################
# CloudWatch log group
##############################################################################

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${var.app_name}"
  retention_in_days = 30
}

##############################################################################
# ECS cluster + task definition + service
##############################################################################

resource "aws_ecs_cluster" "app" {
  name = var.app_name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = var.app_name }
}

resource "aws_ecs_task_definition" "app" {
  family                   = var.app_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  volume {
    name = "data"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.data.id
      root_directory     = "/"
      transit_encryption = "ENABLED"
    }
  }

  container_definitions = jsonencode([{
    name      = var.app_name
    image     = "${aws_ecr_repository.app.repository_url}:latest"
    essential = true

    portMappings = [{
      containerPort = var.container_port
      protocol      = "tcp"
    }]

    mountPoints = [{
      sourceVolume  = "data"
      containerPath = "/data"
      readOnly      = false
    }]

    # All sensitive values should be moved to AWS Secrets Manager and
    # referenced via "secrets" below. Plain environment only for non-sensitive config.
    environment = [
      { name = "NODE_ENV",              value = "production" },
      { name = "PORT",                  value = tostring(var.container_port) },
      { name = "DB_PATH",               value = "/data/tracker.db" },
      { name = "APP_URL",               value = var.app_url },
      { name = "GOOGLE_CLIENT_ID",      value = var.google_client_id },
      { name = "GOOGLE_CALLBACK_URL",   value = var.google_callback_url },
      { name = "OPERATOR_ADMIN_EMAIL",  value = var.operator_admin_email },
      { name = "REDDIT_CLIENT_ID",      value = var.reddit_client_id },
      { name = "REDDIT_USERNAME",       value = var.reddit_username },
    ]

    # Sensitive values — store in AWS Secrets Manager, reference by ARN here.
    # Example (create each with: aws secretsmanager create-secret --name viral-aio/SESSION_SECRET ...):
    # secrets = [
    #   { name = "SESSION_SECRET",                valueFrom = "arn:aws:secretsmanager:...:viral-aio/SESSION_SECRET::" },
    #   { name = "ANTHROPIC_API_KEY",             valueFrom = "arn:aws:secretsmanager:...:viral-aio/ANTHROPIC_API_KEY::" },
    #   { name = "APIFY_TOKEN",                   valueFrom = "arn:aws:secretsmanager:...:viral-aio/APIFY_TOKEN::" },
    #   { name = "INSTAGRAM_SESSION_ID",          valueFrom = "arn:aws:secretsmanager:...:viral-aio/INSTAGRAM_SESSION_ID::" },
    #   { name = "DISCORD_BOT_TOKEN",             valueFrom = "arn:aws:secretsmanager:...:viral-aio/DISCORD_BOT_TOKEN::" },
    #   { name = "GOOGLE_CLIENT_SECRET",          valueFrom = "arn:aws:secretsmanager:...:viral-aio/GOOGLE_CLIENT_SECRET::" },
    #   { name = "GOOGLE_SERVICE_ACCOUNT_JSON",   valueFrom = "arn:aws:secretsmanager:...:viral-aio/GOOGLE_SERVICE_ACCOUNT_JSON::" },
    #   { name = "STRIPE_SECRET_KEY",             valueFrom = "arn:aws:secretsmanager:...:viral-aio/STRIPE_SECRET_KEY::" },
    #   { name = "STRIPE_WEBHOOK_SECRET",         valueFrom = "arn:aws:secretsmanager:...:viral-aio/STRIPE_WEBHOOK_SECRET::" },
    #   { name = "SESSION_SECRET",                valueFrom = "arn:aws:secretsmanager:...:viral-aio/SESSION_SECRET::" },
    #   { name = "REDDIT_CLIENT_SECRET",          valueFrom = "arn:aws:secretsmanager:...:viral-aio/REDDIT_CLIENT_SECRET::" },
    #   { name = "REDDIT_PASSWORD",               valueFrom = "arn:aws:secretsmanager:...:viral-aio/REDDIT_PASSWORD::" },
    # ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.app.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:${var.container_port}/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 15
    }
  }])
}

resource "aws_ecs_service" "app" {
  name                               = "${var.app_name}-service"
  cluster                            = aws_ecs_cluster.app.id
  task_definition                    = aws_ecs_task_definition.app.arn
  launch_type                        = "FARGATE"
  desired_count                      = 1
  # Keep at 1 until SQLite is replaced with RDS — see architecture note at top
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = data.aws_subnets.public.ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = var.app_name
    container_port   = var.container_port
  }

  depends_on = [
    aws_lb_listener.http_redirect,
    aws_iam_role_policy_attachment.ecs_execution,
    aws_efs_mount_target.data,
  ]

  tags = { Name = "${var.app_name}-service" }
}

##############################################################################
# Outputs
##############################################################################

output "ecr_repository_url" {
  description = "ECR repository URL — use as image base in CI"
  value       = aws_ecr_repository.app.repository_url
}

output "alb_dns_name" {
  description = "ALB DNS name — point your CNAME here"
  value       = aws_lb.app.dns_name
}

output "ecs_cluster_name" {
  description = "ECS cluster name (used in deploy workflow)"
  value       = aws_ecs_cluster.app.name
}

output "ecs_service_name" {
  description = "ECS service name (used in deploy workflow)"
  value       = aws_ecs_service.app.name
}
