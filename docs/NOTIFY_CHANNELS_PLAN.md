# 推送渠道整合（飞书 + Web Push）

> 状态：**已实施**。本文记录设计取舍与踩点，实现细节以代码为准；日常查阅入口仍是 [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) 的「提醒推送」与「Web Push / PWA 通知」两节。

## 1. 要解决什么

改造前只有飞书一条推送通道，且 `reminder_targets` 挂的是**飞书绑定 id**。这带来两个问题：

1. **配置粒度错位**。界面上让用户选「张三的飞书」，但他心里想选的是「张三」。同一个人绑过两个飞书号就会在列表里出现两次。
2. **加一条渠道要动所有表单**。订阅档位、保单档位、自动记账规则、记账提醒四处各有一列「推送飞书」多选，新增 Web Push 就得再加四列同形态的多选，且两列之间的语义关系（都选了会不会重复推？）没人说得清。

同时，iPhone 上的实际诉求是「PWA 装到主屏后能收到提醒」，而这条通道与飞书是并列关系，不是替代关系。

## 2. 选的口径：按「人」挂，渠道由接收人自己决定

`reminder_targets` 改存 `user_id`。配置者只回答**推给谁**；走飞书还是 Web Push，由接收人自己在「更多 › 通知」里的两个账号级开关（`users.notify_feishu` / `notify_web_push`）决定。

被否掉的另一个口径是「端点粒度」——把 `reminder_targets` 泛化成 `(channel, target_id)`，选择器里列出「张三 · 飞书」「张三 · iPhone」「张三 · Mac Chrome」。它的致命伤是 **Web Push 订阅是按设备的**：换台手机就在每个订阅档位里留一个死目标，列表越堆越长，而用户根本没有维护它的心智。

按人挂的代价是**账本管理员失去细粒度控制**——没法配「这一档只推飞书、不推手机」。这是有意接受的：渠道选择权本来就该在接收人手里。真需要时可以给 `reminder_targets` 加一个可选的 `channel_mask`，默认跟随用户偏好，但在有人真正提出之前不做。

### 意外收获：跨渠道互斥天然成立

`occurrence_key` 既不含收件人也不含渠道（只到「哪个对象的哪一轮提醒的哪一档」），而动作抢占正是按它做的。于是**同一次提醒在飞书点还是在 iPhone 通知里点，只会生效一次**，一行额外代码都不用写。如果做成两条独立渠道，这块反而要专门对齐。

## 3. 数据模型

| 表                         | 变化                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `users`                    | + `notify_feishu` / `notify_web_push`（均默认 true，老用户升级后行为不变）                                          |
| `push_subscriptions`（新） | 按设备一行：`user_id` / `endpoint`(唯一) / `p256dh` / `auth` / `device_label` / `last_success_at` / `failure_count` |
| `reminder_targets`         | + `user_id`；删 `channel`、`feishu_binding_id`；唯一约束改 `(source_type, source_id, user_id)`                      |
| `notifications`            | `channel` 放行 `webpush`；`dedupe_key` 加入渠道段                                                                   |

迁移是 `48_notify_channels`，在同一个事务里把旧的 `feishu_binding_id` 按绑定表翻译成 `user_id`、合并同一个人的重复行，并把历史 `dedupe_key` 改写成新格式（不改写的话，今天已发过的飞书提醒会因为 key 变了再发一次）。

`push_subscriptions` **不进系统备份的排除名单**（即正常备份与恢复）。它有指向 `users` 的外键，恢复时本来就会被清空；正常备份能让「恢复到某个快照」保住当时的订阅，而快照之后新增的订阅由前端每次启动的重新登记补回来。

## 4. 关键实现点

- **`NotificationTargetsResolver`**（`packages/backend/notifications`）是枢纽：userId[] → `[{channel, targetRef}]`。新增一条渠道只需在这里多拼一段，业务表单、DTO、前端选择器一律不动。
- **展开口径按渠道不同**：飞书按每条生效绑定各出一条 notification；Web Push 一人只出一条（`target_ref = userId`），多台设备在**发送时**才展开。反过来做的话，用户新装一台设备就会让同一条提醒重发一遍，而且 `dedupe_key` 会随设备增减而漂移。
- **成功判据是「至少一台设备收到」**。某人三台设备里有一台早就失效，不该因此把整条推送判失败再重试三轮——另外两台会被重复投递。
- **`dispatchPending` 按行渠道判定可用性**。改造前是 `if (!feishu.enabled) return`，整合后必须按行；不然只开 Web Push 的部署整个推送系统是哑的。这是本次改造最容易漏、且症状最像「代码没生效」的一处。
- **动作执行统一在 `NotificationActionsService`**（api 的 `modules/notifications`），飞书卡片回调与 Web 落地页共用。两边各写一份必然会漂移成「一边能点一边不能点」。

## 5. iOS / PWA 的硬约束

这些不是本项目的选择，是平台规则，记在这里省得每次重新查：

- **必须「添加到主屏幕」并从主屏图标打开**。Safari 标签页里 `window.Notification` 根本不存在，订阅不了。
- **必须是有效证书的 HTTPS**。自签名不行；iPhone 上没有 localhost 例外，真机验证只能在真域名上做。
- **VAPID subject 必须是 `mailto:` 或 `https://`**。其它格式 `web.push.apple.com` 直接 403，且错误信息不指向原因。
- **每条推送必须弹出可见通知**。静默推送会被浏览器撤销推送权限。
- **通知上的动作按钮不支持**（`showNotification` 的 `actions` 被 Safari 忽略）。这就是 `/n/{id}` 落地页存在的全部理由。
- **订阅会静默失效**：删掉主屏图标再装回来、系统清理、长期不用。服务端遇到 404/410 当场删行，前端每次启动重新登记做自愈。
- 不需要 Apple 开发者账号、证书或上架——Apple 只是把标准 Web Push 转成 APNs，服务端侧完全是 RFC 8030。

## 6. 部署

```bash
pnpm gen:vapid   # 生成三个环境变量，写进 .env / .env.docker
```

`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` 三者要么都配、要么都不配（只配一半会在启动时报错，因为静默禁用会让人以为「代码没生效」）。api 与 worker **都要拿到**：worker 负责到点投递，api 负责下发公钥与发测试通知。

密钥生成一次后**不要更换**：`applicationServerKey` 是订阅的一部分，换了等于让所有已存在的订阅静默作废，而用户毫无察觉。

公钥由 api 在运行时通过 `GET /notifications/settings` 下发，**刻意不走 `NEXT_PUBLIC_`**——那是编译期内联的，而镜像构建时还不知道部署方的密钥。

## 7. 验证清单

自动化能覆盖的部分在 `pnpm e2e:api` 的 `assertNotificationChannels`：候选接收人的范围与越权、渠道开关的读写与对 `channels` 的影响、订阅 upsert 与退订、落地页的读取鉴权、动作 ↔ sourceType 校验、动作幂等（第二次返回 `already`）。

真机部分只能手工，且**必须在有真证书的部署环境上做**（本地 `localhost` 验不出 iOS 的行为）：

1. iPhone Safari 打开站点 → 分享 → 添加到主屏幕 → **从主屏图标打开**。
2. 更多 › 通知 → 开启本机通知（应弹出系统授权框）。
3. 「发送测试通知」→ 锁屏应收到。
4. 把自己设为某条订阅提醒的接收人，等 worker 到点，确认收到并能点进落地页完成动作。
5. 删掉主屏图标再装回来 → 旧订阅应在下一次推送时被 410 清掉，重新开启后恢复。
