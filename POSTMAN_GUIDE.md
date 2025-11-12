# Guía de Postman para Testing de Rewards API

Esta guía te ayudará a probar manualmente todos los endpoints de recompensas usando Postman.

## Prerrequisitos

1. Asegúrate de que el servidor esté corriendo:
   ```bash
   npm run dev
   ```
   O si estás usando la versión compilada:
   ```bash
   npm run build
   npm start
   ```

2. El servidor debería estar corriendo en `http://localhost:3000` (o el puerto configurado en `PORT`)

## Configuración Inicial en Postman

### 1. Crear una Variable de Entorno

1. En Postman, haz clic en "Environments" en la barra lateral
2. Crea un nuevo environment llamado "RewardsHub"
3. Agrega las siguientes variables:
   - `base_url`: `http://localhost:3000`
   - `business_token`: (se llenará automáticamente después del login)
   - `business_id`: (se llenará automáticamente después del registro)
   - `user_token`: (se llenará automáticamente después del login de usuario)
   - `user_id`: (se llenará automáticamente después del registro de usuario)
   - `reward_id`: (se llenará cuando crees una recompensa)

### 2. Autenticación de Negocio

Primero necesitas registrar y autenticar un negocio para obtener el token.

#### Paso 1: Registrar un Negocio

**POST** `{{base_url}}/business/register`

**Headers:**
```
Content-Type: application/json
```

**Body (raw JSON):**
```json
{
  "name": "Mi Negocio de Prueba",
  "email": "negocio@test.com",
  "password": "password123"
}
```

**Respuesta esperada (201):**
```json
{
  "business": {
    "id": "6912280eb656bd7c7158235a",
    "name": "Mi Negocio de Prueba",
    "email": "negocio@test.com",
    "createdAt": "2024-01-15T10:30:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Configuración de Tests en Postman (opcional):**
En la pestaña "Tests", agrega:
```javascript
if (pm.response.code === 201) {
    const jsonData = pm.response.json();
    pm.environment.set("business_token", jsonData.token);
    pm.environment.set("business_id", jsonData.business.id);
}
```

#### Paso 2: Login de Negocio (opcional si ya tienes cuenta)

**POST** `{{base_url}}/business/login`

**Body:**
```json
{
  "email": "negocio@test.com",
  "password": "password123"
}
```

**Respuesta esperada (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### 3. Autenticación de Usuario (Cliente)

Para probar los endpoints que requieren autenticación de usuario, necesitas registrar y autenticar un usuario.

#### Paso 1: Registrar un Usuario

**POST** `{{base_url}}/auth/register`

**Headers:**
```
Content-Type: application/json
```

**Body (raw JSON):**
```json
{
  "username": "Usuario de Prueba",
  "email": "usuario@test.com",
  "password": "password123"
}
```

**Respuesta esperada (201):**
```json
{
  "user": {
    "id": "6912280eb656bd7c7158235a",
    "username": "Usuario de Prueba",
    "email": "usuario@test.com",
    "createdAt": "2024-01-15T10:30:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Configuración de Tests en Postman (opcional):**
```javascript
if (pm.response.code === 201) {
    const jsonData = pm.response.json();
    pm.environment.set("user_token", jsonData.token);
    pm.environment.set("user_id", jsonData.user.id);
}
```

#### Paso 2: Login de Usuario (opcional si ya tienes cuenta)

**POST** `{{base_url}}/auth/login`

**Body:**
```json
{
  "email": "usuario@test.com",
  "password": "password123"
}
```

**Respuesta esperada (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

## Endpoints de Recompensas

### 1. Crear Sistema de Recompensas por Puntos

**POST** `{{base_url}}/rewards/points`

**Headers:**
```
Content-Type: application/json
Authorization: Bearer {{business_token}}
```

**Body (raw JSON):**
```json
{
  "name": "Sistema de Puntos",
  "description": "Gana puntos por cada compra y canjéalos por recompensas",
  "pointsConversion": {
    "amount": 10,
    "currency": "MXN",
    "points": 1
  },
  "pointsRewards": [
    {
      "pointsRequired": 100,
      "rewardType": "discount",
      "rewardValue": 10,
      "description": "10% de descuento en tu próxima compra"
    },
    {
      "pointsRequired": 500,
      "rewardType": "free_product",
      "rewardValue": "producto_gratis_123",
      "description": "Producto gratis"
    },
    {
      "pointsRequired": 1000,
      "rewardType": "cashback",
      "rewardValue": 50,
      "description": "$50 MXN de cashback"
    }
  ]
}
```

**Respuesta esperada (201):**
```json
{
  "id": "6912280fb656bd7c7158235b",
  "businessId": "6912280eb656bd7c7158235a",
  "type": "points",
  "name": "Sistema de Puntos",
  "description": "Gana puntos por cada compra y canjéalos por recompensas",
  "isActive": true,
  "createdAt": "2024-01-15T10:35:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z",
  "pointsConversion": {
    "amount": 10,
    "currency": "MXN",
    "points": 1
  },
  "pointsRewards": [
    {
      "pointsRequired": 100,
      "rewardType": "discount",
      "rewardValue": 10,
      "description": "10% de descuento en tu próxima compra"
    }
  ]
}
```

**Configuración de Tests en Postman:**
```javascript
if (pm.response.code === 201) {
    const jsonData = pm.response.json();
    pm.environment.set("reward_id", jsonData.id);
}
```

### 2. Crear Sistema de Recompensas por Estampas

**POST** `{{base_url}}/rewards/stamps`

**Headers:**
```
Content-Type: application/json
Authorization: Bearer {{business_token}}
```

#### Ejemplo 1: Producto Específico

**Body:**
```json
{
  "name": "Bebidas Gratis",
  "description": "Compra 10 bebidas y obtén 1 gratis",
  "targetStamps": 10,
  "productType": "specific",
  "productIdentifier": "bebida_coca_cola",
  "stampReward": {
    "rewardType": "free_product",
    "rewardValue": "bebida_coca_cola",
    "description": "1 Bebida Coca Cola gratis"
  }
}
```

#### Ejemplo 2: Producto General

**Body:**
```json
{
  "name": "Descuento en Bebidas",
  "description": "Compra 5 bebidas de cualquier tipo y obtén 20% de descuento",
  "targetStamps": 5,
  "productType": "general",
  "stampReward": {
    "rewardType": "discount",
    "rewardValue": 20,
    "description": "20% de descuento en tu próxima compra"
  }
}
```

#### Ejemplo 3: Cualquier Producto

**Body:**
```json
{
  "name": "Cupón de Descuento",
  "description": "Compra 8 productos y obtén un cupón",
  "targetStamps": 8,
  "productType": "any",
  "stampReward": {
    "rewardType": "coupon",
    "rewardValue": "DESCUENTO20",
    "description": "Cupón de descuento del 20%"
  }
}
```

**Respuesta esperada (201):**
```json
{
  "id": "69122810b656bd7c7158235c",
  "businessId": "6912280eb656bd7c7158235a",
  "type": "stamps",
  "name": "Bebidas Gratis",
  "description": "Compra 10 bebidas y obtén 1 gratis",
  "isActive": true,
  "createdAt": "2024-01-15T10:40:00.000Z",
  "updatedAt": "2024-01-15T10:40:00.000Z",
  "targetStamps": 10,
  "productType": "specific",
  "productIdentifier": "bebida_coca_cola",
  "stampReward": {
    "rewardType": "free_product",
    "rewardValue": "bebida_coca_cola",
    "description": "1 Bebida Coca Cola gratis"
  }
}
```

### 3. Listar Todas las Recompensas

**GET** `{{base_url}}/rewards`

**Headers:**
```
Authorization: Bearer {{business_token}}
```

**Query Parameters (opcionales):**
- `includeInactive`: `true` o `false` (por defecto: `false`)

**Ejemplo:**
```
GET {{base_url}}/rewards?includeInactive=false
```

**Respuesta esperada (200):**
```json
[
  {
    "id": "6912280fb656bd7c7158235b",
    "businessId": "6912280eb656bd7c7158235a",
    "type": "points",
    "name": "Sistema de Puntos",
    "isActive": true,
    "createdAt": "2024-01-15T10:35:00.000Z",
    "updatedAt": "2024-01-15T10:35:00.000Z",
    "pointsConversion": {
      "amount": 10,
      "currency": "MXN",
      "points": 1
    },
    "pointsRewards": [...]
  },
  {
    "id": "69122810b656bd7c7158235c",
    "businessId": "6912280eb656bd7c7158235a",
    "type": "stamps",
    "name": "Bebidas Gratis",
    "isActive": true,
    "createdAt": "2024-01-15T10:40:00.000Z",
    "updatedAt": "2024-01-15T10:40:00.000Z",
    "targetStamps": 10,
    "productType": "specific",
    "productIdentifier": "bebida_coca_cola",
    "stampReward": {...}
  }
]
```

### 4. Obtener una Recompensa Específica

**GET** `{{base_url}}/rewards/{{reward_id}}`

**Headers:**
```
Authorization: Bearer {{business_token}}
```

**Respuesta esperada (200):**
```json
{
  "id": "6912280fb656bd7c7158235b",
  "businessId": "6912280eb656bd7c7158235a",
  "type": "points",
  "name": "Sistema de Puntos",
  "description": "Gana puntos por cada compra y canjéalos por recompensas",
  "isActive": true,
  "createdAt": "2024-01-15T10:35:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z",
  "pointsConversion": {...},
  "pointsRewards": [...]
}
```

### 5. Actualizar Sistema de Puntos

**PUT** `{{base_url}}/rewards/points/{{reward_id}}`

**Headers:**
```
Content-Type: application/json
Authorization: Bearer {{business_token}}
```

**Body (todos los campos son opcionales):**
```json
{
  "name": "Sistema de Puntos Actualizado",
  "description": "Nueva descripción",
  "isActive": true,
  "pointsConversion": {
    "amount": 20,
    "currency": "MXN",
    "points": 2
  },
  "pointsRewards": [
    {
      "pointsRequired": 200,
      "rewardType": "discount",
      "rewardValue": 15,
      "description": "15% de descuento"
    }
  ]
}
```

**Respuesta esperada (200):**
```json
{
  "id": "6912280fb656bd7c7158235b",
  "businessId": "6912280eb656bd7c7158235a",
  "type": "points",
  "name": "Sistema de Puntos Actualizado",
  "description": "Nueva descripción",
  "isActive": true,
  "updatedAt": "2024-01-15T11:00:00.000Z",
  "pointsConversion": {
    "amount": 20,
    "currency": "MXN",
    "points": 2
  },
  "pointsRewards": [...]
}
```

### 6. Actualizar Sistema de Estampas

**PUT** `{{base_url}}/rewards/stamps/{{reward_id}}`

**Headers:**
```
Content-Type: application/json
Authorization: Bearer {{business_token}}
```

**Body (todos los campos son opcionales):**
```json
{
  "name": "Bebidas Gratis Actualizado",
  "description": "Nueva descripción",
  "isActive": true,
  "targetStamps": 15,
  "productType": "general",
  "stampReward": {
    "rewardType": "discount",
    "rewardValue": 25,
    "description": "25% de descuento"
  }
}
```

**Respuesta esperada (200):**
Similar a la respuesta de creación, pero con los campos actualizados.

### 7. Eliminar una Recompensa

**DELETE** `{{base_url}}/rewards/{{reward_id}}`

**Headers:**
```
Authorization: Bearer {{business_token}}
```

**Query Parameters (opcionales):**
- `hardDelete`: `true` o `false` (por defecto: `false` - soft delete)

**Ejemplo de soft delete (por defecto):**
```
DELETE {{base_url}}/rewards/{{reward_id}}
```

**Ejemplo de hard delete:**
```
DELETE {{base_url}}/rewards/{{reward_id}}?hardDelete=true
```

**Respuesta esperada (200):**
```json
{
  "message": "reward system deleted successfully"
}
```

---

## Casos de Error Comunes

### 1. Sin Autenticación (401)

**Request sin header Authorization:**
```
POST {{base_url}}/rewards/points
```

**Respuesta:**
```json
{
  "message": "missing token"
}
```

### 2. Token Inválido (401)

**Request con token inválido:**
```
Authorization: Bearer token_invalido
```

**Respuesta:**
```json
{
  "message": "invalid token"
}
```

### 3. Campos Requeridos Faltantes (400)

**Request sin puntosConversion:**
```json
{
  "name": "Sistema de Puntos"
}
```

**Respuesta:**
```json
{
  "message": "pointsConversion is required for points-based reward systems"
}
```

### 4. Recompensa No Encontrada (404)

**Request con ID que no existe o no pertenece al negocio:**
```
GET {{base_url}}/rewards/123456789012345678901234
```

**Respuesta:**
```json
{
  "message": "reward system not found"
}
```

### 5. Acceso Denegado a Recompensa de Otro Negocio (404)

Si intentas acceder a una recompensa que pertenece a otro negocio, recibirás un 404 (por seguridad, no se revela si existe o no).

---

## Colección de Postman

### Importar Colección Completa

Puedes crear una colección en Postman con todos estos endpoints. Aquí está la estructura recomendada:

```
RewardsHub API
├── Authentication
│   ├── Register Business
│   └── Login Business
├── Rewards - Points
│   ├── Create Points Reward
│   ├── Update Points Reward
│   └── List Points Rewards
├── Rewards - Stamps
│   ├── Create Stamps Reward
│   ├── Update Stamps Reward
│   └── List Stamps Rewards
└── Rewards - General
    ├── List All Rewards
    ├── Get Reward by ID
    └── Delete Reward
```

### Variables de Colección

Configura estas variables a nivel de colección:
- `base_url`: `http://localhost:3000`
- `business_token`: (se actualiza después del login)
- `reward_id`: (se actualiza después de crear una recompensa)

---

## Tips para Testing

1. **Orden de Pruebas:**
   - Primero: Registra/Login del negocio
   - Segundo: Crea recompensas
   - Tercero: Lista, obtiene, actualiza, elimina

2. **Manejo de Tokens:**
   - Los tokens expiran después de 15 minutos (configurable)
   - Si recibes un 401, vuelve a hacer login
   - Usa el refresh token si está disponible

3. **Limpieza:**
   - Después de probar, puedes eliminar las recompensas creadas
   - O simplemente desactivarlas (soft delete) para mantener el historial

4. **Validaciones:**
   - Prueba casos exitosos primero
   - Luego prueba casos de error (campos faltantes, tokens inválidos, etc.)
   - Verifica que no puedas acceder a recompensas de otros negocios

---

## Ejemplos de Flujos Completos

### Flujo 1: Crear y Gestionar Sistema de Puntos

1. **Registrar Negocio** → Obtener token
2. **Crear Sistema de Puntos** → Obtener reward_id
3. **Listar Recompensas** → Verificar que aparece
4. **Obtener Recompensa por ID** → Verificar detalles
5. **Actualizar Recompensa** → Cambiar puntosConversion
6. **Listar Recompensas Actualizadas** → Verificar cambios
7. **Eliminar Recompensa** → Soft delete
8. **Listar Recompensas (includeInactive=true)** → Verificar que está inactiva

### Flujo 2: Crear y Gestionar Sistema de Estampas

1. **Registrar Negocio** → Obtener token
2. **Crear Sistema de Estampas (specific)** → Producto específico
3. **Crear Sistema de Estampas (general)** → Tipo general
4. **Crear Sistema de Estampas (any)** → Cualquier producto
5. **Listar Todas las Recompensas** → Verificar que aparecen las 3
6. **Actualizar una Recompensa** → Cambiar targetStamps
7. **Eliminar una Recompensa** → Hard delete

### Flujo 3: Testing de Seguridad

1. **Negocio 1**: Crear recompensa
2. **Negocio 2**: Intentar acceder a recompensa de Negocio 1 → Debe fallar (404)
3. **Negocio 1**: Verificar que puede acceder a su propia recompensa
4. **Sin token**: Intentar crear recompensa → Debe fallar (401)

---

## Endpoints de Puntos y Estampas de Usuarios

### 1. Agregar Puntos/Estampas a un Usuario

**POST** `{{base_url}}/user-points/add`

**Headers:**
```
Content-Type: application/json
Authorization: Bearer {{business_token}}
```

#### Para Sistema de Puntos:

**Body:**
```json
{
  "userId": "6912280eb656bd7c7158235a",
  "rewardSystemId": "6912280fb656bd7c7158235b",
  "purchaseAmount": 100
}
```

**Respuesta esperada (200):**
```json
{
  "message": "Points/stamps added successfully",
  "userPoints": {
    "id": "69122810b656bd7c7158235c",
    "userId": "6912280eb656bd7c7158235a",
    "businessPoints": [
      {
        "businessId": "6912280eb656bd7c7158235a",
        "points": 10,
        "stamps": 0,
        "lastVisit": "2024-01-15T11:00:00.000Z",
        "rewardSystems": [
          {
            "rewardSystemId": "6912280fb656bd7c7158235b",
            "points": 10,
            "stamps": 0,
            "lastUpdated": "2024-01-15T11:00:00.000Z"
          }
        ]
      }
    ],
    "createdAt": "2024-01-15T11:00:00.000Z",
    "updatedAt": "2024-01-15T11:00:00.000Z"
  }
}
```

#### Para Sistema de Estampas:

**Body:**
```json
{
  "userId": "6912280eb656bd7c7158235a",
  "rewardSystemId": "69122810b656bd7c7158235c",
  "stampsCount": 3
}
```

**Para Estampas de Producto Específico:**
```json
{
  "userId": "6912280eb656bd7c7158235a",
  "rewardSystemId": "69122810b656bd7c7158235c",
  "stampsCount": 1,
  "productIdentifier": "bebida_coca_cola"
}
```

**Respuesta esperada (200):**
```json
{
  "message": "Points/stamps added successfully",
  "userPoints": {
    "id": "69122810b656bd7c7158235c",
    "userId": "6912280eb656bd7c7158235a",
    "businessPoints": [
      {
        "businessId": "6912280eb656bd7c7158235a",
        "points": 0,
        "stamps": 3,
        "lastVisit": "2024-01-15T11:00:00.000Z",
        "rewardSystems": [
          {
            "rewardSystemId": "69122810b656bd7c7158235c",
            "points": 0,
            "stamps": 3,
            "lastUpdated": "2024-01-15T11:00:00.000Z"
          }
        ]
      }
    ]
  }
}
```

### 2. Obtener Puntos del Usuario Autenticado

**GET** `{{base_url}}/user-points`

**Headers:**
```
Authorization: Bearer {{user_token}}
```

**Respuesta esperada (200):**
```json
{
  "id": "69122810b656bd7c7158235c",
  "userId": "6912280eb656bd7c7158235a",
  "businessPoints": [
    {
      "businessId": "6912280eb656bd7c7158235a",
      "points": 10,
      "stamps": 3,
      "lastVisit": "2024-01-15T11:00:00.000Z",
      "rewardSystems": [...]
    }
  ],
  "createdAt": "2024-01-15T11:00:00.000Z",
  "updatedAt": "2024-01-15T11:00:00.000Z"
}
```

### 3. Obtener Puntos de un Usuario para un Negocio Específico (Como Usuario)

**GET** `{{base_url}}/user-points/business/{{businessId}}`

**Headers:**
```
Authorization: Bearer {{user_token}}
```

**Respuesta esperada (200):**
```json
{
  "businessId": "6912280eb656bd7c7158235a",
  "points": 10,
  "stamps": 3,
  "lastVisit": "2024-01-15T11:00:00.000Z",
  "rewardSystems": [
    {
      "rewardSystemId": "6912280fb656bd7c7158235b",
      "points": 10,
      "stamps": 0,
      "lastUpdated": "2024-01-15T11:00:00.000Z"
    }
  ]
}
```

**Si el usuario no ha visitado el negocio:**
```json
{
  "userId": "6912280eb656bd7c7158235a",
  "businessId": "6912280eb656bd7c7158235a",
  "points": 0,
  "stamps": 0,
  "rewardSystems": [],
  "lastVisit": null,
  "message": "You have not visited this business yet"
}
```

### 4. Obtener Puntos de un Usuario para un Negocio Específico (Como Negocio)

**GET** `{{base_url}}/user-points/{{userId}}`

**Headers:**
```
Authorization: Bearer {{business_token}}
```

**Descripción:** Este endpoint permite a un negocio ver los puntos de un usuario específico en su negocio. El `businessId` se obtiene automáticamente del token del negocio autenticado.

**Respuesta esperada (200):**
```json
{
  "businessId": "6912280eb656bd7c7158235a",
  "points": 10,
  "stamps": 3,
  "lastVisit": "2024-01-15T11:00:00.000Z",
  "rewardSystems": [
    {
      "rewardSystemId": "6912280fb656bd7c7158235b",
      "points": 10,
      "stamps": 0,
      "lastUpdated": "2024-01-15T11:00:00.000Z"
    }
  ]
}
```

---

## Troubleshooting

### Error: "Cannot find module"
- Asegúrate de que el servidor esté corriendo
- Verifica que la URL base sea correcta

### Error: "missing token" o "invalid token"
- Verifica que el header Authorization esté configurado correctamente
- Asegúrate de que el token no haya expirado
- Vuelve a hacer login si es necesario

### Error: "reward system not found"
- Verifica que el ID de la recompensa sea correcto
- Asegúrate de que la recompensa pertenezca al negocio autenticado
- Verifica que la recompensa no haya sido eliminada (hard delete)

### Error: "pointsConversion is required"
- Para sistemas de puntos, siempre debes incluir pointsConversion
- Verifica que todos los campos requeridos estén presentes

---

¡Listo! Ahora puedes probar todos los endpoints de recompensas manualmente en Postman.

