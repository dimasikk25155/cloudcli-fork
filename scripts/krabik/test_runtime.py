import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock


class KrabikRuntimeTest(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('krabik_runtime', Path(__file__).with_name('runtime.py'))
        self.runtime = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.runtime)
        self.temp = tempfile.TemporaryDirectory(prefix='krabik-runtime-test-')
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.runtime.HOME = root
        self.runtime.PROJECT = root / 'krabik'
        self.runtime.CONFIG = root / '.config/krabik/provider'
        self.runtime.run = Mock(return_value=subprocess.CompletedProcess([], 0, '', ''))

    def test_missing_codex_login_never_touches_the_running_fallback(self):
        self.runtime.run.return_value.returncode = 1
        self.runtime.current = Mock(side_effect=AssertionError('must not touch the current agent'))
        with self.assertRaisesRegex(RuntimeError, 'CODEX_AUTH_REQUIRED'):
            self.runtime.switch('codex')
        self.runtime.current.assert_not_called()
        self.assertFalse(self.runtime.CONFIG.exists())

    def test_herdr_missing_agent_error_can_arrive_on_stderr(self):
        self.runtime.run.return_value = subprocess.CompletedProcess([], 1, '', json.dumps({'error': {'code': 'agent_not_found'}}))
        self.assertIsNone(self.runtime.current())

    def test_busy_agent_is_never_interrupted_by_switch(self):
        self.runtime.current = Mock(return_value={'agent': 'claude', 'agent_status': 'working'})
        self.runtime.herdr = Mock()
        with self.assertRaisesRegex(RuntimeError, 'занят'):
            self.runtime.switch('codex')
        self.runtime.herdr.assert_not_called()

    def test_idle_switch_persists_only_after_confirmed_start(self):
        self.runtime.current = Mock(side_effect=[{'agent': 'claude', 'agent_status': 'idle', 'pane_id': 'w1:p1'}, None])
        self.runtime.herdr = Mock(return_value={})
        self.runtime.start = Mock()
        self.assertEqual(self.runtime.switch('codex'), 'started')
        self.runtime.start.assert_called_once_with('codex', 'w1:p1')
        self.assertEqual(self.runtime.CONFIG.read_text(), 'codex\n')

    def test_failed_start_restores_the_previous_engine(self):
        self.runtime.current = Mock(side_effect=[{'agent': 'claude', 'agent_status': 'idle', 'pane_id': 'w1:p1'}, None, None])
        self.runtime.herdr = Mock(return_value={})
        self.runtime.start = Mock(side_effect=[RuntimeError('failed start'), None])
        with self.assertRaisesRegex(RuntimeError, 'failed start'):
            self.runtime.switch('codex')
        self.assertEqual([call.args[0] for call in self.runtime.start.call_args_list], ['codex', 'claude'])
        self.assertFalse(self.runtime.CONFIG.exists())

    def test_transcript_is_bound_to_the_current_agent_and_its_project(self):
        root = self.runtime.HOME / '.codex/sessions'
        root.mkdir(parents=True)
        wanted = '12345678-1234-1234-1234-123456789abc'
        other = '87654321-4321-4321-4321-cba987654321'
        file = root / ('rollout-' + wanted + '.jsonl')
        file.write_text(json.dumps({'type': 'session_meta', 'payload': {'cwd': str(self.runtime.PROJECT)}}) + '\n')
        foreign = root / ('rollout-' + other + '.jsonl')
        foreign.write_text(json.dumps({'type': 'session_meta', 'payload': {'cwd': '/another/project'}}) + '\n')
        self.assertEqual(self.runtime.session_file('codex', wanted), file)
        self.assertIsNone(self.runtime.session_file('codex', other))
        with self.assertRaisesRegex(RuntimeError, 'некорректный'):
            self.runtime.session_file('codex', '../../auth.json')


if __name__ == '__main__':
    unittest.main()
