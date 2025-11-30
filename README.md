# RewardsHub - Backend

> RewardsHub is a univeral platform for rewards and fidelization programs between businesses and clients.
> Businesses create a RewardsHub account and configure their custom rewards and points systems.
> Clients use the app to generate an unique QR ID code, which will be used by businesses to accumulate points in the client's profile.
> Clients can see all the businesses registered in the platform, labeled as `visited`, not `visited` and `rewards available`.

> This project sets up endpoints and a backend structure with the objective to be used by both a web app and a mobile app.

---

## Tech stack

- Node.js
- Express
- TypeScript
- MongoDB (mongoose)

---

## Project Structure

```md
├── src/
│ ├── controllers/
│ ├── db/
│ ├── middleware/
│ ├── models/
│ ├── routes/
│ ├── services/
│ ├── types/
│ └── index.ts
├── tests/
├── jest.config.cjs
├── package-lock.json
├── package.json
├── README.md
└── tsconfig.json
```

---

## User Flows

### Business

1. Registers/logs in with a business account.
2. Configure customs rewards and points system.
3. Opens scanner on app.
4. Inputs check's price.
5. Scans clients QR code.

### Clients

1. Registers/logs in with a client account.
2. Opens QR code.
3. See rewards, visited businesses, and not visited businesses.

---

## 🚀 Deployment

This project is ready to be deployed on **Render.com** with MongoDB Atlas.

### Quick Deploy

1. **Prepare for deployment:**
   ```bash
   npm run verify-deployment
   ```

2. **Follow the deployment guide:**
   See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed step-by-step instructions.

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required variables:
- `MONGO_URI` - MongoDB connection string
- `JWT_SECRET` - Secret for JWT tokens
- `JWT_REFRESH_SECRET` - Secret for refresh tokens
- `ALLOWED_ORIGINS` - Comma-separated list of allowed frontend URLs

---

## 💻 Development

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your local configuration
```

### Running Locally

```bash
# Development mode with hot reload
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

### Testing

```bash
# Run tests
npm test

# Type checking
npm run typecheck

# Linting
npm run lint
```

---

## 📚 API Documentation

See [POSTMAN_GUIDE.md](./POSTMAN_GUIDE.md) for detailed API documentation and testing guide.

### Base Endpoints

- **Health Check**: `GET /health`
- **Authentication**: `/auth/*`
- **Business**: `/business/*`
- **Systems**: `/systems/*`
- **Rewards**: `/rewards/*`
- **User Points**: `/user-points/*`
- **Transactions**: `/transactions/*`

---

## 📁 Additional Documentation

- [Deployment Guide](./DEPLOYMENT.md) - Deploy to Render.com
- [Postman Testing Guide](./POSTMAN_GUIDE.md) - API testing with Postman
- [Environment Variables](./.env.example) - Required configuration

---

## 🔒 Security

- JWT-based authentication
- Password hashing with bcrypt
- Helmet.js for security headers
- CORS configuration for production
- Environment-based configuration

---

## 📝 License

ISC
