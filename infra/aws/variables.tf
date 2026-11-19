variable "project" {
  description = "Prefijo para nombrar los recursos."
  type        = string
  default     = "rewardshub"
}

variable "region" {
  description = "AWS Academy Learner Lab solo permite us-east-1 y us-west-2."
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "Perfil de ~/.aws/credentials con las credenciales del lab (AWS Details → AWS CLI)."
  type        = string
  default     = "academy"
}

variable "env_file" {
  description = "Ruta al .env del backend. Se sube a un bucket privado y las instancias lo descargan."
  type        = string
  default     = "../../.env"
}

variable "instance_profile_name" {
  description = "En el Learner Lab no se pueden crear roles IAM; se usa el perfil que ya existe."
  type        = string
  default     = "LabInstanceProfile"
}

variable "instance_type" {
  description = "t3.small como mínimo: npm ci + tsc en 1 GB (t3.micro) suele quedarse sin memoria."
  type        = string
  default     = "t3.small"
}

variable "key_name" {
  description = "Key pair opcional para SSH (en el lab suele existir 'vockey'). null = sin SSH."
  type        = string
  default     = null
}

variable "node_version" {
  description = "≥ 22.12 (o ≥ 20.19): uuid@13 es solo ESM y se carga con require()."
  type        = string
  default     = "22.12.0"
}

# ── Escalado ────────────────────────────────────────────────────────────────

variable "api_min" {
  type    = number
  default = 2
}

variable "api_desired" {
  type    = number
  default = 2
}

variable "api_max" {
  type    = number
  default = 4
}

variable "api_cpu_target" {
  description = "El ASG de la API agrega/quita instancias para mantener este % de CPU promedio."
  type        = number
  default     = 60
}

variable "worker_min" {
  type    = number
  default = 1
}

variable "worker_max" {
  type    = number
  default = 3
}

# ── Cola ────────────────────────────────────────────────────────────────────

variable "sqs_visibility_seconds" {
  description = "Tiempo que un mensaje queda oculto mientras un worker lo procesa (el worker lo renueva)."
  type        = number
  default     = 900
}

variable "sqs_max_receive_count" {
  description = "Intentos antes de mandar el mensaje a la DLQ."
  type        = number
  default     = 5
}

variable "notification_schedule" {
  description = "Cron de EventBridge (UTC). Hoy en Render el batch corre a las 10:00 hora del servidor (UTC)."
  type        = string
  default     = "cron(0 10 * * ? *)"
}

variable "engagement_schedule" {
  description = "Cron de EventBridge (UTC). Hoy en Render corre a las 19:00 hora del servidor (UTC)."
  type        = string
  default     = "cron(0 19 * * ? *)"
}

# ── Rate limiting ───────────────────────────────────────────────────────────

variable "enable_waf" {
  description = "Rate limiting por IP en el ALB con AWS WAF. Apágalo si el lab no permite WAF."
  type        = bool
  default     = true
}

variable "waf_rate_limit" {
  description = "Peticiones máximas por IP en una ventana de 5 minutos antes de bloquear."
  type        = number
  default     = 1000
}

# ── Frontend ────────────────────────────────────────────────────────────────

variable "enable_frontend" {
  description = "Despliega el frontend como sitio estático de S3 (el lab no permite CloudFront)."
  type        = bool
  default     = true
}

variable "frontend_dir" {
  description = "Carpeta del repo del frontend (Vite). Se compila en tu máquina tal como esté en disco."
  type        = string
  default     = "../../../rewardshub_front"
}
