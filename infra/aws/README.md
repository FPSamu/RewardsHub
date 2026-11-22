# RewardsHub en AWS Academy (rama `sistemas-escalables`)

Infraestructura para la práctica de sistemas escalables. **No es producción**: producción sigue en Render.
Cubre las piezas del diagrama de arquitectura: load balancer + WAF, autoescalado de API y workers, cola SQS con
EventBridge, MongoDB propia del lab en EC2 (dentro de la VPC), Redis (caché + rate limits), réplica de lectura en DynamoDB y Grafana.
Todo lo nuevo se enciende con variables de `terraform.tfvars` y viene **apagado** por defecto.
La guía paso a paso para una sesión del lab está en [`docs/LAB-RUNBOOK.md`](../../docs/LAB-RUNBOOK.md).

```
Clientes ──► ALB (+ WAF rate limit) ──► ASG API (2..4 × EC2, escala por CPU) ──► MongoDB 7 en EC2 (rs0, base rewardshub_lab)
                                              │   │                                  ▲
                                              │   └──► Redis (caché del mapa, rate limits) [redis_mode]
                                              │   └──► DynamoDB (lecturas de estadísticas y reportes) [enable_dynamo]
                                              │  POST /notifications/run-*  → encola
EventBridge (avisos, daily-stats, reconcile, replicate-dynamo) ──► SQS jobs ──► ASG Workers (1..3 × EC2,
                                       │                                       escala por antigüedad del mensaje)
                                       └─► DLQ (tras 5 intentos fallidos)
CloudWatch ◄── métricas de ALB/ASG/SQS/WAF/ElastiCache/DynamoDB + métricas propias de la app ──► Grafana [enable_grafana]
```

## Frontend

`frontend.tf` despliega `../rewardshub_front` (Vite/React) como sitio estático de S3:

```
http://<bucket>.s3-website-us-east-1.amazonaws.com  → frontend (rutas de la SPA → index.html)
            │ llamadas a la API (CORS)
            ▼
http://<alb>.us-east-1.elb.amazonaws.com            → API
```

- El lab no permite CloudFront y no hay dominio para un certificado, así que **todo es HTTP**.
- Terraform compila el frontend **en tu máquina** (`vite build` con `VITE_API_URL` = URL del ALB) y lo sube. Se usa lo que haya en disco en ese repo, sea cual sea la rama.
- Las instancias de la API reciben `ALLOWED_ORIGINS` y `FRONTEND_URL` con la URL del sitio.
- Login con Google: agrega `<bucket>.s3-website-us-east-1.amazonaws.com` en Firebase → Authentication → Settings → Authorized domains.
- Por ser HTTP, el navegador bloquea la **cámara** (escáner QR) y la **geolocalización** (mapa). Para la demo, en Chrome: `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, agrega la URL del sitio y reinicia Chrome.
- `enable_frontend = false` lo omite.

## Qué cambió en el código

| Archivo | Cambio |
|---|---|
| `src/index.ts` | Si existe `SQS_QUEUE_URL`, **no** programa los batches en proceso (con N instancias correrían N veces). Apagado ordenado con SIGTERM (cierra Redis y manda las métricas pendientes). |
| `src/worker.ts` | Proceso nuevo (`npm run worker`) que consume la cola con long polling: avisos, engagement, `daily-stats`, `reconcile-balances`, `replicate-dynamo`. |
| `src/queue/*` | Cliente SQS, formato de mensajes (con `params` opcionales validados por tipo), procesamiento y candado de idempotencia. Los mensajes viejos se leen igual que antes. |
| `src/models/jobRun.model.ts` | Candado en Mongo: SQS entrega "al menos una vez", así que el mismo trabajo nunca se ejecuta dos veces aunque haya varios workers. |
| `src/controllers/notification.controller.ts` | Con cola activa, `run-batch` / `run-engagement` encolan y responden `202`. |
| `src/app.ts` | `TRUST_PROXY=1` para leer la IP real del cliente detrás del ALB. 404 y errores siempre en JSON (`src/middleware/error.middleware.ts`), conservando el status. CORS acepta `Idempotency-Key` y expone `Idempotent-Replayed`, `Retry-After`, `X-Cache`, `X-Data-Freshness`. |
| `user_data.sh.tftpl` | `/etc/rewardshub.env` con lo propio de AWS: `DB_NAME=rewardshub_lab` (`lab_db_name`; el lab escribe en **su propia base**, nunca en la de producción), `MONGO_MAX_POOL_SIZE=20`, `TZ=UTC` (días de las estadísticas = días UTC) y, según las variables, `GEO_QUERY_MODE`, `STATS_SOURCE`, `REDIS_URL`, `RATE_LIMITS`, `METRICS_ENABLED`, `DDB_*`. systemd las pone antes que el `.env`, así que ganan. |
| `src/db/mongoose.ts` | Pasa `dbName` (gana sobre la base del `MONGO_URI`) y `MONGO_MAX_POOL_SIZE` (con hasta 7 procesos, el default de 100 conexiones rebasa el límite de un cluster compartido). Sin las variables, igual que antes. |
| `src/db/safety.ts`, `src/db/seed/*`, `scripts/seed-lab.ts` | `assertNonProductionDb()`: todo script que escribe se niega si la base no termina en `_lab`/`_test`/`test`. `./lab.sh seed` llena la base del lab con datos sintéticos coherentes (ver *Uso*). |
| `mongo.tf`, `user_data_mongo.sh.tftpl` | **MongoDB 7.0 dentro del lab**: una `t3.medium` (sin ASG) con IP privada fija (`.10` de la primera subred), Docker `mongo:7.0` manejado por systemd, replica set de un nodo `rs0` (lo pide `withTransaction`), auth con usuario `admin` y usuario `app` con `readWrite` **solo** en `rewardshub_lab`. Contraseñas y keyfile salen de `random_password`; en la instancia viven en `/etc/rewardshub-mongo/` (solo root). Datos en un volumen gp3 de 20 GB en `/data/db` (se borra con la instancia). Puerto 27017 solo desde los SG de la API y los workers. `enable_mongo = false` lo omite. |
| `user_data.sh.tftpl` (Mongo) | Terraform arma `MONGO_URI=mongodb://app:…@<ip privada>:27017/rewardshub_lab?replicaSet=rs0&authSource=rewardshub_lab` y lo escribe en `/etc/rewardshub.env` (ahora `chmod 600`). Gana sobre el `.env.lab`, que **no debe** traer `MONGO_URI`: `artifact.tf` se niega a subirlo si lo trae o si contiene `mongodb+srv`. Instala `rh-cli` (scripts con el mismo entorno que el servicio). |
| `src/db/mongoose.ts`, `src/index.ts` | `MONGO_CONNECT_RETRIES` (20 en el lab): si Mongo aún no responde al arrancar, reintenta con espera creciente (1 s … 30 s). Si se agotan, la API sale con código 1 (antes solo lo registraba) y systemd la reinicia. Sin la variable, un solo intento como siempre. |
| `src/cli/*` (`dist/cli/run.js`) | Los scripts de mantenimiento compilados, para correrlos **dentro de la VPC** (Mongo ya no es alcanzable desde tu máquina): `seed`, `compare-stats-sources`, `migrate-locations-geo`, `find-duplicate-memberships`, `reconcile-fix`. Conservan sus candados; `--prod` se rechaza siempre. Los `scripts/*.ts` siguen funcionando igual en local (son envoltorios). |
| `src/services/business.service.ts`, `src/controllers/{business,auth,adminPin}.controller.ts` | Seguridad: las respuestas de negocio ya no incluyen hashes de contraseña; `GET /auth/:id` pide token y solo responde al propio usuario o a un negocio del que es cliente; `POST /business/admin-pin/generate` solo con `ADMIN_SECRET`. |
| `src/services/userPoints.service.ts`, `src/db/withTransaction.ts` | **Escrituras atómicas**: sumar/restar es un solo `updateOne` con `$inc` (la resta exige saldo suficiente en el filtro) y saldo + historial van en una transacción. Con 2–4 instancias detrás del ALB, dos cajeros sobre el mismo cliente ya no pierden ni duplican puntos. El canje de códigos de delivery y de membresías también es atómico. |
| `src/middleware/idempotency.middleware.ts` | **Idempotency-Key** en `POST /user-points/add`, `/user-points/subtract`, `/delivery/claim`, `/memberships/activate`, `/memberships/redeem`: un reintento con la misma llave recibe la respuesta guardada (`Idempotent-Replayed: true`) en vez de sumar otra vez. Sin header todo funciona como antes. |
| `src/controllers/webhook.controller.ts` | Webhook de Stripe deduplicado por `event.id` (colección `stripeevents`) e ignora `subscription.updated` más viejos que el último aplicado. Se prueba en local/Render, no en el lab (ver *Limitaciones*). |
| `src/models/business.model.ts`, `src/services/business.service.ts` | Sucursales con GeoJSON (`locations[].geo`, índice `2dsphere`, sincronizado desde lat/lng; no sale en las respuestas). Con `GEO_QUERY_MODE=geo` (`geo_query_mode`) el mapa usa `$geoNear` / `$geoWithin`; respuestas idénticas a la consulta por recuadro (tests de contrato). Backfill: `scripts/migrate-locations-geo.ts`. |
| `src/services/dailyStats.service.ts`, `src/models/dailyStat.model.ts` | Colección `daily_stats` (un día UTC por fila, por negocio y por sucursal). Con `STATS_SOURCE=daily` (`stats_source`) la serie diaria, los KPIs y la comparación por sucursal salen de ahí + hoy en vivo, con los mismos números que el cálculo completo. |
| `src/jobs/dailyStats.job.ts` | Llena `daily_stats`. Sin params: los últimos 2 días UTC de cada negocio. Con `from`/`to`: backfill, partido en un mensaje por semana. |
| `src/jobs/reconcile.job.ts`, `scripts/reconcile-fix.ts` | Concilia `userpoints` contra el historial de `transactions` y guarda el reporte en `reconciliation_runs`. **Solo reporta**; el arreglo es `scripts/reconcile-fix.ts`, a mano y solo en la base del lab. |
| `scheduler.tf` | Reglas de EventBridge: avisos (10:00 y 19:00 UTC), `daily-stats` (06:15 UTC), `reconcile-balances` (07:30 UTC) y `replicate-dynamo` (cada 10 min, con `enable_dynamo`). Un horario `""` apaga esa regla. |
| `redis.tf`, `src/cache/*` | **Redis** (`redis_mode`): caché del mapa (`/business/nearby`, `/in-bounds`, `/all`, header `X-Cache: HIT\|MISS\|BYPASS`, TTL 120 s, invalidación por versión en cada escritura relevante de un negocio) y contadores compartidos de rate limit. Falla abierta: si Redis no responde la API sigue igual. |
| `src/middleware/rateLimit.middleware.ts` | Con `RATE_LIMITS=on` (`enable_rate_limits`): login (10 intentos fallidos / 15 min / IP), registro, recuperar contraseña (10 / 15 min / IP), PIN de administrador (5 intentos fallidos / 15 min **por negocio**) y reportes PDF (10 / min por negocio). Con Redis el contador es global; sin Redis, por instancia. El WAF sigue siendo el límite grueso. |
| `dynamodb.tf`, `src/replica/*`, `src/jobs/replicateDynamo.job.ts` | **Réplica de lectura en DynamoDB** (`enable_dynamo`): tablas `rewardshub-daily-stats` y `rewardshub-transactions` (GSI `byShift`), `PAY_PER_REQUEST`. El job `replicate-dynamo` copia lo nuevo de Mongo con un checkpoint (`replication_checkpoints`). Con `STATS_SOURCE=dynamo` las estadísticas y los reportes leen de DynamoDB; lo que la réplica aún no tiene, de Mongo; si DynamoDB falla, todo de Mongo. Header `X-Data-Freshness`. Comparación de fuentes: `scripts/compare-stats-sources.ts`. |
| `compute.tf` (alarma `jobs-backlog`) | Escala workers por **antigüedad** del mensaje más viejo (> `backlog_age_seconds`, 120 s, dos minutos seguidos) en vez de por "≥ 1 mensaje visible": con trabajos cada 10 min, contar mensajes agregaba workers sin necesidad. |
| `grafana.tf`, `grafana/dashboards/*.json`, `user_data_grafana.sh.tftpl` | **Grafana OSS** sobre CloudWatch (`enable_grafana`): una `t3.micro` con el datasource de CloudWatch y el dashboard *RewardsHub · Lab* provisionados (el JSON está en git; los nombres reales de los recursos se ponen al arrancar). Puerto 3000 solo desde `admin_cidr`. |
| `src/observability/metrics.ts` | Con `METRICS_ENABLED=true` (`enable_app_metrics`) la API y los workers publican métricas propias en CloudWatch (namespace `RewardsHub`, dimensión `Role`) cada 60 s: diferencias de la conciliación, retraso de la réplica, replays de Idempotency-Key, aciertos de la caché del mapa, 429. Mismas credenciales que SQS; si falla, solo avisa en el log. |
| `scripts/find-duplicate-memberships.ts` | Solo lectura: membresías activas duplicadas que impedirían crear el índice único nuevo (correr antes de desplegar en una base con datos). |
| `scripts/load/concurrent-redeem.ts` | Demo de concurrencia e Idempotency-Key contra el ALB (ver *Demostraciones*). |
| `lab.sh` | `enqueue <tipo> [json]` (params opcionales), `status` (+ salud de Mongo, Redis y retraso de la réplica de DynamoDB), `grafana` (URL actual), `seed`, `run <script>`, `mongo-eval '<js>'` (por SSM; nunca manda contraseñas). `up` toma tu IP pública como `admin_cidr` si no la pusiste. |
| `frontend.tf` | Si `frontend_dir` no tiene `package.json` (p. ej. un checkout sin el repo del frontend al lado), el frontend se omite con un aviso en vez de fallar. |

Sin `SQS_QUEUE_URL`, `REDIS_URL`, `DDB_*`, `RATE_LIMITS`, `METRICS_ENABLED`, `GEO_QUERY_MODE`, `STATS_SOURCE` ni `MONGO_CONNECT_RETRIES` (local, Render) todo funciona igual que antes.

## Requisitos

- Terraform ≥ 1.5 y AWS CLI.
- Un `.env.lab` en la raíz del repo (ver `.env.lab.example`; se sube a un bucket privado del lab). **Sin `MONGO_URI`**: el lab nunca se conecta a una base fuera de AWS.
- **Base del lab**: MongoDB 7 en EC2 dentro de la VPC (`mongo.tf`), base `rewardshub_lab` (variable `lab_db_name`). Empieza vacía en cada `./lab.sh up` y se pierde con `./lab.sh down`; llénala con `./lab.sh seed` (ver *Uso*).

## Uso

1. En el Learner Lab: **Start Lab** → **AWS Details** → copia el bloque *AWS CLI* a `~/.aws/credentials` bajo el perfil `[academy]` (cambia `[default]` por `[academy]` al pegarlo).
   Las credenciales caducan con la sesión (unas 4 h): repite este paso cada vez.
2. Levantar:
   ```bash
   cd infra/aws
   ./lab.sh up          # terraform apply
   ```
   Las instancias tardan unos 5 minutos en instalar Node, hacer `npm ci` y compilar.
3. Revisar:
   ```bash
   ./lab.sh status      # salud de las instancias del ALB, ASGs y la cola
   curl $(terraform output -raw api_url)/health
   ./lab.sh enqueue     # encola un notification-batch de prueba
   ./lab.sh enqueue engagement-batch
   ./lab.sh enqueue daily-stats '{"day":"2026-11-18"}'   # con params (JSON)
   ./lab.sh enqueue replicate-dynamo                     # réplica a DynamoDB (si enable_dynamo)
   ./lab.sh dlq         # mensajes que fallaron 5 veces
   ./lab.sh logs worker 50   # últimas 50 líneas de cada worker
   ./lab.sh grafana     # URL de Grafana (si enable_grafana)
   ```
4. Destruir al terminar (el lab cobra mientras exista):
   ```bash
   ./lab.sh down        # terraform destroy
   ```

### Datos de prueba en la base del lab

Mongo vive dentro de la VPC, así que el seed corre en una instancia de la API (por SSM, con el mismo entorno que el servicio):

```bash
./lab.sh seed            # ~50 negocios, 2k usuarios, 50k transacciones en 90 días (~2–5 min)
./lab.sh seed --reset    # vacía las colecciones del seed y regenera
```

Los demás scripts de mantenimiento, igual (`./lab.sh run <script> [args]`; `--prod` se rechaza):

```bash
./lab.sh run compare-stats-sources --businesses 10 --days 30   # solo lectura
./lab.sh run migrate-locations-geo [--apply]
./lab.sh run find-duplicate-memberships [--json]               # solo lectura
./lab.sh run reconcile-fix --run <runKey> [--apply]
./lab.sh mongo-eval 'db.businesses.countDocuments()'           # JS como el usuario app en rewardshub_lab
```

- Datos sintéticos (correos `@seed.rewardshub.test`, contraseña `lab12345` para `/auth/cashier-login`), sucursales en Guadalajara y CDMX.
- Los saldos de `userpoints` se calculan a partir de las transacciones generadas: la conciliación arranca en 0 diferencias.
- Sin `--reset`, si ya hay datos del seed, se detiene (no duplica).
- Al terminar borra los checkpoints de `replicate-dynamo` (`replication_checkpoints`): las transacciones del seed traen `updatedAt` del pasado y, con un checkpoint ya avanzado, nunca se copiarían. La próxima corrida copia todo.
- `src/db/safety.ts` → `assertNonProductionDb()`: el script se niega a escribir si la base no termina en `_lab`, `_test` o `test` (y `test` a secas solo si viene explícita en `DB_NAME`, porque es la base por defecto del driver). `ALLOW_DB_WRITES=I_KNOW` lo salta: solo a mano y sabiendo lo que haces.

El estado (`terraform.tfstate`) queda local en esta carpeta. No lo borres antes de `./lab.sh down`.
Si cambias el código o el `.env.lab`: `./lab.sh up` sube el zip nuevo y actualiza el launch template, y luego `./lab.sh roll` reemplaza las instancias una por una (el lab no permite *instance refresh*, por eso es un paso aparte).

## Demostraciones para la práctica

- **Balanceo**: `for i in $(seq 20); do curl -s $(terraform output -raw api_url)/health; done` y mira los logs de cada instancia.
- **Autoescalado de la API**: sube `api_desired` en `terraform.tfvars`, o genera carga y mira cómo el ASG agrega instancias al pasar de 60 % de CPU.
- **Rate limiting**: más de 1000 peticiones en 5 minutos desde una IP reciben `429` (WAF). Ajustable con `waf_rate_limit`.
- **Cola y workers**: encola un backfill largo (`./lab.sh enqueue daily-stats '{"from":"…","to":"…"}'`, se parte en un mensaje por semana); cuando el mensaje más viejo lleva más de 120 s esperando durante 2 minutos, la alarma `jobs-backlog` agrega un worker, y `jobs-empty` lo quita tras 15 min sin mensajes. Las métricas de SQS llegan a CloudWatch con algunos minutos de retraso: con un backfill corto (14 semanas, ~5 min con un worker) la alarma dispara cuando la cola ya se vació. Para ver el escalado *mientras* hay trabajo, encola un rango más largo o varios backfills seguidos. Un mensaje inválido (tipo desconocido, params mal formados) se descarta con `Mensaje inválido` en el log y no va a la DLQ; a la DLQ solo llegan trabajos que fallan 5 veces (visibilidad de 900 s → ~75 min).
- **Idempotencia**: encola el mismo trabajo dos veces en el mismo minuto; solo uno se ejecuta (colección `jobruns` en Mongo).
- **Tolerancia a fallos**: termina una instancia desde la consola; el ALB deja de enviarle tráfico y el ASG la reemplaza.
- **Escrituras concurrentes** (después de `./lab.sh seed`): N restas simultáneas al mismo cliente, repartidas por el ALB entre las instancias de la API. Desde la raíz del repo:
  ```bash
  API=$(terraform -chdir=infra/aws output -raw api_url)
  npx ts-node scripts/load/concurrent-redeem.ts --url $API --n 20 --amount 10 --topup 100
  ```
  Con saldo 100 y 20 restas de 10: exactamente 10 responden `200`, 10 `400 Insufficient points…`, saldo final 0 y 10 transacciones `subtract`. Antes de las escrituras atómicas, el saldo final dependía de la carrera (restas perdidas o el chequeo de saldo pasado por dos a la vez).
- **Grafana** (con `enable_grafana = true`, `admin_cidr = "<tu IP>/32"` y, para los paneles *App*, `enable_app_metrics = true`):
  ```bash
  ./lab.sh grafana                                   # URL actual (la IP cambia cada sesión) y usuario
  terraform output -raw grafana_admin_password; echo
  ```
  Dashboard *RewardsHub · Lab*: entrada (ALB, p50/p95, 5xx, WAF), cómputo (instancias por ASG, CPU con la línea del 60 %), cola (visibles, en proceso, antigüedad, DLQ, con las alarmas `jobs-backlog`/`jobs-empty` como anotaciones), datos (Redis/DynamoDB, fila colapsada) y la app. Durante una prueba de carga (`scripts/load/concurrent-redeem.ts`) o un backfill largo de `daily-stats` se ve escalar la API y los workers. Tu IP pública: `curl -s https://checkip.amazonaws.com`.
- **Réplica en DynamoDB** (con `enable_dynamo = true` y `stats_source = "dynamo"`, después de llenar `daily_stats`):
  ```bash
  ./lab.sh enqueue replicate-dynamo       # o esperar ≤ 10 min a EventBridge
  ./lab.sh status                         # "Réplica DynamoDB: al día hasta … (retraso N min)"
  curl -s -D - -o /dev/null -H "Authorization: Bearer $TOKEN" "$API/business/stats/timeseries?days=30" | grep -i x-data-freshness
  # comparar las tres fuentes (solo lectura), dentro de la VPC:
  ./lab.sh run compare-stats-sources --businesses 10 --days 30
  ```
  Las tres fuentes (live, daily, dynamo) deben coincidir. En Grafana, la fila *Datos* muestra la capacidad consumida de DynamoDB y *App* el retraso de la réplica.
- **Caché del mapa** (con `redis_mode` ≠ `"off"`):
  ```bash
  API=$(terraform output -raw api_url)
  for i in 1 2 3; do curl -s -o /dev/null -D - "$API/business/nearby?latitude=20.6597&longitude=-103.3496" | grep -i x-cache; done
  ```
  La primera dice `X-Cache: MISS` y las siguientes `HIT` (aunque las atienda otra instancia: la caché está en Redis). Edita una sucursal (cambiando algo, p. ej. el nombre) desde el dashboard y la siguiente consulta vuelve a ser `MISS` y ya trae el cambio; un PUT con los mismos valores no invalida. La API abre la conexión a Redis al arrancar (`warmUpRedis`, máx. 2 s), así que ni la primera petición tras un `roll` sale `BYPASS`. Para la demo del 429: `/auth/cashier-login` comparte el contador `login`, así que hazla al final (o borra `rl:login:*`, ver `docs/LAB-RUNBOOK.md`). Coordenadas a unos metros (`20.6599`) también son `HIT`: la llave se redondea a ~110 m, pero las distancias de la respuesta son las exactas de cada petición.
- **Rate limit compartido**: 20 logins fallidos seguidos a través del ALB (el ALB los reparte entre las instancias):
  ```bash
  for i in $(seq 20); do curl -s -o /dev/null -w '%{http_code} ' -X POST "$API/auth/login" -H 'Content-Type: application/json' -d '{"idToken":"x"}'; done; echo
  ```
  Con Redis: `401` × 10 y luego `429`. Con `redis_mode = "off"` (el "antes"): cada instancia cuenta por su lado, así que con 2 instancias pasan ~20 antes del `429`.
- **Redis caído**: detén Redis (modo `ec2`: detén la instancia `rewardshub-redis` en la consola; o `redis_mode = "off"` + `./lab.sh up && ./lab.sh roll`). La API sigue respondiendo con `X-Cache: BYPASS` y los límites vuelven a ser por instancia.
- **Trabajos programados nuevos** (después de `./lab.sh seed`):
  ```bash
  ./lab.sh enqueue daily-stats '{"from":"2026-08-01","to":"2026-11-18"}'   # backfill: el worker lo parte en semanas
  ./lab.sh enqueue daily-stats '{"day":"2026-11-18"}'
  ./lab.sh enqueue reconcile-balances                                     # conciliación (solo reporte)
  ./lab.sh logs worker 50                                                 # 📅 [daily-stats] … / 🧮 [reconcile] …
  ```
  Con datos del seed, `reconcile-balances` reporta `mismatchCount: 0` (colección `reconciliation_runs`). Para la demo, corrompe a mano un saldo (`./lab.sh mongo-eval 'db.userpoints.updateOne({}, {$inc: {"businessPoints.0.rewardSystems.0.points": 7}})'`), vuelve a encolar y debe reportar exactamente 1. Para arreglarlo: `./lab.sh run reconcile-fix --run <runKey>` (dry run) y luego `--apply`. El backfill largo también sirve para ver escalar a los workers (varios mensajes en la cola).
- **Mapa con índice 2dsphere**: con `geo_query_mode = "geo"` en `terraform.tfvars` (+ `./lab.sh up && ./lab.sh roll`), `/business/nearby`, `/in-bounds` y `/all` consultan con `$geoNear` / `$geoWithin` en vez de recorrer el recuadro de lat/lng. La respuesta es la misma; con `./lab.sh mongo-eval` y `explain()` se ve que usa el índice `locations.geo_2dsphere`.
- **daily_stats**: con `stats_source = "daily"`, las estadísticas del dashboard leen `daily_stats` (una fila por día) en vez de agregar todas las transacciones. Hasta que el job `daily-stats` del worker (P3) llene la colección, los días faltantes se calculan en vivo: el resultado es el mismo, solo más lento.
- **Idempotency-Key**: las mismas 20 restas con **una sola** llave (como un celular que reintenta tras un timeout):
  ```bash
  npx ts-node scripts/load/concurrent-redeem.ts --url $API --n 20 --amount 10 --same-key
  ```
  Solo una resta se aplica; el resto recibe `409` (`Retry-After: 1`) mientras la primera está en curso, o la misma respuesta con `Idempotent-Replayed: true`. El script sale con código 1 si el saldo no cuadra.

## Logs

Con `key_name = "vockey"` en `terraform.tfvars` puedes entrar por SSH (o usa *EC2 Instance Connect* desde la consola):

```bash
sudo tail -f /var/log/cloud-init-output.log   # arranque / build
sudo journalctl -u rewardshub -f              # la app (API o worker)
sudo journalctl -u rewardshub-mongo -f        # MongoDB (instancia rewardshub-mongo)
sudo rh-mongo-health                          # rs.status(): PRIMARY
```

## Limitaciones del Learner Lab

- No se pueden crear roles IAM: las instancias usan `LabInstanceProfile`, y EventBridge publica en SQS mediante la política de la cola (no necesita un rol).
- Solo `us-east-1` / `us-west-2`.
- La SCP del lab niega `s3:GetBucketObjectLockConfiguration` (por eso el bucket se crea con CloudFormation) y `autoscaling:StartInstanceRefresh` (por eso existe `./lab.sh roll`). CloudFront no está permitido en absoluto (por eso el frontend es un sitio estático de S3 por HTTP).
- Si `apply` falla en los recursos `aws_wafv2_*`, desactiva WAF con `enable_waf = false`.
- **Redis — prueba de ElastiCache (P4.0): ✅ OK el 2026-11-21.** `rh-probe` (`cache.t3.micro`, Redis 7.1.0) llegó a `available` en 199 s y se borró. → `redis_mode = "elasticache"`. Cómo repetir la prueba (otra cuenta u otro lab):
  1. En una sesión del lab, prueba crear y borrar un clúster mínimo:
     ```bash
     aws elasticache create-cache-cluster --cache-cluster-id rh-probe --engine redis \
       --cache-node-type cache.t3.micro --num-cache-nodes 1 --profile academy --region us-east-1
     aws elasticache wait cache-cluster-available --cache-cluster-id rh-probe --profile academy --region us-east-1
     aws elasticache delete-cache-cluster --cache-cluster-id rh-probe --profile academy --region us-east-1
     ```
  2. Si llega a `available` → `redis_mode = "elasticache"` en `terraform.tfvars`.
     Si falla (AccessDenied, SCP, service-linked role) → `redis_mode = "ec2"`: una `t3.micro` con Valkey/Redis 6, mismo security group (6379 solo desde la API y los workers).
  3. `./lab.sh up && ./lab.sh roll`, y `./lab.sh status` muestra el estado de Redis.
- **DynamoDB y CloudWatch — prueba P5.0: ✅ OK el 2026-11-21**, desde una instancia de la API con su rol (LabRole, vía SSM): `dynamodb put-item` / `get-item` sobre `rh-probe` (`PAY_PER_REQUEST`), `cloudwatch put-metric-data` (namespace `RewardsHub`) y `cloudwatch list-metrics`. La tabla se borró. → `enable_dynamo = true`, `enable_app_metrics = true` y Grafana viable. (La métrica `RewardsHub/Probe` no se puede borrar a mano; CloudWatch la descarta sola tras 15 meses sin datos.) Cómo repetir la prueba:
  ```bash
  aws dynamodb create-table --table-name rh-probe --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=pk,AttributeType=S --key-schema AttributeName=pk,KeyType=HASH \
    --profile academy --region us-east-1
  aws dynamodb wait table-exists --table-name rh-probe --profile academy --region us-east-1
  # desde una instancia del lab (SSH o Instance Connect), con su rol:
  aws dynamodb put-item --table-name rh-probe --item '{"pk":{"S":"x"}}' --region us-east-1
  aws dynamodb get-item --table-name rh-probe --key '{"pk":{"S":"x"}}' --region us-east-1
  aws cloudwatch put-metric-data --namespace RewardsHub --metric-name Probe --value 1 --region us-east-1
  # y borrar:
  aws dynamodb delete-table --table-name rh-probe --profile academy --region us-east-1
  ```
  Si todo pasa → `enable_dynamo = true` (y `stats_source = "dynamo"`). Si DynamoDB falla, todo sigue en Mongo (`stats_source = "daily"`). Anota aquí el resultado (fecha y error, si lo hubo).
- **Permisos para MongoDB en EC2, DynamoDB y ElastiCache — prueba del 2026-11-22 (01:12 UTC)**, con el rol de la CLI (`assumed-role/voclabs`, cuenta del lab):
  - `aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::<cuenta>:role/voclabs` **sí está permitido** (no hubo que caer en el plan B). Resultado `allowed` para:
    `dynamodb:CreateTable`, `DeleteTable`, `DescribeTable`, `PutItem`, `GetItem`, `BatchWriteItem`, `Query`;
    `elasticache:CreateCacheCluster`, `DeleteCacheCluster`, `DescribeCacheClusters`, `CreateCacheSubnetGroup`;
    `ec2:RunInstances`, `CreateVolume`, `AttachVolume`, `CreateSecurityGroup`, `AuthorizeSecurityGroupIngress`, `DeleteSecurityGroup`, `CreateTags`, `DescribeInstances`; `ssm:SendCommand`.
  - `iam:PassRole` con recurso `*` → `implicitDeny`; con recurso `arn:aws:iam::<cuenta>:role/LabRole` → `allowed`. Es lo que usa `LabInstanceProfile`: las instancias solo pueden llevar ese perfil.
  - Como la simulación no evalúa condiciones de la SCP del lab (tipo de instancia, etc.), además se probó `ec2 run-instances --dry-run` con AL2023, `t3.medium`, `LabInstanceProfile`, IMDSv2 obligatorio (`HttpTokens=required`, hop limit 2), IP privada fija (`.10` de la subred) y un volumen extra `/dev/sdf` gp3 de 20 GB con `DeleteOnTermination=true`: **`DryRunOperation` (se habría creado)**, tanto con `Encrypted=false` como con `Encrypted=true`.
  - Prueba real de security groups: `rh-probe-sg` + `rh-probe-sg2` en la VPC por defecto, regla 27017 en el primero con origen el segundo (referencia entre SG, como `mongo.tf`) → OK; los dos se borraron (`describe-security-groups` con `rh-probe*` → 0).
  - Cuotas: `service-quotas get-service-quota` (vCPU, `L-1216C47A`) → **AccessDenied** (`no identity-based policy allows the servicequotas:GetServiceQuota action`). `ec2 describe-account-attributes` → `max-instances = 20`. El límite propio del Learner Lab (instancias/vCPU simultáneos) no se puede leer por la API: revisa el panel *Readme* del lab. Peor caso con los defaults: API 4 + workers 3 + Grafana 1 + Mongo 1 = 9 instancias EC2 (Redis va en ElastiCache), 18 vCPU.
- **MongoDB en EC2**:
  - Datos desechables: el volumen se borra con la instancia, así que `./lab.sh down` pierde la base (y las tablas de DynamoDB, que también se destruyen). Cada `up` empieza vacío → `./lab.sh seed`.
  - La instancia ignora cambios de AMI y de `user_data` (`ignore_changes`): una AMI nueva de AL2023 no la reemplaza a media sesión. Para tomar un script nuevo: `down` + `up`.
  - Orden de arranque: la API y los workers pueden arrancar antes que Mongo. La API no escucha hasta conectar; con `MONGO_CONNECT_RETRIES=20` espera ~8 min (más el timeout de cada intento) y luego sale con 1 y systemd la reinicia. Mongo tarda ~2 min en estar `PRIMARY` y la API ~5 min en compilar, dentro de los 600 s de gracia del ASG: no hay bucle de reemplazos salvo que Mongo esté caído más de 10 min.
  - Sin TLS (red privada de la VPC; 27017 solo desde la API y los workers). Las contraseñas están en el estado local de Terraform, en el `user_data` (lo ve quien tenga las credenciales del lab) y en archivos solo-root de las instancias; `lab.sh` nunca las manda por SSM.
  - Conexiones: hasta 7 procesos × `MONGO_MAX_POOL_SIZE=20` = 140 conexiones, sin problema para una `t3.medium`.
- La réplica es incremental por `updatedAt`: las transacciones no se editan ni se borran después de creadas. Si alguna vez se borraran en Mongo, la copia en DynamoDB quedaría (no se replican borrados).
- **Grafana**: Amazon Managed Grafana no es opción (necesita IAM Identity Center / roles de servicio). Se usa Grafana OSS en EC2 con `LabInstanceProfile`. La IP pública cambia cada vez que el lab detiene y arranca la instancia: usa `./lab.sh grafana`; si cambia tu IP, actualiza `admin_cidr` y `./lab.sh up`. Las métricas de grupo de los ASG (`GroupInServiceInstances`) se activan solo con Grafana. **Verificado en el lab el 2026-11-21:** LabRole lee CloudWatch y la app publica sus métricas; los 21 paneles responden sin error (los de WAF bloqueado, DynamoDB throttled y BYPASS salen en 0 porque no hubo ninguno). La `t3.micro` tiene 1 GB: el `user_data` crea 1 GB de swap antes de `dnf install grafana`, que sin él moría por falta de memoria ("Killed" en `/var/log/cloud-init-output.log`). Grafana tarda ~2.5 min en responder tras crear la instancia.
- Redis va sin TLS ni contraseña: vive en la VPC y su security group solo acepta a la API y los workers. La caché no guarda hashes ni tokens.
- Solo HTTP (no hay dominio ni certificado). Los webhooks de Stripe necesitan HTTPS, así que no apuntes Stripe al ALB. La deduplicación del webhook se prueba con tests y con `stripe trigger` / `stripe events resend` contra local o Render.
- El `.env.lab` vive cifrado (SSE-S3) en un bucket privado del lab. Sus `AWS_ACCESS_KEY_ID`/`SECRET` siguen usándose solo para S3; SQS usa el rol de la instancia.
