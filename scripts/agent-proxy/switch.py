#!/usr/bin/env python3
"""Offline primary/reserve switcher. No model calls, secrets in output, or direct fallback."""
import argparse
import concurrent.futures
import fcntl
import json
import os
from pathlib import Path
import platform
import socket
import subprocess
import tempfile
import time
import uuid
from datetime import datetime

from transport import physical_network, start_client, configure_browser_proxy, browser_proxy_ready

PROFILES = {
    'primary': {'ip': '45.86.61.144', 'country': 'Нидерланды'},
    'reserve': {'ip': '185.166.154.209', 'country': 'Финляндия'},
}
REMOTE_SCRIPT = '/usr/local/lib/neo3-agent-proxy/switch.py'


class SwitchError(Exception):
    pass


def atomic_write(path, data, mode=0o600):
    path = Path(path)
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, mode)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def exit_ip(proxy):
    for url in ['https://api.ipify.org', 'https://checkip.amazonaws.com']:
        try:
            result = subprocess.run(['curl', '--fail', '--silent', '--connect-timeout', '4',
                '--max-time', '8', '--noproxy', '', '--proxy', proxy, url],
                capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                return result.stdout.strip()
        except subprocess.TimeoutExpired:
            pass
    raise SwitchError('Мост не отвечает. Проверьте интернет или выберите другую страну.')


class Host:
    def __init__(self, root=None, secrets=None, active=None, binary=None, restart=None):
        self.mac = platform.system() == 'Darwin'
        self.root = Path(root or Path(__file__).resolve().parent)
        default_secrets = (Path.home() / 'Antigravity Project/.secrets.d/neo3-agent-profiles'
                           if self.mac else Path('/etc/neo3-agent-proxy/profiles'))
        self.secrets = Path(secrets or default_secrets)
        self.active = Path(active or (Path.home() / 'Antigravity Project/.secrets.d/neo3-agent-hysteria.json'
                           if self.mac else '/etc/neo3-agent-proxy/hysteria.json'))
        self.binary = str(binary or (self.root / 'hysteria' if self.mac else '/usr/local/bin/hysteria'))
        self.restart_command = restart or (['launchctl', 'kickstart', '-k',
            f'gui/{os.getuid()}/com.dimasik.neo3-agent-hysteria'] if self.mac else
            ['systemctl', 'restart', 'neo3-agent-hysteria.service'])
        self.journal = self.root / 'switch-recovery.json'
        self.gate = self.root / 'switch-in-progress'

    def state(self):
        manifest = json.loads((self.root / 'installation.json').read_text())
        pending = json.loads(self.journal.read_text()) if self.journal.exists() else None
        return {'expected_ip': manifest.get('expected_ip'), 'proxy': manifest['proxy'],
                'pending': {k: pending[k] for k in ['token', 'profile']} if pending else None,
                'blocked': self.gate.exists()}

    def profile(self, name):
        if name not in PROFILES:
            raise SwitchError('Неизвестный профиль.')
        config = json.loads((self.secrets / (name + '.json')).read_text())
        if config['server'].split(':')[0] != PROFILES[name]['ip']:
            raise SwitchError('Адрес профиля не совпадает с закреплённым сервером.')
        if config.get('tls', {}).get('insecure'):
            raise SwitchError('Профиль без проверки сертификата не разрешён.')
        return config

    def live_state(self):
        state = self.state()
        try:
            state['actual_ip'] = exit_ip(state['proxy'])
            state['healthy'] = state['actual_ip'] == state['expected_ip']
        except SwitchError:
            state.update(actual_ip=None, healthy=False)
        state['checked_at'] = datetime.now().astimezone().isoformat(timespec='seconds')
        if self.mac:
            try:
                state['browser_proxy'] = browser_proxy_ready(physical_network()[0])
            except Exception:
                state['browser_proxy'] = False
        return state

    def probe(self, name):
        config = self.profile(name)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        config.pop('socks5', None)
        config['http'] = {'listen': f'127.0.0.1:{port}'}
        with tempfile.TemporaryDirectory(prefix='neo3-proxy-probe-') as directory:
            path = Path(directory) / 'client.json'
            atomic_write(path, json.dumps(config).encode())
            with open(Path(directory) / 'client.log', 'wb') as log:
                if self.mac:
                    proc = start_client(self.root, config, port, physical_network()[0], directory, log)
                else:
                    proc = subprocess.Popen([self.binary, 'client', '-c', str(path),
                        '--disable-update-check', '--log-level', 'warn'], stdout=log, stderr=log)
                try:
                    ready = False
                    for _ in range(40):
                        if proc.poll() is not None:
                            break
                        try:
                            with socket.create_connection(('127.0.0.1', port), timeout=0.2):
                                ready = True
                                break
                        except OSError:
                            time.sleep(0.2)
                    if not ready:
                        raise SwitchError('Туннель не подключился. Рабочий профиль не изменён.')
                    ip = exit_ip(f'http://127.0.0.1:{port}')
                    if ip != PROFILES[name]['ip']:
                        raise SwitchError('Резерв вернул другой IP. Переключение запрещено.')
                    return {'ip': ip, 'profile': name}
                finally:
                    proc.terminate()
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait()

    def check_active(self, name):
        expected = PROFILES[name]['ip']
        state = self.state()
        if state['expected_ip'] != expected:
            raise SwitchError('Настройки запуска ещё не переключены.')
        if exit_ip(state['proxy']) != expected:
            raise SwitchError('Работающий туннель не подтвердил нужный IP.')
        return {'ip': expected, 'profile': name}

    def pending(self, name, token):
        if not self.journal.exists():
            raise SwitchError('Нет сохранённого переключения для продолжения.')
        state = json.loads(self.journal.read_text())
        if state['token'] != token or state['profile'] != name:
            raise SwitchError('Уже выполняется другое переключение.')
        return state

    def stage(self, name, token):
        self.profile(name)
        if self.journal.exists():
            existing = json.loads(self.journal.read_text())
            if existing['token'] != token:
                raise SwitchError('Уже выполняется другое переключение.')
        atomic_write(self.journal, json.dumps({'token': token, 'profile': name}).encode())
        atomic_write(self.gate, token.encode())
        return {'staged': True}

    def apply(self, name, token):
        self.pending(name, token)
        # Remain blocked until BOTH hosts have verified the chosen exit.
        atomic_write(self.gate, token.encode())
        config = self.profile(name)
        config['http'] = {'listen': '127.0.0.1:12809'}
        atomic_write(self.active, json.dumps(config).encode())
        manifest_path = self.root / 'installation.json'
        manifest = json.loads(manifest_path.read_text())
        manifest.update(proxy='http://127.0.0.1:12809', expected_ip=PROFILES[name]['ip'])
        atomic_write(manifest_path, (json.dumps(manifest, indent=2) + '\n').encode(), 0o644)
        env = f"NEO3_AGENT_PROXY_URL=http://127.0.0.1:12809\nNEO3_AGENT_EXPECTED_IP={PROFILES[name]['ip']}\n"
        atomic_write(self.root / 'proxy.env', env.encode(), 0o644)
        result = subprocess.run(self.restart_command, capture_output=True, timeout=20)
        if result.returncode:
            raise SwitchError('Не удалось перезапустить туннель. Запуск ИИ остаётся заблокирован.')
        for _ in range(30):
            try:
                with socket.create_connection(('127.0.0.1', 12809), timeout=0.2):
                    break
            except OSError:
                time.sleep(0.2)
        return self.check_active(name)

    def finish(self, name, token):
        if self.journal.exists():
            self.pending(name, token)
        self.check_active(name)
        # The wrapper also checks the journal, so it stays blocked until both are removed.
        if self.gate.exists():
            if self.gate.read_text() != token:
                raise SwitchError('Блокировка принадлежит другому переключению.')
            self.gate.unlink()
        if self.journal.exists():
            self.journal.unlink()
        return {'ip': PROFILES[name]['ip'], 'profile': name, 'complete': True}


def remote(action, name='primary', token='none'):
    # Every argument is a fixed enum or a generated hexadecimal token.
    command = f'python3 {REMOTE_SCRIPT} --local {action} {name} {token}'
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
        '-o', 'HostName=100.75.69.57', '-o', 'HostKeyAlias=185.166.154.209',
        '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2', 'vps-nl', command],
        capture_output=True, text=True, timeout=65)
    try:
        data = json.loads(result.stdout)
    except ValueError:
        raise SwitchError('Нет связи с VPS через Tailscale. Проверьте доступность сервера.')
    if result.returncode or not data.get('ok'):
        raise SwitchError('VPS: ' + data.get('error', 'операция не завершена.'))
    return data['result']


def coordinate(host, name, remote_fn=remote):
    expected = PROFILES[name]['ip']
    if getattr(host, 'mac', False):
        configure_browser_proxy(physical_network()[0])
    pending = host.state()['pending']
    token = pending['token'] if pending else uuid.uuid4().hex
    # Probe both hosts before changing the serving configuration.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(host.probe, name)
        b = pool.submit(remote_fn, 'probe', name, token)
        a.result()
        b.result()
    host.stage(name, token)
    try:
        remote_fn('stage', name, token)
        remote_fn('apply', name, token)
        host.apply(name, token)
        remote_fn('check', name, token)
        host.check_active(name)
        remote_fn('finish', name, token)
        host.finish(name, token)
    except Exception as error:
        raise SwitchError('Переход не завершён. Запуски ИИ на участвующих узлах заблокированы. '
                          'Сохранён ход операции: восстановите связь и нажмите нужную страну повторно. '
                          + (str(error) if isinstance(error, SwitchError) else 'Ошибка выполнения.'))
    return {'ip': expected, 'profile': name, 'complete': True,
            'message': f"Подключено: {PROFILES[name]['country']} · {expected}\nMac: IP подтверждён\nVPS: IP подтверждён\nHapp не требуется. Можно продолжать работу."}


def dashboard(host, remote_fn=remote):
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(host.live_state)
        b = pool.submit(remote_fn, 'status')
        local = a.result()
        try:
            vps = b.result()
        except (SwitchError, subprocess.SubprocessError):
            vps = {'actual_ip': None, 'healthy': False, 'pending': None, 'unreachable': True}
    def line(label, state):
        if state.get('unreachable'):
            return f'{label}: нет связи с сервером'
        if state.get('pending') or state.get('blocked'):
            return f'{label}: переход не завершён; повторите выбранную кнопку'
        if not state.get('healthy'):
            return f"{label}: мост не отвечает или IP не совпадает (получен: {state.get('actual_ip') or 'нет'})"
        country = next((p['country'] for p in PROFILES.values() if p['ip'] == state['actual_ip']), 'неизвестно')
        return f"{label}: {country} · {state['actual_ip']} · работает"
    browser = ('\nБраузер: подключён к этому же мосту' if local.get('browser_proxy') else
               '\nБраузер: прокси не настроен; нажмите нужную страну') if 'browser_proxy' in local else ''
    return {'mac': local, 'vps': vps, 'profiles': PROFILES,
            'message': line('Mac', local) + '\n' + line('VPS', vps) + browser
                       + '\nПроверено: ' + datetime.now().strftime('%H:%M:%S')}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--local', action='store_true')
    parser.add_argument('action', choices=['status', 'probe', 'switch', 'stage', 'apply', 'check', 'finish'])
    parser.add_argument('profile', choices=list(PROFILES), nargs='?', default='primary')
    parser.add_argument('token', nargs='?', default='none')
    args = parser.parse_args()
    host = Host()
    try:
        if args.action in ['stage', 'apply', 'finish']:
            if not args.local or len(args.token) != 32 or any(c not in '0123456789abcdef' for c in args.token):
                raise SwitchError('Некорректная операция переключения.')
        # Status/probe remain available while a previous switch is blocked.
        with open(host.root / 'switch-control.lock', 'a') as lock:
            if args.action not in ['status', 'probe', 'check']:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise SwitchError('Другая операция уже выполняется. Дождитесь её результата.')
            if args.local:
                method = {'status': lambda: host.live_state(), 'probe': lambda: host.probe(args.profile),
                    'stage': lambda: host.stage(args.profile, args.token),
                    'apply': lambda: host.apply(args.profile, args.token),
                    'check': lambda: host.check_active(args.profile),
                    'finish': lambda: host.finish(args.profile, args.token)}
                if args.action not in method:
                    raise SwitchError('Операция недоступна.')
                result = method[args.action]()
            elif args.action == 'switch':
                result = coordinate(host, args.profile)
            elif args.action == 'probe':
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                    local_probe = pool.submit(host.probe, args.profile)
                    vps_probe = pool.submit(remote, 'probe', args.profile)
                    result = {'mac': local_probe.result(), 'vps': vps_probe.result(),
                              'message': f"Резерв проверен с Mac и VPS: {PROFILES[args.profile]['ip']}. Текущий маршрут не изменён."}
            elif args.action == 'status':
                result = dashboard(host)
            else:
                raise SwitchError('Операция доступна только внутреннему переключателю.')
        print(json.dumps({'ok': True, 'result': result}, ensure_ascii=False))
        return 0
    except Exception as error:
        message = str(error) if isinstance(error, SwitchError) else 'Проверка не завершена. Настройки или связь недоступны.'
        print(json.dumps({'ok': False, 'error': message}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
