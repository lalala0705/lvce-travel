#!/usr/bin/env python3
"""Validate a hidden local key before atomically replacing the deployment env file."""
import getpass
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import warnings


class ConfigurationError(Exception):
    pass


def validate_key(key, opener=urllib.request.urlopen):
    key = key.strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{10,4096}', key):
        raise ConfigurationError('格式不正确：请只复制完整 API Key，不要带引号、Bearer 或说明文字。')
    request = urllib.request.Request('https://api.deepseek.com/models', headers={
        'Authorization': 'Bearer ' + key,
        'User-Agent': 'lvce-key-setup/1.0',
    })
    try:
        with opener(request, timeout=20) as response:
            if response.status != 200:
                raise ConfigurationError('DeepSeek 未通过验证，未修改现有配置。')
    except urllib.error.HTTPError as error:
        if error.code == 401:
            raise ConfigurationError('DeepSeek 返回 401：请在 DeepSeek 开放平台创建新的 API Key 后重试。') from None
        raise ConfigurationError('DeepSeek 返回 HTTP %s，未修改现有配置。' % error.code) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ConfigurationError('无法连接 DeepSeek，未修改现有配置，请稍后再试。') from None
    return key


def atomic_write(path, contents):
    descriptor, temporary = tempfile.mkstemp(prefix='.key-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as target:
            os.fchmod(target.fileno(), 0o600)
            target.write(contents)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def configure(key, source, env_path=Path('/opt/lvce-ai/service.env'), opener=urllib.request.urlopen,
              runner=subprocess.run):
    key = validate_key(key, opener)
    previous = env_path.read_bytes() if env_path.exists() else None
    atomic_write(env_path, ('DEEPSEEK_API_KEY=' + key + '\n').encode('ascii'))
    try:
        print('密钥验证通过，正在应用配置；不会调用付费生成。', flush=True)
        result = runner(['bash', str(source / 'backend/tencent/install.sh'), str(source)], check=False)
        if result.returncode:
            raise ConfigurationError('部署未完成，密钥配置文件已恢复，请发送错误提示。')
    except BaseException:
        if previous is None:
            env_path.unlink(missing_ok=True)
        else:
            atomic_write(env_path, previous)
        raise


def read_hidden_key():
    # getpass opens the controlling terminal as a raw descriptor, or securely uses
    # an available PTY stdin. Text-mode r+ cannot open non-seekable terminals.
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            return getpass.getpass('粘贴新的 DeepSeek API Key（输入不显示），然后回车：')
    except (OSError, getpass.GetPassWarning):
        raise ConfigurationError('无法安全隐藏输入，已停止；不要在 Shell 提示符下粘贴密钥。') from None


def main():
    if os.geteuid() != 0:
        raise ConfigurationError('请使用 root 执行。')
    source = Path(sys.argv[1] if len(sys.argv) > 1 else '/opt/lvce-ai-source').resolve()
    if not (source / 'backend/tencent/install.sh').is_file() or not Path('/opt/lvce-ai').is_dir():
        raise ConfigurationError('未找到现有部署，请先完成服务器安装。')
    key = read_hidden_key()
    configure(key, source)
    print('密钥已验证并应用。请只发送最终状态，不要发送密钥。')


if __name__ == '__main__':
    try:
        main()
    except ConfigurationError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (KeyboardInterrupt, EOFError):
        print('\n已取消。', file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('配置失败，请检查服务器环境；密钥不会显示。', file=sys.stderr)
        sys.exit(1)
