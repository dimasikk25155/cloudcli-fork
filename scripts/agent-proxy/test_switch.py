"""Failure-path tests for coordinated switching without touching live services."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from transport import client_config, physical_network, service_for_interface

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
        if self.journal and self.journal['token'] != token:
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
        return switch.coordinate(self.mac, 'reserve', self.remote)

    def test_both_hosts_verified_before_unblocking(self):
        self.run_switch()
        self.assertEqual(self.mac.ip, self.vps.ip)
        self.assertFalse(self.mac.blocked or self.vps.blocked)
        self.assertIn('check', self.mac.log[:self.mac.log.index('finish')])

    def test_no_browser_or_system_ip_required(self):
        with patch.object(switch, 'exit_ip', side_effect=AssertionError('Must not inspect browser route')):
            self.run_switch()
        self.assertEqual(self.mac.ip, '185.166.154.209')

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

    def test_interrupted_transition_can_return_to_primary(self):
        self.mac.fail_apply = True
        with self.assertRaises(switch.SwitchError):
            self.run_switch()
        self.mac.fail_apply = False
        switch.coordinate(self.mac, 'primary', self.remote)
        self.assertEqual(self.mac.ip, '45.86.61.144')
        self.assertEqual(self.vps.ip, self.mac.ip)
        self.assertFalse(self.mac.blocked or self.vps.blocked)

    def test_physical_transport_has_no_direct_or_vpn_fallback(self):
        profile = {'server': '185.166.154.209:8443', 'auth': 'test-secret',
                   'tls': {'sni': 'fi.neo3.ru', 'insecure': False}}
        config = client_config(profile, 12345, 'en0')
        self.assertEqual(len(config['outbounds']), 1)
        self.assertEqual(config['outbounds'][0]['bind_interface'], 'en0')
        self.assertEqual(config['outbounds'][0]['type'], 'hysteria2')
        self.assertFalse(config['outbounds'][0]['tls']['insecure'])
        with self.assertRaises(ValueError):
            client_config(profile, 12345, 'utun4')

    def test_vpn_default_route_is_not_selected_as_physical_network(self):
        responses = [subprocess.CompletedProcess([], 0, 'interface: utun9'),
                     subprocess.CompletedProcess([], 0, 'Device: en0\nDevice: en5'),
                     subprocess.CompletedProcess([], 0, '192.168.0.24\n')]
        with patch('transport.subprocess.run', side_effect=responses):
            self.assertEqual(physical_network(), ('en0', '192.168.0.24'))

    def test_dashboard_reports_actual_mismatch_not_configured_success(self):
        self.mac.live_state = lambda: {'expected_ip': '45.86.61.144', 'actual_ip': '192.0.2.1',
                                      'healthy': False, 'pending': None}
        result = switch.dashboard(self.mac, lambda action: {'expected_ip': '45.86.61.144',
            'actual_ip': '45.86.61.144', 'healthy': True, 'pending': None})
        self.assertIn('IP не совпадает', result['message'])
        self.assertIn('192.0.2.1', result['message'])

    def test_browser_proxy_follows_physical_service_not_vpn(self):
        listing = '(1) Office Wi-Fi\n(Hardware Port: Wi-Fi, Device: en0)\n(2) VPN\n(Hardware Port: VPN, Device: )'
        self.assertEqual(service_for_interface('en0', listing), 'Office Wi-Fi')
        with self.assertRaises(RuntimeError):
            service_for_interface('en5', listing)

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
            profile = {'server': '185.166.154.209:8443', 'auth': 'test-secret', 'tls': {'insecure': False}}
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
