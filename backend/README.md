# AIHustle LMS backend

## Main Admin account

Add these values to `backend/.env` without committing the file:

```env
ADMIN_EMAIL=the-admin-email@example.com
ADMIN_PASSWORD=choose-a-long-unique-password
JWT_SECRET=use-a-random-secret-at-least-32-bytes-long
```

Keep the existing `MONGO_URI` entry pointed at the `LMS` database.
`MONGO_DB_NAME` can explicitly override the database name for isolated test
connections; otherwise, startup uses the database named in `MONGO_URI`.
`ADMIN_PASSWORD` must be at least 12 characters. Generate a JWT secret with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Seed a Main Admin and start the API:

```sh
npm run seed:admin
npm run dev
```

The seed command creates a `main_admin` account in `admin`, reserves its login
identity in `accountidentities`, and bcrypt-hashes the password. It leaves an
existing account unchanged. Public registration is available only to
independent students.

## Account collections and roles

The application uses the database selected by `MONGO_URI` (currently `LMS`).

| Collection | Account/data |
|---|---|
| `admin` | Main Admin (`main_admin`) |
| `sub_admins` | College Sub-Admins (`college_admin`) |
| `students` | Independent Students (`student`, `studentType: "independent"`) |
| `clg_students` | College Students (`student`, `studentType: "college"`, with `collegeId`) |
| `colleges` | College details |
| `courses` | Courses, modules, and lessons |
| `enrollment` | Course enrollments |
| `accountidentities` | Normalized login identity-to-collection/document mappings |
| `referralCodes` | External User referral codes and redemption history |
| `referralCodeDailyLimits` | Atomic per-External-User UTC daily generation counters |

Authentication accepts only the `main_admin`, `college_admin`, and `student`
roles. JWTs include the canonical role and the account collection; identity
lookups use `accountidentities`. No `users` collection fallback is used by
authentication. A college has a unique code. Courses support modules, lessons,
assignments, and quizzes; correct quiz answers are not returned to students.
The `accountidentities` collection enforces global case-insensitive username
uniqueness across student and administrator account collections.

## External User referrals

External Users can generate up to five referral codes per UTC calendar day.
Generation requests are idempotent per authenticated user, and the per-day
counter and new code are written in a MongoDB transaction. Codes are generated
with Node.js cryptographic randomness and expire 15 days after creation.

The referral API is:

| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/api/referrals/generate` | Authenticated External User |
| `GET` | `/api/referrals/me` | Authenticated External User |
| `POST` | `/api/referrals/validate` | Public registration validation |

`POST /api/auth/register` accepts an optional `referralCode`. Registration,
identity creation, and one-time referral redemption happen in the same MongoDB
transaction. The `referralCodes` collection has unique code and per-user
idempotency indexes, owner/date history and expiry indexes. The daily-counter
collection has a unique owner/UTC-day index. Referral history is retained; no
TTL index is used. Referral history returns only whether the friend registered
and their registration status, not their account identifiers or profile data.

The current public External User registration flow activates accounts
immediately. Referral registration status is derived from the referred
account's current approval/account status and is refreshed when the creator
loads referral history; the referral feature does not alter account approval.

## Database backup, integration tests, and reset

The integration test writes real test accounts and learning records only to
`LMS_TEST`, verifies each collection and login mapping, and drops that disposable
database after it finishes. It refuses to run if `LMS_TEST` is not empty.

```powershell
$env:LMS_BACKUP_DIR = 'C:\protected\backup\LMS-before-reset'
npm run backup:database
npm run test:database
npm run reset:database
```

The backup command connects explicitly to `LMS`, writes BSON collection data,
collection/index metadata, and a SHA-256 manifest to an empty directory, then
decodes the BSON and checks counts and hashes. Keep that directory protected;
it contains account data and password hashes.

`reset:database` is read-only and prints the exact current collection/count
deletion plan after checking the verified backup against the live database.
`reset:database:execute` is destructive: it drops only `LMS`, recreates the
application collections and indexes, and seeds only the configured Main Admin.
Do not run it until the backup is verified, the deletion list is reviewed, and
the reset is explicitly approved. The obsolete legacy reset utility has been
removed.

## College Sub-Admin activation

The Main Admin creates a College Sub-Admin without setting a password. The API
stores a hash of a random, single-use activation token and emails the activation
link. The sub-admin sets a password; only its bcrypt hash is stored. Tokens
expire after 24 hours and are invalidated on use. A pending invite can be
resent from the Colleges page.

Configure outbound SMTP and the public frontend origin in `backend/.env`:

```env
CLIENT_ORIGIN=https://your-frontend.example
SMTP_HOST=smtp.example
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=LMS <no-reply@example.com>
```

Keep SMTP credentials private and never commit `.env`. If mail delivery fails,
the account remains pending and the Main Admin can retry after fixing SMTP.

## Student email changes

Student email changes require an 8-digit verification code sent to the new
address. The current email remains active until the code is verified; codes
expire after 15 minutes. This uses the SMTP settings above. Account identity
and student email records are updated together after verification.

## Student email two-factor authentication

Set `RESEND_API_KEY` and `EMAIL_FROM` in `backend/.env`; see `.env.example` for
the variable names. Keep the Resend API key private. Email OTPs are random
six-digit values, stored only as keyed hashes, expire after five minutes, and
are limited to five verification attempts. Resending is limited to once per
minute.

Students enable or disable two-factor authentication from Settings after
verifying a code sent to their registered email. When enabled, password and
Google sign-in return a short-lived login challenge instead of an access token.
The normal JWT is issued only after successful OTP verification. The
`emailotpchallenges` collection uses a TTL index to remove expired challenge
records.

## Google sign-in

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `backend/.env`, and set the
matching `VITE_GOOGLE_CLIENT_ID` in `client/.env`. Keep the client secret only
on the backend. Configure the OAuth client with the frontend origin as an
authorized JavaScript origin and redirect URI.

The client sends the one-time authorization code and selected canonical role
to `POST /api/auth/google`. The API validates the request origin, exchanges the
code, verifies the ID token and verified email, then finds the existing
`accountidentities` mapping. Google sign-in never creates accounts.

Run the backend with `npm run dev`. For a separately hosted client, set
`VITE_API_BASE_URL` to the backend API base URL before starting or building the
client. The default local API base is `http://localhost:5000/api`.
