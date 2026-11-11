"""Isolated wrapper repair and fail-closed regression tests; no provider access."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

SOURCE = Path(__file__).resolve().parent


class AgentProxyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.home = self.root / 'home'
        self.prefix = self.root / 'proxy'
        self.bin.mkdir()
        (self.home / '.local/bin').mkdir(parents=True)
        self.command = self.bin / 'codex'
        self.command.write_text('#!/bin/sh\nprintf "original\\n"\n')
        self.command.chmod(0o755)

    def install(self, *extra):
        return subprocess.run(['python3', str(SOURCE / 'install.py'),
            '--prefix', str(self.prefix), '--engine-home', str(self.home),
            '--bin-dir', str(self.bin), *extra], capture_output=True, text=True)

    def configured(self):
        result = self.install('--proxy', 'http://127.0.0.1:12809',
                              '--expected-ip', '45.86.61.144')
        self.assertEqual(result.returncode, 0, result.stderr)

    def fake_curl(self, body):
        curl = self.bin / 'curl'
        curl.write_text('#!/bin/sh\n' + body + '\n')
        curl.chmod(0o755)
        return {**os.environ, 'PATH': str(self.bin) + os.pathsep + os.environ['PATH'],
                'NEO3_AGENT_PROXY_WAIT_SEC': '0'}

    def test_repair_preserves_exit_and_new_upstream_binary(self):
        self.configured()
        self.assertEqual(self.install().returncode, 0)
        self.command.write_text('#!/bin/sh\nprintf "updated\\n"\n')
        self.assertEqual(self.install().returncode, 0)
        state = json.loads((self.prefix / 'installation.json').read_text())
        self.assertEqual(state['proxy'], 'http://127.0.0.1:12809')
        self.assertEqual(state['expected_ip'], '45.86.61.144')
        env = self.fake_curl('printf "45.86.61.144"')
        result = subprocess.run([str(self.command)], env=env, capture_output=True, text=True)
        self.assertEqual(result.stdout, 'updated\n')

    def test_relative_symlink_survives_repeated_install(self):
        claude = self.home / '.local/bin/claude'
        native = self.home / '.local/claude-version'
        native.write_text('#!/bin/sh\necho claude-ok\n')
        native.chmod(0o755)
        claude.symlink_to('../claude-version')
        self.configured()
        self.assertEqual(self.install().returncode, 0)
        result = subprocess.run([str(claude)], env=self.fake_curl('echo 45.86.61.144'),
                                capture_output=True, text=True)
        self.assertEqual(result.stdout, 'claude-ok\n')

    def test_wrong_exit_blocks_before_agent_starts(self):
        self.configured()
        result = subprocess.run([str(self.command)], env=self.fake_curl('echo 192.0.2.1'),
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 78)
        self.assertEqual(result.stdout, '')

    def test_unavailable_proxy_never_retries_without_proxy(self):
        self.configured()
        log = self.root / 'curl-args'
        env = self.fake_curl('printf "%s\\n" "$*" >> "$PROBE_LOG"\nexit 7')
        env['PROBE_LOG'] = str(log)
        result = subprocess.run([str(self.command)], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 78)
        self.assertEqual(result.stdout, '')
        for call in log.read_text().splitlines():
            self.assertIn('--proxy http://127.0.0.1:12809', call)

    def test_fresh_tunnel_health_starts_without_probe(self):
        self.configured()
        (self.prefix / 'health').write_text(str(int(time.time())) + '\n')
        env = self.fake_curl('echo probed >> "$PROBE_LOG"\nexit 7')
        env['PROBE_LOG'] = str(self.root / 'probes')
        result = subprocess.run([str(self.command)], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, 'original\n')
        self.assertFalse((self.root / 'probes').exists())

    def test_stale_tunnel_health_is_not_trusted(self):
        self.configured()
        (self.prefix / 'health').write_text(str(int(time.time()) - 600) + '\n')
        result = subprocess.run([str(self.command)], env=self.fake_curl('exit 7'),
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 78)
        self.assertEqual(result.stdout, '')
        self.assertIn('blocked', (self.prefix / 'blocked.log').read_text())

    def test_short_stall_waits_for_tunnel_instead_of_failing(self):
        self.configured()
        counter = self.root / 'count'
        env = self.fake_curl('n=$(cat "$COUNT" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$COUNT"\n'
                             '[ $n -ge 3 ] && echo 45.86.61.144 && exit 0\nexit 7')
        env.update(COUNT=str(counter), NEO3_AGENT_PROXY_WAIT_SEC='20')
        result = subprocess.run([str(self.command)], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, 'original\n')
        self.assertIn('жду', result.stderr)

    def test_non_loopback_endpoint_rejected(self):
        result = self.install('--proxy', 'http://192.0.2.1:12809')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('wrapper', self.command.read_text())


if __name__ == '__main__':
    unittest.main()
