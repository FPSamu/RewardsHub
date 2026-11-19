# Scheduler: reemplaza el setTimeout/setInterval de src/index.ts, que con N
# instancias dispararía cada batch N veces. Las reglas publican un mensaje en
# la cola y un solo worker lo ejecuta.

locals {
  scheduled_jobs = {
    "notification-batch" = var.notification_schedule
    "engagement-batch"   = var.engagement_schedule
  }
}

resource "aws_cloudwatch_event_rule" "jobs" {
  for_each            = local.scheduled_jobs
  name                = "${var.project}-${each.key}"
  description         = "Encola ${each.key} en SQS"
  schedule_expression = each.value
}

resource "aws_cloudwatch_event_target" "jobs" {
  for_each = local.scheduled_jobs
  rule     = aws_cloudwatch_event_rule.jobs[each.key].name
  arn      = aws_sqs_queue.jobs.arn

  # Mensaje que entiende src/queue/jobs.ts. `time` es la hora programada del
  # evento: los reintentos de EventBridge traen la misma y el worker los deduplica.
  input_transformer {
    input_paths    = { time = "$.time" }
    input_template = "{\"type\": \"${each.key}\", \"scheduledAt\": <time>}"
  }
}
