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

Run the seed once and then start the API:

```sh
npm install
npm run seed:admin
npm run dev
```

The script creates the `admin` username with role `admin`, status `active`, and
wildcard administrative permissions. It hashes the password with bcryptjs and
does not replace or duplicate an existing `admin` account. The login API accepts
the account through the common sign-in form; there is no public admin
registration endpoint.

## Public registration

The client submits user and instructor applications to `POST /api/auth/register`.
User registration creates an active `student` account. Instructor registration
creates an instructor account with `status: pending`; the existing login route
refuses pending instructors until an administrator approves them. Public
registration does not accept the admin role.

The request includes `fullName`, `email`, `username`, `password`,
`confirmPassword`, and `role` (`user` or `instructor`). Instructor requests also
include `professionalDetails`. Passwords are hashed before they are stored.
Successful creation returns HTTP 201; invalid input returns 400 and duplicate
email or username returns 409.

Run the backend with `npm run dev`, then use the client’s Create account form.
For a separately hosted client, set `VITE_API_BASE_URL` to the backend API base
URL (for example, `http://localhost:5000/api`) before starting/building the
client. The default local client API base is `http://localhost:5000/api`.
