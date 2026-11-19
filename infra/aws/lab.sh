#!/usr/bin/env bash
# Atajos para el lab de AWS Academy.
#   ./lab.sh up        crea/actualiza todo (terraform apply)
#   ./lab.sh down      destruye todo (terraform destroy)
#   ./lab.sh roll      reemplaza las instancias para que tomen código nuevo (tras un `up`)
#   ./lab.sh status    salud de las instancias detrás del ALB y estado de la cola
#   ./lab.sh enqueue   encola un notification-batch de prueba
#   ./lab.sh logs [api|worker] [N]  últimas N líneas del log de cada instancia (sin plugin de SSM)
#   ./lab.sh dlq       muestra los mensajes que cayeron en la DLQ
set -euo pipefail
cd "$(dirname "$0")"

PROFILE="${AWS_PROFILE:-academy}"
REGION="${AWS_REGION:-us-east-1}"
aws_() { aws --profile "$PROFILE" --region "$REGION" "$@"; }
out() { terraform output -raw "$1"; }

check_creds() {
  # sts get-caller-identity responde aun con credenciales de una sesión
  # terminada (AWS Academy las revoca con la política voc-cancel-cred), así
  # que se prueba una llamada real de EC2.
  if ! aws_ ec2 describe-availability-zones --query "AvailabilityZones[0].ZoneName" --output text >/dev/null 2>&1; then
    echo "❌ Credenciales inválidas o de una sesión que ya terminó."
    echo "   En el Learner Lab: Start Lab (espera el círculo verde) → AWS Details → AWS CLI → Show,"
    echo "   y pega el bloque NUEVO en ~/.aws/credentials bajo [$PROFILE]."
    exit 1
  fi
}

case "${1:-}" in
  up)
    check_creds
    terraform init -input=false -upgrade >/dev/null
    terraform apply "${@:2}"
    echo
    echo "⏳ Las instancias nuevas tardan ~5 min en instalar y compilar. Revisa con: ./lab.sh status"
    echo "   Si cambiaste código o .env y ya había instancias corriendo: ./lab.sh roll"
    ;;
  roll)
    # Reemplazo escalonado manual (el lab no permite instance refresh):
    # se termina una instancia a la vez sin bajar la capacidad deseada y se
    # espera a que el ASG levante su reemplazo con el launch template nuevo.
    check_creds
    healthy_count() {
      aws_ elbv2 describe-target-health --target-group-arn "$(out target_group_arn)" \
        --query "length(TargetHealthDescriptions[?TargetHealth.State=='healthy'])" --output text
    }
    for ASG in "$(out api_asg)" "$(out worker_asg)"; do
      IDS=$(aws_ autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$ASG" \
        --query 'AutoScalingGroups[0].Instances[].InstanceId' --output text)
      DESIRED=$(aws_ autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$ASG" \
        --query 'AutoScalingGroups[0].DesiredCapacity' --output text)
      for ID in $IDS; do
        echo "♻️  $ASG: terminando $ID"
        # El ASG pudo haberla reemplazado ya por su cuenta (p. ej. por unhealthy).
        if ! aws_ autoscaling terminate-instance-in-auto-scaling-group --instance-id "$ID" \
          --no-should-decrement-desired-capacity >/dev/null 2>&1; then
          echo "   ya no está en el ASG, se omite"
          continue
        fi
        if [ "$ASG" = "$(out api_asg)" ] && [ "$DESIRED" -gt 1 ]; then
          echo "   esperando a que su reemplazo esté healthy en el ALB..."
          sleep 60
          for _ in $(seq 60); do
            [ "$(healthy_count)" -ge "$DESIRED" ] && break
            sleep 15
          done
        fi
      done
    done
    echo "✅ Listo. Revisa con: ./lab.sh status"
    ;;
  down)
    check_creds
    terraform destroy "${@:2}"
    ;;
  status)
    check_creds
    echo "API:      $(out api_url)"
    echo "Frontend: $(terraform output -raw frontend_url 2>/dev/null || echo '-')"
    echo
    echo "── Target group (instancias de la API) ──"
    aws_ elbv2 describe-target-health --target-group-arn "$(out target_group_arn)" \
      --query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State,TargetHealth.Reason]' --output table
    echo "── Auto Scaling ──"
    aws_ autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$(out api_asg)" "$(out worker_asg)" \
      --query 'AutoScalingGroups[].[AutoScalingGroupName,DesiredCapacity,length(Instances)]' --output table
    echo "── Cola ──"
    for q in queue_url dlq_url; do
      aws_ sqs get-queue-attributes --queue-url "$(out $q)" \
        --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
        --query "{cola:'$q',visibles:Attributes.ApproximateNumberOfMessages,en_proceso:Attributes.ApproximateNumberOfMessagesNotVisible}" --output table
    done
    ;;
  enqueue)
    check_creds
    TYPE="${2:-notification-batch}"
    aws_ sqs send-message --queue-url "$(out queue_url)" \
      --message-body "{\"type\":\"$TYPE\",\"scheduledAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
    ;;
  logs)
    check_creds
    ROLE="${2:-worker}"; LINES="${3:-30}"
    IDS=$(aws_ autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$(out ${ROLE}_asg)" \
      --query 'AutoScalingGroups[0].Instances[].InstanceId' --output text)
    for ID in $IDS; do
      CID=$(aws_ ssm send-command --instance-ids "$ID" --document-name AWS-RunShellScript \
        --parameters "commands=[\"journalctl -u rewardshub --no-pager -o cat -n $LINES\"]" \
        --query Command.CommandId --output text)
      aws_ ssm wait command-executed --command-id "$CID" --instance-id "$ID" 2>/dev/null || true
      echo "──────── $ROLE · $ID ────────"
      aws_ ssm get-command-invocation --command-id "$CID" --instance-id "$ID" \
        --query StandardOutputContent --output text
    done
    ;;
  dlq)
    check_creds
    aws_ sqs receive-message --queue-url "$(out dlq_url)" --max-number-of-messages 10 --visibility-timeout 0 \
      --query 'Messages[].Body' --output text
    ;;
  *)
    sed -n '2,10p' "$0"; exit 1 ;;
esac
