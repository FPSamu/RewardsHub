# 🔧 Fix: Root Directory Error en Render

## ❌ Error Actual

```
Error: Cannot find module '/opt/render/project/src/dist/index.js'
```

**Problema**: Render está buscando en `/opt/render/project/src/dist/` cuando debería buscar en `/opt/render/project/dist/`

---

## 🎯 Causa del Problema

En la configuración de Render Dashboard, el **Root Directory** está configurado como `src` cuando debería estar **vacío** o ser `.` (raíz del proyecto).

---

## ✅ Solución - Opción 1: Desde Render Dashboard (Recomendado)

### Paso 1: Ve a Render Dashboard

1. Abre [Render Dashboard](https://dashboard.render.com/)
2. Click en tu servicio **rewardshub-api**

### Paso 2: Edita la Configuración

1. Click en **"Settings"** en el menú lateral
2. Busca la sección **"Build & Deploy"**
3. Encuentra el campo **"Root Directory"**

### Paso 3: Corrige el Root Directory

**Si dice `src`:**
- ❌ Bórralo completamente (déjalo vacío)
- O cambialo a `.`

**Debería quedar:**
```
Root Directory: [vacío] o .
```

### Paso 4: Guarda y Redeploy

1. Click en **"Save Changes"**
2. Click en **"Manual Deploy"** → **"Deploy latest commit"**

---

## ✅ Solución - Opción 2: Actualizar render.yaml

Si prefieres controlar todo desde código, actualiza `render.yaml`:

```yaml
services:
  - type: web
    name: rewardshub-api
    env: node
    runtime: node
    region: oregon
    plan: free
    rootDir: .                              # ← AGREGAR ESTA LÍNEA
    buildCommand: npm install && npm run build
    startCommand: npm start
    healthCheckPath: /health
    # ... resto de la configuración
```

Luego:
```bash
git add render.yaml
git commit -m "fix: set root directory to project root"
git push
```

---

## 📁 Estructura Correcta del Proyecto

Render debería ver esta estructura:

```
/opt/render/project/          ← Root Directory (aquí debe estar)
├── src/
│   ├── index.ts
│   ├── app.ts
│   └── ...
├── dist/                     ← Generado por 'npm run build'
│   ├── index.js             ← Render ejecuta esto
│   ├── app.js
│   └── ...
├── package.json
├── tsconfig.json
└── render.yaml
```

**NO debería ser:**
```
/opt/render/project/src/      ← ❌ INCORRECTO
├── dist/
│   └── index.js
```

---

## 🔍 Verificación

### En Render Dashboard, verifica:

1. **Root Directory**: Vacío o `.`
2. **Build Command**: `npm install && npm run build`
3. **Start Command**: `npm start`

### En package.json, verifica:

```json
{
  "scripts": {
    "build": "tsc -p .",
    "start": "node dist/index.js"  ← Debe ser dist/index.js (no src/dist/)
  }
}
```

---

## 🚀 Pasos para Aplicar el Fix

### Opción A: Desde Dashboard (Más Rápido)

1. ✅ Ve a Render Dashboard
2. ✅ Settings → Build & Deploy
3. ✅ Root Directory: [vacío]
4. ✅ Save Changes
5. ✅ Manual Deploy → Deploy latest commit
6. ⏳ Espera 2-5 minutos

### Opción B: Desde Código

1. ✅ Actualiza `render.yaml` (agrega `rootDir: .`)
2. ✅ `git add render.yaml`
3. ✅ `git commit -m "fix: set root directory"`
4. ✅ `git push`
5. ⏳ Espera auto-deploy (2-5 minutos)

---

## 📊 Proceso de Build Correcto

```
┌─────────────────────────────────────┐
│  Root: /opt/render/project/         │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│  npm install                        │
│  (instala dependencies)             │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│  npm run build                      │
│  tsc compila src/ → dist/           │
│  Crea: /opt/render/project/dist/    │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│  npm start                          │
│  node dist/index.js                 │
│  ✅ Encuentra el archivo             │
└─────────────────────────────────────┘
```

---

## ✅ Verificación Post-Deploy

Una vez que el deploy termine:

```bash
# Test health check
curl https://tu-app.onrender.com/health

# Debería responder:
{"status":"ok"}
```

---

## 🆘 Si Aún Falla

### Verifica los Logs en Render

Busca estas líneas en los logs:

**✅ Correcto:**
```
==> Building...
==> Running 'npm run build'
Successfully compiled TypeScript
==> Running 'node dist/index.js'
Server running on port 10000
```

**❌ Incorrecto:**
```
Error: Cannot find module '/opt/render/project/src/dist/index.js'
```

### Comandos de Debug

Si el problema persiste, puedes agregar un script de debug:

```json
{
  "scripts": {
    "debug": "ls -la && ls -la dist/ && pwd"
  }
}
```

Y cambiar temporalmente el Start Command a:
```
npm run debug && npm start
```

---

## 📝 Resumen

**Problema**: Root Directory configurado como `src`  
**Solución**: Cambiar Root Directory a vacío o `.`  
**Dónde**: Render Dashboard → Settings → Build & Deploy  

---

**¡Aplica el fix y el deployment debería funcionar! 🚀**
