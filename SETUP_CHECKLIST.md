# PandaStack Deployment Checklist

Use this checklist to verify that your koshi PandaStack deployment is proceeding correctly.

---

## ✅ Step 1: Prerequisites

- [ ] PandaStack account created (https://dashboard.pandastack.io)
- [ ] GitHub PAT generated (Settings → Developer settings → Personal access tokens)
- [ ] PAT scopes verified: `repo`, `workflow`, `write:packages`
- [ ] Node.js v20+ installed (`node -v` to check)
- [ ] npm/Git working (`npm -v`, `git --version`)

---

## ✅ Step 2: Repository Verification

- [ ] `ryopc/koshi` repository exists
- [ ] main branch is up to date
- [ ] Required files exist:
  - [ ] `package.json`
  - [ ] `Dockerfile`
  - [ ] `pandastack.json`
  - [ ] `bin/server.js` (Express entry point)
  - [ ] `src/db/schema.sql` (PostgreSQL schema)
  - [ ] `.env.example`
  - [ ] `PANDASTACK_DEPLOYMENT.md` (this guide)

---

## ✅ Step 3: Environment Variables

Configure the following in PandaStack Dashboard → Environment:

### Required
- [ ] `DATABASE_URL` - Neon PostgreSQL connection string
- [ ] `JWT_SECRET` - 32+ character random string
- [ ] `NODE_ENV` - `production`
- [ ] `PORT` - `8080` (or auto-assigned)

### Optional
- [ ] `CORS_ORIGIN` - Frontend URL
- [ ] `LOG_LEVEL` - `info`

---

## ✅ Step 4: Deployment

- [ ] Connect GitHub repository in PandaStack
- [ ] Select branch: `main`
- [ ] Build settings auto-detected (Dockerfile)
- [ ] Deploy triggered
- [ ] Build logs show success
- [ ] Deployment URL assigned

---

## ✅ Step 5: Post-Deployment Verification

- [ ] `GET /health` returns `{"status":"ok"}`
- [ ] `GET /` serves the web app
- [ ] Can register account
- [ ] Can login
- [ ] Can create post
- [ ] Database migrations ran successfully
- [ ] WebSocket connection works

---

## Troubleshooting

- **Build fails**: Check Dockerfile and package.json
- **DB connection fails**: Verify DATABASE_URL format
- **CORS errors**: Set CORS_ORIGIN correctly
- **500 errors**: Check logs in PandaStack dashboard

---

Need help? See [PANDASTACK_DEPLOYMENT.md](./PANDASTACK_DEPLOYMENT.md)
