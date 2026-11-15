# Poetree Publications — Order, Accounts & Dispatch System

Web application (responsive, works on phone browsers) plus REST API for Poetree's dealers, sales staff, accounts and godown.

```
poetree/
├── server/      Node.js + TypeScript + Express + Prisma (PostgreSQL) — API, business rules, PDFs, Excel, tests
├── web/         React + Vite + TypeScript — all roles, responsive, i18n-ready
└── deploy/      Dockerfile, docker-compose (app + PostgreSQL + Caddy HTTPS + daily backups), DEPLOY.md
```

## 1. Run it locally

Requirements: Node.js 22+, PostgreSQL 16 (or Docker).

```bash
# 1. database (or use your own Postgres and set DATABASE_URL in server/.env)
#    server/.env already points at postgresql://poetree:poetree@localhost:5432/poetree

# 2. API
cd server
npm install
npx prisma db push          # creates tables
npm run prisma:seed         # demo users, books, stock, dealers, terms
npm start                   # http://localhost:4000 (also serves the web app once built)

# 3. Web (development with hot reload; proxies /api to :4000)
cd ../web
npm install
npm run dev                 # http://localhost:5173

# or build the web app once and let the API serve it on :4000
npm run build
```

### Demo accounts (password for all: `Demo@12345`)

| Role | Email | What they see |
|---|---|---|
| Super Admin (Owner) | admin@poetree.demo | Everything, users, settings, audit log, discount approvals |
| Account Person | accounts@poetree.demo | Verify orders, terms, billing, payments, returns approval, targets |
| Sales Employee | sales@poetree.demo | Assigned dealers, accept orders, targets |
| Godown Person | godown@poetree.demo | Picking, packing, dispatch, bilty, returns receiving, stock |
| Dealer (School) | school@poetree.demo | Own orders, ledger, returns, terms acceptance |
| Dealer (Bookseller) | bookseller@poetree.demo | Own orders for many schools, class sets |

Language: English and ગુજરાતી (Gujarati). Switch with the language box on the login screen or top bar; the choice is remembered in the browser.

## 2. What is built

| Area | Status |
|---|---|
| Login with JWT + refresh tokens, password reset, dealer self-registration (stays Pending until approved) | Built |
| Roles and permissions (5 roles), row-level scope (sales see only their dealers, dealers see only themselves) | Built |
| Dealers (both onboarding routes), approval, assignment, schools under a bookseller | Built |
| Terms & conditions: versioned, dealer must accept before ordering, changes highlighted | Built |
| Books (ISBN, class, MRP, HSN, reorder level), class sets, stock ledger (receipts, dispatch, returns, adjustments), low-stock flag | Built |
| Orders: place, edit lines, cancel, accept, verify (discount + credit check), status history, notifications | Built |
| Godown: pick (typed/scanned code), shortfall vs stock, pack (creates shipment + invoice, reduces stock), dispatch with transport details, bilty photo upload | Built |
| Partial dispatch and backorders (remaining books ship as a separate shipment with its own invoice) | Built |
| Invoice PDF (Original / Duplicate / Transport copy, school-wise breakup, round-off, amount in words, Indian format) | Built |
| Payments (manual, auto-allocated to oldest invoices), receipts (PDF), dealer ledger (Excel), ageing, debit notes | Built |
| Returns with yearly limit (blocks over limit, Accounts/Super Admin override), godown receiving, Accounts approval, automatic credit note, stock increase | Built |
| Targets per sales employee (amount and quantity, net of returns) with dealer-wise breakup | Built |
| 13 reports, each exportable to Excel | Built |
| Audit log (old → new for changes), soft delete, financial-year lock | Built |
| Notifications: in-app inbox + email (SMTP) through one service layer | Built |
| Settings: company details (invoice letterhead), discount limit, invoice prefix, default return limit | Built |
| Automated tests: 26 (unit + end-to-end order, credit, discount, stock, returns) | Built, all passing |
| Docker, HTTPS (Caddy), daily backups, deployment guide | Built (run on your server — see `deploy/DEPLOY.md`) |
| **Not built yet** | see section 5 |

## 3. Test steps (per phase)

Run `npm test` in `server/` first — all 26 tests must pass.

**Phase 1 — Auth, roles, users, audit**
1. Log in as `admin@poetree.demo`. You should see the full menu including *Settings*.
2. Log in as `godown@poetree.demo`. The menu should show Godown, Books, Returns, Dispatches only; no Dealers or Reports.
3. Settings → Users & roles → add a Sales user with a referral code. Log in as that user and confirm it sees only its own dealers.
4. Settings → Audit log: the user creation and any changes appear with who, when and old/new values.

**Phase 2 — Dealers, schools, books, stock**
1. Dealers → *+ Add dealer* as Sales: the dealer shows *pending*. Log in as Accounts → Dealers → *Approve*.
2. Open *Gurukul Book House*: add two schools. Open *Sunrise Public School* (School type): it has no extra school list, it orders for itself.
3. Books → Catalogue: add a book with an ISBN. Look it up by ISBN.
4. Books → Stock: receive 50 copies from printing with a reason; check the on-hand count changes. Low-stock books show a red *low* tag.
5. Books → Class sets: open the *Class 3 Full Set*.

**Phase 3 — Terms & conditions**
1. Dealers → open a dealer → *Issue new version*: change the discount. The dealer sees a version change notice.
2. Log in as the dealer → Terms → *I accept*. The acceptance time is stored.
3. Before accepting the latest version, a dealer cannot place an order (try *New order*: it is refused).

**Phase 4 — Order flow (the main test)**
1. As the bookseller dealer: New order → choose a school and books (or a class set) → *Place order*. Status: *placed*.
2. As Sales: open the order → *Accept order*.
3. As Accounts: open the order → enter discount (leave blank for default) → *Verify & send to godown*. Try a discount above 10% first: it is blocked until Super Admin *Approve discount*.
4. Set an order large enough to break the credit limit: it is blocked until Accounts ticks *Allow over-credit-limit*.
5. As Godown → Queue → open the order. Type a book code and press Enter to add 1 per scan. Adjust *Pick qty*, *Save picks*.
6. *Pack & generate invoice* → an invoice number appears, and stock drops.
7. *Dispatch* → enter transporter, LR, e-way bill. Upload a bilty photo.
8. Dealer → open the order → *Mark received*. The order becomes *delivered* once everything is received.
9. Pick a partial quantity so that a backorder remains. Dispatch the first shipment; the second shipment gets its own invoice.
10. Open the invoice PDF: it has three pages (Original, Duplicate, Transport copy).

**Phase 5 — Payments, ledger, notes**
1. Finance → select dealer → *Record payment*: it is allocated to the oldest invoice first.
2. Ledger shows invoices (debit), payments (credit) and the running balance. *Download ledger (Excel)*.
3. Ageing buckets show 0–30, 31–60, 61–90, 90+ and on-account.
4. Payment → *Receipt* downloads a PDF.

**Phase 6 — Returns with limits**
1. Dealer → Returns → add books → *Submit return*. The yearly limit is shown if it would be exceeded.
2. Godown → open the return → enter received quantities → *Mark received at godown*.
3. Accounts → *Approve & raise credit note*: a credit note is created and stock increases.

**Phase 7 — Targets, reports**
1. Reports → *Sales targets*: set an amount target for a sales employee. Progress shows achieved (net of returns) and dealer-wise.
2. Choose each report, set a date range, *Download Excel*.

**Phase 8 — Android app** — not built (see section 5).

**Phase 9 — Deployment** — follow `deploy/DEPLOY.md`, then run the order test above on the live domain.

## 4. Decisions I made (change these if you disagree)

Your brief asked me to check before making business-flow assumptions. You asked for everything to be built now, so I used these defaults. Each one is easy to change.

1. **Dealer login is email + password, not mobile OTP.** Mobile OTP needs an SMS provider and you said no SMS for now. Add OTP later behind the same login endpoint.
2. **Languages:** English and Gujarati. Menus, login, dashboards labels and common buttons are translated. Invoices stay in English as specified. Add Marathi by creating `web/src/i18n/mr.json` and registering it in `web/src/i18n/index.ts`.
3. **Discount** is applied on MRP per line. Above **10%** (Settings → Discount & numbering), Super Admin must approve before verification.
4. **Credit limit breach:** an order that goes over the dealer's credit limit is blocked, and Accounts can tick *Allow over-credit-limit* to override it.
5. **Stock never goes negative.** Picking is limited to what is on hand (minus what other orders have already picked). Shortfalls become backorders.
6. **Stock is deducted at packing**, and the invoice is created at the same moment.
7. **Returns limit:** one yearly limit per dealer (set in Terms). Per-school limits are not built yet.
8. **Sales employee assignment:** one sales employee per dealer. Accounts can reassign.
9. **Referral codes** are set per sales user in Settings → Users & roles.
10. **Financial years** are locked by Super Admin in Settings → Close year. The current year cannot be locked.
11. **Invoice numbers** are `INV/2026-27/0001` (per financial year, prefix configurable).
12. **Excel order upload** (optional in the brief) is not built.

## 5. Not built yet (be honest about these)

- **Android app (Expo):** not started. The web app is responsive and can be installed to the home screen as a PWA, which covers the phone need until the app is built. The API is ready for it.
- **Push notifications (Firebase):** not connected. In-app inbox and email work now; `server/src/services/notify.ts` is the single place to add FCM.
- **Mobile OTP login and SMS:** not built (see decision 1).
- **Camera barcode scanning in the browser:** the picking screen accepts any barcode scanner or a typed ISBN. Camera scanning comes with the Android app.
- **Gujarati coverage:** the navigation, login, and common labels are translated. Page-specific text (form fields, table headers, messages inside each page) is still English. The Gujarati wording was written by me and should be checked by a Gujarati speaker on your team before go-live.
- **Marathi:** not started.
- **Per-school return limits, and the "per school" option** in return limits.
- **E-way bill JSON export** (you asked for later integration; the e-way number field is stored).
- **Database migrations:** the schema is applied with `prisma db push`. For a long-running production database, generate versioned migrations with `prisma migrate` before the first real data load.
- **Permission editor:** roles are fixed (5 roles). A per-user permission matrix is not built.
- **Hosting on your server:** I could not reach your VPS from here, so the deployment files are ready but have not been run on your domain.

## 6. Security notes

- Passwords are hashed with bcrypt. Access tokens expire in 15 minutes; refresh tokens rotate on each use.
- Change `JWT_SECRET` and `DB_PASSWORD` before going live (see `deploy/.env.example`). The `.env` in `server/` is for local development only.
- All financial records are soft-deleted and every change is in the audit log.
