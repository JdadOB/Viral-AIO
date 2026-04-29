variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "app_name" {
  description = "Short name used to tag all resources"
  type        = string
  default     = "viral-aio"
}

variable "container_port" {
  description = "Port the container listens on"
  type        = number
  default     = 3000
}

variable "task_cpu" {
  description = "Fargate task CPU units (256 = 0.25 vCPU)"
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Fargate task memory in MiB"
  type        = number
  default     = 1024
}

# ── Secrets (supply via terraform.tfvars or environment, never commit values) ──

variable "session_secret" {
  description = "SESSION_SECRET — at least 32 random characters"
  type        = string
  sensitive   = true
}

variable "anthropic_api_key" {
  description = "ANTHROPIC_API_KEY"
  type        = string
  sensitive   = true
}

variable "apify_token" {
  description = "APIFY_TOKEN"
  type        = string
  sensitive   = true
  default     = ""
}

variable "instagram_session_id" {
  description = "INSTAGRAM_SESSION_ID (optional)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "discord_bot_token" {
  description = "DISCORD_BOT_TOKEN (optional)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "google_client_id" {
  description = "GOOGLE_CLIENT_ID (optional — Google OAuth)"
  type        = string
  default     = ""
}

variable "google_client_secret" {
  description = "GOOGLE_CLIENT_SECRET (optional)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "google_callback_url" {
  description = "GOOGLE_CALLBACK_URL (optional)"
  type        = string
  default     = ""
}

variable "google_service_account_json" {
  description = "Full contents of the Google service account JSON key (Sheets integration)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "stripe_secret_key" {
  description = "STRIPE_SECRET_KEY"
  type        = string
  sensitive   = true
  default     = ""
}

variable "stripe_webhook_secret" {
  description = "STRIPE_WEBHOOK_SECRET"
  type        = string
  sensitive   = true
  default     = ""
}

variable "app_url" {
  description = "APP_URL — public URL of the deployed app (e.g. https://app.example.com)"
  type        = string
}

variable "operator_admin_email" {
  description = "OPERATOR_ADMIN_EMAIL — promoted to admin on first boot"
  type        = string
  default     = ""
}

variable "reddit_client_id" {
  description = "REDDIT_CLIENT_ID (optional)"
  type        = string
  default     = ""
}

variable "reddit_client_secret" {
  description = "REDDIT_CLIENT_SECRET (optional)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "reddit_username" {
  description = "REDDIT_USERNAME (optional)"
  type        = string
  default     = ""
}

variable "reddit_password" {
  description = "REDDIT_PASSWORD (optional)"
  type        = string
  sensitive   = true
  default     = ""
}
