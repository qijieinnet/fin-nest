-- 基线迁移：启用 PostgreSQL 扩展。
-- citext 用于 users.email / users.account 等大小写不敏感唯一列（见 DATABASE_DESIGN.md）。
-- 该迁移先于 B0 生成的业务表迁移执行（按文件名字典序排序）。
CREATE EXTENSION IF NOT EXISTS citext;
