"""Failure-path tests for coordinated switching without touching live services."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('switch', Path(__file__).with_name('switch.py'))
switch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(switch)


class FakeHost:
    def __init__(self):
        self.ip = switch.PROFILES['primary']['ip']
        self.journal = None
        self.blocked = False
        self.fail_apply = False
        self.fail_probe = False
        self.log = []

    def state(self):
        return {'pending': self.journal}

    def probe(self, name):
        if self.fail_probe:
            raise switch.SwitchError('probe failed')
        return {'ip': switch.PROFILES[name]['ip']}

    def stage(self, name, token):
        if self.journal and self.journal != {'profile': name, 'token': token}:
            raise switch.SwitchError('other operation')
        self.journal = {'profile': name, 'token': token}
        self.blocked = True
        self.log.append('stage')

    def apply(self, name, token):
        if not self.blocked:
            raise AssertionError('must block before applying')
        if self.fail_apply:
            raise switch.SwitchError('restart failed')
        self.ip = switch.PROFILES[name]['ip']
        self.log.append('apply')

    def check_active(self, name):
        assert self.ip == switch.PROFILES[name]['ip']
        self.log.append('check')

    def finish(self, name, token):
        self.check_active(name)
        self.journal = None
        self.blocked = False
        self.log.append('finish')


class SwitchTests(unittest.TestCase):
    def setUp(self):
        self.mac = FakeHost()
        self.vps = FakeHost()

    def remote(self, action, name, token):
        method = {'check': self.vps.check_active}.get(action, getattr(self.vps, action, None))
        return method(name) if action in ['check', 'probe'] else method(name, token)

    def run_switch(self):
        return switch.coordinate(self.mac, 'reserve', self.remote,
                                 lambda proxy: switch.PROFILES['reserve']['ip'])

    def test_both_hosts_verified_before_unblocking(self):
        self.run_switch()
        self.assertEqual(self.mac.ip, self.vps.ip)
        self.assertFalse(self.mac.blocked or self.vps.blocked)
        self.assertIn('check', self.mac.log[:self.mac.log.index('finish')])

    def test_browser_on_wrong_profile_changes_neither_host(self):
        with self.assertRaises(switch.SwitchError):
            switch.coordinate(self.mac, 'reserve', self.remote, lambda proxy: '192.0.2.1')
        self.assertFalse(self.mac.log or self.vps.log)

    def test_failed_probe_changes_neither_host(self):
        self.vps.fail_probe = True
        with self.assertRaises(switch.SwitchError):
            self.run_switch()
        self.assertFalse(self.mac.log or self.vps.log)

    def test_interrupted_apply_stays_blocked_and_can_resume(self):
        self.mac.fail_apply = True
        with self.assertRaises(switch.SwitchError):
            self.run_switch()
        token = self.mac.journal['token']
        self.assertTrue(self.mac.blocked and self.vps.blocked)
        self.assertEqual(token, self.vps.journal['token'])
        self.mac.fail_apply = False
        self.run_switch()
        self.assertFalse(self.mac.blocked or self.vps.blocked)
        self.assertEqual(self.mac.ip, self.vps.ip)

    def test_wrapper_blocks_even_if_only_recovery_journal_survives(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = Path(__file__).with_name('run.sh')
            (root / 'run.sh').write_bytes(source.read_bytes())
            (root / 'switch-recovery.json').write_text('{}')
            result = subprocess.run(['sh', str(root / 'run.sh'), 'echo', 'must-not-run'],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 78)
            self.assertEqual(result.stdout, '')

    def test_stage_has_no_secret_material_and_preserves_active_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            secrets = root / 'profiles'
            secrets.mkdir()
            profile = {'server': '45.86.63.89:8443', 'auth': 'test-secret', 'tls': {'insecure': False}}
            (secrets / 'reserve.json').write_text(json.dumps(profile))
            active = root / 'active.json'
            active.write_text('original')
            host = switch.Host(root=root, secrets=secrets, active=active)
            host.stage('reserve', 'a' * 32)
            self.assertEqual(active.read_text(), 'original')
            self.assertNotIn('test-secret', host.journal.read_text())
            self.assertEqual(host.journal.stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    unittest.main()
