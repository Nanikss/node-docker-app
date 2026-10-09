# node-docker-app

[![CI](https://github.com/Nanikss/node-docker-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Nanikss/node-docker-app/actions/workflows/ci.yml)

A small URL-shortener API, packaged and run the way I'd want a production service to be: a hardened container image, health and readiness probes, Prometheus metrics, structured logs, graceful shutdown, infrastructure in Terraform, and a CI pipeline that tests, builds, smoke-tests and publishes the image, with deploys to AWS EC2 behind a manual gate.

**Stack:** Node.js 20 · Express · PostgreSQL · Docker · Terraform (AWS EC2) · GitHub Actions · Jest.

## History

I started this repo in 2025 as a Docker + EC2 exercise: a hello-world `http` server, a basic Dockerfile, and a workflow that SSH'd into a hard-coded instance and ran `docker build` on every push. That history is kept. I later rebuilt it into a production-style service: the app is now worth deploying, the image is built once in CI and promoted by tag, and the server is created by Terraform instead of by hand.

## Architecture

```
 push / PR ──> GitHub Actions CI ──> lint + tests ──> docker build ──> smoke test ──> GHCR
                                                                                        │ image:<sha>
 manual "Deploy" workflow ──ssh──> EC2 (Amazon Linux 2023, Terraform)                   │
                                     └─ scripts/deploy.sh ── docker pull <────────────────┘
                                          candidate on :3001 ─/readyz ok─> swap onto :80

 client ──:80──> container :3000 ── Express app ── store ──> in-memory (default)
                                        │                └─> PostgreSQL (DATABASE_URL)
                                        └─ /healthz /readyz /metrics, JSON logs to stdout
```

API:

| Method | Path | Result |
|---|---|---|
| `POST` | `/api/links` | `{"url": "...", "alias": "optional"}` → 201 with `code` and `shortUrl`; 400 on invalid URL/alias; 409 if the alias is taken |
| `GET` | `/:code` | 302 to the target URL and increments the hit counter; 404 if unknown |
| `GET` | `/api/links/:code` | link stats (`url`, `hits`, `createdAt`) |

## What makes it production-ready

- **Liveness and readiness are separate.** `/healthz` only says the process is up. `/readyz` also pings the database and returns 503 during shutdown, so a deploy or load balancer can stop sending traffic without anything restarting the container.
- **Graceful shutdown.** On SIGTERM/SIGINT the service marks itself not ready, stops accepting connections, closes idle keep-alive sockets, waits for in-flight requests, closes the DB pool and exits 0. If draining takes longer than `SHUTDOWN_TIMEOUT_MS` (8s, under Docker's 10s kill), it force-closes and exits 1. Requests in flight during a deploy finish instead of being cut off.
- **Metrics.** `/metrics` exposes Prometheus default process metrics plus `http_request_duration_seconds`, labelled by route *template* (`/api/links/:code`), method and status, so label cardinality stays bounded.
- **Structured logs.** One JSON line per request (pino) with a request id, taken from `X-Request-Id` when valid, otherwise generated, and returned in the response header. Logs go to stdout for Docker to collect, with log rotation set on the container.
- **Config validated at startup.** `PORT`, `LOG_LEVEL`, `DATABASE_URL`, `PUBLIC_BASE_URL` and `SHUTDOWN_TIMEOUT_MS` are checked before the server starts. A bad value fails the boot with every problem listed (the DB URL is never echoed), so a broken deploy fails the readiness gate instead of failing on the first request.
- **Storage behind an interface.** In-memory by default (tests, quick runs), PostgreSQL when `DATABASE_URL` is set. The schema (`db/schema.sql`) is idempotent and applied on boot.
- **Hardened image.** Multi-stage build, `npm ci --omit=dev` from the lockfile, runs as the non-root `node` user with code files it can't modify, `NODE_ENV=production`, a `HEALTHCHECK`, and exec-form `CMD` so Node is PID 1 and actually receives SIGTERM.
- **Safer EC2 host.** Security group opens 80 to the world and 22 only to `ssh_cidr`; IMDSv2 required; encrypted root volume; AMI resolved from the AWS SSM parameter rather than hard-coded.

## Run locally

```bash
npm install
npm start                                   # http://localhost:3000, in-memory store
curl -X POST localhost:3000/api/links -H 'Content-Type: application/json' -d '{"url":"https://example.com"}'

docker compose up --build                   # app + Postgres 16, app waits for a healthy DB
```

Configuration (all optional): `PORT` (3000), `LOG_LEVEL` (info), `DATABASE_URL` (unset = in-memory), `PUBLIC_BASE_URL` (used in `shortUrl`), `SHUTDOWN_TIMEOUT_MS` (8000).

## Deploy

1. **Infrastructure.** With AWS credentials in your shell (profile or SSO, nothing stored in the repo):
   ```bash
   cd infra
   cp terraform.tfvars.example terraform.tfvars   # set ssh_cidr and key_name
   terraform init && terraform apply
   ```
   This creates the security group and a `t3.micro` in `ap-south-1`. On first boot `user_data` installs Docker and runs the image (80 → 3000, `--restart unless-stopped`). Outputs: `public_ip` and `url`. The GHCR package must be public, or the host must `docker login ghcr.io`.
2. **Releases.** Add the repo secrets `EC2_HOST` (the `public_ip` output) and `EC2_SSH_KEY` (the key pair's private key), then run the **Deploy** workflow by hand with an image tag (the short SHA CI pushed). It copies `scripts/deploy.sh` to the host and runs it: pull, start a candidate on port 3001, wait for `/readyz`, swap it onto port 80, and put the old image back if the new one fails there. `rollback: true` returns to the previous image. Without the secrets, the workflow stops with a notice.

On a single instance the swap means a few seconds without a listener on port 80. Zero-downtime needs two targets behind a load balancer (see next steps).

## CI pipeline

`.github/workflows/ci.yml`, on every push to `master` and every PR:

- **test**: Node 20, `npm ci`, `npm run lint`, `npm test`.
- **image** (after test): Buildx build with layer cache, then a smoke test against the real container: `/healthz`, `/readyz`, create and follow a link, check `/metrics`, check it runs as `node`, and `docker stop` it to prove SIGTERM gives exit code 0. On `master` only, it pushes `ghcr.io/<owner>/node-docker-app:<short-sha>` and `:latest` using `GITHUB_TOKEN`.
- **terraform**: `fmt -check`, `init -backend=false`, `validate`.

Deploys are a separate, manual workflow (`deploy.yml`). A push never touches the server.

## Tests

```bash
npm test     # 43 tests, Jest + supertest
npm run lint
```

They cover link creation and validation, alias conflicts (409), code-collision retries, redirect plus hit counting, 404s, request ids, `/healthz` and `/readyz` (including 503 when the DB is down and during shutdown), the metrics histogram labels, config validation, the Postgres row and error mapping (with a fake pool), and graceful shutdown. The shutdown tests inject the request handler, so they control exactly when an in-flight request finishes and assert that the process waits for it, without sleeping.

## Layout

```
src/server.js         entrypoint: config, wiring, signal handlers
src/app.js            Express app factory (routes, error handling); dependencies injected
src/shutdown.js       connection tracking and graceful drain with timeout
src/config.js         env parsing and fail-fast validation
src/logger.js         pino logger and request-id middleware
src/metrics.js        prom-client registry and request duration histogram
src/links.js          URL/alias validation, short-code generation
src/store/            memory and Postgres stores behind one interface
db/schema.sql         links table
infra/                Terraform: security group, EC2, user_data, outputs
scripts/deploy.sh     on-host release with readiness gate and rollback
.github/workflows/    ci.yml (test, image, terraform), deploy.yml (manual)
```

## Interview notes

- **Liveness vs readiness:** liveness failing means "restart me", readiness failing means "don't send me traffic". Checking the database in liveness would restart healthy containers during a DB blip, so only readiness checks it.
- **SIGTERM in containers:** `docker stop` (and ECS/Kubernetes) sends SIGTERM, then SIGKILL after a grace period. That only works if Node is PID 1 (exec-form `CMD`, not `npm start`) and handles the signal by draining, with its own timeout shorter than the platform's.
- **Non-root and multi-stage:** the runtime image has no dev dependencies or npm cache, and a compromised process has no root inside the container and can't rewrite its own code. The app listens on 3000 and the host maps 80 to it.
- **Manual deploy gate:** CI builds one immutable image per commit; deploying is a separate, deliberate step that promotes a tag, with a readiness check and a rollback path. Rebuilding on the server, as the 2025 version did, means what runs was never tested.
- **Next steps:** move to ECS Fargate or EKS for rolling deploys; put an ALB with an ACM certificate in front for HTTPS and zero-downtime swaps; keep `DATABASE_URL` in SSM Parameter Store or Secrets Manager; replace SSH with SSM Run Command (GitHub-hosted runners have changing IPs, so `ssh_cidr` is awkward); store Terraform state in S3 with locking.

Built with AI coding tools; I designed the deployment and operational behaviour, and reviewed and tested the code.
