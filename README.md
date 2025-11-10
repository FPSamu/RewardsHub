# RewardsHub - Backend
> RewardsHub is a univeral platform for rewards and fidelization programs between businesses and clients.
Businesses create a RewardsHub account and configure their custom rewards and points systems.
Clients use the app to generate an unique QR ID code, which will be used by businesses to accumulate points in the client's profile.
Clients can see all the businesses registered in the platform, labeled as `visited`, not `visited` and `rewards available`.

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
│   ├── controllers/
│   ├── db/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── services/
│   ├── types/
│   └── index.ts
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
