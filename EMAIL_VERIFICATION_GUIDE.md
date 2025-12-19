# 📧 Sistema de Verificación de Email - RewardsHub

## 📋 Resumen

El sistema de verificación de email está **completamente implementado** y funcional para ambos tipos de usuarios:
- ✅ **Usuarios (Clientes)**
- ✅ **Negocios**

El campo `isVerified` permanece en `false` hasta que el usuario clickee en el link de verificación enviado por email.

---

## 🔄 Flujo de Verificación

### 1. **Registro de Usuario/Negocio**

Cuando un usuario o negocio se registra:

1. Se crea la cuenta con `isVerified: false`
2. Se genera un token de verificación único (32 bytes hex)
3. Se guarda el token en el campo `verificationToken`
4. Se envía un email con el link de verificación
5. Se retorna el token JWT para autenticación (pero `isVerified` sigue en `false`)

### 2. **Email de Verificación**

El usuario recibe un email con un link como:
```
https://tu-frontend.com/user/verify-email?token=abc123...
```

O para negocios:
```
https://tu-frontend.com/business/verify-email?token=abc123...
```

### 3. **Verificación del Email**

Cuando el usuario clickea el link:

1. El frontend hace una petición GET al backend:
   ```
   GET /auth/verify-email?token=abc123...
   ```
   O para negocios:
   ```
   GET /business/verify-email?token=abc123...
   ```

2. El backend:
   - Busca el usuario/negocio con ese `verificationToken`
   - Si existe, actualiza `isVerified: true`
   - Elimina el `verificationToken`
   - Retorna éxito

3. El frontend muestra un mensaje de éxito y redirige al usuario

---

## 🛠️ Endpoints Disponibles

### Para Usuarios (Clientes)

| Método | Endpoint | Descripción | Autenticación |
|--------|----------|-------------|---------------|
| `POST` | `/auth/register` | Registra usuario y envía email | No |
| `GET` | `/auth/verify-email?token=xxx` | Verifica el email | No |
| `POST` | `/auth/resend-verification` | Reenvía email de verificación | Sí (JWT) |
| `POST` | `/auth/forgot-password` | Solicita reset de contraseña | No |
| `POST` | `/auth/reset-password` | Resetea contraseña con token | No |

### Para Negocios

| Método | Endpoint | Descripción | Autenticación |
|--------|----------|-------------|---------------|
| `POST` | `/business/register` | Registra negocio y envía email | No |
| `GET` | `/business/verify-email?token=xxx` | Verifica el email | No |
| `POST` | `/business/forgot-password` | Solicita reset de contraseña | No |
| `POST` | `/business/reset-password` | Resetea contraseña con token | No |

---

## 📝 Ejemplos de Uso

### 1. Registro de Usuario

**Request:**
```http
POST http://localhost:3000/auth/register
Content-Type: application/json

{
  "username": "Juan Pérez",
  "email": "juan@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "username": "Juan Pérez",
    "email": "juan@example.com",
    "profilePicture": null,
    "isVerified": false,  // ← Inicia en false
    "createdAt": "2025-12-18T20:00:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Email enviado:**
```
Subject: Verify your RewardsHub Account

Welcome to RewardsHub!

Please verify your email address by clicking the link below:

[Verify Email] → http://localhost:5173/user/verify-email?token=abc123...

If you did not create an account, please ignore this email.
```

---

### 2. Verificación del Email

**Request:**
```http
GET http://localhost:3000/auth/verify-email?token=abc123...
```

**Response (Éxito):**
```json
{
  "message": "Email verified successfully"
}
```

**Response (Token inválido):**
```json
{
  "message": "Invalid or expired token"
}
```

**Estado en la base de datos:**
```javascript
// ANTES de verificar
{
  "_id": "507f1f77bcf86cd799439011",
  "username": "Juan Pérez",
  "email": "juan@example.com",
  "isVerified": false,  // ← false
  "verificationToken": "abc123..."  // ← token presente
}

// DESPUÉS de verificar
{
  "_id": "507f1f77bcf86cd799439011",
  "username": "Juan Pérez",
  "email": "juan@example.com",
  "isVerified": true,  // ← true
  "verificationToken": undefined  // ← token eliminado
}
```

---

### 3. Reenviar Email de Verificación

Si el usuario no recibió el email o expiró:

**Request:**
```http
POST http://localhost:3000/auth/resend-verification
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Response:**
```json
{
  "message": "Verification email sent"
}
```

**Si ya está verificado:**
```json
{
  "message": "Already verified"
}
```

---

### 4. Registro de Negocio

**Request:**
```http
POST http://localhost:3000/business/register
Content-Type: application/json

{
  "name": "Café Delicioso",
  "email": "cafe@example.com",
  "password": "password123",
  "category": "food"
}
```

**Response:**
```json
{
  "business": {
    "id": "507f1f77bcf86cd799439012",
    "name": "Café Delicioso",
    "email": "cafe@example.com",
    "isVerified": false,  // ← Inicia en false
    "createdAt": "2025-12-18T20:00:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Email enviado:**
```
Subject: Verify your RewardsHub Business Account

Welcome to RewardsHub!

Please verify your email address by clicking the link below:

[Verify Email] → http://localhost:5173/business/verify-email?token=xyz789...

If you did not create an account, please ignore this email.
```

---

### 5. Verificación de Email de Negocio

**Request:**
```http
GET http://localhost:3000/business/verify-email?token=xyz789...
```

**Response:**
```json
{
  "message": "Email verified successfully",
  "user": {
    "id": "507f1f77bcf86cd799439012",
    "name": "Café Delicioso",
    "email": "cafe@example.com",
    "isVerified": true,  // ← Ahora es true
    "createdAt": "2025-12-18T20:00:00.000Z"
  }
}
```

---

## 🧪 Pruebas

### Prueba 1: Verificar que `isVerified` inicia en `false`

1. Registra un usuario:
   ```bash
   POST http://localhost:3000/auth/register
   {
     "username": "Test User",
     "email": "test@example.com",
     "password": "password123"
   }
   ```

2. Verifica la respuesta:
   ```json
   {
     "user": {
       "isVerified": false  // ✅ Debe ser false
     }
   }
   ```

3. Consulta el usuario:
   ```bash
   GET http://localhost:3000/auth/me
   Authorization: Bearer <token>
   ```

4. Verifica que sigue en `false`:
   ```json
   {
     "isVerified": false  // ✅ Sigue en false
   }
   ```

---

### Prueba 2: Verificar el email

1. **Revisa tu bandeja de entrada** del email que usaste en el registro

2. **Copia el token** del link de verificación:
   ```
   http://localhost:5173/user/verify-email?token=abc123...
                                                  ^^^^^^^^ Copia esto
   ```

3. **Haz la petición de verificación:**
   ```bash
   GET http://localhost:3000/auth/verify-email?token=abc123...
   ```

4. **Verifica la respuesta:**
   ```json
   {
     "message": "Email verified successfully"
   }
   ```

5. **Consulta el usuario de nuevo:**
   ```bash
   GET http://localhost:3000/auth/me
   Authorization: Bearer <token>
   ```

6. **Verifica que ahora es `true`:**
   ```json
   {
     "isVerified": true  // ✅ Ahora es true
   }
   ```

---

### Prueba 3: Token inválido

1. **Intenta verificar con un token falso:**
   ```bash
   GET http://localhost:3000/auth/verify-email?token=token-falso
   ```

2. **Verifica el error:**
   ```json
   {
     "message": "Invalid or expired token"
   }
   ```

---

### Prueba 4: Reenviar verificación

1. **Registra un usuario** (si no lo has hecho)

2. **Reenvía el email de verificación:**
   ```bash
   POST http://localhost:3000/auth/resend-verification
   Authorization: Bearer <token>
   ```

3. **Verifica la respuesta:**
   ```json
   {
     "message": "Verification email sent"
   }
   ```

4. **Revisa tu bandeja de entrada** - Deberías recibir un nuevo email

---

## 🔍 Verificación en la Base de Datos

### MongoDB Compass / MongoDB Shell

```javascript
// Ver usuarios no verificados
db.users.find({ isVerified: false })

// Ver usuarios verificados
db.users.find({ isVerified: true })

// Ver usuario específico
db.users.findOne({ email: "test@example.com" })

// Resultado esperado ANTES de verificar:
{
  "_id": ObjectId("..."),
  "username": "Test User",
  "email": "test@example.com",
  "passHash": "$2a$10$...",
  "isVerified": false,  // ← false
  "verificationToken": "abc123...",  // ← token presente
  "createdAt": ISODate("2025-12-18T20:00:00.000Z")
}

// Resultado esperado DESPUÉS de verificar:
{
  "_id": ObjectId("..."),
  "username": "Test User",
  "email": "test@example.com",
  "passHash": "$2a$10$...",
  "isVerified": true,  // ← true
  // verificationToken ya no existe
  "createdAt": ISODate("2025-12-18T20:00:00.000Z")
}
```

---

## 🎨 Implementación en el Frontend

### React Example (User)

```typescript
// Página de verificación: /user/verify-email
import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

export const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    
    if (!token) {
      setStatus('error');
      setMessage('Token no proporcionado');
      return;
    }

    // Verificar el email
    axios.get(`http://localhost:3000/auth/verify-email?token=${token}`)
      .then(response => {
        setStatus('success');
        setMessage(response.data.message);
        
        // Redirigir al login después de 3 segundos
        setTimeout(() => {
          navigate('/login');
        }, 3000);
      })
      .catch(error => {
        setStatus('error');
        setMessage(error.response?.data?.message || 'Error al verificar email');
      });
  }, [searchParams, navigate]);

  return (
    <div className="verify-email-page">
      {status === 'loading' && <p>Verificando email...</p>}
      {status === 'success' && (
        <div>
          <h1>✅ Email Verificado</h1>
          <p>{message}</p>
          <p>Redirigiendo al login...</p>
        </div>
      )}
      {status === 'error' && (
        <div>
          <h1>❌ Error</h1>
          <p>{message}</p>
          <button onClick={() => navigate('/login')}>Ir al Login</button>
        </div>
      )}
    </div>
  );
};
```

### React Example (Business)

```typescript
// Página de verificación: /business/verify-email
import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

export const VerifyBusinessEmailPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    
    if (!token) {
      setStatus('error');
      setMessage('Token no proporcionado');
      return;
    }

    // Verificar el email del negocio
    axios.get(`http://localhost:3000/business/verify-email?token=${token}`)
      .then(response => {
        setStatus('success');
        setMessage(response.data.message);
        
        // Redirigir al dashboard después de 3 segundos
        setTimeout(() => {
          navigate('/business/dashboard');
        }, 3000);
      })
      .catch(error => {
        setStatus('error');
        setMessage(error.response?.data?.message || 'Error al verificar email');
      });
  }, [searchParams, navigate]);

  return (
    <div className="verify-email-page">
      {status === 'loading' && <p>Verificando email...</p>}
      {status === 'success' && (
        <div>
          <h1>✅ Email Verificado</h1>
          <p>{message}</p>
          <p>Redirigiendo al dashboard...</p>
        </div>
      )}
      {status === 'error' && (
        <div>
          <h1>❌ Error</h1>
          <p>{message}</p>
          <button onClick={() => navigate('/business/login')}>Ir al Login</button>
        </div>
      )}
    </div>
  );
};
```

---

## 📊 Estado del Sistema

### ✅ Implementado

- [x] Modelo de usuario con campo `isVerified` y `verificationToken`
- [x] Modelo de negocio con campo `isVerified` y `verificationToken`
- [x] Generación de token de verificación al registrarse
- [x] Envío de email de verificación automático
- [x] Endpoint de verificación de email (usuarios)
- [x] Endpoint de verificación de email (negocios)
- [x] Endpoint para reenviar email de verificación (usuarios)
- [x] Sistema de reset de contraseña (usuarios)
- [x] Sistema de reset de contraseña (negocios)
- [x] Emails con HTML estilizado
- [x] Configuración de Nodemailer con Gmail

### 📋 Recomendaciones Adicionales

#### 1. **Expiración de Tokens**

Actualmente los tokens de verificación no expiran. Puedes agregar expiración:

```typescript
// En user.service.ts y business.service.ts
export const generateVerificationToken = async (userId: string): Promise<string> => {
  const crypto = await import('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 3600000); // 24 horas
  
  await UserModel.findByIdAndUpdate(userId, { 
    verificationToken: token,
    verificationTokenExpires: expires  // ← Agregar este campo
  }).exec();
  
  return token;
};

// Actualizar verifyUserEmail
export const verifyUserEmail = async (token: string) => {
  const doc = await UserModel.findOne({ 
    verificationToken: token,
    verificationTokenExpires: { $gt: new Date() }  // ← Verificar que no haya expirado
  }).exec();
  
  if (!doc) return undefined;
  
  doc.isVerified = true;
  doc.verificationToken = undefined;
  doc.verificationTokenExpires = undefined;  // ← Limpiar fecha de expiración
  await doc.save();
  
  return toPublic(doc as IUser);
};
```

#### 2. **Restricciones por Verificación**

Puedes requerir verificación para ciertas acciones:

```typescript
// Middleware de verificación
export const requireVerified = (req: Request, res: Response, next: NextFunction) => {
  const user = req.user;
  
  if (!user) {
    return res.status(401).json({ message: 'not authenticated' });
  }
  
  if (!user.isVerified) {
    return res.status(403).json({ 
      message: 'email verification required',
      isVerified: false
    });
  }
  
  next();
};

// Usar en rutas que requieren verificación
router.post('/user-points/add', authenticate, requireVerified, userPointsCtrl.addPoints);
```

#### 3. **Notificación en el Frontend**

Muestra un banner si el usuario no está verificado:

```typescript
// En tu componente principal
{!user.isVerified && (
  <div className="verification-banner">
    <p>⚠️ Tu email no está verificado. 
      <button onClick={resendVerification}>Reenviar email</button>
    </p>
  </div>
)}
```

---

## ✅ Conclusión

El sistema de verificación de email está **completamente funcional**:

1. ✅ Los usuarios se registran con `isVerified: false`
2. ✅ Se envía un email con link de verificación
3. ✅ El link contiene un token único
4. ✅ Al clickear el link, `isVerified` cambia a `true`
5. ✅ El token se elimina después de verificar
6. ✅ Funciona tanto para usuarios como para negocios

**No necesitas hacer cambios** - el sistema ya funciona correctamente. Solo necesitas:
1. Configurar las variables de entorno de email (Gmail)
2. Configurar `FRONTEND_URL` con la URL de tu frontend
3. Implementar las páginas de verificación en el frontend
