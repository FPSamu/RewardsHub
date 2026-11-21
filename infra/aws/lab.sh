#!/usr/bin/env bash
# Atajos para el lab de AWS Academy.
#   ./lab.sh up        crea/actualiza todo (terraform apply)
#   ./lab.sh down      destruye todo (terraform destroy)
#   ./lab.sh roll      reemplaza las instancias para que tomen código nuevo (tras un `up`)
#   ./lab.sh status    salud de las instancias detrás del ALB y estado de la cola
#   ./lab.sh enqueue [type] [json]  encola un trabajo (default notification-batch); json = params opcionales
#                      p. ej. ./lab.sh enqueue daily-stats '{"from":"2026-08-01","to":"2026-11-18"}'
#   ./lab.sh logs [api|worker] [N]  últimas N líneas del log de cada instancia (sin plugin de SSM)
#   ./lab.sh dlq       muestra los mensajes que cayeron en la DLQ
#   ./lab.sh grafana   URL actual de Grafana (la IP cambia en cada sesión) y cómo entrar
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
            H="$(healthy_count 2>&1)" || true
            # Sin poder leer la salud del ALB (p. ej. la sesión del lab terminó y las
            # credenciales se revocaron) NO se sigue terminando instancias a ciegas.
            if ! [[ "$H" =~ ^[0-9]+$ ]]; then
              echo "❌ No se pudo leer la salud del ALB: $H"
              echo "   Se detiene el roll. Revisa las credenciales (Start Lab → AWS Details) y vuelve a correr ./lab.sh roll."
              exit 1
            fi
            [ "$H" -ge "$DESIRED" ] && break
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
    echo "── Redis ($(out redis_mode)) ──"
    case "$(out redis_mode)" in
      elasticache)
        aws_ elasticache describe-cache-clusters --cache-cluster-id "$(out redis_cluster_id)" --show-cache-node-info \
          --query 'CacheClusters[0].[CacheClusterStatus,CacheNodes[0].Endpoint.Address,EngineVersion]' --output table ;;
      ec2)
        aws_ ec2 describe-instances --instance-ids "$(out redis_instance_id)" \
          --query 'Reservations[0].Instances[0].[State.Name,PrivateIpAddress,InstanceType]' --output table ;;
      *) echo "apagado (redis_mode = off)" ;;
    esac
    DDB_TABLE="$(terraform output -raw ddb_daily_stats_table 2>/dev/null || true)"
    if [ -n "$DDB_TABLE" ] && [ "$DDB_TABLE" != "null" ]; then
      echo "── Réplica DynamoDB (replicate-dynamo) ──"
      for SRC in daily_stats transactions; do
        SYNCED=$(aws_ dynamodb get-item --table-name "$DDB_TABLE" \
          --key "{\"pk\":{\"S\":\"META#replication\"},\"sk\":{\"S\":\"$SRC\"}}" \
          --query 'Item.syncedAt.S' --output text 2>/dev/null || echo None)
        if [ "$SYNCED" = "None" ] || [ -z "$SYNCED" ]; then
          echo "$SRC: aún sin sincronizar"
        else
          LAG=$(( $(date -u +%s) - $(date -u -d "$SYNCED" +%s) ))
          echo "$SRC: al día hasta $SYNCED (retraso $(( LAG / 60 )) min $(( LAG % 60 )) s)"
        fi
      done
    fi
    echo "── Cola ──"
    for q in queue_url dlq_url; do
      aws_ sqs get-queue-attributes --queue-url "$(out $q)" \
        --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
        --query "{cola:'$q',visibles:Attributes.ApproximateNumberOfMessages,en_proceso:Attributes.ApproximateNumberOfMessagesNotVisible}" --output table
    done
    ;;
  enqueue)
    # ./lab.sh enqueue <type> [json-params]
    #   ./lab.sh enqueue daily-stats '{"day":"2026-11-18"}'
    #   ./lab.sh enqueue daily-stats '{"from":"2026-08-01","to":"2026-11-18"}'   # el worker lo parte por semanas
    #   ./lab.sh enqueue reconcile-balances
    #   ./lab.sh enqueue reconcile-balances '{"businessId":"<id>"}'
    #   ./lab.sh enqueue replicate-dynamo
    # El worker valida los params y descarta (con log) un mensaje inválido.
    TYPE="${2:-notification-batch}"
    PARAMS="${3:-}"
    case "$TYPE" in
      notification-batch|engagement-batch|daily-stats|reconcile-balances|replicate-dynamo) ;;
      *) echo "❌ Tipo desconocido: $TYPE (notification-batch | engagement-batch | daily-stats | reconcile-balances | replicate-dynamo)"; exit 1 ;;
    esac
    if [ -n "$PARAMS" ]; then
      # Validar el JSON antes de gastar una llamada (python3 viene con la AWS CLI v1 y casi cualquier sistema)
      if command -v python3 >/dev/null 2>&1; then
        python3 -c 'import json,sys; v=json.loads(sys.argv[1]); assert isinstance(v, dict)' "$PARAMS" 2>/dev/null \
          || { echo "❌ params debe ser un objeto JSON, p. ej. '{\"day\":\"2026-11-18\"}'"; exit 1; }
      fi
      BODY="{\"type\":\"$TYPE\",\"scheduledAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"params\":$PARAMS}"
    else
      BODY="{\"type\":\"$TYPE\",\"scheduledAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
    fi
    check_creds
    echo "📨 $BODY"
    aws_ sqs send-message --queue-url "$(out queue_url)" --message-body "$BODY"
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
  grafana)
    ID="$(terraform output -raw grafana_instance_id 2>/dev/null || true)"
    if [ -z "$ID" ] || [ "$ID" = "null" ]; then
      echo "Grafana está apagado: pon enable_grafana = true y admin_cidr en terraform.tfvars y corre ./lab.sh up"
      exit 1
    fi
    check_creds
    # La IP pública cambia cada vez que el lab detiene y arranca la instancia
    read -r STATE IP <<<"$(aws_ ec2 describe-instances --instance-ids "$ID" \
      --query 'Reservations[0].Instances[0].[State.Name,PublicIpAddress]' --output text)"
    if [ "$STATE" != "running" ]; then
      echo "La instancia de Grafana ($ID) está '$STATE'. Arráncala desde la consola o con ./lab.sh up."
      exit 1
    fi
    echo "Grafana:    http://$IP:3000   (solo desde admin_cidr)"
    echo "Usuario:    admin"
    echo "Contraseña: terraform output -raw grafana_admin_password"
    echo "Dashboard:  RewardsHub → RewardsHub · Lab (tarda ~3 min en instalarse tras crear la instancia)"
    ;;
  dlq)
    check_creds
    aws_ sqs receive-message --queue-url "$(out dlq_url)" --max-number-of-messages 10 --visibility-timeout 0 \
      --query 'Messages[].Body' --output text
    ;;
  *)
    sed -n '2,12p' "$0"; exit 1 ;;
esac
