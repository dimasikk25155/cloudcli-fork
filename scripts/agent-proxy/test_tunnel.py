"""tunnel.sh на подставных ssh/curl/nc: порядок путей, переход, режимы, возврат на основной.
Сеть и настоящие серверы не используются."""
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
import unittest

SOURCE = Path(__file__).resolve().parent
EXPECTED = '45.86.61.144'

FAKE_SSH = r'''#!/bin/sh
# Имя пути по адресату.
route=''
for a in "$@"; do
  case "$a" in
    mitya-vps) route=mitya ;;
    root@100.75.69.57) route=vps-ts ;;
    root@92.118.233.67) route=vps-pub ;;
  esac
done
good() { grep -qx "$route" "$STATE/good" 2>/dev/null; }
echo "$route $*" >> "$STATE/calls.log"
case " $* " in
  *" -N "*)
    good || exit 255
    echo "$route" > "$STATE/active"
    trap 'exit 0' TERM INT
    while :; do sleep 0.2; good || exit 255; done ;;
  *)
    # Проверка «ожил ли путь»: команда curl на сервере.
    good && echo "''' + EXPECTED + r'''" ; good ;;
esac
'''

FAKE_CURL = r'''#!/bin/sh
active=$(cat "$STATE/active" 2>/dev/null)
grep -qx "$active" "$STATE/good" 2>/dev/null && { echo "''' + EXPECTED + r'''"; exit 0; }
exit 7
'''


class TunnelRoutesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.dir = root / 'proxy'
        self.bin = root / 'bin'
        self.state = root / 'state'
        for d in (self.dir, self.bin, self.state):
            d.mkdir()
        for name in ('tunnel.sh', 'routes.sh'):
            shutil.copy(SOURCE / name, self.dir / name)
        (self.dir / 'proxy.env').write_text(f'NEO3_AGENT_EXPECTED_IP={EXPECTED}\n')
        for name, body in (('ssh', FAKE_SSH), ('curl', FAKE_CURL), ('nc', '#!/bin/sh\nexit 0\n')):
            path = self.bin / name
            path.write_text(body)
            path.chmod(0o755)
        self.proc = None

    def tearDown(self):
        if self.proc and self.proc.poll() is None:
            self.proc.send_signal(signal.SIGTERM)
            try:
                self.proc.wait(5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        subprocess.run(['pkill', '-f', str(self.bin / 'ssh')], capture_output=True)

    def good(self, *routes):
        (self.state / 'good').write_text(''.join(r + '\n' for r in routes))

    def start(self, mode=None, return_sec='1800'):
        if mode:
            (self.dir / 'mode').write_text(mode + '\n')
        env = {**os.environ, 'PATH': f'{self.bin}{os.pathsep}{os.environ["PATH"]}', 'STATE': str(self.state),
               'HOME': str(self.state), 'NEO3_AGENT_TUNNEL_SSH': str(self.bin / 'ssh'),
               'NEO3_AGENT_TUNNEL_CHECK_SEC': '1', 'NEO3_AGENT_TUNNEL_FAIL_SLEEP': '0',
               'NEO3_AGENT_TUNNEL_RETRY_SEC': '1', 'NEO3_AGENT_TUNNEL_RETURN_SEC': return_sec}
        self.proc = subprocess.Popen(['/bin/sh', str(self.dir / 'tunnel.sh')], env=env,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def wait_route(self, name, seconds=15):
        end = time.time() + seconds
        while time.time() < end:
            try:
                if (self.dir / 'route').read_text().split()[0] == name:
                    return True
            except (OSError, IndexError):
                pass
            time.sleep(0.2)
        return False

    def calls(self):
        try:
            return (self.state / 'calls.log').read_text()
        except OSError:
            return ''

    def test_auto_prefers_mitya(self):
        self.good('mitya', 'vps-ts', 'vps-pub')
        self.start()
        self.assertTrue(self.wait_route('mitya'))
        self.assertTrue((self.dir / 'health').exists())

    def test_auto_falls_over_to_vps_when_mitya_down(self):
        self.good('vps-ts')
        self.start()
        self.assertTrue(self.wait_route('vps-ts'))
        self.assertIn('vps-ts', (self.dir / 'switches.log').read_text())

    def test_stall_on_mitya_moves_to_vps(self):
        self.good('mitya', 'vps-ts')
        self.start()
        self.assertTrue(self.wait_route('mitya'))
        self.good('vps-ts')  # Митя пропал — ssh рвётся, проверка выхода падает
        self.assertTrue(self.wait_route('vps-ts'))

    def test_vps_mode_never_touches_mitya(self):
        self.good('mitya', 'vps-ts', 'vps-pub')
        self.start(mode='vps')
        self.assertTrue(self.wait_route('vps-ts'))
        self.assertNotIn('mitya ', self.calls())

    def test_vps_public_when_tailscale_down(self):
        self.good('vps-pub')
        self.start(mode='vps')
        self.assertTrue(self.wait_route('vps-pub'))

    def test_returns_to_mitya_when_it_recovers(self):
        self.good('vps-ts')
        self.start(return_sec='1')
        self.assertTrue(self.wait_route('vps-ts'))
        self.good('mitya', 'vps-ts')
        self.assertTrue(self.wait_route('mitya', 20))

    def test_all_down_marks_none(self):
        self.good()
        self.start()
        self.assertTrue(self.wait_route('none'))
        self.assertFalse((self.dir / 'health').exists())

    def test_routes_local_overrides_vps_address(self):
        (self.dir / 'routes.local').write_text('NEO3_BRIDGE_VPS_PUBLIC=10.9.9.9\n')
        self.good()
        self.start(mode='vps')
        end = time.time() + 10
        while time.time() < end and 'root@10.9.9.9' not in self.calls():
            time.sleep(0.2)
        self.assertIn('root@10.9.9.9', self.calls())


if __name__ == '__main__':
    unittest.main()
