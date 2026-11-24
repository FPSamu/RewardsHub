# Cheat sheet: demo del lab de AWS Academy

Todos los comandos se corren en `rewardshub_back/infra/aws`, salvo donde se indica.

**Orden para la demo:** credenciales → `up` → `status` → `seed` → `activate` → abrir Grafana → `demo rapidos` → `demo workers` → WAF alto + `demo carga` + `up` → `demo falla` → `demo waf --si` → `down`.

## 1. Credenciales (cada sesión, duran ~4 h)

| Acción | Qué hace |
|---|---|
| Learner Lab → **Start Lab** → **AWS Details** → **AWS CLI: Show** | Muestra las credenciales nuevas |
| Pegarlas en `~/.aws/credentials` cambiando `[default]` por `[academy]` | `lab.sh` y Terraform usan el perfil `academy` |
| `aws --profile academy sts get-caller-identity` | Comprueba que las credenciales funcionan |

## 2. Código (solo si hubo cambios)

| Comando | Qué hace |
|---|---|
| `cd rewardshub_back && git pull && npm ci` | Trae el backend y sus dependencias |
| `cd rewardshub_front && git pull` | Trae el front; `up` lo compila tal como esté en disco |

Primera vez: `cp .env.lab.example .env.lab` en `rewardshub_back` y llenar `JWT_SECRET`, `JWT_REFRESH_SECRET` (`npm run generate-secrets`) y `FIREBASE_*`. El front necesita `VITE_FIREBASE_*` en su `.env.local`.

## 3. Levantar

| Comando | Qué hace |
|---|---|
| `./lab.sh up` → `yes` | Crea todo: VPC, ALB, WAF, API, workers, Mongo, Redis, DynamoDB, SQS, Grafana y el front (~5–8 min) |
| `./lab.sh status` | Salud de las instancias, Mongo, Redis, réplica y cola. Repite hasta ver **2 healthy** y Mongo **PRIMARY** |
| `./lab.sh roll` | *Opcional:* reemplaza las instancias para que tomen código nuevo. Solo después de ver healthy |
| `./lab.sh seed` | Llena la base del lab: 50 negocios, 2000 clientes y 50k transacciones |
| `./lab.sh activate` | Verifica las cuentas y da suscripción a los negocios (sin correo ni Stripe). Repítelo tras registrar cuentas nuevas |

## 4. URLs y accesos

| Comando o acción | Qué hace |
|---|---|
| `terraform output -raw frontend_url` | URL del front |
| Agregar ese dominio (sin `http://`) en Firebase → Authentication → Settings → **Authorized domains** | Habilita el login en el front del lab. Solo hace falta si el bucket cambió (después de un `down` y otro `up`) |
| `./lab.sh grafana` | URL, usuario y contraseña de Grafana → dashboard **RewardsHub · Lab** (*Last 30 minutes*, refresco 10 s) |
| `chrome://flags/#unsafely-treat-insecure-origin-as-secure` → agregar la URL del front | Permite la cámara (QR) y la ubicación en HTTP |

**Cuentas:**
- **Negocio:** login de cajero con `negocio01@seed.rewardshub.test` / `lab12345`. PIN de administrador: `123456`.
- **Cliente:** regístrate desde la web y luego corre `./lab.sh activate`.

## 5. Pruebas guiadas (con log y panel de Grafana)

Cada escenario registra lo que hace en la terminal y en `logs/lab-demo-*.log`, verifica el resultado (✅/❌) y dice qué panel de Grafana mirar. Grafana va 1–5 min atrás del log.

| Comando | Qué hace |
|---|---|
| `./lab.sh demo` | Lista los escenarios |
| `./lab.sh demo rapidos` | Corre los 6 rápidos de esta tabla seguidos (~2 min) |
| `./lab.sh demo balanceo` | El ALB reparte 120 peticiones entre instancias |
| `./lab.sh demo cache` | Mapa: MISS y luego HIT en Redis |
| `./lab.sh demo idempotencia` | Reintento, doble clic y llave reutilizada: no suma dos veces |
| `./lab.sh demo atomico` | 10 canjes simultáneos: el saldo nunca queda negativo |
| `./lab.sh demo ratelimit` | PIN equivocado: 429 al 6.º intento |
| `./lab.sh demo cola` | SQS: trabajos, un duplicado descartado y un mensaje inválido descartado |
| `./lab.sh demo workers` | La alarma de la cola agrega un worker (~15 min) |
| `./lab.sh up -var waf_rate_limit=2000000` | Sube el límite del WAF para la prueba de carga |
| `./lab.sh demo carga` | La CPU pasa de 40 % y la API escala (~10–15 min) |
| `./lab.sh up` | Regresa el WAF a su límite normal después de la carga |
| `./lab.sh demo falla` | Termina una instancia de la API; el servicio sigue y el ASG la reemplaza |
| `./lab.sh demo waf --si` | **Al final:** el WAF bloquea tu IP con 403 durante 5–10 min |

## 6. Revisar

| Comando | Qué hace |
|---|---|
| `./lab.sh logs api 50` / `./lab.sh logs worker 50` | Últimas líneas del log de cada instancia |
| `./lab.sh logs api 200 \| grep withTransaction` | Vacío = Mongo hace transacciones reales (replica set) |
| `./lab.sh enqueue reconcile-balances` | Encola un trabajo a mano |
| `./lab.sh dlq` | Mensajes que fallaron 5 veces |
| `./lab.sh mongo-eval 'db.users.countDocuments()'` | Consulta la base del lab |

## 7. Apagar (siempre)

| Comando | Qué hace |
|---|---|
| `./lab.sh down` → `yes` | Destruye todo, incluida la base del lab |
| Si la sesión ya expiró: Start Lab → nuevas credenciales → `./lab.sh down` | Con credenciales viejas falla |
