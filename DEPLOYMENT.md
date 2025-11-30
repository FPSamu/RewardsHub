# 🚀 Deployment Guide - Render.com

Esta guía te ayudará a desplegar RewardsHub en Render.com paso a paso.

## 📋 Prerrequisitos

1. **Cuenta en Render.com**
   - Crea una cuenta gratuita en [render.com](https://render.com)
   - Conecta tu cuenta de GitHub

2. **Base de Datos MongoDB**
   - Opción 1: MongoDB Atlas (Recomendado - Gratis)
   - Opción 2: Render PostgreSQL (si prefieres cambiar de DB)

3. **Repositorio Git**
   - Tu código debe estar en un repositorio de GitHub/GitLab

---

## 🗄️ Paso 1: Configurar MongoDB Atlas

### 1.1 Crear Cluster Gratuito

1. Ve a [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Crea una cuenta o inicia sesión
3. Crea un nuevo proyecto llamado "RewardsHub"
4. Crea un cluster gratuito (M0 Sandbox)
   - Provider: AWS
   - Region: Elige la más cercana a tu ubicación
   - Cluster Name: `RewardsHub-Cluster`

### 1.2 Configurar Acceso

1. **Database Access**:
   - Ve a "Database Access" en el menú lateral
   - Click en "Add New Database User"
   - Username: `rewardshub_user`
   - Password: Genera una contraseña segura (guárdala!)
   - Database User Privileges: "Read and write to any database"
   - Click "Add User"

2. **Network Access**:
   - Ve a "Network Access"
   - Click "Add IP Address"
   - Click "Allow Access from Anywhere" (0.0.0.0/0)
   - Click "Confirm"

### 1.3 Obtener Connection String

1. Ve a "Database" → "Connect"
2. Selecciona "Connect your application"
3. Driver: Node.js, Version: 5.5 or later
4. Copia el connection string, se verá así:
   ```
   mongodb+srv://rewardshub_user:<password>@rewardshub-cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
5. Reemplaza `<password>` con tu contraseña
6. Agrega el nombre de la base de datos después de `.net/`:
   ```
   mongodb+srv://rewardshub_user:tu_password@rewardshub-cluster.xxxxx.mongodb.net/rewardshub?retryWrites=true&w=majority
   ```

---

## 🌐 Paso 2: Desplegar en Render.com

### Opción A: Deployment Automático con render.yaml (Recomendado)

1. **Asegúrate de que el archivo `render.yaml` esté en tu repositorio**
   - Ya está creado en la raíz del proyecto

2. **Crear Blueprint en Render**:
   - Ve a [Render Dashboard](https://dashboard.render.com/)
   - Click en "New" → "Blueprint"
   - Conecta tu repositorio de GitHub
   - Render detectará automáticamente el `render.yaml`
   - Click "Apply"

3. **Configurar Variables de Entorno**:
   - Render te pedirá configurar las variables que tienen `sync: false`
   - Configura:
     - `MONGO_URI`: Tu connection string de MongoDB Atlas
     - `ALLOWED_ORIGINS`: URLs de tu frontend (separadas por comas)
       ```
       https://tu-frontend.vercel.app,https://www.tu-frontend.com
       ```

### Opción B: Deployment Manual

1. **Crear Web Service**:
   - Ve a [Render Dashboard](https://dashboard.render.com/)
   - Click "New" → "Web Service"
   - Conecta tu repositorio de GitHub
   - Selecciona el repositorio de RewardsHub

2. **Configurar el Service**:
   - **Name**: `rewardshub-api`
   - **Region**: Oregon (o la más cercana)
   - **Branch**: `main` (o tu rama principal)
   - **Root Directory**: (dejar vacío)
   - **Runtime**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free

3. **Configurar Variables de Entorno**:
   Click en "Advanced" → "Add Environment Variable" y agrega:

   ```
   NODE_ENV=production
   PORT=10000
   MONGO_URI=mongodb+srv://rewardshub_user:tu_password@cluster.mongodb.net/rewardshub?retryWrites=true&w=majority
   JWT_SECRET=genera-un-string-aleatorio-muy-largo-y-seguro
   JWT_REFRESH_SECRET=genera-otro-string-aleatorio-diferente-muy-largo
   JWT_EXPIRES_IN=15m
   JWT_REFRESH_EXPIRES_IN=7d
   ALLOWED_ORIGINS=https://tu-frontend.vercel.app,https://www.tu-frontend.com
   USER_COLLECTION=users
   BUSINESSES_COLLECTION=businesses
   SYSTEMS_COLLECTION=systems
   REWARDS_COLLECTION=rewards
   USERS_POINTS_COLLECTION=userPoints
   TRANSACTIONS_COLLECTION=transactions
   ```

   **⚠️ IMPORTANTE**: 
   - Genera secretos seguros para `JWT_SECRET` y `JWT_REFRESH_SECRET`
   - Puedes usar: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

4. **Health Check Path**:
   - En "Advanced" → "Health Check Path": `/health`

5. **Click "Create Web Service"**

---

## 🔐 Paso 3: Generar Secretos JWT Seguros

En tu terminal local, ejecuta:

```bash
# Para JWT_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Para JWT_REFRESH_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copia estos valores y úsalos en las variables de entorno de Render.

---

## ✅ Paso 4: Verificar el Deployment

1. **Espera a que termine el build** (2-5 minutos)
   - Verás los logs en tiempo real
   - Debe mostrar: "Build successful" y "Deploy live"

2. **Obtén tu URL**:
   - Render te dará una URL como: `https://rewardshub-api.onrender.com`

3. **Prueba el Health Check**:
   ```bash
   curl https://rewardshub-api.onrender.com/health
   ```
   
   Deberías recibir:
   ```json
   {"status":"ok"}
   ```

4. **Prueba el endpoint raíz**:
   ```bash
   curl https://rewardshub-api.onrender.com/
   ```
   
   Deberías recibir:
   ```
   Server Working!
   ```

---

## 🔧 Paso 5: Configurar tu Frontend

En tu proyecto frontend, actualiza la URL base de la API:

```javascript
// Antes (desarrollo local)
const API_URL = 'http://localhost:3000';

// Después (producción)
const API_URL = 'https://rewardshub-api.onrender.com';

// Mejor práctica (detectar automáticamente)
const API_URL = process.env.REACT_APP_API_URL || 
                process.env.NEXT_PUBLIC_API_URL || 
                'https://rewardshub-api.onrender.com';
```

---

## 📝 Notas Importantes

### ⚡ Free Tier Limitations

El plan gratuito de Render tiene estas limitaciones:

1. **Sleep después de 15 minutos de inactividad**
   - El servicio se "duerme" si no recibe requests
   - El primer request después de dormir tarda ~30-50 segundos (cold start)
   - Solución: Usar un servicio de ping (ej: UptimeRobot) o actualizar a plan pagado

2. **750 horas/mes de runtime**
   - Suficiente para desarrollo y demos
   - Para producción real, considera el plan pagado ($7/mes)

3. **Builds limitados**
   - Render reconstruye automáticamente cuando haces push a GitHub

### 🔄 Auto-Deploy

Render está configurado para auto-deploy:
- Cada vez que hagas `git push` a tu rama principal
- Render detectará los cambios y reconstruirá automáticamente
- Toma 2-5 minutos por deploy

### 🐛 Debugging

Si algo falla:

1. **Ver Logs**:
   - En Render Dashboard → Tu servicio → "Logs"
   - Verás errores de build o runtime

2. **Errores Comunes**:
   - **"Cannot connect to MongoDB"**: Verifica tu `MONGO_URI`
   - **"Port already in use"**: Render usa el puerto 10000, asegúrate de usar `process.env.PORT`
   - **"Module not found"**: Verifica que todas las dependencias estén en `dependencies` (no en `devDependencies`)

3. **Verificar Variables de Entorno**:
   - Dashboard → Tu servicio → "Environment"
   - Asegúrate de que todas estén configuradas

---

## 🎯 Endpoints Disponibles

Una vez desplegado, tu API estará disponible en:

```
Base URL: https://rewardshub-api.onrender.com

Health Check:
GET /health

Authentication:
POST /auth/register
POST /auth/login
GET  /auth/me

Business:
POST /business/register
POST /business/login
GET  /business/profile

Systems:
POST /systems
GET  /systems
GET  /systems/:id
PUT  /systems/:id
DELETE /systems/:id

Rewards:
POST /rewards
GET  /rewards
GET  /rewards/:id
PUT  /rewards/:id
DELETE /rewards/:id

User Points:
POST /user-points/add
GET  /user-points
GET  /user-points/business/:businessId

Transactions:
POST /transactions
GET  /transactions
GET  /transactions/user/:userId
GET  /transactions/business/:businessId
```

---

## 🔗 URLs de Referencia

- **Render Dashboard**: https://dashboard.render.com/
- **MongoDB Atlas**: https://cloud.mongodb.com/
- **Documentación Render**: https://render.com/docs
- **Documentación MongoDB Atlas**: https://www.mongodb.com/docs/atlas/

---

## 🆘 Soporte

Si tienes problemas:

1. Revisa los logs en Render Dashboard
2. Verifica que todas las variables de entorno estén configuradas
3. Asegúrate de que MongoDB Atlas permita conexiones desde cualquier IP
4. Verifica que tu connection string sea correcto

---

## ✨ Próximos Pasos

1. ✅ Desplegar backend en Render
2. ✅ Configurar MongoDB Atlas
3. ✅ Configurar variables de entorno
4. 🔄 Conectar frontend con la nueva URL
5. 🧪 Probar todos los endpoints en producción
6. 📊 Configurar monitoreo (opcional)
7. 🔒 Configurar dominio personalizado (opcional)

---

**¡Listo!** Tu API de RewardsHub ahora está desplegada y lista para ser consumida por tu frontend. 🎉
