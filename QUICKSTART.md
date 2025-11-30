# Quick Start Guide - RewardsHub Deployment

## 🎯 Pre-Deployment Checklist

Before deploying to Render.com, make sure you have:

- [ ] MongoDB Atlas account created
- [ ] MongoDB cluster configured with database user
- [ ] Network access set to allow all IPs (0.0.0.0/0)
- [ ] MongoDB connection string ready
- [ ] GitHub repository with your code
- [ ] Render.com account created and connected to GitHub

## 🚀 5-Minute Deployment

### Step 1: Verify Your Project (30 seconds)

```bash
npm run verify-deployment
```

This will check that everything is configured correctly.

### Step 2: Push to GitHub (1 minute)

```bash
git add .
git commit -m "Prepare for Render deployment"
git push origin main
```

### Step 3: Create Web Service on Render (2 minutes)

1. Go to https://dashboard.render.com/
2. Click **"New"** → **"Web Service"**
3. Connect your GitHub repository
4. Render will auto-detect settings from `render.yaml`

### Step 4: Configure Environment Variables (1 minute)

Add these in Render Dashboard:

```
MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/rewardshub?retryWrites=true&w=majority
ALLOWED_ORIGINS=https://your-frontend.vercel.app
```

Render will auto-generate `JWT_SECRET` and `JWT_REFRESH_SECRET`.

### Step 5: Deploy! (30 seconds)

Click **"Create Web Service"** and wait 2-5 minutes for the build.

## ✅ Verify Deployment

Once deployed, test your API:

```bash
# Replace with your Render URL
curl https://rewardshub-api.onrender.com/health
```

Expected response:
```json
{"status":"ok"}
```

## 🔗 Next Steps

1. Copy your Render URL (e.g., `https://rewardshub-api.onrender.com`)
2. Update your frontend to use this URL
3. Test your endpoints with Postman
4. Monitor logs in Render Dashboard

## 📖 Need More Details?

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the complete step-by-step guide.

## 🆘 Common Issues

**Issue**: MongoDB connection fails
**Solution**: Check your `MONGO_URI` format and network access settings

**Issue**: CORS errors from frontend
**Solution**: Add your frontend URL to `ALLOWED_ORIGINS`

**Issue**: Service sleeps after 15 minutes
**Solution**: This is normal on free tier. First request after sleep takes ~30s

---

**Ready to deploy?** Start with Step 1! 🚀
