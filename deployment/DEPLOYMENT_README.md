# Deployment Package for naturalgarden.am

This folder is a deployment-ready copy of the project.

## Applied change

- Frontend API URL is set to:
  - `https://api.naturalgarden.am`
  - File: `deployment/greenhouse/js/config.js`

## Upload plan (Option A)

1. Upload contents of `deployment/greenhouse/` to your main domain document root (`public_html`) for `naturalgarden.am`.
2. Deploy `deployment/backend/` to your Node host (subdomain `api.naturalgarden.am`).
3. Keep database files writable on backend host (`deployment/db` structure can be used/initialized there).

## Required backend environment flags

- `AUTH_ALLOW_REGISTRATION=false`
- `AUTH_REQUIRE_EMAIL_VERIFICATION=false`

Master user (already ensured by backend startup logic):

- username: `grower`
- password: `1q2w3e4r5t!`
