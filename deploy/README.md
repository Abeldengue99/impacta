# IMPACTA pilot deployment templates

These are example Nginx and Apache reverse proxy configurations. They are not
an active deployment. Choose one server, replace the sample domain and paths,
install a valid certificate, and review the target host before enabling it.

## Required shape

- Serve the repository root as static files, but deny access to backend code,
  package files, saved local HTML copies, hidden files, node_modules, and deploy
  templates. The root index forwards visitors to the public home page.
- Terminate HTTPS at the proxy and send /api/v1/ to 127.0.0.1:3001.
- Keep the API bound to loopback. Production startup rejects a public API_HOST
  and trusts forwarded client IP headers only from the local proxy.
- Set FRONTEND_ORIGINS to the exact HTTPS origin and FRONTEND_BASE_URL to the
  public page path, for example https://impacta.example.org/frontend/pages.
- Set PGSSL=true, PGPOOL_MAX from the database connection budget,
  IMPACTA_MEDIA_DIR to a private absolute path outside the document root,
  AUTH_TOKEN_PEPPER (at least 32 random bytes), MFA_ENCRYPTION_KEY
  (32-byte hexadecimal), and all five SMTP variables in the environment or
  secret manager. Do not place production values in this repository.
- Configure PostgreSQL for TLS and use the dedicated impacta_app role.
- Restrict inbound network access to HTTPS (443) and administrative access.
  Do not expose PostgreSQL or API port 3001 publicly.

## Release gate

Both proxy policies allow only same-origin API connections and the two Google
Fonts origins used by the current pages. They disallow inline scripts, objects,
and framing by other sites. Inline styles remain allowed because parts of the
interface set styles at runtime. Review every page on the actual domain before
opening the pilot.

Run npm ci, npm run build, then start the API with the production environment.
The read-only smoke check is npm test; it also verifies that incomplete
production startup settings are rejected. It checks /api/v1/health/live and
/api/v1/health/ready. To check a deployed host, set
IMPACTA_SMOKE_BASE_URL=https://impacta.example.org. Readiness must return 200
before inviting users.

Do not apply the current SQL migrations remotely yet. The current inventory has 34 of 42 SQL scripts
contain explicit loopback-only guards. Keep those safeguards in place until a
reviewed production migration path, verified backup, and restore rehearsal
are approved. A database restore, load test, authenticated end-to-end test, and
independent security review are also still required.