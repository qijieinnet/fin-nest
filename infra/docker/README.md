# Docker 部署

Fin Nest 的容器化打包与编排说明。根目录 `Dockerfile` 为多阶段多目标，可单独构建每个服务；`infra/compose/docker-compose.prod.yml` 提供整栈一键部署。

## 镜像目标（单独打包）

一个 `Dockerfile`，四个运行目标，全部通过环境变量注入配置（镜像内不含机密）：

| target    | 说明                              | 端口 | 启动命令                          |
| --------- | --------------------------------- | ---- | --------------------------------- |
| `api`     | NestJS API                        | 4000 | `node dist/main.js`               |
| `worker`  | 常驻后台任务进程                  | —    | `node dist/main.js`               |
| `web`     | Next.js 站点（standalone）        | 4001 | `node apps/web/server.js`         |
| `migrate` | 一次性执行数据库迁移后退出        | —    | `prisma migrate deploy`           |

单独构建：

```bash
# 在仓库根目录执行
docker build --target api     -t fin-nest-api:latest     .
docker build --target worker  -t fin-nest-worker:latest  .
docker build --target migrate -t fin-nest-migrate:latest .
# web 的 NEXT_PUBLIC_* 在构建期内联，如需自定义用 --build-arg：
docker build --target web -t fin-nest-web:latest \
  --build-arg NEXT_PUBLIC_API_BASE_URL=/api .
```

单独运行（示例，环境变量按需传入）：

```bash
# 先迁移（对已有数据的库安全，只应用未执行的迁移）
docker run --rm -e DATABASE_URL="postgresql://user:pass@db-host:5432/finnest?schema=public" \
  fin-nest-migrate:latest

# 再跑 API
docker run -d --name fin-nest-api -p 4000:4000 \
  -e DATABASE_URL="postgresql://user:pass@db-host:5432/finnest?schema=public" \
  -e WEB_ORIGIN="https://your-domain" \
  -e MINIO_ENDPOINT=minio-host -e MINIO_ACCESS_KEY=... -e MINIO_SECRET_KEY=... \
  fin-nest-api:latest
```

## 整栈部署（Compose）

一并部署内置 PostgreSQL + MinIO + 迁移 + api + worker + web：

```bash
cp .env.docker.example .env.docker      # 修改密码、域名等
docker compose -f infra/compose/docker-compose.prod.yml --env-file .env.docker up -d --build
# 浏览器访问 http://<host>:4001
```

启动顺序由 compose 编排：`postgres` 就绪 → `migrate` 应用迁移并退出 → `api` / `worker` 启动 → `web` 启动。

常用命令：

```bash
docker compose -f infra/compose/docker-compose.prod.yml --env-file .env.docker ps
docker compose -f infra/compose/docker-compose.prod.yml --env-file .env.docker logs -f api
docker compose -f infra/compose/docker-compose.prod.yml --env-file .env.docker down      # 停止，保留数据卷
```

## 数据安全

- 内置 postgres 的数据存于命名卷 `pgdata`，`down` **不会**删除数据；只有显式 `down -v` 才会删卷。
- 数据库迁移一律走 `prisma migrate deploy`（`migrate` 服务 / `migrate` 镜像），**只应用未执行的迁移，绝不重置或清空已有数据**。对接一个已有数据的库同样安全。

## 使用外部数据库 / 对象存储

在 `.env.docker` 中：

1. 置空 `COMPOSE_PROFILES=`（不启动内置 postgres / minio）。
2. 把 `DATABASE_URL` 指向外部库，`MINIO_*` 指向外部 S3/MinIO。

再执行相同的 `up -d`。此时 compose 只启动 `migrate` / `api` / `worker` / `web`，迁移会作用到你的外部库（安全，不清数据）。

## 反向代理（可选）

`web` 已在容器内把 `/api` 转发到 `api` 服务，因此对外只需暴露 `web`（4001）即可同源访问。若需统一域名 / TLS，可在前面再加 nginx，见 `infra/nginx/fin-nest.conf.example`。
