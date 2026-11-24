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
#   ./lab.sh seed [args]            llena rewardshub_lab con el dataset del lab (desde una instancia de la API, dentro de la VPC)
#   ./lab.sh run <script> [args]    corre un script de mantenimiento en una instancia de la API:
#                      compare-stats-sources | migrate-locations-geo | find-duplicate-memberships | reconcile-fix | seed
#   ./lab.sh mongo-eval '<js>'      corre JS (mongosh) en la instancia de Mongo como el usuario de la app, en rewardshub_lab
#   ./lab.sh demo [escenario]  pruebas guiadas con log para seguirlas en Grafana (sin escenario: la lista)
#   ./lab.sh activate  verifica todas las cuentas y da suscripción lifetime a todos los negocios (sin correo ni Stripe)
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

# Corre un comando en una instancia vía SSM (sin plugin de sesiones) y espera
# a que termine (sin el tope de ~100 s de `ssm wait`). Imprime stdout/stderr y
# devuelve el código de salida del comando. Nunca se mandan contraseñas: los
# comandos solo usan archivos que ya están en la instancia.
#   ssm_run <instance-id> <comando> [timeout-segundos]
ssm_run() {
  local id="$1" cmd="$2" timeout="${3:-3600}" params cid status
  params=$(python3 -c 'import json,sys; print(json.dumps({"commands":[sys.argv[1]],"executionTimeout":[sys.argv[2]]}))' "$cmd" "$timeout")
  cid=$(aws_ ssm send-command --instance-ids "$id" --document-name AWS-RunShellScript \
    --parameters "$params" --timeout-seconds 600 --query Command.CommandId --output text)
  for _ in $(seq $(( timeout / 5 + 24 ))); do
    sleep 5
    status=$(aws_ ssm get-command-invocation --command-id "$cid" --instance-id "$id" \
      --query Status --output text 2>/dev/null || echo Pending)
    case "$status" in Pending|InProgress|Delayed) continue ;; esac
    break
  done
  aws_ ssm get-command-invocation --command-id "$cid" --instance-id "$id" \
    --query StandardOutputContent --output text
  local err
  err=$(aws_ ssm get-command-invocation --command-id "$cid" --instance-id "$id" \
    --query StandardErrorContent --output text)
  [ -n "$err" ] && [ "$err" != "None" ] && echo "$err" >&2
  [ "$status" = "Success" ]
}

# Primera instancia InService (y healthy, si es de la API) de un ASG
first_instance() {
  local role="$1"
  aws_ autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$(out "${role}_asg")" \
    --query "AutoScalingGroups[0].Instances[?LifecycleState=='InService' && HealthStatus=='Healthy'] | [0].InstanceId" --output text
}

# Argumentos que viajan a la instancia: solo caracteres seguros (se arman en
# una línea de shell remota) y nunca --prod.
safe_args() {
  local a
  for a in "$@"; do
    if [ "$a" = "--prod" ]; then echo "❌ --prod no se permite desde el lab" >&2; return 1; fi
    if ! [[ "$a" =~ ^[A-Za-z0-9_.,:=@/+-]+$ ]]; then echo "❌ Argumento no permitido: $a" >&2; return 1; fi
  done
}

case "${1:-}" in
  up)
    check_creds
    terraform init -input=false -upgrade >/dev/null
    # Grafana (enable_grafana) solo se abre a admin_cidr. Si no está en ningún
    # *.tfvars ni en TF_VAR_admin_cidr, se usa tu IP pública actual.
    if [ -z "${TF_VAR_admin_cidr:-}" ] && ! grep -Eqs '^[[:space:]]*admin_cidr[[:space:]]*=' ./*.tfvars; then
      MYIP=$(curl -fsS --max-time 5 https://checkip.amazonaws.com | tr -d '[:space:]' || true)
      if [[ "$MYIP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        export TF_VAR_admin_cidr="$MYIP/32"
        echo "🌐 admin_cidr = $TF_VAR_admin_cidr (tu IP pública; Grafana solo acepta esa IP)"
      else
        echo "⚠️  No se pudo leer tu IP pública: si enable_grafana = true, pon admin_cidr en terraform.tfvars"
      fi
    fi
    terraform apply "${@:2}"
    SKIP="$(terraform output -raw frontend_skipped_reason 2>/dev/null || true)"
    if [ -n "$SKIP" ] && [ "$SKIP" != "null" ]; then echo "⚠️  Frontend omitido: $SKIP"; fi
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
    MONGO_ID="$(terraform output -raw mongo_instance_id 2>/dev/null || true)"
    if [ -n "$MONGO_ID" ] && [ "$MONGO_ID" != "null" ]; then
      echo "── MongoDB (EC2 $(out mongo_private_ip), replica set rs0) ──"
      MSTATE=$(aws_ ec2 describe-instances --instance-ids "$MONGO_ID" --query 'Reservations[0].Instances[0].State.Name' --output text)
      echo "instancia $MONGO_ID: $MSTATE"
      if [ "$MSTATE" = "running" ]; then
        if H=$(ssm_run "$MONGO_ID" "/usr/local/sbin/rh-mongo-health" 60 2>&1); then
          if python3 -c 'import json,sys; d=json.loads(sys.argv[1].strip().splitlines()[-1]); sys.exit(0 if d.get("ok")==1 and d.get("state")=="PRIMARY" else 1)' "$H" 2>/dev/null; then
            echo "✅ rs.status() OK · PRIMARY · $(echo "$H" | tail -1)"
          else
            echo "⚠️  rs.status(): $H"
          fi
        else
          echo "⚠️  Sin respuesta de rh-mongo-health (¿sigue arrancando? ~2 min tras crear la instancia): $H"
        fi
      fi
    fi
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
          echo "⏳ $SRC: aún sin sincronizar (la primera pasada llega ≤ 10 min tras el up, o: ./lab.sh enqueue replicate-dynamo)"
        else
          LAG=$(( $(date -u +%s) - $(date -u -d "$SYNCED" +%s) ))
          # replicate-dynamo corre cada 10 min: más de 15 min de retraso = algo no está corriendo
          if [ "$LAG" -lt 900 ]; then MARK="✅"; else MARK="⚠️  (> 15 min: ./lab.sh logs worker | grep replicate-dynamo)"; fi
          echo "$MARK $SRC: al día hasta $SYNCED (retraso $(( LAG / 60 )) min $(( LAG % 60 )) s)"
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
    [[ "$ROLE" =~ ^(api|worker)$ ]] || { echo "❌ rol: api | worker"; exit 1; }
    [[ "$LINES" =~ ^[0-9]+$ ]] || { echo "❌ N debe ser un número"; exit 1; }
    IDS=$(aws_ autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$(out ${ROLE}_asg)" \
      --query 'AutoScalingGroups[0].Instances[].InstanceId' --output text)
    for ID in $IDS; do
      echo "──────── $ROLE · $ID ────────"
      ssm_run "$ID" "journalctl -u rewardshub --no-pager -o cat -n $LINES" 120 || true
    done
    ;;
  seed|run)
    # ./lab.sh seed [--reset] [--businesses N …]
    # ./lab.sh run <script> [args]   (rh-cli valida el nombre del script)
    if [ "$1" = "seed" ]; then SCRIPT=seed; ARGS=("${@:2}"); else SCRIPT="${2:-}"; ARGS=("${@:3}"); fi
    case "$SCRIPT" in
      seed|compare-stats-sources|migrate-locations-geo|find-duplicate-memberships|reconcile-fix) ;;
      *) echo "❌ Script desconocido: '$SCRIPT' (seed | compare-stats-sources | migrate-locations-geo | find-duplicate-memberships | reconcile-fix)"; exit 1 ;;
    esac
    safe_args ${ARGS[@]+"${ARGS[@]}"} || exit 1  # bash 3.2 (macOS) + set -u: arreglo vacío
    check_creds
    ID=$(first_instance api)
    if [ -z "$ID" ] || [ "$ID" = "None" ]; then echo "❌ No hay una instancia de la API InService/Healthy todavía (./lab.sh status)"; exit 1; fi
    echo "🖥️  $SCRIPT en $ID (dentro de la VPC, entorno de /etc/rewardshub.env)"
    ssm_run "$ID" "/usr/local/bin/rh-cli $SCRIPT ${ARGS[*]+${ARGS[*]}}"
    ;;
  mongo-eval)
    # ./lab.sh mongo-eval 'db.userpoints.countDocuments()'
    # El JS viaja en base64; las credenciales las lee la instancia de un archivo solo-root.
    JS="${2:-}"
    [ -n "$JS" ] || { echo "Uso: ./lab.sh mongo-eval '<js>'   (p. ej. 'db.businesses.countDocuments()')"; exit 1; }
    check_creds
    MONGO_ID="$(terraform output -raw mongo_instance_id 2>/dev/null || true)"
    [ -n "$MONGO_ID" ] && [ "$MONGO_ID" != "null" ] || { echo "❌ No hay instancia de Mongo (enable_mongo = false)"; exit 1; }
    B64=$(printf '%s' "$JS" | base64 | tr -d '\n')
    ssm_run "$MONGO_ID" "/usr/local/sbin/rh-mongo-eval $B64" 300
    ;;
  demo)
    # Pruebas guiadas con log (scripts/lab/demo.mjs): ./lab.sh demo para ver la lista
    check_creds
    command -v node >/dev/null || { echo "❌ Necesitas Node ≥ 18 en tu máquina"; exit 1; }
    exec node ../../scripts/lab/demo.mjs "${@:2}"
    ;;
  activate)
    # En el lab no hay correo ni webhooks de Stripe: las cuentas registradas
    # desde la web se quedan sin verificar y los negocios sin suscripción (el
    # front los manda a /verify-pending o a /business/subscription y no salen
    # en el mapa). Esto las deja listas para probar. Solo toca rewardshub_lab
    # (el usuario de Mongo de la app no puede escribir en otra base).
    # Se puede repetir: correrlo de nuevo después de registrar cuentas nuevas.
    exec "$0" mongo-eval "
      const now = new Date();
      const u = db.users.updateMany({ isVerified: { \$ne: true } }, { \$set: { isVerified: true } });
      const b = db.businesses.updateMany(
        { \$or: [{ isVerified: { \$ne: true } }, { status: { \$ne: 'active' } }] },
        { \$set: { isVerified: true, status: 'active' } });
      let s = 0;
      db.businesses.find({}, { _id: 1 }).forEach((x) => {
        const r = db.subscriptions.updateOne({ businessId: x._id }, { \$setOnInsert: {
          businessId: x._id, stripeCustomerId: 'lab_' + x._id, planType: 'lifetime_access',
          membershipStatus: 'lifetime', createdAt: now, updatedAt: now } }, { upsert: true });
        s += r.upsertedCount;
      });
      print('✅ usuarios verificados: ' + u.modifiedCount + ' · negocios activados: ' + b.modifiedCount + ' · suscripciones lifetime nuevas: ' + s);
      print('   Si ya tenías sesión abierta en la web, cierra sesión y vuelve a entrar.');
    "
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
    sed -n '2,16p' "$0"; exit 1 ;;
esac
