# IMPACTA Admin Area: scope and architecture proposal

## Objective

Build a usable administration area for IMPACTA with access controlled by role and resource scope. The admin frontend will be a separate section of the existing web frontend. The API will use Node.js, TypeScript, and Fastify. It will not use PHP.

This document and the SQL file beside it are proposals. They do not create tables or connect to a database. Review the model and create the accepted schema in PostgreSQL before connecting application data.

No implementation can honestly guarantee zero bugs or zero successful attacks. This design reduces exposure with layered controls, least privilege, safe defaults, and reviewable operations.

## Admin capabilities

| Area | Administrator capabilities |
| --- | --- |
| Overview | View live counts and queues the signed-in admin may see. Show an unavailable state until data is connected; do not invent metrics. |
| Users | Search and filter accounts, inspect necessary profile data, suspend and restore accounts, start account closure or privacy workflows, assign only permitted roles, and inspect relevant account history. |
| Roles and permissions | Use a fixed permission catalogue and role matrix. Admins cannot grant permissions they do not hold. Super-admin bootstrap is not a routine UI action. |
| Communities | Review details, membership, and status; manage membership and settings within assigned scope. |
| Projects and challenges | Review submissions and participation; change lifecycle state using recorded reasons and allowed transitions. |
| Content moderation | Review posts, comments, and media; hide, restore, or remove content with a reason and an audit entry. |
| Reports and appeals | Triage reports, assign or resolve them, record outcomes, and process appeals with a traceable decision history. |
| Announcements | Draft, preview, schedule, publish, expire, and archive platform announcements. |
| Recognition | Manage badges and point adjustments through a reasoned ledger; do not overwrite earned history. |
| Privacy requests | Track access, correction, export, and closure requests with restricted visibility and recorded status changes. |
| Admin security | Require MFA for privileged accounts; let admins inspect and revoke their own sessions. Permit controlled session revocation by authorized security staff. |
| Audit | Search permitted audit records and export them only with a separate permission. Never expose credentials, password hashes, MFA secrets, session tokens, or recovery codes. |
| Settings | Edit validated, non-secret platform settings. Keep secrets in deployment secret storage. |

## Roles and scope

- member: standard platform account.
- support_agent: limited account lookup and support workflows.
- moderator: content, reports, appeals, and related actions.
- community_manager: community operations limited to explicitly assigned communities.
- platform_admin: platform operations from the permission catalogue, excluding super-admin bootstrap.
- super_admin: emergency/bootstrap identity with tightly restricted assignment and use.

Permissions are separate from role names. API authorization denies by default and checks both the action and target resource scope. Hiding a button in the frontend is not authorization.

The first privileged account must be provisioned through a one-time operator-controlled bootstrap after the service is configured. Never seed a shared/default password or provide a super-admin creation action in the routine interface.

## Application structure

- Keep the current static frontend conventions and add admin pages under frontend/pages/admin/.
- Put admin styles and behavior in dedicated files.
- Add a Node.js and TypeScript service under backend/, with versioned REST endpoints under /api/v1.
- Organize API code by authentication, users, permissions, communities, projects, moderation, announcements, privacy, and audit.
- Validate request and response shapes with static JSON Schemas. Use parameterized database queries through a single validated data access boundary.
- Serve the frontend and API on one origin through a reverse proxy where possible. Otherwise use an exact CORS allowlist. Never combine credentialed requests with wildcard origins.
- Until the approved schema and connection exist, show that live data actions are unavailable. Do not show fabricated accounts or operational counts.

## Security requirements

### Identity and sessions

- Store passwords using Argon2id with parameters reviewed against deployment hardware. Never store plaintext or reversible passwords.
- Use generic sign-in and password-reset responses to reduce account enumeration.
- Require MFA for all admin roles. Encrypt TOTP secrets with a key held outside PostgreSQL; store recovery codes only as one-way hashes.
- Generate high-entropy opaque session tokens and store only token hashes. Use cookies with HttpOnly, SameSite=Strict, Path=/, no Domain, and Secure in production.
- Rotate sessions after sign-in, privilege changes, and MFA changes. Enforce idle and absolute expiry, revocation, CSRF protection, and rate limits.
- Re-authenticate for sensitive actions such as changing roles, exporting audit data, or revoking other users' sessions.

### Authorization and input handling

- Deny by default. Check permissions and resource scope on every API request, including reads and bulk operations.
- Verify access to each requested record to prevent insecure direct object references.
- Validate inputs and outputs at the API boundary. Bound pagination, uploads, text length, filter complexity, and export size.
- Use parameterized SQL. Never build SQL from user-supplied values or identifiers.
- Keep CORS, trusted proxy configuration, content security policy, and security headers explicit. Trust forwarded headers only from configured proxy addresses.
- Use CSRF tokens for cookie-authenticated changes. Escape untrusted browser content and use a restrictive content security policy.

### Operations and data

- Do not commit secrets, production data, or generated credentials. Load secrets from deployment configuration or a secret manager.
- Use TLS in production and keep PostgreSQL private to the application network.
- Use a dedicated database role with only required schema/table privileges. The application must not use a PostgreSQL superuser or schema owner.
- Keep audit records with actor, action, target, timestamp, and reason. Restrict access and updates. Sanitize logs and exclude credentials and unnecessary personal data.
- Encrypt backups and periodically verify restores. Define retention and account-closure handling before production.
- Pin and review dependencies, apply security updates, and run security checks before production releases.

## API outline

All routes require authentication unless explicitly identified as public. Admin routes require the named permission and scope.

- GET /api/v1/admin/overview — permitted dashboard metrics.
- GET /api/v1/admin/users and GET /api/v1/admin/users/{id} — scoped account lookup.
- POST /api/v1/admin/users/{id}/suspensions and DELETE /api/v1/admin/users/{id}/suspensions/{suspensionId} — reasoned suspend and restore.
- PUT /api/v1/admin/users/{id}/roles — grant or revoke only roles the actor may manage.
- GET /api/v1/admin/communities and /api/v1/admin/projects — scoped operational lists.
- GET /api/v1/admin/reports and POST /api/v1/admin/reports/{id}/decisions — report decisions with audit reasons.
- GET /api/v1/admin/moderation/queue and POST /api/v1/admin/moderation/actions — content actions.
- GET and POST /api/v1/admin/announcements — announcement lifecycle.
- GET /api/v1/admin/privacy-requests and POST /api/v1/admin/privacy-requests/{id}/transitions — privacy workflow.
- GET /api/v1/admin/audit-events — permissioned audit search.
- GET /api/v1/admin/sessions and DELETE /api/v1/admin/sessions/{id} — controlled session management.

Finalize routes and transitions with the page flows before implementation.

## Delivery sequence

1. Review this scope and impacta-v1.sql.
2. Adjust and accept the model, then create it in the user's PostgreSQL environment.
3. Implement the admin API and screens against the accepted schema, initially without production credentials.
4. Add security controls, accessible loading/empty/error states, and permission-scoped interactions.
5. Connect only after the database exists and deployment secrets and network configuration are supplied.
6. Verify integrated workflows and security behavior before production use.

## Reference material

- Fastify request validation and serialization: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- Fastify proxy configuration: https://fastify.dev/docs/latest/Reference/Server/
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- PostgreSQL identity columns: https://www.postgresql.org/docs/current/ddl-identity-columns.html
- PostgreSQL CREATE TABLE reference: https://www.postgresql.org/docs/17/sql-createtable.html
