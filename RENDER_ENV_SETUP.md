# 🚀 Variables de Entorno para Render.com

## 📧 Configuración de Email (Gmail)

Después de hacer el deploy, necesitas configurar estas variables de entorno en Render:

### Variables Requeridas para Email

1. **Ve a tu servicio en Render.com**
2. **Click en "Environment"**
3. **Agrega estas variables:**

```
EMAIL_SERVICE=gmail
EMAIL_USER=tu-email@gmail.com
EMAIL_PASSWORD=tu-app-password-de-16-caracteres
EMAIL_FROM=tu-email@gmail.com
FRONTEND_URL=https://tu-frontend.vercel.app
```

### Otras Variables Requeridas

```
# MongoDB
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/rewardshub?retryWrites=true&w=majority

# JWT
JWT_SECRET=tu-secret-key-production
JWT_REFRESH_SECRET=tu-refresh-secret-key-production
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# CORS
ALLOWED_ORIGINS=https://tu-frontend.vercel.app,https://www.tu-frontend.vercel.app

# Node Environment
NODE_ENV=production
PORT=3000
```

### Colecciones de MongoDB (Opcional)

```
USER_COLLECTION=users
BUSINESSES_COLLECTION=businesses
SYSTEMS_COLLECTION=systems
REWARDS_COLLECTION=rewards
USERS_POINTS_COLLECTION=userPoints
TRANSACTIONS_COLLECTION=transactions
```

---

## ⚠️ IMPORTANTE: App Password de Gmail

Para obtener tu App Password:

1. Ve a: https://myaccount.google.com/apppasswords
2. Genera una contraseña para "Correo" → "RewardsHub"
3. Copia la contraseña de 16 caracteres (sin espacios)
4. Úsala en `EMAIL_PASSWORD`

**NO uses tu contraseña normal de Gmail en producción.**

---

## 🔍 Verificar Configuración

Después de configurar las variables:

1. **Redeploy** el servicio en Render
2. **Revisa los logs** para ver:
   ```
   ✅ Servidor de email listo para enviar mensajes
   ```
3. **Prueba** registrando un usuario

---

## 📝 Checklist de Deploy

- [ ] Configuré `MONGO_URI` con mi cluster de MongoDB Atlas
- [ ] Generé y configuré `JWT_SECRET` y `JWT_REFRESH_SECRET`
- [ ] Configuré `ALLOWED_ORIGINS` con mi URL de frontend
- [ ] Obtuve mi App Password de Gmail
- [ ] Configuré todas las variables de email
- [ ] Configuré `FRONTEND_URL` con mi URL de frontend
- [ ] Hice redeploy del servicio
- [ ] Verifiqué los logs para confirmar conexión de email
- [ ] Probé el registro de usuario

---

## 🐛 Solución de Problemas

### Error: "Invalid login" en producción

- Verifica que `EMAIL_PASSWORD` sea el App Password (16 caracteres)
- Verifica que `EMAIL_USER` sea tu email completo
- Regenera el App Password si es necesario

### No se envían emails en producción

- Revisa los logs de Render para ver errores
- Verifica que todas las variables de email estén configuradas
- Verifica que `FRONTEND_URL` sea la URL correcta de tu frontend

### Error de CORS

- Verifica que `ALLOWED_ORIGINS` incluya tu URL de frontend
- Asegúrate de que no haya espacios en la lista de orígenes
- Incluye tanto `https://` como `https://www.` si es necesario

---

## 📚 Más Información

- [Guía de Deployment](./DEPLOYMENT.md)
- [Guía de CORS](./CORS_SETUP.md)
- [Guía de Gmail](./GMAIL_SETUP.md)
