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

### Optional eWeLink config

Create `backend/.env` from `backend/.env.example`:

```env
EWELINK_EMAIL=your_email@example.com
EWELINK_PASSWORD=your_password_here
EWELINK_REGION=eu
```

If you do not use Sonoff right now, you can skip `.env`.

## 2) Run the app

From `backend/`:

```bash
npm start
```

Server starts at:

- `http://localhost:3001`

The backend serves the frontend files, so you only need this one process.

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

