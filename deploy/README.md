# SmartTrade VPS deployment

The initial endpoint is `http://189.72.155.44/`. Nginx serves the Admin site and proxies `/api/` to Django. Only Nginx publishes a host port. Gunicorn uses three workers with a 120-second timeout.

On the VPS, copy `.env.prod.example` to `.env.prod`, restrict the file to the deployment account, and replace both secret placeholders with independently generated secrets. Keep the production database and volumes separate from development data.

```sh
chmod 600 .env.prod
docker compose --env-file .env.prod -f docker-compose.prod.yml config --quiet
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
curl --fail http://189.72.155.44/api/v1/health
```

The API container applies migrations and collects static assets at startup. Back up PostgreSQL, `private_uploads`, `catalogue_uploads`, and any seeded assets in `media_volume` before an upgrade. Nginx sees only collected static files and the public media volume. Staff previews and private attachments are served by authorized API endpoints. Public catalogue image URLs are checked for current product visibility by Django. The `/admin/` proxy is reserved for Django routes. The React Admin console is at `/`.

HTTP carries credentials and bearer tokens in cleartext. Use the IP endpoint for connectivity checks. Enable HTTPS before using real accounts or private data. Production disables development sign-in, OTP and email simulations. Authenticated workflows require configured providers and a provisioned staff account.

When adding a domain, configure DNS and TLS on Nginx, update `server_name`, `ALLOWED_HOSTS`, and both origin lists, then set `USE_HTTPS=true`. The terminating proxy must forward the actual scheme as `X-Forwarded-Proto`. Update the mobile build URL to HTTPS and remove the temporary IP exception from the Android network security config.

For the initial Android build, set `EXPO_PUBLIC_API_URL=http://189.72.155.44/api/v1` and `EXPO_PUBLIC_ENABLE_DEMO_ROLES=false` in the signed release build environment. Rebuild the APK to include the IP exception. The checked-in Android network policy permits cleartext only for loopback and this VPS IP.
