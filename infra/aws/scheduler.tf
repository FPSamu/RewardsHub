# Scheduler: reemplaza el setTimeout/setInterval de src/index.ts, que con N
# instancias dispararía cada batch N veces. Las reglas publican un mensaje en
# la cola y un solo worker lo ejecuta.

# Un horario vacío ("") apaga ese trabajo (no se crea la regla).
locals {
  scheduled_jobs = {
    for type, schedule in {
      "notification-batch" = var.notification_schedule
      "engagement-batch"   = var.engagement_schedule
      "daily-stats"        = var.daily_stats_schedule
      "reconcile-balances" = var.reconcile_schedule
      "replicate-dynamo"   = var.enable_dynamo ? var.replicate_schedule : ""
    } : type => schedule if schedule != ""
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
  # Sin params: daily-stats recalcula los últimos 2 días UTC y reconcile revisa todo.
  input_transformer {
    input_paths    = { time = "$.time" }
    input_template = "{\"type\": \"${each.key}\", \"scheduledAt\": <time>}"
  }
}
