# AIHustle LMS backend

## Main Admin account

Add these values to `Server/.env` without committing the file:

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
existing account unchanged. Public registration is available only to independent students. New independent
student registrations remain pending
until approved by a Main Admin; the existing college onboarding flow is unchanged.
Independent-student registration requires a server-verified email address before
the account is created. The registration code is a six-digit Resend OTP; codes
expire after 10 minutes, are stored as keyed hashes, and can be requested once
per minute. Verification is bound to the exact normalized email and is consumed
in the registration transaction.
After a pending independent student is approved and the database transaction
commits, the backend sends an AIHustle-branded confirmation to the student's
registered email. The message links to the frontend at `CLIENT_ORIGIN` and uses
its `/logo.png` asset. Approval-email delivery errors are logged without undoing
approval; only a successful pending-to-approved transition initiates that email.
Rejection email delivery uses the same Resend service and is also attempted
only after the decision is saved.

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
transaction.
The `referralCodes` collection has unique code and per-user idempotency indexes,
owner/date history and expiry indexes. The daily-counter collection has a
unique owner/UTC-day index. Referral history is retained; no TTL index is used.
Referral history returns only whether the friend registered and their
registration status, not their account identifiers or profile data.

Independent-student referral registration remains pending until approved.
Referral registration status is derived from the referred account's current
approval/account status and is refreshed when the creator loads referral
history; the referral feature does not alter account approval.

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

Configure both email providers and the public frontend origin in `Server/.env`
(or as environment variables on Render):

```env
CLIENT_ORIGIN=https://your-frontend.example
RESEND_API_KEY=your-resend-api-key
EMAIL_FROM="AIHustle LMS <onboarding@resend.dev>"
EMAIL_USER=lmsp702@gmail.com
EMAIL_PASS=your-gmail-app-password
ADMIN_EMAIL=main-admin@example.com
```

In Render, set `RESEND_API_KEY` and `EMAIL_FROM`; also set `CLIENT_ORIGIN` to
the deployed frontend URL because the branded registration and decision emails
build links and logo URLs from it. `onboarding@resend.dev` is a temporary
Resend sender for testing. A custom production sender must use a domain verified
in Resend. Do not put the API key in source control or print it in logs.

Run `npm run test:email` locally to send a safe test message to Resend's
`delivered@resend.dev` test recipient. The command refuses to run when
`NODE_ENV=production` and reports the API response without exposing credentials.

`EMAIL_USER` must be the Gmail mailbox that owns the `EMAIL_PASS` Google App Password; enable
2-Step Verification before creating the App Password. Never use your regular
Gmail password. Configure the App Password without spaces.

Resend sends registration email verification codes, independent-student
approval/rejection notifications, college administrator activation,
support-ticket complaint alerts to `ADMIN_EMAIL`, email-change verification,
and two-factor/security messages. Gmail currently sends student registration
receipt confirmations. Each provider has independent credentials, and decision
email failures are logged without undoing the saved approval/rejection. Keep all
credentials private and never commit `.env`.

## Student email changes

Student email changes require an 8-digit verification code sent to the new
address. The current email remains active until the code is verified; codes
expire after 15 minutes. This uses the Resend settings above. Account identity
and student email records are updated together after verification.

## Student email two-factor authentication

Set `RESEND_API_KEY` and `EMAIL_FROM` in `Server/.env`; see `.env.example` for
the variable names. Keep the Resend API key private. Email OTPs are random
six-digit values, stored only as keyed hashes, expire after five minutes, and
are limited to five verification attempts. Resending is limited to once per
minute.

Students enable or disable two-factor authentication from Settings after
verifying a code sent to their registered email using Resend. When enabled,
password and Google sign-in return a short-lived login challenge instead of an access token.
The normal JWT is issued only after successful OTP verification. The
`emailotpchallenges` collection uses a TTL index to remove expired challenge
records.

## Registration email verification

| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/api/auth/registration/email/send` | Public, rate-limited |
| `POST` | `/api/auth/registration/email/verify` | Public, rate-limited |
| `POST` | `/api/auth/register` | Public; requires a verified-email token |

The public registration form sends a code to `/api/auth/registration/email/send`
with `{ "email": "..." }`, then verifies it at
`/api/auth/registration/email/verify` with the email and six-digit code. A
successful response contains a short-lived signed
`emailVerificationToken`; the registration endpoint validates that token and
atomically consumes its verified database record. A changed email requires a
new verification. Registration OTPs expire after 10 minutes, allow five
incorrect attempts and five requests per email per hour, and have a 60-second
resend cooldown plus IP-based rate limits. The
`registrationemailverifications` collection has a TTL cleanup index.
The existing optional referral code is still redeemed in the same registration
transaction.

## Main Admin course media

Configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
`CLOUDINARY_API_SECRET` in `Server/.env`. Main Admin lesson media is uploaded
through authenticated Multer endpoints:

- `POST /api/admin/courses/:courseId/modules/:moduleId/media/video`
- `POST /api/admin/courses/:courseId/modules/:moduleId/media/resource`
- `POST /api/admin/course-assets/delete`

Videos accept MP4, M4V, MOV, WebM, OGV, AVI, or MKV, with a default 2 GiB limit.
PDF, PNG, JPEG, and WebP resources default to a 50 MiB limit. Set
`COURSE_VIDEO_MAX_BYTES` and `COURSE_RESOURCE_MAX_BYTES` to change those limits.
Uploads are validated by extension, MIME type, and file signature, streamed from
temporary files to Cloudinary, then removed from disk. MongoDB stores the
Cloudinary URLs, public IDs, media metadata, and embedded lesson timestamps;
video and resource bytes are never stored in MongoDB. Cloudinary assets are
deleted only after a course edit removes them and no course still references
their public ID. Thumbnail images continue to use a signed upload request.

## Main Admin AI quiz question generation

Set `GEMINI_API_KEY` in `Server/.env`. The key stays on the backend and is never
sent to the client. Authenticated Main Admins can request reviewable quiz
questions with `POST /api/admin/courses/generate-quiz-questions`:

```json
{
  "lessonContent": "Lesson text...",
  "questionCount": 5,
  "difficulty": "intermediate",
  "questionTypes": ["multiple-choice", "multiple-select", "true-false"]
}
```

`questionTypes` is optional and defaults to all supported types. The endpoint
returns structured question data, including answer indexes, without saving it
to a course or publishing it. Admins can review and edit the response before
using it in a quiz.

## Course certificates

When a student completes every trackable lesson in an enrolled course, the
learning API stores one certificate record in MongoDB. A unique student/course
index prevents duplicate awards. Independent and college student records are
scoped separately; existing completions are not backfilled.

Main Admin progress reports read earned certificate records for each student.
Authenticated certificate documents are available at
`GET /api/certificates/:certificateId/view` and
`GET /api/certificates/:certificateId/download`; students can access only their
own certificates, while Main Admins can access certificates in reports.

## Google sign-in

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `Server/.env`, and set the
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
