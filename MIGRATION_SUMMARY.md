# Resumen de Migración: SendGrid → Nodemailer

## 📅 Fecha de Migración
18 de diciembre de 2025

## 🎯 Objetivo
Migrar el sistema de envío de correos electrónicos de **SendGrid** a **Nodemailer** para mayor flexibilidad, control y reducción de dependencias de servicios externos.

---

## ✅ Cambios Realizados

### 1. **Dependencias Actualizadas**

#### Agregadas:
- `nodemailer@^6.9.7` - Cliente de email para Node.js
- `@types/nodemailer@^6.4.14` - Tipos TypeScript para Nodemailer

#### Removidas:
- `@sendgrid/mail@^8.1.6` - Cliente de SendGrid
- `@types/sendgrid@^2.0.31` - Tipos TypeScript para SendGrid

### 2. **Archivos Modificados**

#### `package.json`
- Reemplazada dependencia `@sendgrid/mail` por `nodemailer`
- Reemplazada dependencia `@types/sendgrid` por `@types/nodemailer`

#### `src/services/email.service.ts` (Reescrito completamente)
**Cambios principales:**
- Importación de `nodemailer` en lugar de `@sendgrid/mail`
- Nuevo sistema de transporter con inicialización lazy
- Soporte para múltiples proveedores:
  - Gmail
  - Outlook/Hotmail
  - SMTP personalizado (Mailgun, SES, SendinBlue, etc.)
- Verificación automática de conexión al inicializar
- Mejor manejo de errores con códigos específicos (`EAUTH`, `ECONNECTION`)
- Mensajes de log más descriptivos con emojis
- Soporte para texto plano automático desde HTML

**Funciones mantenidas (API compatible):**
- `sendEmail(to, subject, html, text?)` - Función principal
- `sendVerificationEmail(to, token, isBusiness?)` - Email de verificación
- `sendPasswordResetEmail(to, token, isBusiness?)` - Email de reset de contraseña
- `sendRewardReminderEmail(to, businessName, rewardTitle, message?)` - Email de recordatorio

#### `.env.example`
**Variables agregadas:**
- `EMAIL_SERVICE` - Tipo de servicio (gmail, outlook, smtp)
- `EMAIL_USER` - Usuario/email del remitente
- `EMAIL_PASSWORD` - Contraseña o App Password
- `EMAIL_FROM` - Email que aparece como remitente
- `SMTP_HOST` - Host SMTP (solo para servicio smtp)
- `SMTP_PORT` - Puerto SMTP (solo para servicio smtp)
- `SMTP_SECURE` - SSL/TLS (solo para servicio smtp)
- `FRONTEND_URL` - URL del frontend para links

**Variables removidas:**
- `SENDGRID_API_KEY` - Ya no necesaria

### 3. **Archivos Nuevos Creados**

#### `NODEMAILER_SETUP.md`
Guía completa de configuración que incluye:
- Instrucciones paso a paso para Gmail, Outlook y SMTP
- Configuración específica por proveedor (SES, Mailgun, SendinBlue)
- Solución de problemas comunes
- Mejores prácticas de seguridad
- Recomendaciones para producción
- Ejemplos de código

#### `.env.local.example`
Archivo de ejemplo para desarrollo local con:
- Configuración comentada para desarrollo
- Instrucciones inline para obtener App Passwords de Gmail
- Ejemplos para los 3 tipos de servicios soportados
- Configuraciones opcionales (AWS S3, Stripe)

#### `MIGRATION_SUMMARY.md` (este archivo)
Resumen de todos los cambios realizados en la migración.

### 4. **Documentación Actualizada**

#### `README.md`
- Agregado enlace a `NODEMAILER_SETUP.md` en la sección de documentación adicional

---

## 🔄 Cambios en la API

### Antes (SendGrid)
```typescript
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const msg = {
    to: 'user@example.com',
    from: 'sender@example.com',
    subject: 'Test',
    html: '<h1>Hello</h1>',
};

await sgMail.send(msg);
```

### Después (Nodemailer)
```typescript
import { sendEmail } from './services/email.service';

await sendEmail(
    'user@example.com',
    'Test',
    '<h1>Hello</h1>'
);
```

**Nota:** La API pública de las funciones de negocio (`sendVerificationEmail`, `sendPasswordResetEmail`, `sendRewardReminderEmail`) **no cambió**, por lo que no se requieren cambios en los controladores.

---

## 🚀 Ventajas de la Migración

### 1. **Mayor Flexibilidad**
- Soporte para múltiples proveedores sin cambiar código
- Fácil cambio entre Gmail, Outlook, SES, Mailgun, etc.
- No dependencia de un único servicio externo

### 2. **Menor Costo**
- Gmail: 500 emails/día gratis
- Outlook: 300 emails/día gratis
- Opción de usar servicios más económicos (SES, Mailgun)

### 3. **Mejor Control**
- Control total sobre la configuración SMTP
- Debugging más sencillo con logs detallados
- Verificación de conexión al iniciar

### 4. **Desarrollo Local Más Fácil**
- Usa tu cuenta personal de Gmail/Outlook
- No necesitas API keys de servicios externos
- Configuración en minutos

### 5. **Compatibilidad**
- Funciona en cualquier servidor (Render, AWS, Heroku, etc.)
- No hay restricciones de puertos SMTP en la mayoría de plataformas
- Soporte para SMTP sobre TLS/SSL

---

## ⚠️ Consideraciones Importantes

### 1. **Variables de Entorno**
Debes actualizar tu archivo `.env` con las nuevas variables:

```env
# Remover:
# SENDGRID_API_KEY=SG.xxxxx

# Agregar:
EMAIL_SERVICE=gmail
EMAIL_USER=tu-email@gmail.com
EMAIL_PASSWORD=app-password-16-caracteres
EMAIL_FROM=tu-email@gmail.com
FRONTEND_URL=http://localhost:5173
```

### 2. **Gmail App Passwords**
Si usas Gmail, **debes** generar un "App Password":
1. Activa verificación en dos pasos
2. Ve a https://myaccount.google.com/apppasswords
3. Genera una contraseña para "Correo"
4. Usa esa contraseña de 16 caracteres en `EMAIL_PASSWORD`

### 3. **Límites de Envío**
Ten en cuenta los límites de cada proveedor:
- **Gmail**: 500 emails/día (gratis), 2000/día (Workspace)
- **Outlook**: 300 emails/día (gratis)
- **SES**: Muy económico, pero requiere verificación
- **Mailgun**: 5,000 emails/mes gratis

### 4. **Producción**
Para producción, se recomienda usar servicios dedicados:
- **Amazon SES** - Muy económico ($0.10 por 1,000 emails)
- **Mailgun** - 5,000 emails/mes gratis
- **SendinBlue** - 300 emails/día gratis
- **Postmark** - Excelente deliverability

---

## 🧪 Testing

### Verificar que Todo Funciona

1. **Actualiza tu `.env`:**
   ```bash
   cp .env.local.example .env
   # Edita .env con tus credenciales
   ```

2. **Inicia el servidor:**
   ```bash
   npm run dev
   ```

3. **Busca en los logs:**
   ```
   ✅ Servidor de email listo para enviar mensajes
   ```

4. **Prueba registrando un usuario:**
   ```bash
   POST http://localhost:3000/auth/register
   {
     "username": "Test User",
     "email": "tu-email@gmail.com",
     "password": "password123"
   }
   ```

5. **Verifica que recibiste el email de verificación**

---

## 📋 Checklist de Migración

- [x] Instalar dependencias de Nodemailer
- [x] Desinstalar dependencias de SendGrid
- [x] Actualizar `email.service.ts`
- [x] Actualizar `package.json`
- [x] Actualizar `.env.example`
- [x] Crear guía de configuración (`NODEMAILER_SETUP.md`)
- [x] Crear ejemplo de configuración local (`.env.local.example`)
- [x] Actualizar `README.md`
- [x] Verificar que el código compile (`npm run typecheck`)
- [ ] Actualizar `.env` con credenciales reales
- [ ] Probar envío de emails en desarrollo
- [ ] Actualizar variables de entorno en servidor de producción
- [ ] Probar envío de emails en producción

---

## 🔗 Referencias

- [Documentación de Nodemailer](https://nodemailer.com/)
- [Guía de configuración](./NODEMAILER_SETUP.md)
- [Variables de entorno de ejemplo](./.env.example)
- [Configuración local de ejemplo](./.env.local.example)

---

## 👨‍💻 Soporte

Si tienes problemas con la configuración:
1. Revisa la [Guía de Configuración](./NODEMAILER_SETUP.md)
2. Verifica la sección de "Solución de Problemas"
3. Revisa los logs del servidor para errores específicos

---

**Migración completada exitosamente** ✅

La aplicación ahora usa Nodemailer para el envío de correos electrónicos con soporte para múltiples proveedores y mejor flexibilidad.
