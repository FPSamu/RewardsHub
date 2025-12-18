# 📧 Configuración de Gmail - Guía Rápida

## 🎯 Solo 3 Pasos

### Paso 1: Obtén tu App Password de Gmail

1. **Abre este link**: https://myaccount.google.com/apppasswords
   
2. **Si no ves la opción "Contraseñas de aplicaciones":**
   - Ve a https://myaccount.google.com/security
   - Activa "Verificación en dos pasos" primero
   - Luego regresa a https://myaccount.google.com/apppasswords

3. **Genera la contraseña:**
   - En "Seleccionar app": Elige "Correo"
   - En "Seleccionar dispositivo": Elige "Otro (nombre personalizado)"
   - Escribe: "RewardsHub"
   - Click en "Generar"

4. **Copia la contraseña de 16 caracteres** que aparece (ejemplo: `abcd efgh ijkl mnop`)

---

### Paso 2: Agrega las Variables a tu .env

Abre tu archivo `.env` y agrega estas líneas:

```env
# Configuración de Gmail
EMAIL_SERVICE=gmail
EMAIL_USER=tu-email@gmail.com
EMAIL_PASSWORD=abcdefghijklmnop
EMAIL_FROM=tu-email@gmail.com
FRONTEND_URL=http://localhost:5173
```

**Reemplaza:**
- `tu-email@gmail.com` → Tu email de Gmail
- `abcdefghijklmnop` → La contraseña de 16 caracteres (sin espacios)

---

### Paso 3: Verifica que Funcione

```bash
npm run verify-email
```

Deberías ver:
```
✅ Variables de entorno configuradas correctamente
✅ ¡Conexión exitosa!
🎉 Tu configuración de email está lista para usar.
```

---

## 🧪 Prueba Enviando un Email

1. **Inicia el servidor:**
   ```bash
   npm run dev
   ```

2. **Registra un usuario de prueba** (usa Postman o tu frontend):
   ```bash
   POST http://localhost:3000/auth/register
   {
     "username": "Test User",
     "email": "tu-email@gmail.com",
     "password": "password123"
   }
   ```

3. **Revisa tu bandeja de entrada** - Deberías recibir un email de verificación ✉️

---

## ❓ Problemas Comunes

### "Invalid login: 535-5.7.8"
- ✅ Asegúrate de usar el **App Password** (16 caracteres), NO tu contraseña normal de Gmail
- ✅ Copia el App Password **sin espacios**: `abcdefghijklmnop`
- ✅ Verifica que la verificación en dos pasos esté activa

### "EAUTH: Invalid credentials"
- ✅ Verifica que `EMAIL_USER` sea tu email completo: `usuario@gmail.com`
- ✅ Verifica que `EMAIL_PASSWORD` sea el App Password correcto
- ✅ Regenera el App Password si es necesario

### No recibo el email
- ✅ Revisa la carpeta de **Spam/Correo no deseado**
- ✅ Verifica que el servidor esté corriendo (`npm run dev`)
- ✅ Revisa los logs del servidor para ver si hay errores

---

## 📋 Ejemplo Completo de .env

```env
# Server
PORT=3000
NODE_ENV=development

# MongoDB
MONGO_URI=mongodb://localhost:27017/rewardshub

# JWT
JWT_SECRET=dev-secret-key-12345
JWT_REFRESH_SECRET=dev-refresh-secret-12345
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# CORS
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000

# ✉️ EMAIL - GMAIL
EMAIL_SERVICE=gmail
EMAIL_USER=rewardshub@gmail.com
EMAIL_PASSWORD=abcdefghijklmnop
EMAIL_FROM=rewardshub@gmail.com
FRONTEND_URL=http://localhost:5173

# MongoDB Collections
USER_COLLECTION=users
BUSINESSES_COLLECTION=businesses
SYSTEMS_COLLECTION=systems
REWARDS_COLLECTION=rewards
USERS_POINTS_COLLECTION=userPoints
TRANSACTIONS_COLLECTION=transactions
```

---

## 🔒 Seguridad

- ✅ **Nunca** compartas tu App Password
- ✅ **Nunca** hagas commit de tu `.env` al repositorio
- ✅ Puedes revocar el App Password en cualquier momento desde https://myaccount.google.com/apppasswords
- ✅ Cada App Password es único para cada aplicación

---

## 📊 Límites de Gmail

- **500 emails por día** para cuentas gratuitas
- **2000 emails por día** para Google Workspace

Si necesitas enviar más emails, considera usar:
- Amazon SES
- Mailgun
- SendinBlue

---

## ✅ Checklist

- [ ] Activé la verificación en dos pasos en mi cuenta de Gmail
- [ ] Generé un App Password en https://myaccount.google.com/apppasswords
- [ ] Copié el App Password (16 caracteres, sin espacios)
- [ ] Agregué las variables a mi archivo `.env`
- [ ] Ejecuté `npm run verify-email` y vi ✅ Conexión exitosa
- [ ] Probé enviando un email de registro
- [ ] Recibí el email en mi bandeja de entrada

---

**¡Listo!** Tu configuración de Gmail está completa. 🎉

¿Tienes problemas? Revisa la sección de "Problemas Comunes" arriba o consulta `NODEMAILER_SETUP.md` para más detalles.
