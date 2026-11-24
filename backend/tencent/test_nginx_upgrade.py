from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

INSTALLER = Path(__file__).with_name('install.sh').read_text()
TRANSFORM = INSTALLER.split("<<'PY'\n", 1)[1].split('\nPY\n', 1)[0]

class NginxUpgradeTests(unittest.TestCase):
    def transform(self, source):
        with tempfile.TemporaryDirectory() as directory:
            original, candidate = Path(directory) / 'site', Path(directory) / 'candidate'
            original.write_text(source)
            run = subprocess.run([sys.executable, '-c', TRANSFORM, str(original), str(candidate)], capture_output=True, text=True)
            return run.returncode, candidate.read_text() if candidate.exists() else ''

    def test_new_route_keeps_existing_site_and_certificate(self):
        original = 'server {\n server_name kuaitrip.cn www.kuaitrip.cn;\n ssl_certificate /existing/fullchain.pem;\n location /old/ { client_max_body_size 16k; }\n}\n'
        code, result = self.transform(original)
        self.assertEqual(code, 0)
        self.assertIn('client_max_body_size 64k;', result)
        self.assertIn('location /old/ { client_max_body_size 16k; }', result)
        self.assertIn('ssl_certificate /existing/fullchain.pem;', result)

    def test_upgrade_changes_only_managed_request_size(self):
        original = '''server {
 server_name kuaitrip.cn www.kuaitrip.cn;
 # lvce-ai managed route
 location ^~ /lvce-ai/ {
   proxy_pass http://127.0.0.1:8787/;
   client_max_body_size 16k;
 }
 location /old/ { client_max_body_size 16k; }
}
'''
        code, result = self.transform(original)
        self.assertEqual(code, 0)
        self.assertEqual(result.count('client_max_body_size 64k;'), 1)
        self.assertEqual(result.count('client_max_body_size 16k;'), 1)
        self.assertEqual(result.count('# lvce-ai managed route'), 1)

    def test_unexpected_managed_config_fails_without_a_candidate(self):
        code, result = self.transform('server {\n # lvce-ai managed route\n location /different/ { }\n}')
        self.assertNotEqual(code, 0)
        self.assertEqual(result, '')

if __name__ == '__main__':
    unittest.main()
