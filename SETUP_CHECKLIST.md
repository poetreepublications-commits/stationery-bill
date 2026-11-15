# Final setup checklist (fill these in, then the system is ready to go live)

Only these values are still open. Everything else is built and tested.

| Item | Where to set it | Example |
|---|---|---|
| Domain name | `deploy/.env` → `DOMAIN` | `orders.yourdomain.com` |
| Server (VPS) IP / SSH access | your hosting panel | Ubuntu 24.04, 2 GB RAM |
| Database password | `deploy/.env` → `DB_PASSWORD` | `openssl rand -base64 32` |
| JWT secret | `deploy/.env` → `JWT_SECRET` | `openssl rand -base64 48` |
| Company details on invoices | Settings → Company & invoice | name, address, GSTIN, bank, signatory |
| Email (SMTP), optional | `deploy/.env` → `SMTP_*` | any SMTP provider |
| Owner (Super Admin) login | create after first start (DEPLOY.md §3) | your email |

## Steps after filling the table
1. `cp deploy/.env.example deploy/.env` and fill it in.
2. `cd deploy && docker compose up -d --build`
3. Open `https://<your domain>` and log in as the owner.
4. Remove the demo users, or change their passwords.
5. Run the order test from README.md section 3, Phase 4.

Full instructions: `deploy/DEPLOY.md`.
