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
