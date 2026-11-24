# 腾讯云轻量服务器部署

现有 Nginx 和 HTTPS 保留；AI 容器监听 `127.0.0.1:8787`，挂载持久 SQLite 数据目录。仅公开 `/lvce-ai/api/status` 和 `/lvce-ai/api/generate`，映射到后端 `/api/*`。不提供网页密钥管理，也不依赖 ChatGPT Sites 身份或托管。

DeepSeek Key 通过服务器本地隐藏输入写入 `/opt/lvce-ai/service.env`（root:root 0600），不要提交到仓库或聊天。用量限额固定为北京时间每日 20 次和每个 IP 每小时 3 次；请求失败也消耗试用次数，不自动重试。数据目录包含加密密钥和配额，必须保留，不能通过重建容器重置额度。容器只有 Nginx 能通过主机端口访问，Nginx 必须覆盖 `X-Real-IP`。

`install.sh` 需 root 执行，参数为解压后的源码根目录。安装脚本校验 Docker、端口、Nginx 配置；备份当前站点；构建容器；只添加独立 `/lvce-ai/` 路由；通过 `nginx -t` 后 reload。旧网页、8000 端口和数据库不变。重复运行更新现有容器，复用配置、Key 和数据；不拉取或执行远端脚本。

```bash
bash backend/tencent/install.sh "$PWD"
```

确认 `https://kuaitrip.cn/lvce-ai/api/status` 返回 `ready:true` 后，才可将前端 `AI_BASE` 设置为 `https://kuaitrip.cn/lvce-ai`。安装完成不自动修改 GitHub Pages。未配置 Key 时可先启动验证连通性，状态为 `ready:false`。

备份位于 `/opt/lvce-ai/backups`。回退 Nginx：将对应备份复制回脚本报告的实际配置文件，执行 `nginx -t && systemctl reload nginx`。回退容器：`docker rm -f lvce-ai` 后使用安装前保留的 `lvce-ai:previous` 镜像和相同 env/volume/端口重新启动。若安装前无容器，直接移除新容器即可；不要删除 `/opt/lvce-ai/data`。

腾讯云防火墙只需沿用 80/443，不要开放 8787。备案和 HTTPS 证书有效性需由域名管理员确认。脚本不调整旧 PostgreSQL 公网端口或旧服务。
