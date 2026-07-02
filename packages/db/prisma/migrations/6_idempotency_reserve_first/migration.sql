-- 幂等 key 改为“先占位再执行”：response 允许为 NULL 表示请求执行中。
ALTER TABLE "idempotency_keys" ALTER COLUMN "response" DROP NOT NULL;
