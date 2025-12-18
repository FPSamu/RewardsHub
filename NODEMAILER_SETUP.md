# Guía de Configuración de Nodemailer para RewardsHub

## 📧 Migración de SendGrid a Nodemailer

Este proyecto ha sido migrado de **SendGrid** a **Nodemailer** para mayor flexibilidad y control sobre el envío de correos electrónicos.

---

## 🚀 Configuración Rápida

### Opción 1: Gmail (Recomendado para Desarrollo)

1. **Habilitar "App Passwords" en tu cuenta de Gmail:**
   - Ve a tu cuenta de Google: https://myaccount.google.com/
   - Navega a **Seguridad** → **Verificación en dos pasos** (actívala si no está activa)
   - Busca **Contraseñas de aplicaciones**
   - Genera una nueva contraseña para "Correo" en "Otro (nombre personalizado)"
   - Copia la contraseña de 16 caracteres generada

2. **Configura tu archivo `.env`:**
   ```env
   EMAIL_SERVICE=gmail
   EMAIL_USER=tu-email@gmail.com
   EMAIL_PASSWORD=xxxx-xxxx-xxxx-xxxx  # App Password de 16 caracteres
   EMAIL_FROM=tu-email@gmail.com
   FRONTEND_URL=http://localhost:5173
   ```

### Opción 2: Outlook/Hotmail

```env
EMAIL_SERVICE=outlook
EMAIL_USER=tu-email@outlook.com
EMAIL_PASSWORD=tu-contraseña
EMAIL_FROM=tu-email@outlook.com
FRONTEND_URL=http://localhost:5173
```

### Opción 3: SMTP Personalizado

Para servicios como **Mailgun**, **SendinBlue**, **Amazon SES**, etc.:

```env
EMAIL_SERVICE=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false  # true para puerto 465, false para 587
EMAIL_USER=tu-email@example.com
EMAIL_PASSWORD=tu-contraseña
EMAIL_FROM=tu-email@example.com
FRONTEND_URL=http://localhost:5173
```

---

## 📋 Variables de Entorno Requeridas

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `EMAIL_SERVICE` | Servicio de email (`gmail`, `outlook`, `smtp`) | `gmail` |
| `EMAIL_USER` | Email del remitente | `rewardshub@gmail.com` |
| `EMAIL_PASSWORD` | Contraseña o App Password | `xxxx-xxxx-xxxx-xxxx` |
| `EMAIL_FROM` | Email que aparecerá como remitente | `rewardshub@gmail.com` |
| `FRONTEND_URL` | URL del frontend para links de verificación | `http://localhost:5173` |
| `SMTP_HOST` | (Solo SMTP) Host del servidor SMTP | `smtp.gmail.com` |
| `SMTP_PORT` | (Solo SMTP) Puerto SMTP | `587` |
| `SMTP_SECURE` | (Solo SMTP) Usar SSL/TLS | `false` |

---

## 🔧 Configuración por Proveedor

### Gmail

**Importante:** Gmail requiere "App Passwords" si tienes la verificación en dos pasos activada.

```env
EMAIL_SERVICE=gmail
EMAIL_USER=tu-email@gmail.com
EMAIL_PASSWORD=app-password-de-16-caracteres
EMAIL_FROM=tu-email@gmail.com
```

**Límites de Gmail:**
- **500 emails/día** para cuentas gratuitas
- **2000 emails/día** para Google Workspace

### Outlook/Hotmail

```env
EMAIL_SERVICE=outlook
EMAIL_USER=tu-email@outlook.com
EMAIL_PASSWORD=tu-contraseña
EMAIL_FROM=tu-email@outlook.com
```

**Límites de Outlook:**
- **300 emails/día** para cuentas gratuitas

### Amazon SES

```env
EMAIL_SERVICE=smtp
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=false
EMAIL_USER=tu-smtp-username
EMAIL_PASSWORD=tu-smtp-password
EMAIL_FROM=verified-email@example.com
```

### Mailgun

```env
EMAIL_SERVICE=smtp
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_SECURE=false
EMAIL_USER=postmaster@tu-dominio.mailgun.org
EMAIL_PASSWORD=tu-api-key
EMAIL_FROM=noreply@tu-dominio.com
```

### SendinBlue (Brevo)

```env
EMAIL_SERVICE=smtp
SMTP_HOST=smtp-relay.sendinblue.com
SMTP_PORT=587
SMTP_SECURE=false
EMAIL_USER=tu-email@example.com
EMAIL_PASSWORD=tu-smtp-key
EMAIL_FROM=tu-email@example.com
```

---

## 🧪 Pruebas

### Verificar Configuración

El transporter se verifica automáticamente al iniciar el servidor. Busca en los logs:

```
✅ Servidor de email listo para enviar mensajes
```

Si hay un error:

```
⚠️ Error al conectar con el servidor de email: [detalles del error]
```

### Enviar Email de Prueba

Puedes probar el envío de emails usando los endpoints de autenticación:

1. **Registrar un usuario:**
   ```bash
   POST http://localhost:3000/auth/register
   {
     "username": "Test User",
     "email": "tu-email-de-prueba@gmail.com",
     "password": "password123"
   }
   ```

2. **Verificar que recibiste el email de verificación**

---

## 🐛 Solución de Problemas

### Error: "Invalid login: 535-5.7.8 Username and Password not accepted"

**Causa:** Credenciales incorrectas o App Password no configurado (Gmail).

**Solución:**
- Para Gmail: Genera un "App Password" en lugar de usar tu contraseña normal
- Verifica que `EMAIL_USER` y `EMAIL_PASSWORD` estén correctos

### Error: "ECONNECTION"

**Causa:** No se puede conectar al servidor SMTP.

**Solución:**
- Verifica `SMTP_HOST` y `SMTP_PORT`
- Asegúrate de que tu firewall no bloquee el puerto
- Intenta cambiar `SMTP_SECURE` a `true` o `false`

### Error: "EAUTH"

**Causa:** Error de autenticación.

**Solución:**
- Verifica que las credenciales sean correctas
- Para Gmail: Asegúrate de usar App Password
- Para Outlook: Verifica que la cuenta no tenga restricciones de seguridad

### Los emails no llegan

**Posibles causas:**
1. **Revisa la carpeta de spam**
2. **Verifica los logs del servidor** para ver si hay errores
3. **Límites de envío alcanzados** (Gmail: 500/día, Outlook: 300/día)
4. **Email no verificado** (algunos proveedores requieren verificar el dominio)

---

## 📝 Funciones Disponibles

### `sendEmail(to, subject, html, text?)`

Función principal para enviar emails.

```typescript
import { sendEmail } from './services/email.service';

await sendEmail(
  'usuario@example.com',
  'Asunto del email',
  '<h1>Contenido HTML</h1>',
  'Contenido en texto plano (opcional)'
);
```

### `sendVerificationEmail(to, token, isBusiness?)`

Envía email de verificación de cuenta.

```typescript
import { sendVerificationEmail } from './services/email.service';

await sendVerificationEmail(
  'usuario@example.com',
  'verification-token-123',
  false // true para negocios, false para usuarios
);
```

### `sendPasswordResetEmail(to, token, isBusiness?)`

Envía email de recuperación de contraseña.

```typescript
import { sendPasswordResetEmail } from './services/email.service';

await sendPasswordResetEmail(
  'usuario@example.com',
  'reset-token-123',
  false
);
```

### `sendRewardReminderEmail(to, businessName, rewardTitle, message?)`

Envía recordatorio de recompensa disponible.

```typescript
import { sendRewardReminderEmail } from './services/email.service';

await sendRewardReminderEmail(
  'usuario@example.com',
  'Café Delicioso',
  'Café Gratis',
  '¡Ya tienes 10 estampas! Reclama tu café gratis.'
);
```

---

## 🔒 Seguridad

### Mejores Prácticas

1. **Nunca commits credenciales al repositorio**
   - Usa `.env` para credenciales
   - Asegúrate de que `.env` esté en `.gitignore`

2. **Usa App Passwords para Gmail**
   - Más seguro que usar tu contraseña principal
   - Puedes revocar acceso sin cambiar tu contraseña

3. **Limita el rate de envío**
   - Implementa rate limiting para prevenir spam
   - Respeta los límites de tu proveedor

4. **Valida emails antes de enviar**
   - Verifica formato de email
   - Usa listas de verificación para prevenir bounces

---

## 🚀 Producción

### Recomendaciones para Producción

1. **Usa un servicio dedicado de email:**
   - **SendGrid** (hasta 100 emails/día gratis)
   - **Mailgun** (hasta 5,000 emails/mes gratis)
   - **Amazon SES** (muy económico, requiere verificación)
   - **Postmark** (excelente deliverability)

2. **Configura SPF, DKIM y DMARC:**
   - Mejora la deliverability
   - Reduce la probabilidad de ir a spam

3. **Monitorea el envío:**
   - Implementa logging de emails enviados
   - Monitorea bounce rates y quejas de spam

4. **Usa un dominio personalizado:**
   - Mejor reputación que emails genéricos
   - Mayor confianza del usuario

---

## 📚 Recursos Adicionales

- [Documentación de Nodemailer](https://nodemailer.com/)
- [Gmail App Passwords](https://support.google.com/accounts/answer/185833)
- [Lista de servicios soportados](https://nodemailer.com/smtp/well-known/)

---

## ✅ Checklist de Migración

- [x] Instalar `nodemailer` y `@types/nodemailer`
- [x] Desinstalar `@sendgrid/mail` y `@types/sendgrid`
- [x] Actualizar `email.service.ts`
- [x] Actualizar `.env.example`
- [ ] Configurar variables de entorno en `.env`
- [ ] Probar envío de emails en desarrollo
- [ ] Configurar proveedor de email para producción
- [ ] Actualizar variables de entorno en Render/servidor de producción

---

**¡Listo!** Tu aplicación ahora usa Nodemailer para el envío de correos electrónicos. 🎉
