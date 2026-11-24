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

## 更新无效或过期的 Key

在服务器交互终端运行 `python3 backend/tencent/configure-key.py "$PWD"`。输入会隐藏，去除首尾空格后，仅向固定 `https://api.deepseek.com/models` 验证授权，不调用付费生成。验证不通过不修改现有文件；通过后以 0600 权限原子保存并运行部署脚本应用配置。应用失败恢复原配置文件。不要在命令参数、聊天或截图中填写 Key。

密钥更新工具验证：`python3 -m unittest discover -s backend/tencent -p 'test_*.py'`。

## 高德地图

在高德控制台准备三个值：Web端（JS API）Key、该 Key 对应的安全密钥 securityJsCode、Web服务 Key。JS Key 域名白名单允许 `lalala0705.github.io`；若 Web 服务 Key 设置 IP 白名单，允许这台服务器的实际公网出口 IP。服务权限和用量以高德控制台为准，不自动购买授权。

从仓库最新代码启动 `python3 backend/tencent/configure-maps.py "$PWD"`，等每个隐藏输入提示出现再粘贴对应值。工具先验证 Web 服务 Key 的 POI 搜索，再合并配置并部署，保留 DeepSeek Key；JS Key 和安全密钥需在网页实际加载后验证。若仍显示 Shell 提示符或报错，不要粘贴密钥。

环境变量为 `AMAP_JS_KEY`、`AMAP_SECURITY_CODE`、`AMAP_WEB_KEY`。只有 JS Key 通过 `/api/maps/config` 返回给指定网页 Origin，另两项不返回。`/api/maps/search` 支持城市文本与自愿提交 GPS 的周边搜索；GPS 通过高德转换为 GCJ-02 后查询。`/api/maps/route` 支持步行/驾车。`/_AMapService/` 只代理列明的 SDK 地图样式、行政区、地理编码和地点相关路径，目标为固定高德域名。

接口配额与 AI 独立持久保存。REST 每天 1000 次、每 IP 每小时 60 次；SDK 代理每天 2000 次、每 IP 每小时 300 次。无请求正文或精确位置日志。候选地点、GPS 不在服务器长期保存；POI 信息只有用户确认保存后才进入本机旅行记录。前端按需加载地图，SDK 和地图瓦片请求仍由高德处理。
