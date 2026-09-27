# Card Day Ledger

A weekend-market ledger: log Sell/Buy/Trade transactions by Cash/Bank/TNG, attach photos,
and see totals by day and by month. Your own Express server + Postgres database, deployable
to Render. Works offline — transactions save on the device instantly and sync automatically
once you're back online.

## Project structure

```
card-ledger-app/
  server.js          <- Express API server (auth + transactions)
  package.json
  .env.example        <- copy to .env for local dev
  public/
    index.html         <- the app's UI
    app.js              <- frontend logic (auth, offline queue, rendering)
    sw.js               <- service worker (lets the page open with no internet)
```

## Run it locally in VS Code

1. Open this folder in VS Code.
2. Install a local Postgres, OR just skip straight to deploying on Render and testing there —
   that's the simplest path since Render gives you a database for free.
3. If you do want to run locally: install Postgres, create a database, copy `.env.example` to
   `.env` and fill in `DATABASE_URL` and `JWT_SECRET`.
4. In the VS Code terminal:
   ```
   npm install
   npm start
   ```
5. Open http://localhost:3000 in your browser.

## Deploy to Render (recommended path)

1. Push this folder to a GitHub repository (Render deploys from GitHub).
2. On Render: **New +** → **PostgreSQL** → create a free database. Copy its **Internal Database URL**.
3. On Render: **New +** → **Web Service** → connect your GitHub repo.
   - Build command: `npm install`
   - Start command: `npm start`
4. Under the web service's **Environment** tab, add:
   - `DATABASE_URL` → paste the Internal Database URL from step 2
   - `JWT_SECRET` → any long random string (e.g. generate one at randomkeygen.com)
5. Deploy. Render gives you a live URL like `https://card-ledger.onrender.com`.
6. Open that URL, tap **Sign up**, create your account, and start logging.
7. On your iPad, open the URL in Safari, tap Share → **Add to Home Screen** so it behaves like a normal app icon.

## Notes

- Render's free database tier is fine to start; check Render's current free-tier limits before
  relying on it long-term, as free databases can expire after a period of inactivity.
- Free Render web services "sleep" after inactivity and take a few seconds to wake up on the
  next visit — normal for the free tier, not a bug.
- Photos are stored as compressed images directly in the database. If you'll be adding a lot of
  large photos over years of use, consider swapping to a file storage service later (e.g. Cloudinary
  or an S3-compatible bucket) — ask me and I can wire that in.
- Passwords are hashed with bcrypt before storage; nobody, including you, can see users' plain
  passwords in the database.
