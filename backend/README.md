# 旅策 AI 服务

入口：`worker/index.js`。共享请求和结果验证器：`../dist/ai-schema.js`。

构建：在主仓库运行 `npm --prefix backend run build`，输出无依赖 Worker ESM：`backend/dist/server/index.js`。

Sites 托管配置：`.openai/hosting.json` 中 `d1: "DB"` 声明 D1 绑定；`drizzle/` 中的不可变迁移由部署系统应用。不要在请求处理时建表。

运行时 Secret：`ENCRYPTION_KEY`（随机 32 字节 Base64）、`ADMIN_EMAIL`（已确认的管理员邮箱）、可选 `AI_DAILY_LIMIT` 和 `AI_HOURLY_IP_LIMIT`。不要将真实值提交到 GitHub。

API：

- `GET /api/status`：公开、不含密钥的服务状态。
- `POST /api/generate`：校验来源、输入、重复提交、配额后调用固定 DeepSeek API。
- `GET /admin`：使用平台管理的 ChatGPT 登录，仅允许管理员访问密钥配置表单。
- `POST /api/admin/key`：同源且管理员身份下验证、加密保存 Key；响应不含 Key。

生成接口不要求网页用户登录，但使用 D1 原子 UPSERT 限制全站日请求量。Origin 不是身份凭证，勿将其作为唯一的费用保护。用户取消后，已到达模型的请求仍可能计费。后端不保存用户行程或模型完整响应。

密钥配置使用平台注入的认证用户信息与服务端管理员白名单；不能信任公网绕过 Sites dispatcher 直接向 Worker 注入认证头。迁移到其他托管平台时需重新实现可信管理员认证。
