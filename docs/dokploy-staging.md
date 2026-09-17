# Dokploy staging control

Rakazo can expose an owner-only, server-side Dokploy control surface. Configure `DOKPLOY_URL` and `DOKPLOY_API_KEY` only in the API/worker environment. The API key is sent as `x-api-key`; it is never returned to browsers, put in URLs, or copied into computer sandboxes.

## Fixed staging policy

- Project: `rakazo-staging`
- Per app: 2 CPU, 4 GB memory, 20 GB disk
- Automatic domains: subdomains beneath `*.staging.getbijou.xyz` only
- Infrastructure: self-hosted Dokploy services only
- Mutations require an owner preview and explicit confirmation

The adapter supports Dokploy Applications and Compose services. Applications are preferred for a single stateless service. Compose is preferred for a full stack with a database, Redis, and named volumes. Environment values are passed server-side. Responses and deployment logs are redacted before they leave the API.

Health verification may target an HTTPS health URL beneath the staging domain. A failed health check reports failure and leaves rollback as a separate previewed action. Rakazo never guesses a rollback deployment. Registry rollback requires an operator-configured self-hosted registry; Docker Swarm automatic rollback requires a service health check and rollback update policy.

No Dokploy project, database, volume, domain, certificate, deployment, or rollback is created merely by enabling these settings.

Sources:

- https://docs.dokploy.com/docs/api
- https://docs.dokploy.com/docs/api/reference-application
- https://docs.dokploy.com/docs/api/reference-compose
- https://docs.dokploy.com/docs/api/reference-deployment
- https://docs.dokploy.com/docs/api/reference-domain
- https://docs.dokploy.com/docs/core/applications/rollbacks
