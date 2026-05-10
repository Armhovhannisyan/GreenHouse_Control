# Greenhouse Dashboard

Web dashboard for greenhouse monitoring with:

- Weather polling and history storage
- Dashboard, weather reports, and climate pages
- User registration/login
- Optional Sonoff/eWeLink integration

## Requirements

- Node.js 16+ recommended
- npm

## Project Structure

- `backend/` - Node.js server and API
- `greenhouse/` - frontend static files (HTML/CSS/JS)
- `db/` - local JSON database files (created/updated by backend)
- `logs/` - backend log files

## 1) Backend setup

From project root:

```bash
cd backend
npm install
```

### Optional eWeLink (Sonoff) config

Create `backend/.env` from `backend/.env.example`.

**Recommended: OAuth (developer app)**

1. Create an app at [eWeLink Developer Center](https://dev.ewelink.cc/) and copy **App ID** and **App Secret**.
2. Set **Redirect URL** in the app to exactly the same value as `EWELINK_OAUTH_REDIRECT_URL` (default below).
3. Put credentials in `backend/.env`:

```env
EWELINK_APP_ID=your_app_id
EWELINK_APP_SECRET=your_app_secret
EWELINK_OAUTH_REDIRECT_URL=http://localhost:3001/api/sonoff/oauth/callback
EWELINK_REGION=eu
```

4. Log in to the dashboard (so you have a Bearer token in `localStorage`), then start linking:

- **POST** `http://localhost:3001/api/sonoff/oauth/start` with header `Authorization: Bearer <your_token>` — response is `{ "url": "..." }`. Open `url` in your browser and sign in to eWeLink.

You can also use **GET** with the same header (for example `curl -L -H "Authorization: Bearer …" http://localhost:3001/api/sonoff/oauth/start`) to follow the redirect automatically.

After you approve access in the eWeLink page, the server stores tokens in `db/ewelink-oauth.json` (gitignored).

**Legacy (optional):** email/password on the old cloud API often returns errors; you can still set:

```env
EWELINK_EMAIL=your_email@example.com
EWELINK_PASSWORD=your_password_here
EWELINK_REGION=eu
```

If you do not use Sonoff, you can skip these variables.

## 2) Run the app

From `backend/`:

```bash
npm start
```

Server starts at:

- `http://localhost:3001`

The backend serves the frontend files, so you only need this one process.

**Two servers (optional):** If you use `npx serve` on another port (for example `http://localhost:51617`) only for static files, you still need the **Node backend on port 3001** for `/api/*`. Keep `greenhouse/js/config.js` → `backendBaseUrl: 'http://localhost:3001'`. To link eWeLink from the static site, open **`greenhouse/ewelink-oauth.html`** on that static URL after logging in (it calls the backend for OAuth).

## 3) First login

Open:

- `http://localhost:3001/login.html`

Then register a user and login.

After login, you can use:

- `http://localhost:3001/index.html`
- `http://localhost:3001/weather.html`
- `http://localhost:3001/climate.html`

## API overview

- Auth:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `GET /api/auth/me`
  - `POST /api/auth/logout`
- Weather:
  - `GET /api/weather/current`
  - `GET /api/weather/history`
  - `GET /api/weather/reports`
- Sonoff:
  - `GET /api/sonoff/oauth/start` (auth required) — redirects to eWeLink login, or `POST` returns `{ url }`
  - `GET /api/sonoff/oauth/callback` (public) — must match redirect URL in developer app
  - `GET /api/sonoff/devices`
  - `POST /api/sonoff/control`

## Common commands

From `backend/`:

```bash
# install dependencies
npm install

# run server
npm start
```

## Troubleshooting

- **Port already in use (3001)**:
  Stop the old Node process and restart.
- **Cannot login**:
  Register first at `/login.html` (register link on page).
- **No weather data yet**:
  Wait ~30 seconds for first polling cycle.
- **Sonoff API returns error**:
  Check `backend/.env` and `logs/backend.log`.

