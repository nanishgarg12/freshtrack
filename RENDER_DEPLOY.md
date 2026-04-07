# Render Deployment Checklist (FreshTrack)

## 1) Push code
- Push `main` branch with `render.yaml`.

## 2) Create services from Blueprint
- In Render, choose **New +** -> **Blueprint**.
- Connect this GitHub repo.
- Render will create:
  - `freshtrack` (web service)
  - `freshtrack-expiry-alerts` (cron service)

## 3) Set environment variables
Set these on both services (or use one shared Environment Group):

- `MONGO_URI`
- `JWT_SECRET`
- `ADMIN_EMAILS`
- `RESEND_API_KEY`
- `RESEND_FROM`

Optional SMTP fallback:
- `EMAIL_USER`
- `EMAIL_PASS`
- `EMAIL_SMTP_HOST`
- `EMAIL_SMTP_PORT`
- `EMAIL_SMTP_SECURE`

Optional scanner APIs:
- `OCR_SPACE_API_KEY`
- `BARCODE_LOOKUP_API_KEY`

Notes:
- Without `BARCODE_LOOKUP_API_KEY`, barcode lookups rely on free providers and some products may return "Product not found".
- When that happens, use **Save Barcode** on the Add Item screen to store the product details for future scans.

Already provided via `render.yaml`:
- `NODE_ENV=production`
- `ENABLE_IN_PROCESS_CRON=false`
- `EXPIRY_CRON_SCHEDULE=0 9 * * *`
- `EXPIRY_CRON_TZ=Asia/Kolkata`

## 4) Confirm cron behavior
- Render cron service schedule is UTC.
- If you need a different run time, update:
  - cron service `schedule` in Render/`render.yaml`
  - optional `EXPIRY_CRON_SCHEDULE` for local/in-process fallback

## 5) Validate after deploy
- Open: `/healthz` -> should return `{ "ok": true }`.
- Login as admin and call: `POST /api/admin/test-email`.
- Trigger once manually: `POST /api/admin/trigger-expiry-alerts`.
- Check Render logs for `Email sent ... via Resend`.
