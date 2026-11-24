#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo '请使用 root 执行'; exit 1; }
source_root=${1:?请提供解压后的源码目录}
source_root=$(realpath "$source_root")
for tool in docker nginx python3 curl; do command -v "$tool" >/dev/null || { echo "缺少 $tool，未修改服务"; exit 1; }; done
docker info >/dev/null
nginx -t
site=$(readlink -f /etc/nginx/sites-enabled/lvce)
[[ -f "$site" ]] || { echo '未找到现有 lvce 站点配置'; exit 1; }
install -d -m 700 /opt/lvce-ai /opt/lvce-ai/backups
install -d -m 700 -o 1000 -g 1000 /opt/lvce-ai/data
backup="/opt/lvce-ai/backups/nginx-$(date +%Y%m%d-%H%M%S).conf"
cp -p "$site" "$backup"
if [[ ! -f /opt/lvce-ai/service.env ]]; then
  read -r -s -p '粘贴 DeepSeek Key（输入不显示；直接回车可稍后配置）: ' provider_key </dev/tty
  echo
  if [[ -n "$provider_key" && ! "$provider_key" =~ ^[A-Za-z0-9_-]{10,4096}$ ]]; then echo 'Key 格式不正确，未部署'; exit 1; fi
  (umask 077; printf 'DEEPSEEK_API_KEY=%s\n' "$provider_key" > /opt/lvce-ai/service.env)
  unset provider_key
fi
chmod 600 /opt/lvce-ai/service.env
# Keep the old image/container until a candidate has passed its local health check.
docker build -f "$source_root/backend/tencent/Dockerfile" -t lvce-ai:candidate "$source_root"
if docker container inspect lvce-ai-check >/dev/null 2>&1; then echo '检测容器已存在，请先检查 lvce-ai-check'; exit 1; fi
# Test a separate database, so a failed candidate cannot modify production data.
check_data=$(mktemp -d /opt/lvce-ai/check.XXXXXX)
chown 1000:1000 "$check_data"
previous_container=''
installed=false
changed_site=false
cleanup(){
  docker rm -f lvce-ai-check >/dev/null 2>&1 || true
  rm -rf "$check_data"
  if [[ "$installed" != true ]]; then
    if [[ "$changed_site" == true ]]; then cp -p "$backup" "$site"; nginx -t && systemctl reload nginx || true; fi
    if [[ -n "$previous_container" ]]; then
      docker rm -f lvce-ai >/dev/null 2>&1 || true
      docker rename "$previous_container" lvce-ai
      docker start lvce-ai >/dev/null
      echo '已恢复安装前的 AI 容器'
    fi
  fi
}
trap cleanup EXIT
docker run -d --name lvce-ai-check --env-file /opt/lvce-ai/service.env -p 127.0.0.1:18787:8787 -v "$check_data:/data" --cap-drop ALL --security-opt no-new-privileges --read-only lvce-ai:candidate >/dev/null
check_ok=false
for ((i=0;i<15;i++)); do
  if curl -fsS --max-time 2 http://127.0.0.1:18787/api/status >/dev/null; then check_ok=true; break; fi
  sleep 1
done
[[ "$check_ok" == true ]] || { echo '新服务本机检查失败，旧服务未修改'; exit 1; }
docker rm -f lvce-ai-check >/dev/null
# Build the config change before stopping any production container.
python3 - "$site" /opt/lvce-ai/nginx.candidate <<'PY'
import re,sys
from pathlib import Path
text=Path(sys.argv[1]).read_text()
marker='# lvce-ai managed route'
if marker not in text:
    match=re.search(r'^\s*server_name\s+kuaitrip\.cn\s+www\.kuaitrip\.cn\s*;',text,re.M)
    if not match: raise SystemExit('站点配置不符合预期，未修改 Nginx')
    route='''
    # lvce-ai managed route
    location ^~ /lvce-ai/ {
        proxy_pass http://127.0.0.1:8787/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 110s;
        proxy_send_timeout 20s;
        proxy_buffering off;
        client_max_body_size 16k;
    }
'''
    text=text[:match.end()]+route+text[match.end():]
Path(sys.argv[2]).write_text(text)
PY
if docker image inspect lvce-ai:current >/dev/null 2>&1; then docker tag lvce-ai:current lvce-ai:previous; fi
had_previous=false
if docker container inspect lvce-ai >/dev/null 2>&1; then
  docker stop lvce-ai >/dev/null
  previous_container="lvce-ai-backup-$(date +%Y%m%d-%H%M%S)"
  docker rename lvce-ai "$previous_container"
  had_previous=true
fi
docker tag lvce-ai:candidate lvce-ai:current
docker run -d --name lvce-ai --restart unless-stopped --env-file /opt/lvce-ai/service.env -p 127.0.0.1:8787:8787 -v /opt/lvce-ai/data:/data --cap-drop ALL --security-opt no-new-privileges --read-only --memory 512m --cpus 1 --pids-limit 128 --log-opt max-size=5m --log-opt max-file=2 lvce-ai:current >/dev/null
production_ok=false
for ((i=0;i<15;i++)); do
  if curl -fsS --max-time 2 http://127.0.0.1:8787/api/status >/dev/null; then production_ok=true; break; fi
  sleep 1
done
[[ "$production_ok" == true ]] || { echo "启动失败，Nginx 未修改。旧容器已保留，是否存在旧容器：$had_previous"; exit 1; }
changed_site=true
cp /opt/lvce-ai/nginx.candidate "$site"
if ! nginx -t; then cp -p "$backup" "$site"; echo "Nginx 校验失败，已恢复配置：$backup"; exit 1; fi
if ! systemctl reload nginx; then cp -p "$backup" "$site"; nginx -t && systemctl reload nginx; echo 'reload 失败，已恢复配置'; exit 1; fi
echo "安装完成。Nginx 配置：$site；备份：$backup"
echo '服务状态（不调用付费模型）：'
curl -fsS --max-time 10 --resolve kuaitrip.cn:443:127.0.0.1 https://kuaitrip.cn/lvce-ai/api/status
echo
installed=true
