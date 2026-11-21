# Redis (P4): caché del mapa de negocios + rate limits compartidos entre las
# instancias de la API.
#
# var.redis_mode:
#   "off"         → nada (default). La API funciona igual: caché apagada y
#                   límites por instancia (en memoria).
#   "elasticache" → ElastiCache for Redis, cache.t3.micro, 1 nodo, sin snapshots.
#   "ec2"         → plan B si el lab no permite ElastiCache: una t3.micro con
#                   Valkey/Redis 6 (AL2023), con LabInstanceProfile.
# La prueba de ElastiCache en el lab (P4.0) está pendiente: ver README → Limitaciones.
#
# En los dos modos el puerto 6379 solo acepta tráfico desde los security
# groups de la API y los workers. Sin TLS ni contraseña (HTTP-only lab, red
# privada de la VPC); la app falla "abierta" si Redis no responde.

locals {
  redis_enabled = var.redis_mode != "off"

  # try(): con count = 0 el índice [0] no existe; así ningún modo rompe el plan
  redis_host = (
    var.redis_mode == "elasticache" ? try(aws_elasticache_cluster.redis[0].cache_nodes[0].address, "") :
    var.redis_mode == "ec2" ? try(aws_instance.redis[0].private_ip, "") :
    ""
  )
  redis_url = local.redis_enabled ? "redis://${local.redis_host}:6379" : ""
}

resource "aws_security_group" "redis" {
  count       = local.redis_enabled ? 1 : 0
  name        = "${var.project}-redis"
  description = "Redis: 6379 solo desde la API y los workers"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis desde API y workers"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id, aws_security_group.worker.id]
  }

  # Salida: el modo ec2 instala paquetes con dnf
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ── ElastiCache ─────────────────────────────────────────────────────────────

resource "aws_elasticache_subnet_group" "redis" {
  count      = var.redis_mode == "elasticache" ? 1 : 0
  name       = "${var.project}-redis"
  subnet_ids = aws_subnet.public[*].id
}

resource "aws_elasticache_cluster" "redis" {
  count                    = var.redis_mode == "elasticache" ? 1 : 0
  cluster_id               = "${var.project}-redis"
  engine                   = "redis"
  engine_version           = var.redis_engine_version
  node_type                = var.redis_node_type
  num_cache_nodes          = 1
  port                     = 6379
  parameter_group_name     = "default.redis7"
  subnet_group_name        = aws_elasticache_subnet_group.redis[0].name
  security_group_ids       = [aws_security_group.redis[0].id]
  snapshot_retention_limit = 0
  apply_immediately        = true
}

# ── Plan B: Redis en EC2 ────────────────────────────────────────────────────

resource "aws_instance" "redis" {
  count                  = var.redis_mode == "ec2" ? 1 : 0
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.redis_instance_type
  subnet_id              = aws_subnet.public[0].id
  vpc_security_group_ids = [aws_security_group.redis[0].id]
  iam_instance_profile   = var.instance_profile_name
  key_name               = var.key_name

  user_data = <<-EOT
    #!/bin/bash
    # Valkey (fork de Redis, en AL2023 recientes) o redis6 si no está.
    set -euxo pipefail
    if dnf install -y valkey; then SVC=valkey; CONF=/etc/valkey/valkey.conf;
    else dnf install -y redis6; SVC=redis6; CONF=/etc/redis6/redis6.conf; fi
    # Escuchar en la VPC (el security group limita quién entra); sin persistencia:
    # es caché y contadores de rate limit, se puede perder sin problema.
    sed -i -E 's/^bind .*/bind 0.0.0.0/; s/^protected-mode .*/protected-mode no/; s/^(save .*)/# \1/' "$CONF"
    grep -q '^maxmemory ' "$CONF" || echo 'maxmemory 256mb' >> "$CONF"
    grep -q '^maxmemory-policy ' "$CONF" || echo 'maxmemory-policy allkeys-lru' >> "$CONF"
    echo 'appendonly no' >> "$CONF"
    echo 'save ""' >> "$CONF"
    systemctl enable --now "$SVC"
  EOT

  tags = { Name = "${var.project}-redis", Role = "redis" }
}
