# LMS-Platform
AIHustle Learning Management System with Main Admin, College Sub-Admin, and Student portals.

## Client

Run the client from the `client` directory:

```sh
npm install
npm run dev
```

To create a production build, run `npm run build` in the same directory

## Deploy to Vercel

Import the repository with the project root set to the repository root. The
root `vercel.json` builds the Vite client and sends `/api` requests to the
Express serverless function. Configure `MONGO_URI` and `JWT_SECRET` in the
Vercel project's environment variables. Set `CLIENT_ORIGIN` to the deployed
frontend origin; add the other server and client environment variables
required by the features you use. For separate frontend and backend projects,
`client/.env.production` sets the frontend API base URL; override it with
`VITE_API_URL` in Vercel when using a different backend domain. For a combined
deployment, set `VITE_API_URL` to `/api`.

For the current separate deployments, set the frontend Vercel environment
variable `VITE_API_URL` to
`https://lms-platform-v6a7.vercel.app/api` and the
backend Vercel environment variable `CLIENT_ORIGIN` to
`https://lms-platform-kpv2.vercel.app` (no trailing slash). Redeploy both
projects after changing their environment variables.

For a separate backend deployment, create another Vercel project with its root
directory set to `Server`. `Server/vercel.json` routes the backend root and API
requests to the function; `GET /` returns a JSON health response.

For a separate frontend Vercel project, set its root directory to `client`.
`client/vercel.json` forwards `/api/*` to the backend and rewrites frontend
routes to `/index.html` for React Router navigation.

Vercel serverless functions have request-size and execution limits. In
particular, course media uploads may exceed Vercel's request-size limit and
should be uploaded directly to a media provider or served from a separately
hosted backend.
