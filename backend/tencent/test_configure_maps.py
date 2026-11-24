import contextlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import tempfile
import types
import unittest

spec = importlib.util.spec_from_file_location('configure_maps', Path(__file__).with_name('configure-maps.py'))
maps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(maps)
VALUES = {'AMAP_JS_KEY': 'a' * 32, 'AMAP_WEB_KEY': 'b' * 32, 'AMAP_SECURITY_CODE': 'c' * 32}

class MapSetupTests(unittest.TestCase):
    def accepted(self, url, timeout):
        self.assertTrue(url.startswith('https://restapi.amap.com/v5/place/text?'))
        return contextlib.closing(io.BytesIO(json.dumps({'status': '1', 'pois': []}).encode()))

    def test_configuration_retains_deepseek_and_is_private(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()) as output:
            path = Path(directory) / 'service.env'
            path.write_text('DEEPSEEK_API_KEY=existing-fake-key\n')
            def applied(arguments, **kwargs):
                contents = path.read_text()
                self.assertIn('DEEPSEEK_API_KEY=existing-fake-key', contents)
                for name, value in VALUES.items():
                    self.assertIn(name + '=' + value, contents)
                    self.assertNotIn(value, repr(arguments))
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                return types.SimpleNamespace(returncode=0)
            maps.configure(VALUES, Path(directory), path, self.accepted, applied)
            for secret in VALUES.values():
                self.assertNotIn(secret, output.getvalue())

    def test_invalid_authorization_preserves_all_existing_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'service.env'
            path.write_text('old-config')
            rejected = lambda *a, **kw: contextlib.closing(io.BytesIO(b'{"status":"0","infocode":"10001"}'))
            with self.assertRaises(maps.setup.ConfigurationError):
                maps.configure(VALUES, Path(directory), path, rejected, lambda *a, **kw: self.fail('must not deploy'))
            self.assertEqual(path.read_text(), 'old-config')

    def test_deepseek_rotation_preserves_maps_and_unknown_settings(self):
        previous = b'AMAP_WEB_KEY=existing-fake-map-key\nDEEPSEEK_API_KEY=old\nOTHER=value\n'
        merged = maps.setup.merge_environment(previous, {'DEEPSEEK_API_KEY': 'new'})
        self.assertIn(b'AMAP_WEB_KEY=existing-fake-map-key\n', merged)
        self.assertIn(b'OTHER=value\n', merged)
        self.assertEqual(merged.count(b'DEEPSEEK_API_KEY='), 1)

    def test_failed_application_restores_previous_file(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            path = Path(directory) / 'service.env'
            path.write_text('old-config')
            with self.assertRaises(maps.setup.ConfigurationError):
                maps.configure(VALUES, Path(directory), path, self.accepted, lambda *a, **kw: types.SimpleNamespace(returncode=1))
            self.assertEqual(path.read_text(), 'old-config')

if __name__ == '__main__':
    unittest.main()
