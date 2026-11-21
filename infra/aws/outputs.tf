output "api_url" {
  description = "URL pública de la API (a través del load balancer)."
  value       = "http://${aws_lb.api.dns_name}"
}

output "queue_url" {
  value = aws_sqs_queue.jobs.url
}

output "dlq_url" {
  value = aws_sqs_queue.jobs_dlq.url
}

output "api_asg" {
  value = aws_autoscaling_group.api.name
}

output "worker_asg" {
  value = aws_autoscaling_group.worker.name
}

output "target_group_arn" {
  value = aws_lb_target_group.api.arn
}

output "frontend_url" {
  description = "Frontend (sitio estático de S3, HTTP)."
  value       = var.enable_frontend ? local.frontend_url : null
}

output "redis_mode" {
  value = var.redis_mode
}

output "redis_endpoint" {
  description = "host:6379 de Redis (null con redis_mode = \"off\")."
  value       = local.redis_enabled ? "${local.redis_host}:6379" : null
}

output "redis_cluster_id" {
  value = try(aws_elasticache_cluster.redis[0].cluster_id, null)
}

output "redis_instance_id" {
  value = try(aws_instance.redis[0].id, null)
}

output "ddb_daily_stats_table" {
  value = local.ddb_daily_stats_table != "" ? local.ddb_daily_stats_table : null
}

output "ddb_transactions_table" {
  value = local.ddb_transactions_table != "" ? local.ddb_transactions_table : null
}

output "grafana_instance_id" {
  value = try(aws_instance.grafana[0].id, null)
}

output "grafana_url" {
  description = "URL de Grafana al crearla. La IP pública cambia en cada sesión del lab: usa ./lab.sh grafana."
  value       = try("http://${aws_instance.grafana[0].public_ip}:3000", null)
}

output "grafana_admin_password" {
  description = "Contraseña del usuario admin de Grafana (terraform output -raw grafana_admin_password)."
  value       = try(random_password.grafana_admin[0].result, null)
  sensitive   = true
}
