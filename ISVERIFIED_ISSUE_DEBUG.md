# 🐛 Problema: isVerified cambia a true automáticamente

## 📋 Descripción del Problema

El campo `isVerified` de los usuarios cambia automáticamente de `false` a `true` después de un tiempo, **sin que el usuario haya clickeado el link de verificación**.

---

## 🔍 Posibles Causas

### 1. **Problema en la Base de Datos (MongoDB)**

#### Causa: Triggers o Change Streams
MongoDB podría tener un trigger o change stream que esté modificando los documentos.

**Verificación:**
```javascript
// En MongoDB Compass o mongo shell
db.users.find({ isVerified: true, verificationToken: { $exists: true, $ne: null } })
```

Si encuentras usuarios con `isVerified: true` pero que aún tienen `verificationToken`, significa que se verificaron sin usar el endpoint.

---

### 2. **Problema con el Default Value**

#### Causa: Documentos existentes antes del cambio
Si cambiaste el esquema recientemente, los documentos antiguos podrían tener `isVerified: true` por defecto.

**Solución:**
```javascript
// Actualizar todos los usuarios no verificados
db.users.updateMany(
  { isVerified: { $exists: false } },
  { $set: { isVerified: false } }
)
```

---

### 3. **Problema con Mongoose Middleware**

#### Causa: Hook pre/post save
Aunque no encontré ninguno en el código, podría haber un middleware que esté modificando el documento.

**Verificación:**
Ejecuta el script de diagnóstico:
```bash
npm run diagnose-isverified
```

---

### 4. **Problema con la Colección de MongoDB**

#### Causa: Nombre de colección incorrecto
Si la variable de entorno `USER_COLLECTION` apunta a una colección diferente, podrías estar viendo datos de otra colección.

**Verificación:**
```bash
# Verifica tu .env
echo $USER_COLLECTION

# O en Windows PowerShell
$env:USER_COLLECTION
```

---

### 5. **Problema con Caché o Conexión**

#### Causa: Múltiples instancias de la aplicación
Si tienes múltiples instancias corriendo (desarrollo + producción), una podría estar modificando los datos.

**Verificación:**
- Asegúrate de que solo una instancia esté corriendo
- Verifica que `MONGO_URI` apunte a la base de datos correcta

---

### 6. **Problema con el Modelo**

#### Causa: Definición incorrecta del campo
El campo podría no estar definido correctamente en el esquema.

**Verificación actual:**
```typescript
// src/models/user.model.ts
isVerified: { type: Boolean, default: false }  // ✅ Esto está correcto
```

---

## 🛠️ Pasos para Diagnosticar

### Paso 1: Ejecutar el Script de Diagnóstico

```bash
npm run diagnose-isverified
```

Este script te mostrará:
- Usuarios sospechosos (verificados pero con token)
- Estadísticas de verificación
- Si el valor cambia automáticamente
- Middlewares de Mongoose

---

### Paso 2: Verificar Directamente en MongoDB

```javascript
// Conecta a MongoDB Compass o mongo shell

// 1. Ver todos los usuarios
db.users.find().pretty()

// 2. Ver usuarios verificados
db.users.find({ isVerified: true }).pretty()

// 3. Ver usuarios no verificados
db.users.find({ isVerified: false }).pretty()

// 4. Ver usuarios sospechosos
db.users.find({ 
  isVerified: true, 
  verificationToken: { $exists: true, $ne: null } 
}).pretty()
```

---

### Paso 3: Monitorear en Tiempo Real

Crea un usuario de prueba y monitorea su estado:

```bash
# Terminal 1: Inicia el servidor
npm run dev

# Terminal 2: Registra un usuario
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "Test Monitor",
    "email": "test-monitor@example.com",
    "password": "password123"
  }'

# Terminal 3: Monitorea en MongoDB
# Ejecuta este comando cada 10 segundos
watch -n 10 'mongo your-db --eval "db.users.findOne({email: \"test-monitor@example.com\"})"'
```

---

## 🔧 Soluciones Propuestas

### Solución 1: Agregar Validación Estricta

Modifica el modelo para asegurar que `isVerified` siempre sea booleano:

```typescript
// src/models/user.model.ts
const userSchema = new Schema<IUser>(
    {
        // ... otros campos
        isVerified: { 
            type: Boolean, 
            default: false,
            required: true  // ← Agregar required
        },
        // ... otros campos
    },
    { 
        timestamps: false,
        strict: true  // ← Asegurar modo estricto
    }
);
```

---

### Solución 2: Agregar Logging

Agrega logs para rastrear cuándo cambia `isVerified`:

```typescript
// src/models/user.model.ts

// Agregar middleware pre-save
userSchema.pre('save', function(next) {
    if (this.isModified('isVerified')) {
        console.log('⚠️  isVerified cambió:', {
            email: this.email,
            oldValue: this.get('isVerified', null, { getters: false }),
            newValue: this.isVerified,
            stack: new Error().stack
        });
    }
    next();
});

// Agregar middleware pre-update
userSchema.pre('findOneAndUpdate', function(next) {
    const update = this.getUpdate() as any;
    if (update.$set && 'isVerified' in update.$set) {
        console.log('⚠️  isVerified siendo actualizado:', {
            update: update.$set.isVerified,
            stack: new Error().stack
        });
    }
    next();
});
```

---

### Solución 3: Resetear Todos los Usuarios

Si necesitas resetear el estado de todos los usuarios:

```javascript
// Script de reseteo (ejecutar en mongo shell o MongoDB Compass)

// Opción 1: Resetear solo usuarios con token presente
db.users.updateMany(
  { verificationToken: { $exists: true, $ne: null } },
  { $set: { isVerified: false } }
)

// Opción 2: Resetear TODOS los usuarios (¡CUIDADO!)
db.users.updateMany(
  {},
  { $set: { isVerified: false } }
)

// Opción 3: Eliminar usuarios de prueba
db.users.deleteMany({ email: /test.*@example\.com/ })
```

---

### Solución 4: Verificar Conexiones Activas

```bash
# Ver procesos de Node.js corriendo
# Windows PowerShell
Get-Process node

# Linux/Mac
ps aux | grep node

# Matar procesos duplicados si es necesario
# Windows
taskkill /F /PID <process-id>

# Linux/Mac
kill -9 <process-id>
```

---

## 📊 Información para Reportar

Si el problema persiste, necesitaré esta información:

1. **Resultado del script de diagnóstico:**
   ```bash
   npm run diagnose-isverified > diagnostico.txt
   ```

2. **Versión de MongoDB:**
   ```bash
   mongo --version
   ```

3. **Variables de entorno relevantes:**
   ```bash
   echo $MONGO_URI
   echo $USER_COLLECTION
   ```

4. **Ejemplo de un usuario afectado:**
   ```javascript
   db.users.findOne({ email: "usuario-afectado@example.com" })
   ```

5. **Logs del servidor:**
   - Copia los logs cuando registras un usuario
   - Copia los logs después de que `isVerified` cambia

---

## 🧪 Test de Aislamiento

Para confirmar que el problema está en el backend y no en el frontend:

```bash
# 1. Detén el servidor
# Ctrl+C

# 2. Registra un usuario directamente en MongoDB
mongo your-database
db.users.insertOne({
  username: "Test Direct",
  email: "test-direct@example.com",
  passHash: "$2a$10$test",
  isVerified: false,
  verificationToken: "test-token-123",
  createdAt: new Date()
})

# 3. Espera 5 minutos

# 4. Verifica el estado
db.users.findOne({ email: "test-direct@example.com" })

# Si isVerified cambió a true SIN que el servidor esté corriendo,
# el problema está en MongoDB (trigger, change stream, etc.)
```

---

## 📝 Próximos Pasos

1. **Ejecuta el script de diagnóstico:**
   ```bash
   npm run diagnose-isverified
   ```

2. **Comparte los resultados** para que pueda ayudarte mejor

3. **Mientras tanto, agrega logging** (Solución 2) para rastrear el problema

4. **Verifica si hay múltiples instancias** de la aplicación corriendo

---

## ⚠️ Nota Importante

Este problema es inusual y sugiere que hay algo externo modificando los datos:
- Un trigger de MongoDB
- Otra aplicación/script accediendo a la misma base de datos
- Múltiples instancias del servidor
- Un middleware de Mongoose no visible en el código actual

El script de diagnóstico nos ayudará a identificar la causa exacta.
