# 📧 Configuración Rápida de Email (Nodemailer)

## ⚡ Setup en 3 Pasos

### 1️⃣ Copia el archivo de configuración
```bash
cp .env.local.example .env
```

### 2️⃣ Configura tus credenciales de email

#### Opción A: Gmail (Recomendado)
1. Ve a https://myaccount.google.com/apppasswords
2. Genera una "Contraseña de aplicación" para "Correo"
3. Edita `.env`:
```env
EMAIL_SERVICE=gmail
EMAIL_USER=tu-email@gmail.com
EMAIL_PASSWORD=xxxx-xxxx-xxxx-xxxx  # App Password de 16 caracteres
EMAIL_FROM=tu-email@gmail.com
FRONTEND_URL=http://localhost:5173
```

#### Opción B: Outlook
```env
EMAIL_SERVICE=outlook
EMAIL_USER=tu-email@outlook.com
EMAIL_PASSWORD=tu-contraseña
EMAIL_FROM=tu-email@outlook.com
FRONTEND_URL=http://localhost:5173
```

### 3️⃣ Verifica la configuración
```bash
npm run verify-email
```

Si ves `✅ ¡Conexión exitosa!`, ¡estás listo! 🎉

---

## 🧪 Probar el Envío de Emails

Inicia el servidor:
```bash
npm run dev
```

Registra un usuario de prueba:
```bash
POST http://localhost:3000/auth/register
{
  "username": "Test User",
  "email": "tu-email@gmail.com",
  "password": "password123"
}
```

Deberías recibir un email de verificación. ✉️

---

## 📚 Documentación Completa

- **Guía detallada**: [NODEMAILER_SETUP.md](./NODEMAILER_SETUP.md)
- **Resumen de migración**: [MIGRATION_SUMMARY.md](./MIGRATION_SUMMARY.md)
- **Variables de entorno**: [.env.example](./.env.example)

---

## ❓ Problemas Comunes

### "Invalid login: 535-5.7.8"
- **Gmail**: Usa un "App Password", no tu contraseña normal
- **Outlook**: Verifica que no tengas restricciones de seguridad

### "ECONNECTION"
- Verifica tu conexión a internet
- Verifica `SMTP_HOST` y `SMTP_PORT` si usas SMTP personalizado

### Los emails no llegan
- Revisa la carpeta de spam
- Verifica los logs del servidor
- Asegúrate de que `EMAIL_FROM` sea válido

---

## 🚀 Para Producción

Se recomienda usar servicios dedicados:
- **Amazon SES** - $0.10 por 1,000 emails
- **Mailgun** - 5,000 emails/mes gratis
- **SendinBlue** - 300 emails/día gratis

Ver [NODEMAILER_SETUP.md](./NODEMAILER_SETUP.md) para configuración de producción.

---

**¿Necesitas ayuda?** Consulta la [Guía de Solución de Problemas](./NODEMAILER_SETUP.md#-solución-de-problemas)
