# RewardsHub en AWS Academy (rama `sistemas-escalables`)

Infraestructura para la práctica de sistemas escalables. **No es producción**: producción sigue en Render.
De momento cubre el **load balancer** y la **cola SQS** del diagrama de arquitectura.

```
Clientes ──► ALB (+ WAF rate limit) ──► ASG API (2..4 × EC2, escala por CPU)
                                              │  POST /notifications/run-*  → encola
EventBridge (10:00 y 19:00 UTC) ──► SQS jobs ──► ASG Workers (1..3 × EC2, escala por mensajes)
                                       │
                                       └─► DLQ (tras 5 intentos fallidos)
```

## Qué cambió en el código

| Archivo | Cambio |
|---|---|
| `src/index.ts` | Si existe `SQS_QUEUE_URL`, **no** programa los batches en proceso (con N instancias correrían N veces). Apagado ordenado con SIGTERM. |
| `src/worker.ts` | Proceso nuevo (`npm run worker`) que consume la cola con long polling. |
| `src/queue/*` | Cliente SQS, formato de mensajes, procesamiento y candado de idempotencia. |
| `src/models/jobRun.model.ts` | Candado en Mongo: SQS entrega "al menos una vez", así que el mismo trabajo nunca se ejecuta dos veces aunque haya varios workers. |
| `src/controllers/notification.controller.ts` | Con cola activa, `run-batch` / `run-engagement` encolan y responden `202`. |
| `src/app.ts` | `TRUST_PROXY=1` para leer la IP real del cliente detrás del ALB. |

Sin `SQS_QUEUE_URL` (local, Render) todo funciona igual que antes.

## Requisitos

- Terraform ≥ 1.5 y AWS CLI.
- El `.env` del backend en la raíz del repo (se sube a un bucket privado del lab).
- **MongoDB Atlas → Network Access**: permite `0.0.0.0/0` mientras dure la práctica (las IP de las instancias cambian).

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
   ./lab.sh dlq         # mensajes que fallaron 5 veces
   ```
4. Destruir al terminar (el lab cobra mientras exista):
   ```bash
   ./lab.sh down        # terraform destroy
   ```

El estado (`terraform.tfstate`) queda local en esta carpeta. No lo borres antes de `./lab.sh down`.
Si cambias el código o el `.env`: `./lab.sh up` sube el zip nuevo y actualiza el launch template, y luego `./lab.sh roll` reemplaza las instancias una por una (el lab no permite *instance refresh*, por eso es un paso aparte).

## Demostraciones para la práctica

- **Balanceo**: `for i in $(seq 20); do curl -s $(terraform output -raw api_url)/health; done` y mira los logs de cada instancia.
- **Autoescalado de la API**: sube `api_desired` en `terraform.tfvars`, o genera carga y mira cómo el ASG agrega instancias al pasar de 60 % de CPU.
- **Rate limiting**: más de 1000 peticiones en 5 minutos desde una IP reciben `429` (WAF). Ajustable con `waf_rate_limit`.
- **Cola y workers**: encola varios mensajes; tras 2 minutos con mensajes pendientes la alarma `jobs-backlog` agrega workers.
- **Idempotencia**: encola el mismo trabajo dos veces en el mismo minuto; solo uno se ejecuta (colección `jobruns` en Mongo).
- **Tolerancia a fallos**: termina una instancia desde la consola; el ALB deja de enviarle tráfico y el ASG la reemplaza.

## Logs

Con `key_name = "vockey"` en `terraform.tfvars` puedes entrar por SSH (o usa *EC2 Instance Connect* desde la consola):

```bash
sudo tail -f /var/log/cloud-init-output.log   # arranque / build
sudo journalctl -u rewardshub -f              # la app (API o worker)
```

## Limitaciones del Learner Lab

- No se pueden crear roles IAM: las instancias usan `LabInstanceProfile`, y EventBridge publica en SQS mediante la política de la cola (no necesita un rol).
- Solo `us-east-1` / `us-west-2`.
- La SCP del lab niega `s3:GetBucketObjectLockConfiguration` (por eso el bucket se crea con CloudFormation) y `autoscaling:StartInstanceRefresh` (por eso existe `./lab.sh roll`).
- Si `apply` falla en los recursos `aws_wafv2_*`, desactiva WAF con `enable_waf = false`.
- Solo HTTP (no hay dominio ni certificado). Los webhooks de Stripe necesitan HTTPS, así que no apuntes Stripe al ALB.
- El `.env` vive cifrado (SSE-S3) en un bucket privado del lab. Sus `AWS_ACCESS_KEY_ID`/`SECRET` siguen usándose solo para S3; SQS usa el rol de la instancia.
