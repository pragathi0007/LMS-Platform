# Backend admin account

From this directory, add these values to `.env` without committing the file:

```env
ADMIN_EMAIL=the-admin-email@example.com
ADMIN_PASSWORD=choose-a-long-unique-password
JWT_SECRET=use-a-random-secret-at-least-32-bytes-long
```

Replace the example values with your own; never send or commit them.
Keep the existing `MONGO_URI` entry. `ADMIN_PASSWORD` must be at least 12
characters. Generate a JWT secret with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

For an existing database, run the migration instructions below before seeding
the admin or starting the API. For a fresh database, no legacy migration is
needed. Then seed the admin and start the API:

```sh
npm install
npm run seed:admin
npm run dev
```

The script creates the `admin` username in `admin` with role `admin`, status
`active`, and wildcard administrative permissions. It hashes the password with
bcryptjs and does not replace or duplicate an existing `admin` account. The
login API accepts the account through the common sign-in form; there is no
public admin registration endpoint.

## Account collections

The backend explicitly uses the `LMS` database. Student accounts are stored
in `users`; admin accounts remain in `admin`. The private `accountidentities`
collection reserves normalized emails and usernames with unique indexes and
stores the owning account collection and ID, not passwords or profiles.
Passwords are hashed with bcryptjs before storage.

Public registration at `POST /api/auth/register` accepts `student` (and the
legacy `user` alias); admin and instructor registration are rejected.

## Google sign-in

Set `GOOGLE_CLIENT_ID` and the matching `GOOGLE_CLIENT_SECRET` in
`backend/.env`, and set the matching `VITE_GOOGLE_CLIENT_ID` in `client/.env`.
Keep the client secret only on the backend; never add it to a `VITE_` variable
or frontend code. Configure the OAuth client with the frontend origin as an
authorized JavaScript origin and authorized redirect URI. The client uses
Google's OAuth authorization-code popup and sends the one-time code with the
selected role to `POST /api/auth/google`. The
API checks the popup request origin, exchanges the code on the server, verifies
the returned ID token audience and verified email, then authenticates only an
existing account. Google sign-in never creates accounts; an unregistered email
is rejected. Student, instructor, and admin lookups use their respective
collections.

Instructor accounts must first be created through the instructor application,
include the required professional details, and be approved before they can
authenticate. Existing instructor approval and role-protected route checks
also apply to Google sign-in.

Run the backend with `npm run dev`, then use the client’s Create account form.
For a separately hosted client, set `VITE_API_BASE_URL` to the backend API base
URL (for example, `http://localhost:5000/api`) before starting/building the
client. The default local client API base is `http://localhost:5000/api`.
