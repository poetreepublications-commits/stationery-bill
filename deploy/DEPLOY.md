# Deploying Poetree on your server

This guide assumes an Ubuntu 22.04/24.04 VPS (any provider) with a domain name pointing to it (an `A` record for `orders.yourdomain.com`).

## 1. Prepare the server (once)

```bash
sudo apt update && sudo apt install -y ca-certificates curl gnupg
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out and back in afterwards
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```

Make sure ports 80 and 443 are open in your provider's firewall too. HTTPS certificates come from Let's Encrypt, which needs port 80 open.

## 2. Copy the project and configure

```bash
git clone <your-repo-url> poetree && cd poetree/deploy   # or upload the folder with scp/rsync
cp .env.example .env
nano .env   # set DOMAIN, DB_PASSWORD (long random), JWT_SECRET (64+ random chars), SMTP_* if you have email
```

Generate secrets with: `openssl rand -base64 48`

## 3. Start

```bash
docker compose up -d --build
docker compose logs -f api      # wait for "Poetree API listening"
```

Open `https://orders.yourdomain.com`. The first start creates the tables. To load the demo data (optional, for a trial run only), run:

```bash
docker compose exec api node dist/prisma/seed.js   # demo users, password Demo@12345
```

**Delete the demo users before real use**, or change their passwords (Settings → Users & roles).

To create the real Super Admin:

```bash
docker compose exec api node -e "
const {PrismaClient}=require('@prisma/client');const b=require('bcryptjs');
const p=new PrismaClient();
b.hash(process.argv[1],10).then(h=>p.user.create({data:{name:'Owner',email:process.argv[2],role:'SUPER_ADMIN',passwordHash:h}})).then(()=>console.log('created')).finally(()=>p.\$disconnect());
" 'choose-a-strong-password' 'owner@yourdomain.com'
```

## 4. Backups

The `backup` service runs every night at 02:30:
- PostgreSQL dump → `deploy/backups/db-<timestamp>.sql.gz`
- Bilty photos → `deploy/backups/uploads-<timestamp>.tar.gz`
- Files older than 30 days (`BACKUP_RETENTION_DAYS`) are removed.

**Copy the backups off the server** as well (a server disk failure would otherwise take both the database and its backups). Example, run daily from your own computer or a cron job on another machine:

```bash
rsync -avz root@your-server:/root/poetree/deploy/backups/ ./poetree-backups/
```

Test a restore once, before you need it:

```bash
gunzip -c db-<timestamp>.sql.gz | docker compose exec -T db psql -U poetree -d poetree
```

## 5. Updating

```bash
cd poetree && git pull && cd deploy
docker compose up -d --build api
```

The API applies schema changes on start (`prisma db push`). Take a backup first (`docker compose exec backup sh -c "pg_dump -h db -U poetree poetree | gzip > /backups/manual-$(date +%s).sql.gz"`).

## 6. Checks after going live

1. `https://orders.yourdomain.com/api/health` returns `{"ok":true,...}`.
2. The padlock shows a valid certificate.
3. Log in as Super Admin, change the password, and create the staff accounts.
4. Run the order test from the README (section 3, Phase 4) on the live site.
5. Confirm a backup file appears in `deploy/backups/` the next morning.

## Notes

- Without SMTP settings, emails are written to the API log (`docker compose logs api`) instead of being sent.
- The database port is not exposed to the internet (only Caddy's 80/443 are published).
