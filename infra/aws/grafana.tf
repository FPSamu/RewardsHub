# Grafana OSS sobre CloudWatch (P6). Amazon Managed Grafana necesita IAM
# Identity Center / roles de servicio, que el Learner Lab no da: se usa una
# t3.micro con Grafana, y LabInstanceProfile le da lectura de CloudWatch.
#
# Una sola instancia a propósito: los dashboards son código
# (grafana/dashboards/*.json, en git), así que la instancia es desechable.
# Su IP pública cambia en cada sesión del lab → `./lab.sh grafana` da la URL.
#
# enable_grafana = true (default). admin_cidr: si no lo pones, ./lab.sh up usa tu IP
# pública (nunca 0.0.0.0/0). enable_grafana = false no crea nada.

locals {
  grafana_dashboards_dir = "${path.module}/grafana/dashboards"
  grafana_dashboards     = var.enable_grafana ? fileset(local.grafana_dashboards_dir, "*.json") : []
}

resource "random_password" "grafana_admin" {
  count   = var.enable_grafana ? 1 : 0
  length  = 20
  special = false # va a un archivo de entorno vía user_data: sin caracteres que haya que escapar
}

resource "aws_security_group" "grafana" {
  count       = var.enable_grafana ? 1 : 0
  name        = "${var.project}-grafana"
  description = "Grafana: puerto 3000 solo desde admin_cidr"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "Grafana desde la IP del administrador"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = [coalesce(var.admin_cidr, "127.0.0.1/32")]
  }

  dynamic "ingress" {
    for_each = var.key_name == null ? [] : [1]
    content {
      description = "SSH desde la IP del administrador"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [coalesce(var.admin_cidr, "127.0.0.1/32")]
    }
  }

  # Salida: dnf (repo de Grafana) y la API de CloudWatch
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    precondition {
      condition     = var.admin_cidr != null
      error_message = "enable_grafana = true requiere admin_cidr (tu IP pública /32, p. ej. \"203.0.113.7/32\"). Grafana nunca se abre a 0.0.0.0/0."
    }
  }
}

# Los dashboards viajan por el bucket privado de artefactos (como el zip de la app)
resource "aws_s3_object" "grafana_dashboards" {
  for_each               = local.grafana_dashboards
  bucket                 = local.artifacts_bucket
  key                    = "grafana/dashboards/${each.value}"
  source                 = "${local.grafana_dashboards_dir}/${each.value}"
  etag                   = filemd5("${local.grafana_dashboards_dir}/${each.value}")
  server_side_encryption = "AES256"
}

resource "aws_instance" "grafana" {
  count                       = var.enable_grafana ? 1 : 0
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.grafana_instance_type
  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.grafana[0].id]
  iam_instance_profile        = var.instance_profile_name
  key_name                    = var.key_name
  user_data_replace_on_change = true # cambiar un dashboard = instancia nueva (es desechable)

  user_data = templatefile("${path.module}/user_data_grafana.sh.tftpl", {
    region             = var.region
    bucket             = local.artifacts_bucket
    admin_password     = random_password.grafana_admin[0].result
    anonymous_viewer   = var.grafana_anonymous_viewer
    dashboards_version = md5(join(",", [for f in sort(tolist(local.grafana_dashboards)) : filemd5("${local.grafana_dashboards_dir}/${f}")]))

    # Nombres reales que reemplazan los __MARCADORES__ del JSON de los dashboards
    project       = var.project
    alb           = aws_lb.api.arn_suffix
    target_group  = aws_lb_target_group.api.arn_suffix
    api_asg       = aws_autoscaling_group.api.name
    worker_asg    = aws_autoscaling_group.worker.name
    queue         = aws_sqs_queue.jobs.name
    dlq           = aws_sqs_queue.jobs_dlq.name
    waf_acl       = var.enable_waf ? aws_wafv2_web_acl.api[0].name : ""
    waf_rule      = "${var.project}-rate-limit" # metric_name de la regla rate-limit-per-ip (waf.tf)
    redis_cluster = try(aws_elasticache_cluster.redis[0].cluster_id, "")
    # Tablas de DynamoDB (P5); vacías con enable_dynamo = false → paneles "Sin datos"
    ddb_daily_stats  = local.ddb_daily_stats_table
    ddb_transactions = local.ddb_transactions_table
  })

  depends_on = [aws_s3_object.grafana_dashboards]

  tags = { Name = "${var.project}-grafana", Role = "grafana" }
}
