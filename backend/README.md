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
