#!/usr/bin/env python3
"""Configure AMap locally without putting private credentials in chat or arguments."""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

spec = importlib.util.spec_from_file_location('key_setup', Path(__file__).with_name('configure-key.py'))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


def validate(values, opener=urllib.request.urlopen):
    if set(values) != {'AMAP_JS_KEY', 'AMAP_WEB_KEY', 'AMAP_SECURITY_CODE'}:
        raise setup.ConfigurationError('地图配置项目不完整，未修改现有服务。')
    clean = {name: value.strip() for name, value in values.items()}
    if not all(re.fullmatch(r'[a-fA-F0-9]{32}', value) for value in clean.values()):
        raise setup.ConfigurationError('格式不正确：每项应为完整的 32 位值，不要附带引号或说明文字。')
    url = 'https://restapi.amap.com/v5/place/text?' + urllib.parse.urlencode({
        'key': clean['AMAP_WEB_KEY'], 'keywords': '公园', 'region': '广州',
        'city_limit': 'true', 'page_size': '1', 'output': 'json',
    })
    try:
        with opener(url, timeout=20) as response:
            value = json.loads(response.read(100000))
        if value.get('status') != '1':
            code = str(value.get('infocode', ''))
            code = code if re.fullmatch(r'\d{5}', code) else '未知'
            raise setup.ConfigurationError('高德 Web 服务 Key 验证失败（代码 ' + code + '），请检查 Key 类型、服务权限和服务器 IP 白名单。')
    except (urllib.error.URLError, OSError, ValueError):
        raise setup.ConfigurationError('无法验证高德服务，请检查网络后重试；现有配置未修改。') from None
    return clean


def configure(values, source, env_path=Path('/opt/lvce-ai/service.env'), opener=urllib.request.urlopen,
              runner=subprocess.run):
    clean = validate(values, opener)
    previous = env_path.read_bytes()
    setup.atomic_write(env_path, setup.merge_environment(previous, clean))
    try:
        print('高德 Web 服务 Key 验证通过；正在应用地图配置，保留 DeepSeek 配置和配额。', flush=True)
        result = runner(['bash', str(source / 'backend/tencent/install.sh'), str(source)], check=False)
        if result.returncode:
            raise setup.ConfigurationError('部署未完成，配置文件已恢复，请发送错误提示。')
    except BaseException:
        setup.atomic_write(env_path, previous)
        raise
    print('地图配置已应用。JS Key 和安全密钥还需在网页中验证白名单及实际地图加载。')


def main():
    if os.geteuid() != 0:
        raise setup.ConfigurationError('请使用 root 执行。')
    source = Path(sys.argv[1] if len(sys.argv) > 1 else '/opt/lvce-ai-source').resolve()
    if not (source / 'backend/tencent/install.sh').is_file() or not Path('/opt/lvce-ai/service.env').is_file():
        raise setup.ConfigurationError('未找到现有 AI 部署，请先完成安装。')
    print('等待每个输入提示后再粘贴对应值。全部隐藏输入；不要在 Shell 提示符下粘贴密钥。', flush=True)
    values = {}
    for name, label in [('AMAP_JS_KEY', 'Web端（JS API）Key'), ('AMAP_SECURITY_CODE', 'JS Key 对应的安全密钥 securityJsCode'), ('AMAP_WEB_KEY', 'Web服务 Key')]:
        values[name] = setup.read_hidden_key('粘贴' + label + '（输入不显示），然后回车：')
    configure(values, source)


if __name__ == '__main__':
    try:
        main()
    except setup.ConfigurationError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (KeyboardInterrupt, EOFError):
        print('\n已取消，未继续部署。', file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('地图配置未完成，密钥不会显示，请检查部署环境。', file=sys.stderr)
        sys.exit(1)
