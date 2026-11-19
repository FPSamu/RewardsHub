data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}

locals {
  common_user_data = {
    node_version       = var.node_version
    bucket             = local.artifacts_bucket
    app_key            = aws_s3_object.app.key
    env_key            = aws_s3_object.env.key
    region             = var.region
    queue_url          = aws_sqs_queue.jobs.url
    visibility_seconds = var.sqs_visibility_seconds
    frontend_url       = local.frontend_url
  }

  roles = {
    api = {
      entrypoint   = "index"
      stop_timeout = 30
      sg           = aws_security_group.api.id
    }
    worker = {
      entrypoint   = "worker"
      stop_timeout = 300 # deja terminar el batch en curso antes de matar la instancia
      sg           = aws_security_group.worker.id
    }
  }
}

resource "aws_launch_template" "app" {
  for_each      = local.roles
  name_prefix   = "${var.project}-${each.key}-"
  image_id      = data.aws_ami.al2023.id
  instance_type = var.instance_type
  key_name      = var.key_name

  iam_instance_profile {
    name = var.instance_profile_name
  }

  vpc_security_group_ids = [each.value.sg]

  metadata_options {
    http_tokens                 = "required" # IMDSv2
    http_put_response_hop_limit = 2
  }

  user_data = base64encode(templatefile("${path.module}/user_data.sh.tftpl", merge(local.common_user_data, {
    role         = each.key
    entrypoint   = each.value.entrypoint
    stop_timeout = each.value.stop_timeout
  })))

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "${var.project}-${each.key}", Role = each.key }
  }
}

# Nota: la SCP del Learner Lab niega autoscaling:StartInstanceRefresh, así que
# no hay bloque instance_refresh. Al cambiar código, el ASG apunta a la nueva
# versión del launch template y `./lab.sh roll` reemplaza las instancias.

# ── API: detrás del ALB, escala por CPU ─────────────────────────────────────

resource "aws_autoscaling_group" "api" {
  name                      = "${var.project}-api"
  min_size                  = var.api_min
  desired_capacity          = var.api_desired
  max_size                  = var.api_max
  vpc_zone_identifier       = aws_subnet.public[*].id
  target_group_arns         = [aws_lb_target_group.api.arn]
  health_check_type         = "ELB"
  health_check_grace_period = 600 # npm ci + build tardan unos minutos

  launch_template {
    id      = aws_launch_template.app["api"].id
    version = aws_launch_template.app["api"].latest_version
  }


  tag {
    key                 = "Name"
    value               = "${var.project}-api"
    propagate_at_launch = true
  }

  lifecycle {
    ignore_changes = [desired_capacity] # lo mueve el autoscaling
  }
}

resource "aws_autoscaling_policy" "api_cpu" {
  name                   = "${var.project}-api-cpu"
  autoscaling_group_name = aws_autoscaling_group.api.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = var.api_cpu_target
  }
}

# ── Workers: consumen la cola, escalan por mensajes pendientes ──────────────

resource "aws_autoscaling_group" "worker" {
  name                      = "${var.project}-worker"
  min_size                  = var.worker_min
  desired_capacity          = var.worker_min
  max_size                  = var.worker_max
  vpc_zone_identifier       = aws_subnet.public[*].id
  health_check_type         = "EC2"
  health_check_grace_period = 600

  launch_template {
    id      = aws_launch_template.app["worker"].id
    version = aws_launch_template.app["worker"].latest_version
  }


  tag {
    key                 = "Name"
    value               = "${var.project}-worker"
    propagate_at_launch = true
  }

  lifecycle {
    ignore_changes = [desired_capacity]
  }
}

resource "aws_autoscaling_policy" "worker_out" {
  name                   = "${var.project}-worker-scale-out"
  autoscaling_group_name = aws_autoscaling_group.worker.name
  adjustment_type        = "ChangeInCapacity"
  scaling_adjustment     = 1
  cooldown               = 300
}

resource "aws_autoscaling_policy" "worker_in" {
  name                   = "${var.project}-worker-scale-in"
  autoscaling_group_name = aws_autoscaling_group.worker.name
  adjustment_type        = "ChangeInCapacity"
  scaling_adjustment     = -1
  cooldown               = 300
}

resource "aws_cloudwatch_metric_alarm" "queue_backlog" {
  alarm_name          = "${var.project}-jobs-backlog"
  alarm_description   = "Hay trabajos esperando en la cola: agregar un worker"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.jobs.name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = [aws_autoscaling_policy.worker_out.arn]
}

resource "aws_cloudwatch_metric_alarm" "queue_empty" {
  alarm_name          = "${var.project}-jobs-empty"
  alarm_description   = "Cola vacía: quitar workers extra (nunca baja de worker_min)"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.jobs.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 0
  comparison_operator = "LessThanOrEqualToThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_autoscaling_policy.worker_in.arn]
}
