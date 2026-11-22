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
  default     = "../../.env.lab"
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

# ── Base de datos ───────────────────────────────────────────────────────────

variable "lab_db_name" {
  description = "Base de MongoDB del lab (DB_NAME). Es la base de la instancia Mongo del lab (mongo.tf) y la única en la que el usuario de la app puede escribir. Debe terminar en _lab/_test/test (assertNonProductionDb)."
  type        = string
  default     = "rewardshub_lab"

  validation {
    condition     = var.lab_db_name == "" || can(regex("(_lab|_test|test)$", var.lab_db_name))
    error_message = "lab_db_name debe terminar en _lab, _test o test (es lo que acepta assertNonProductionDb)."
  }
}

variable "mongo_max_pool_size" {
  description = "Conexiones a Mongo por proceso (MONGO_MAX_POOL_SIZE). El default del driver es 100; con hasta 7 procesos son 140 conexiones a la instancia Mongo del lab en vez de 700."
  type        = number
  default     = 20
}

# ── MongoDB en EC2 (mongo.tf) ───────────────────────────────────────────────

variable "enable_mongo" {
  description = "MongoDB 7 (replica set rs0) en una EC2 dentro de la VPC; Terraform escribe MONGO_URI en /etc/rewardshub.env. false = sin base (solo para probar la infraestructura). El lab nunca usa Atlas."
  type        = bool
  default     = true
}

variable "mongo_instance_type" {
  type    = string
  default = "t3.medium"
}

variable "mongo_image" {
  description = "Imagen oficial de MongoDB, con versión fija (nunca latest)."
  type        = string
  default     = "mongo:7.0"

  validation {
    condition     = can(regex("^mongo:7\\.0(\\.[0-9]+)?$", var.mongo_image))
    error_message = "mongo_image debe ser mongo:7.0 o mongo:7.0.N (versión fija, nunca latest)."
  }
}

variable "mongo_volume_gb" {
  description = "Volumen gp3 de datos (/data/db). Se borra con la instancia: los datos se pierden con ./lab.sh down."
  type        = number
  default     = 20
}

variable "mongo_wiredtiger_cache_gb" {
  description = "Caché de WiredTiger. La t3.medium tiene 4 GB; el default de Mongo (50 % de RAM − 1 GB) es parecido, pero dentro de Docker conviene fijarlo."
  type        = number
  default     = 1.5
}

variable "mongo_connect_retries" {
  description = "MONGO_CONNECT_RETRIES de la API y los workers: reintentos (con espera creciente, máx. 30 s) si Mongo todavía no responde al arrancar."
  type        = number
  default     = 20
}

# ── Banderas de la app (todas apagadas por defecto) ─────────────────────────

variable "geo_query_mode" {
  description = "GEO_QUERY_MODE de la API: \"geo\" usa el índice 2dsphere en el mapa (/business/nearby, /in-bounds, /all); \"legacy\" = consulta por recuadro de siempre. La base del lab ya trae geo si se llenó con npm run seed:lab."
  type        = string
  default     = "legacy"

  validation {
    condition     = contains(["legacy", "geo"], var.geo_query_mode)
    error_message = "geo_query_mode debe ser \"legacy\" o \"geo\"."
  }
}

variable "stats_source" {
  description = "STATS_SOURCE de la API: \"daily\" lee las estadísticas del dashboard de daily_stats (+ hoy en vivo); \"dynamo\" de la réplica en DynamoDB (requiere enable_dynamo; respaldo en Mongo) y los reportes también; \"live\" = agregación completa de siempre."
  type        = string
  default     = "live"

  validation {
    condition     = contains(["live", "daily", "dynamo"], var.stats_source)
    error_message = "stats_source debe ser \"live\", \"daily\" o \"dynamo\"."
  }
}

# ── Redis (P4) ──────────────────────────────────────────────────────────────

variable "redis_mode" {
  description = "\"off\" (default) | \"elasticache\" | \"ec2\" (plan B si el lab no permite ElastiCache). Ver README → Limitaciones: la prueba de ElastiCache está pendiente."
  type        = string
  default     = "off"

  validation {
    condition     = contains(["off", "elasticache", "ec2"], var.redis_mode)
    error_message = "redis_mode debe ser \"off\", \"elasticache\" o \"ec2\"."
  }
}

variable "redis_node_type" {
  description = "Tipo de nodo de ElastiCache (modo elasticache)."
  type        = string
  default     = "cache.t3.micro"
}

variable "redis_engine_version" {
  description = "Versión de Redis en ElastiCache (modo elasticache). Debe corresponder al parameter group default.redis7."
  type        = string
  default     = "7.1"
}

variable "redis_instance_type" {
  description = "Instancia EC2 para Redis/Valkey (modo ec2)."
  type        = string
  default     = "t3.micro"
}

variable "enable_rate_limits" {
  description = "RATE_LIMITS=on en la API: límites en login/registro/recuperar contraseña, PIN de administrador y reportes. Sin Redis cada instancia cuenta por su lado; con Redis el límite es global."
  type        = bool
  default     = true
}

variable "cache_bizmap_ttl" {
  description = "Segundos que vive en Redis la caché del mapa de negocios (CACHE_BIZMAP_TTL)."
  type        = number
  default     = 120
}

# ── DynamoDB (P5) ───────────────────────────────────────────────────────────

variable "enable_dynamo" {
  description = "Réplica de lectura en DynamoDB (tablas daily-stats y transactions) + job replicate-dynamo. La prueba en el lab está pendiente: ver README → Limitaciones."
  type        = bool
  default     = false
}

variable "replicate_schedule" {
  description = "Cada cuánto EventBridge encola replicate-dynamo (solo con enable_dynamo). \"\" lo apaga."
  type        = string
  default     = "rate(10 minutes)"
}

variable "backlog_age_seconds" {
  description = "La alarma jobs-backlog agrega un worker cuando el mensaje más viejo de la cola lleva más de esto esperando (2 minutos seguidos). Con trabajos cada 10 min, contar mensajes visibles hacía escalar sin necesidad."
  type        = number
  default     = 120
}

# ── Observabilidad (P6) ─────────────────────────────────────────────────────

variable "enable_grafana" {
  description = "Instancia t3.micro con Grafana OSS sobre CloudWatch. Requiere admin_cidr."
  type        = bool
  default     = false
}

variable "admin_cidr" {
  description = "Tu IP pública en CIDR (p. ej. \"203.0.113.7/32\"): la única que puede abrir Grafana (puerto 3000). Obligatoria con enable_grafana."
  type        = string
  default     = null

  validation {
    condition     = var.admin_cidr == null || can(cidrhost(var.admin_cidr, 0))
    error_message = "admin_cidr debe ser un CIDR válido, p. ej. \"203.0.113.7/32\"."
  }
}

variable "grafana_instance_type" {
  type    = string
  default = "t3.micro"
}

variable "grafana_anonymous_viewer" {
  description = "Permite ver los dashboards sin login (rol Viewer), útil para la demo en clase. Sigue limitado a admin_cidr."
  type        = bool
  default     = false
}

variable "enable_app_metrics" {
  description = "METRICS_ENABLED=true en la API y los workers: publican métricas propias (namespace RewardsHub) con PutMetricData cada 60 s."
  type        = bool
  default     = false
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

variable "daily_stats_schedule" {
  description = "Cron de EventBridge (UTC) del job daily-stats: recalcula los últimos 2 días UTC de cada negocio en daily_stats. 06:15 UTC ≈ 00:15 Ciudad de México. \"\" lo apaga."
  type        = string
  default     = "cron(15 6 * * ? *)"
}

variable "reconcile_schedule" {
  description = "Cron de EventBridge (UTC) del job reconcile-balances (solo reporta, no corrige). \"\" lo apaga."
  type        = string
  default     = "cron(30 7 * * ? *)"
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
  description = "Carpeta del repo del frontend (Vite): ruta absoluta o relativa a infra/aws. Se compila en tu máquina tal como esté en disco (npm de tu PATH: corre ./lab.sh con nvm cargado)."
  type        = string
  default     = "../../../rewardshub_front"
}
