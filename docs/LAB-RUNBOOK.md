# RewardsHub · Runbook del Learner Lab (AWS Academy)

Guía para llevar una sesión del lab de principio a fin: preparar, probar qué permite el lab, desplegar,
llenar datos, hacer las demos de la práctica, resolver problemas y apagar todo.
Complementa a [`infra/aws/README.md`](../infra/aws/README.md) (qué hace cada pieza) y a
[`docs/PLAN-pending-architecture.md`](PLAN-pending-architecture.md) (el porqué).

**Producción sigue en Render.** Nada de esto la toca: el lab usa su propia base (`rewardshub_lab`), su propio
`.env` y su propia cuenta de AWS.

## Cómo leer esta guía

| Marca | Significado |
|---|---|
| ⚪ **Sin lab** | Se hace en tu máquina; no gasta presupuesto ni necesita la sesión del Learner Lab. |
| 🟢 **Con lab activo** | Requiere *Start Lab* (círculo verde) y credenciales vigentes en `~/.aws/credentials`. Gasta presupuesto mientras haya recursos. |

| Bloque | Marca | Tiempo estimado |
|---|---|---|
| [A. Preparación](#a-preparación) | ⚪ | 30–45 min (la primera vez) |
| [B. Pruebas de AWS (P4.0, P5.0)](#b-pruebas-de-aws-p40-p50) | 🟢 | 30–40 min (incluye un primer despliegue) |
| [C. Despliegue y datos](#c-despliegue-y-datos) | 🟢 | 40–60 min |
| [D. Demos (sección 7 del plan)](#d-demos-sección-7-del-plan) | 🟢 | 60–90 min |
| [E. Solución de problemas](#e-solución-de-problemas) | 🟢 | según haga falta |
| [F. Cierre](#f-cierre) | 🟢 | 10–15 min |
| [G. Pendientes fuera del lab](#g-pendientes-fuera-del-lab) | ⚪ | — |

Una sesión del lab dura ~4 h y las credenciales caducan con ella. **B + C + D + F caben en una sesión** si la
preparación (A) ya está hecha. Si la sesión termina a mitad, repite A.4 (credenciales) y sigue: el estado de
Terraform es local y los recursos siguen ahí (las instancias se detienen y arrancan solas con IP nueva).

Convenciones de los comandos:

```bash
# Raíz del backend
cd /home/luis/rew_hub/rew_hub_back/RewardsHub
# Node 22 viene de nvm: cada terminal nueva necesita
. ~/.nvm/nvm.sh
```

Todos los `./lab.sh …` y `terraform …` se corren desde `infra/aws/`; los `npm …` / `npx …` desde la raíz.

---

## A. Preparación

⚪ **Sin lab** · 30–45 min la primera vez, 5 min las siguientes.

### A.1 Node, dependencias y pruebas

```bash
cd /home/luis/rew_hub/rew_hub_back/RewardsHub
. ~/.nvm/nvm.sh && nvm use 22
node -v            # v22.x
which npm          # /home/luis/.nvm/versions/node/v22.../bin/npm  (no la de Windows)
npm ci
npm run typecheck && npm test   # suites verdes (usan MongoDB en memoria, no tocan ninguna base real)
```

> `./lab.sh up` compila el frontend con el `npm` de tu PATH: córrelo **siempre** en una terminal donde ya
> hiciste `. ~/.nvm/nvm.sh`.

### A.2 `.env.lab` separado

El lab **no** usa tu `.env` (el de producción). Crea uno propio; `.gitignore` ya ignora `.env.*` y el zip del
código lo excluye.

```bash
cp .env .env.lab
chmod 600 .env.lab
npm run generate-secrets   # imprime JWT_SECRET y JWT_REFRESH_SECRET nuevos
```

Edita `.env.lab`:

| Variable | Valor para el lab | Por qué |
|---|---|---|
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | los **nuevos** de `generate-secrets` | Un token del lab no debe servir en producción (ni al revés). |
| `STRIPE_SECRET_KEY` | `sk_test_…` (modo prueba) | Nada del lab debe poder cobrar. |
| `STRIPE_WEBHOOK_SECRET` | el de un endpoint de prueba (o cualquier `whsec_…`) | Stripe no llega al ALB del lab (HTTP); es solo para que arranque. |
| `STRIPE_MONTHLY_PRICE_ID`, `STRIPE_YEARLY_PRICE_ID`, `STRIPE_LIFETIME_PRICE_ID` | IDs de precios **de prueba** | |
| `MONGO_URI` | **bórralo** | La base del lab es la MongoDB de `infra/aws/mongo.tf`, dentro de la VPC; Terraform pone `MONGO_URI` en `/etc/rewardshub.env`. Si `.env.lab` trae `MONGO_URI` o algún `mongodb+srv://`, `./lab.sh up` se niega a subirlo. |
| `ADMIN_SECRET`, `LIFETIME_ACCESS_CODE` | valores nuevos | No reutilizar los de producción. |
| `NODE_ENV` | `production` | Con el frontend del lab, CORS solo acepta su URL (la pone Terraform en `ALLOWED_ORIGINS`). Con `enable_frontend = false`, el navegador no podrá llamar a la API (`curl` sí). |
| `FIREBASE_*` | los mismos | El login pasa por Firebase; agrega el dominio del sitio del lab en *Authorized domains* (ver README → Frontend). |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | los de S3 de siempre, o vacíos | Solo sirven para subir logos/fotos (otra cuenta). Vacíos = no se pueden subir imágenes en el lab. SQS/DynamoDB/CloudWatch usan el rol de la instancia, nunca estas llaves. |

> **No pongas en `.env.lab`** `MONGO_URI`, `SQS_QUEUE_URL`, `REDIS_URL`, `DDB_*`, `DB_NAME`, `RATE_LIMITS`, `METRICS_ENABLED`,
> `GEO_QUERY_MODE`, `STATS_SOURCE` ni `TZ`: los pone Terraform en `/etc/rewardshub.env` según `terraform.tfvars`.

Comprobar que no quedó ningún `MONGO_URI` (solo cuenta líneas, no imprime valores):

```bash
grep -cE '^\s*(export\s+)?MONGO_URI|mongodb\+srv' .env.lab   # debe imprimir 0
```

Los scripts que tocan la base (seed, conciliación, comparación de fuentes…) ya no corren desde tu máquina:
Mongo solo es alcanzable dentro de la VPC. Se corren con `./lab.sh seed` / `./lab.sh run` (C.2, C.6).

### A.3 `terraform.tfvars`

```bash
cd infra/aws
cp terraform.tfvars.example terraform.tfvars
```

Para empezar (todo lo nuevo apagado; se enciende en B.4 según las pruebas):

```hcl
aws_profile = "academy"
env_file    = "../../.env.lab"
key_name    = "vockey"        # opcional: SSH con la llave del lab

# Frontend: una de las dos
frontend_dir    = "/home/luis/rew_hub/rew_hub_front/RewardsHubFront"
# enable_frontend = false
```

Comprobación local (no contacta AWS):

```bash
terraform fmt && terraform init -backend=false && terraform validate
```

### A.4 Credenciales del Learner Lab

1. Learner Lab → **Start Lab** → espera el círculo **verde**.
2. **AWS Details** → **AWS CLI** → **Show** → copia el bloque.
3. Pégalo en `~/.aws/credentials` bajo `[academy]` (cambia `[default]` por `[academy]`):

```bash
nano ~/.aws/credentials
aws configure set region us-east-1 --profile academy
aws ec2 describe-availability-zones --profile academy --region us-east-1 --query 'AvailabilityZones[0].ZoneName'
```

El último comando debe imprimir `"us-east-1a"`. Si da error, las credenciales son de una sesión terminada:
repite 1–3. **Cada sesión nueva = credenciales nuevas.**

### A.5 MongoDB del lab (no hay nada que configurar)

`./lab.sh up` crea `rewardshub-mongo`: MongoDB 7.0 en Docker sobre una `t3.medium`, replica set `rs0` de un nodo
(las transacciones de P1 lo necesitan), con usuario `app` que solo puede escribir en `rewardshub_lab`. Solo la
API y los workers llegan al puerto 27017. Los datos viven en un volumen que se borra con `./lab.sh down`:
cada sesión empieza con la base vacía (C.2).

---

## B. Pruebas de AWS (P4.0, P5.0)

🟢 **Con lab activo** · 30–40 min. Deciden `redis_mode`, `enable_dynamo` y `enable_app_metrics`.
Anota cada resultado (fecha, OK o el error exacto) en `infra/aws/README.md` → *Limitaciones*.

### B.1 ElastiCache (P4.0) — no necesita instancias

```bash
aws elasticache create-cache-cluster --cache-cluster-id rh-probe --engine redis \
  --cache-node-type cache.t3.micro --num-cache-nodes 1 --profile academy --region us-east-1
aws elasticache wait cache-cluster-available --cache-cluster-id rh-probe --profile academy --region us-east-1   # ~5–10 min
aws elasticache describe-cache-clusters --cache-cluster-id rh-probe --profile academy --region us-east-1 \
  --query 'CacheClusters[0].CacheClusterStatus'
aws elasticache delete-cache-cluster --cache-cluster-id rh-probe --profile academy --region us-east-1
```

- Llega a `"available"` → **`redis_mode = "elasticache"`**.
- `AccessDenied`, error de SCP o de *service-linked role* → **`redis_mode = "ec2"`** (Valkey/Redis 6 en una t3.micro).

### B.2 Primer despliegue (todo apagado), para tener una instancia donde probar

```bash
cd /home/luis/rew_hub/rew_hub_back/RewardsHub/infra/aws
. ~/.nvm/nvm.sh
terraform plan          # revisar: VPC, ALB, ASGs, SQS, EventBridge, bucket (CloudFormation), WAF, frontend
./lab.sh up             # escribe "yes"; ~5 min + ~5 min de arranque de las instancias
./lab.sh status         # espera a que los targets digan "healthy"
```

### B.3 DynamoDB y CloudWatch (P5.0) — desde una instancia, con su rol

```bash
aws dynamodb create-table --table-name rh-probe --billing-mode PAY_PER_REQUEST \
  --attribute-definitions AttributeName=pk,AttributeType=S --key-schema AttributeName=pk,KeyType=HASH \
  --profile academy --region us-east-1
aws dynamodb wait table-exists --table-name rh-probe --profile academy --region us-east-1

# Una instancia de la API
ID=$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names rewardshub-api \
  --query 'AutoScalingGroups[0].Instances[0].InstanceId' --output text --profile academy --region us-east-1)

# Correr la prueba EN la instancia (SSM, sin SSH), con LabInstanceProfile.
# Sintaxis corta de la CLI (pk={S=x}) para no pelear con comillas dentro de SSM.
CID=$(aws ssm send-command --instance-ids "$ID" --document-name AWS-RunShellScript --profile academy --region us-east-1 \
  --parameters '{"commands":[
    "aws dynamodb put-item --table-name rh-probe --item pk={S=x} --region us-east-1 && echo DDB_PUT_OK",
    "aws dynamodb get-item --table-name rh-probe --key pk={S=x} --region us-east-1 && echo DDB_GET_OK",
    "aws cloudwatch put-metric-data --namespace RewardsHub --metric-name Probe --value 1 --region us-east-1 && echo CW_PUT_OK",
    "aws cloudwatch list-metrics --namespace AWS/EC2 --max-items 1 --region us-east-1 > /dev/null && echo CW_READ_OK"
  ]}' --query Command.CommandId --output text)
sleep 10
aws ssm get-command-invocation --command-id "$CID" --instance-id "$ID" --profile academy --region us-east-1 \
  --query '[StandardOutputContent,StandardErrorContent]' --output text

aws dynamodb delete-table --table-name rh-probe --profile academy --region us-east-1
```

### B.4 Fijar las variables según el resultado

| Resultado | En `terraform.tfvars` |
|---|---|
| ElastiCache `available` | `redis_mode = "elasticache"` |
| ElastiCache falla | `redis_mode = "ec2"` |
| `DDB_PUT_OK` y `DDB_GET_OK` | `enable_dynamo = true` y `stats_source = "dynamo"` |
| DynamoDB falla | `enable_dynamo = false` y `stats_source = "daily"` |
| `CW_PUT_OK` | `enable_app_metrics = true` |
| `CW_PUT_OK` no aparece | `enable_app_metrics = false` (Grafana sigue mostrando ALB/ASG/SQS si hay `CW_READ_OK`) |
| `CW_READ_OK` no aparece | Grafana no podrá leer CloudWatch: deja `enable_grafana = false` |

Además, para la práctica:

```hcl
geo_query_mode   = "geo"
enable_grafana   = true
admin_cidr       = "203.0.113.7/32"   # tu IP: curl -s https://checkip.amazonaws.com   (+ "/32")
# grafana_anonymous_viewer = true     # para proyectar en clase sin compartir la contraseña
```

---

## C. Despliegue y datos

🟢 **Con lab activo** · 40–60 min.

### C.1 Plan, up, roll, status

```bash
cd /home/luis/rew_hub/rew_hub_back/RewardsHub/infra/aws
. ~/.nvm/nvm.sh
terraform plan
```

Revisa en el plan:

- Nuevos (según B.4): `aws_security_group.redis` + `aws_elasticache_cluster.redis` **o** `aws_instance.redis`;
  `aws_dynamodb_table.daily_stats` / `.transactions`; `aws_instance.grafana`, `aws_security_group.grafana`,
  `random_password.grafana_admin`, `aws_s3_object.grafana_dashboards`;
  reglas de EventBridge `rewardshub-daily-stats`, `rewardshub-reconcile-balances`, `rewardshub-replicate-dynamo`.
- Cambios: la alarma `rewardshub-jobs-backlog` pasa a `ApproximateAgeOfOldestMessage`; los ASG con `enabled_metrics`;
  nueva versión de los launch templates. En su `user_data` (base64) deben ir: `TZ=UTC`, `DB_NAME=rewardshub_lab`,
  `MONGO_MAX_POOL_SIZE=20`, `GEO_QUERY_MODE=geo`, `STATS_SOURCE=…`, `REDIS_URL=redis://…:6379`, `CACHE_BIZMAP_TTL=120`,
  `RATE_LIMITS=on`, `METRICS_ENABLED=true` (si aplica), `DDB_DAILY_STATS_TABLE`, `DDB_TRANSACTIONS_TABLE`.

```bash
./lab.sh up        # "yes"
./lab.sh roll      # reemplaza las instancias una por una para que tomen el código y el user_data nuevos (~10–15 min)
./lab.sh status    # targets healthy, ASGs, Redis, réplica DynamoDB, cola
./lab.sh logs api 40 | grep -E "Connected to MongoDB|Metrics|Redis|Error"
./lab.sh logs worker 40 | grep -E "Connected to MongoDB|escuchando|Error"
API=$(terraform output -raw api_url); curl -s "$API/health"     # {"status":"ok"}
```

### C.2 Datos de prueba (`./lab.sh seed`)

Corre en una instancia de la API (por SSM, dentro de la VPC, con el entorno del servicio):

```bash
cd infra/aws
./lab.sh status            # antes: MongoDB "✅ rs.status() OK · PRIMARY" y al menos un target healthy
./lab.sh seed              # ~50 negocios, 2000 clientes, 50 000 transacciones en 90 días; ~2–5 min
# Para regenerar desde cero:
# ./lab.sh seed --reset
./lab.sh mongo-eval 'db.businesses.countDocuments()'   # 50
```

Esperado: `🎉 Listo: { businesses: 50, …, transactions: 50000 }`. El candado (`assertNonProductionDb`) sigue
activo: en el lab `DB_NAME=rewardshub_lab` y el usuario `app` no puede escribir en ninguna otra base. Que se niega
con una base que no es de lab lo prueba `npx jest tests/cli.run.test.ts` (local).

> Si la base del lab se llenó **antes** de P2.1 (sin `geo`): `./lab.sh run migrate-locations-geo` (dry run) y luego
> `./lab.sh run migrate-locations-geo --apply`. O regenera con `--reset`.

### C.3 Backfill de `daily_stats`

```bash
cd infra/aws
FROM=$(date -u -d '91 days ago' +%F); TO=$(date -u -d yesterday +%F)
./lab.sh enqueue daily-stats "{\"from\":\"$FROM\",\"to\":\"$TO\"}"
./lab.sh logs worker 60 | grep daily-stats
```

Esperado: `📅 [daily-stats] … partido en 13 trabajos semanales` (91 días), y luego una línea por semana
`{"businesses":50,"days":7,…}`. Con 13 mensajes en la cola, `jobs-backlog` puede agregar un worker (demo D.6).

### C.4 Conciliación

```bash
./lab.sh enqueue reconcile-balances
sleep 60; ./lab.sh logs worker 40 | grep reconcile
```

Esperado: `🧮 [reconcile] {"runKey":"reconcile-balances:…","checked":…,"mismatchCount":0,…,"orphanRewardCount":0}`.

### C.5 Réplica en DynamoDB (si `enable_dynamo = true`)

```bash
./lab.sh enqueue replicate-dynamo        # o esperar ≤ 10 min a EventBridge
sleep 90; ./lab.sh logs worker 40 | grep replicate-dynamo
./lab.sh status                          # "── Réplica DynamoDB ──  daily_stats: al día hasta … (retraso N min)"
```

La primera pasada copia ~50 000 transacciones (varios minutos). Si no termina en 8 min, la siguiente corrida sigue
donde quedó (`caughtUp: false` → `true`).

### C.6 Comparar las fuentes de estadísticas

Solo lectura, dentro de la VPC (la instancia ya tiene `TZ=UTC` y las `DDB_*`):

```bash
./lab.sh run compare-stats-sources --businesses 10 --days 30
```

Esperado: una fila por negocio con `✅` en `daily` y `dynamo`, y `✅ Todas las fuentes coinciden.`
Con `enable_dynamo = false` compara solo live vs daily.

---

## D. Demos (sección 7 del plan)

🟢 **Con lab activo** · 60–90 min. Variables de apoyo:

```bash
cd /home/luis/rew_hub/rew_hub_back/RewardsHub
. ~/.nvm/nvm.sh
API=$(terraform -chdir=infra/aws output -raw api_url)
TOKEN=$(curl -s -X POST "$API/auth/cashier-login" -H 'Content-Type: application/json' \
  -d '{"email":"negocio01@seed.rewardshub.test","password":"lab12345"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
echo "${TOKEN:0:20}…"
```

### D.1 Todo arriba — aceptación 1

```bash
cd infra/aws && ./lab.sh status && ./lab.sh grafana
```

**Esperado:** targets `healthy` (2), ASG api `2/2` y worker `1/1`, Redis `available`/`running`, réplica DynamoDB
con retraso **< 15 min**, URL de Grafana.

### D.2 Datos y conciliación — aceptación 2

Hecho en C.2–C.4. **Esperado:** `daily_stats` llena (`./lab.sh mongo-eval 'db.daily_stats.countDocuments({branchId: null})'`,
~50 × 91 filas "business") y `reconcile-balances` con `mismatchCount: 0`.

Variante (conciliación detecta y arregla):

1. Suma 7 a `businessPoints.0.rewardSystems.0.points` **y** a `businessPoints.0.points` de un documento:

   ```bash
   ./lab.sh mongo-eval 'db.userpoints.updateOne({"businessPoints.0.rewardSystems.0": {$exists: true}}, {$inc: {"businessPoints.0.points": 7, "businessPoints.0.rewardSystems.0.points": 7}})'
   ```

2. `./lab.sh enqueue reconcile-balances` → **Esperado:** `mismatchCount: 1`. Copia el `runKey` del log.
3. Arreglar (dry run y luego aplicar):

   ```bash
   ./lab.sh run reconcile-fix --run "<runKey>"           # would_fix: 1
   ./lab.sh run reconcile-fix --run "<runKey>" --apply   # fixed: 1
   ```

4. `./lab.sh enqueue reconcile-balances` → **Esperado:** `mismatchCount: 0`.

### D.3 Escrituras concurrentes e Idempotency-Key — aceptación 3

```bash
npx ts-node scripts/load/concurrent-redeem.ts --url "$API" --n 20 --amount 10 --topup 100
npx ts-node scripts/load/concurrent-redeem.ts --url "$API" --n 20 --amount 10 --same-key
```

**Esperado (1):** con saldo inicial `S`: aplicadas `min(20, ⌊S/10⌋)`, el resto `400 Insufficient points…`, saldo final
exacto, `✅ Sin pérdidas ni dobles restas.`, código de salida 0.
**Esperado (2):** exactamente **1** resta aplicada; el resto `409` (con `Retry-After: 1`) o `200 (replay)`; saldo baja 10; código 0.

### D.4 Caché del mapa y rate limit compartido — aceptación 4

```bash
for i in 1 2 3; do curl -s -o /dev/null -D - "$API/business/nearby?latitude=20.6597&longitude=-103.3496&maxDistanceKm=10" | grep -i x-cache; done
curl -s -o /dev/null -D - "$API/business/nearby?latitude=20.6599&longitude=-103.3496&maxDistanceKm=10" | grep -i x-cache
```

**Esperado:** `MISS`, `HIT`, `HIT`; la de coordenadas a unos metros también `HIT` (la llave redondea a 3 decimales:
`-103.3494` ya cae en otra casilla de longitud y sería `MISS`).
Edita una sucursal **cambiando algo** (p. ej. el nombre) desde el dashboard o con `PUT /business/locations/<id>`
→ la siguiente consulta es `MISS` y ya trae el cambio. Un PUT con los mismos valores no invalida (no hay cambio).
Usa coordenadas cerca de esa sucursal: los negocios pares del seed están en Guadalajara y los impares en CDMX.

```bash
for i in $(seq 20); do curl -s -o /dev/null -w '%{http_code} ' -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' -d '{"idToken":"x"}'; done; echo
```

**Esperado:** `401` × 10 y luego `429` × 10, aunque el ALB reparta entre 2 instancias.
"Antes" (para comparar): con `redis_mode = "off"` cada instancia cuenta por su lado (~20 `401` antes del primer `429`).
Los contadores duran 15 min; para repetir, espera o cambia de IP.
**Ojo:** `/auth/cashier-login` comparte ese contador (mismo bucket `login` por IP). Después de esta demo, el login de
cajero desde tu IP (y `concurrent-redeem.ts`) responde `429` durante 15 min: haz esta demo **al final**, o borra el
contador en Redis desde una instancia de la API (solo lab):

```bash
ID=$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names rewardshub-api --query 'AutoScalingGroups[0].Instances[0].InstanceId' --output text --profile academy --region us-east-1)
aws ssm send-command --instance-ids "$ID" --document-name AWS-RunShellScript --profile academy --region us-east-1 \
  --parameters '{"commands":["cd /opt/rewardshub && set -a && . /etc/rewardshub.env && set +a && node -e \"const R=require(\\\"ioredis\\\");const r=new R(process.env.REDIS_URL);r.keys(\\\"rl:login:*\\\").then(k=>k.length&&r.del(...k)).then(n=>{console.log(\\\"borrados\\\",n);r.quit()})\""]}'
```

**Redis caído:** modo `ec2` → consola EC2 → detén `rewardshub-redis`; modo `elasticache` → `redis_mode = "off"` +
`./lab.sh up && ./lab.sh roll`. **Esperado:** `/business/nearby` responde `200` con `X-Cache: BYPASS`; los logins
siguen respondiendo (límite por instancia). Vuelve a encender Redis al terminar.

### D.5 Estadísticas desde DynamoDB — aceptación 5

C.6 da la comparación completa. Desde la API:

```bash
curl -s -D - -o /dev/null -H "Authorization: Bearer $TOKEN" "$API/business/stats/timeseries?days=30" | grep -i x-data-freshness
```

**Esperado:** `X-Data-Freshness: <fecha ISO>` (hasta cuándo está al día la réplica; ≤ 10 min atrás).
Con `stats_source = "daily"` el header no aparece (no hay réplica). Los números son los mismos en los tres modos.

### D.6 Grafana bajo carga — aceptación 6

1. `./lab.sh grafana` → abre la URL → usuario `admin`, contraseña `terraform -chdir=infra/aws output -raw grafana_admin_password`
   → carpeta *RewardsHub* → **RewardsHub · Lab**.
2. Genera carga y mira moverse los paneles (2–10 min de retraso de CloudWatch):
   - **Cola y workers:** un backfill largo (C.3). En *Cola* sube "Mensajes en la cola" y "Antigüedad"; tras ~2 min por
     encima de 120 s aparece la anotación de `jobs-backlog` y en *Cómputo* sube "Instancias en servicio" de workers.
   - **ALB:** `for i in $(seq 300); do curl -s -o /dev/null "$API/business/all?limit=50"; done` → *Entrada* sube peticiones y p95.
   - **Autoescalado de la API** (CPU > 60 %): el WAF bloquea a más de 1000 peticiones / 5 min por IP. Para esta demo
     sube `waf_rate_limit = 20000` (o `enable_waf = false`), `./lab.sh up`, y luego
     `wrk2 -t4 -c64 -d600s -R400 "$API/business/all?latitude=20.66&longitude=-103.35"`.
   - **App:** D.3 mueve *Idempotency-Key*; D.4 mueve *Caché del mapa* y *Rate limit*; C.4 la *Conciliación*; C.5 el *Retraso de la réplica*.
3. **Esperado:** se mueven los paneles de ALB, ASG, SQS, WAF, Redis (solo modo elasticache), DynamoDB y App.

### D.7 Stripe sin duplicados (fuera del lab)

Stripe no llega al ALB del lab (HTTP). Contra el backend **local** (o Render, modo prueba):

```bash
stripe login
stripe listen --forward-to localhost:3000/webhooks/stripe   # copia el whsec_ que imprime a STRIPE_WEBHOOK_SECRET y reinicia el backend
stripe trigger customer.subscription.updated
stripe events resend <evt_id>                                # el id del evento anterior
```

**Esperado:** la primera entrega responde `{"received":true}`; el reenvío, `{"received":true,"duplicate":true}`.

### D.8 Cierre — aceptación 7 y 8

Bloque F. Después: actualiza el diagrama de arquitectura (piezas a **Listo**, quita el aviso rojo "el lab usa la misma
base que producción") y anota en `infra/aws/README.md` → *Limitaciones* el resultado de las pruebas de B.

---

## E. Solución de problemas

🟢 **Con lab activo**.

### Logs

```bash
cd infra/aws
./lab.sh logs api 100            # la app (journalctl -u rewardshub) en cada instancia de la API
./lab.sh logs worker 100
# El arranque (instalar Node, npm ci, build) de una instancia:
aws ssm send-command --instance-ids <ID> --document-name AWS-RunShellScript --profile academy --region us-east-1 \
  --parameters 'commands=["tail -n 80 /var/log/cloud-init-output.log"]' --query Command.CommandId --output text
aws ssm get-command-invocation --command-id <CID> --instance-id <ID> --profile academy --region us-east-1 --query StandardOutputContent --output text
```

### Targets `unhealthy` en el ALB

| Síntoma en `./lab.sh status` / logs | Causa probable | Qué hacer |
|---|---|---|
| `Target.FailedHealthChecks` los primeros ~10 min | La instancia sigue instalando y compilando | Esperar (gracia de 600 s). |
| `npm ERR`, `tsc` en `cloud-init-output.log` | El código no compila | `npm run build` local, arreglar, `./lab.sh up && ./lab.sh roll`. |
| `⏳ MongoDB no responde` / `MongoServerSelectionError` | La instancia de Mongo sigue arrancando (~2 min) o está caída | `./lab.sh status` (sección MongoDB). En la instancia `rewardshub-mongo`: `journalctl -u rewardshub-mongo`, `journalctl -u rewardshub-mongo-init`, `/var/log/cloud-init-output.log`. La API reintenta sola (`MONGO_CONNECT_RETRIES`). |
| `Neither apiKey nor config.authenticator provided` | Falta `STRIPE_SECRET_KEY` en `.env.lab` | A.2, luego `./lab.sh up && ./lab.sh roll`. |
| `FIREBASE` / `JWT` en el log | Faltan variables en `.env.lab` | Completar y `up` + `roll`. |
| Unhealthy tras un `roll` que falló | Instancias con launch template viejo | `./lab.sh roll` otra vez. |

### Mensajes en la DLQ

```bash
./lab.sh dlq                     # cuerpos de los mensajes que fallaron 5 veces
./lab.sh logs worker 200 | grep -E "❌|falló"
```

Arreglada la causa, devuélvelos a la cola:

```bash
DLQ_ARN=$(aws sqs get-queue-attributes --queue-url "$(terraform output -raw dlq_url)" --attribute-names QueueArn \
  --query Attributes.QueueArn --output text --profile academy --region us-east-1)
aws sqs start-message-move-task --source-arn "$DLQ_ARN" --profile academy --region us-east-1
```

Un mensaje inválido (tipo o params mal escritos) no va a la DLQ: el worker lo descarta con
`⚠️ [Worker] Mensaje inválido, se descarta` en el log.

### Grafana sin datos

| Síntoma | Causa | Qué hacer |
|---|---|---|
| La URL no abre | Tu IP cambió, o la instancia está detenida | `curl -s https://checkip.amazonaws.com` → `admin_cidr` → `./lab.sh up`; `./lab.sh grafana` da la URL y el estado. |
| Abre pero "No data" en todo | LabRole sin lectura de CloudWatch | En la instancia de Grafana: `journalctl -u grafana-server \| grep -i AccessDenied`. Si sale, B.3 (`CW_READ_OK`) falló: Grafana no es viable en el lab. |
| Solo los paneles *App* vacíos | `enable_app_metrics = false`, o `PutMetricData` denegado | `./lab.sh logs api 100 \| grep Metrics`: `📈 [Metrics] Publicando…` = activado; `⚠️ [Metrics] No se pudieron publicar` = denegado. |
| *Instancias en servicio* vacío | Métricas de grupo del ASG apagadas | Se activan con `enable_grafana`; tardan unos minutos tras `up`. |
| *ElastiCache* vacío | `redis_mode = "ec2"` (no publica en AWS/ElastiCache) | Normal: usa los paneles *App* de la caché. |
| *DynamoDB* vacío | `enable_dynamo = false`, o la réplica no ha corrido | C.5. |
| Todo con ~5 min de retraso | CloudWatch publica cada 1–5 min | Normal. |

### Otros

- **Credenciales caducadas**: `❌ Credenciales inválidas o de una sesión que ya terminó` → A.4.
- **`X-Cache: BYPASS` siempre**: Redis no responde → `./lab.sh status` (Redis) y `./lab.sh logs api | grep Redis`.
- **La réplica no avanza**: `./lab.sh logs worker | grep replicate-dynamo`; `AccessDenied` = DynamoDB no permitido (B.3).
- **`terraform apply` falla en `aws_wafv2_*`**: `enable_waf = false`.

---

## F. Cierre

🟢 **Con lab activo** · 10–15 min. **Hazlo siempre al terminar**: el lab cobra mientras existan los recursos.

```bash
cd /home/luis/rew_hub/rew_hub_back/RewardsHub/infra/aws
./lab.sh down            # "yes"; ~5–10 min (ElastiCache y CloudFormation son los más lentos)
terraform state list     # vacío = Terraform ya no administra nada
```

Confirmar que no queda nada corriendo (todo debe salir vacío):

```bash
P="--profile academy --region us-east-1"
# Filtro por Name (las instancias de los ASG solo llevan la etiqueta Name, no Project)
aws ec2 describe-instances $P --filters 'Name=tag:Name,Values=rewardshub*' Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[].Instances[].[InstanceId,State.Name,Tags[?Key==`Name`]|[0].Value]' --output table
aws elbv2 describe-load-balancers $P --query 'LoadBalancers[?starts_with(LoadBalancerName, `rewardshub`)].LoadBalancerName'
aws autoscaling describe-auto-scaling-groups $P --query 'AutoScalingGroups[?starts_with(AutoScalingGroupName, `rewardshub`)].AutoScalingGroupName'
aws elasticache describe-cache-clusters $P --query 'CacheClusters[].CacheClusterId'      # tampoco "rh-probe"
aws dynamodb list-tables $P --query 'TableNames'                                         # tampoco "rh-probe"
aws sqs list-queues $P --queue-name-prefix rewardshub
aws events list-rules $P --name-prefix rewardshub --query 'Rules[].Name'
aws cloudformation describe-stacks $P --query 'Stacks[?starts_with(StackName, `rewardshub`)].StackName'
aws wafv2 list-web-acls --scope REGIONAL $P --query 'WebACLs[?starts_with(Name, `rewardshub`)].Name'
```

Luego, en el Learner Lab: **End Lab**. La base del lab se borró con la instancia de Mongo.

Si algo quedó (p. ej. `down` falló a medias por credenciales caducadas): renueva credenciales (A.4) y repite
`./lab.sh down`. Lo que esté fuera del estado de Terraform (las pruebas `rh-probe` de B) se borra con los
`delete-…` de B.1 / B.3.

---

## G. Pendientes fuera del lab

⚪ **Sin lab**.

### G.1 Frontend web y apps móviles

- **`Idempotency-Key`** en `POST /user-points/add`, `/user-points/subtract`, `/delivery/claim`,
  `/memberships/activate`, `/memberships/redeem`:
  - Un UUID por **acción del usuario** (un escaneo, un canje), p. ej. `crypto.randomUUID()`, creado al iniciar la acción.
  - En un reintento de **esa misma** acción (timeout, error de red, `409`), reenviar el **mismo** valor.
  - `409` + `Retry-After: 1` → la original sigue en curso: esperar y reintentar con la misma llave.
  - `422` → se reusó una llave con otro body: es un bug del cliente (llave reciclada entre acciones).
  - `Idempotent-Replayed: true` → respuesta repetida de la original: tratarla como éxito normal, sin sumar en la UI otra vez.
  - Sin el header todo sigue funcionando (las apps ya publicadas no se rompen).
- **`429`** (login, registro, recuperar contraseña, PIN de administrador, reportes): body
  `{ "message": "too many requests, please try again later" }`, header `Retry-After` (segundos que faltan) y
  `RateLimit` / `RateLimit-Policy`. Mostrar un mensaje claro ("intenta de nuevo en N min") y deshabilitar el botón
  hasta entonces; no reintentar en bucle. El WAF del ALB también responde `429` (sin esos headers) si una IP pasa de
  1000 peticiones en 5 min.
- **`GET /auth/:id`** ahora pide el token (`Authorization: Bearer …`). La web ya lo manda; **revisar las dos apps móviles**.
- **Headers nuevos** (solo se agregaron, nada cambió de forma): `X-Data-Freshness` (opcional: mostrar "datos al …" en
  las estadísticas), `X-Cache` (solo diagnóstico).
- Las respuestas de negocio ya no traen `passHash` / `branchPassHash` (ningún cliente debería usarlos).

### G.2 Antes de llevar esto a producción (Render)

1. **Membresías duplicadas** (el índice único nuevo no se crea si existen), contra la base de producción, solo lectura:

   ```bash
   npx ts-node scripts/find-duplicate-memberships.ts     # con el .env de producción
   ```

   Si lista grupos: deja una membresía por grupo (la que vence más tarde) y marca las demás `cancelled` a mano.
2. **Variables en Render**: `ADMIN_SECRET` si soporte usa `POST /business/admin-pin/generate` (sin ella responde 403).
   Opcional: `RATE_LIMITS=on` (límites por instancia; protege el PIN de administrador contra fuerza bruta).
   **No** poner `REDIS_URL`, `DDB_*`, `METRICS_ENABLED`, `STATS_SOURCE` ni `GEO_QUERY_MODE` todavía.
3. **Coordinar con front y móviles** (G.1) **antes** del deploy: `/auth/:id` con token.
4. **Deploy a Render** (`render.yaml` no cambió; `package-lock.json` sí: dependencias nuevas). Al arrancar, Mongoose
   crea índices nuevos en producción: `transactions {updatedAt, _id}`, `businesses locations.geo` (2dsphere),
   `clientmemberships uniq_active_plan_per_user`, `idempotencykeys`, `stripeevents`, `daily_stats`. En colecciones
   grandes tardan; revisa en Atlas que terminen.
5. **Backfill de `geo`** (después del deploy; el hook ya mantiene las escrituras nuevas):

   ```bash
   npx ts-node scripts/migrate-locations-geo.ts --prod            # dry run
   npx ts-node scripts/migrate-locations-geo.ts --prod --apply
   ```

   Solo entonces `GEO_QUERY_MODE=geo` en Render.
6. **`STATS_SOURCE=daily`** en Render solo cuando exista algo que llene `daily_stats` allí (Render no tiene worker ni
   EventBridge): hasta entonces, déjalo sin definir (cálculo en vivo, como siempre).
7. **Nunca** correr `seed:lab` ni `reconcile-fix` contra producción (los dos se niegan con nombres de base que no son de
   lab). En producción la conciliación **va a reportar diferencias**: hay saldos de antes del historial.
8. Opcional, cuando `GEO_QUERY_MODE=geo` esté en todos lados: borrar el índice viejo `locations.latitude_1_locations.longitude_1`.
