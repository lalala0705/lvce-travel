import contextlib
import importlib.util
import io
from pathlib import Path
import stat
import tempfile
import types
import unittest
import urllib.error

spec = importlib.util.spec_from_file_location('configure_key', Path(__file__).with_name('configure-key.py'))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
KEY = 'test-only-fake-provider-key'

class KeySetupTests(unittest.TestCase):
    def accepted(self, request, timeout):
        self.assertEqual(request.full_url, 'https://api.deepseek.com/models')
        self.assertEqual(request.get_header('Authorization'), 'Bearer ' + KEY)
        return contextlib.nullcontext(types.SimpleNamespace(status=200))

    def test_rejected_key_never_writes_or_restarts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'service.env'
            path.write_text('old-settings')
            def rejected(request, timeout):
                raise urllib.error.HTTPError(request.full_url, 401, 'secret-bearing message', {}, None)
            with self.assertRaises(setup.ConfigurationError) as error:
                setup.configure(KEY, Path(directory), path, rejected, lambda *a, **kw: self.fail('must not restart'))
            self.assertNotIn(KEY, str(error.exception))
            self.assertNotIn('secret-bearing', str(error.exception))
            self.assertEqual(path.read_text(), 'old-settings')

    def test_success_is_private_and_key_is_absent_from_process_arguments(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()) as output:
            path = Path(directory) / 'service.env'
            def runner(arguments, **kwargs):
                self.assertNotIn(KEY, repr(arguments))
                self.assertEqual(path.read_text(), 'DEEPSEEK_API_KEY=' + KEY + '\n')
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                return types.SimpleNamespace(returncode=0)
            setup.configure('  ' + KEY + '  ', Path(directory), path, self.accepted, runner)
            self.assertNotIn(KEY, output.getvalue())

    def test_failed_deployment_restores_previous_configuration(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            path = Path(directory) / 'service.env'
            path.write_text('old-settings')
            with self.assertRaises(setup.ConfigurationError):
                setup.configure(KEY, Path(directory), path, self.accepted, lambda *a, **kw: types.SimpleNamespace(returncode=1))
            self.assertEqual(path.read_text(), 'old-settings')

if __name__ == '__main__':
    unittest.main()
