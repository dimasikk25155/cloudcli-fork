#!/usr/bin/env python3
"""Mac Hysteria2 client bound to physical networking, independent of VPN apps."""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time


def physical_network():
    route = subprocess.run(['/sbin/route', '-n', 'get', 'default'],
                           capture_output=True, text=True, timeout=3)
    match = re.search(r'interface:\s+(en\d+)\b', route.stdout)
    interfaces = [match[1]] if match else []
    hardware = subprocess.run(['/usr/sbin/networksetup', '-listallhardwareports'],
                              capture_output=True, text=True, timeout=3)
    interfaces += re.findall(r'Device:\s+(en\d+)\b', hardware.stdout)
    for interface in dict.fromkeys(interfaces):
        address = subprocess.run(['/usr/sbin/ipconfig', 'getifaddr', interface],
                                 capture_output=True, text=True, timeout=3).stdout.strip()
        if address and not address.startswith('169.254.'):
            return interface, address
    raise RuntimeError('No physical Internet interface')


def client_config(profile, port, interface):
    host, server_port = profile['server'].rsplit(':', 1)
    tls = profile.get('tls', {})
    if tls.get('insecure') or not re.fullmatch(r'en\d+', interface):
        raise ValueError('Verified TLS and a physical interface are required')
    outbound = {'type': 'hysteria2', 'tag': 'bridge', 'server': host,
                'server_port': int(server_port), 'password': profile['auth'],
                'tls': {'enabled': True, 'server_name': tls.get('sni', host),
                        'insecure': False},
                'bind_interface': interface, 'connect_timeout': '6s'}
    if tls.get('ca'):
        outbound['tls']['certificate_path'] = tls['ca']
    return {'log': {'level': 'error'},
            'inbounds': [{'type': 'http', 'listen': '127.0.0.1', 'listen_port': port}],
            'outbounds': [outbound], 'route': {'final': 'bridge'}}


def service_for_interface(interface, listing):
    service = None
    for line in listing.splitlines():
        match = re.match(r'^\(\d+\) (.+)$', line)
        if match:
            service = match[1]
        if service and f'Device: {interface})' in line:
            return service
    raise RuntimeError('Physical network service not found')


def configure_browser_proxy(interface):
    tool = '/usr/sbin/networksetup'
    result = subprocess.run([tool, '-listnetworkserviceorder'], capture_output=True,
                            text=True, timeout=5, check=True)
    service = service_for_interface(interface, result.stdout)
    for option in ['-setwebproxy', '-setsecurewebproxy']:
        result = subprocess.run([tool, option, service, '127.0.0.1', '12809'],
                                capture_output=True, text=True, timeout=8)
        if result.returncode or 'Error' in result.stdout or 'error' in result.stderr:
            raise RuntimeError('Browser proxy could not be configured')
    return service


def browser_proxy_ready(interface):
    tool = '/usr/sbin/networksetup'
    listing = subprocess.run([tool, '-listnetworkserviceorder'], capture_output=True,
                             text=True, timeout=5, check=True)
    service = service_for_interface(interface, listing.stdout)
    for option in ['-getwebproxy', '-getsecurewebproxy']:
        result = subprocess.run([tool, option, service], capture_output=True,
                                text=True, timeout=5, check=True)
        fields = dict(line.split(': ', 1) for line in result.stdout.splitlines() if ': ' in line)
        if fields.get('Enabled') != 'Yes' or fields.get('Server') != '127.0.0.1' or fields.get('Port') != '12809':
            return False
    return True


def start_client(root, profile, port, interface, directory, output=None):
    config = Path(directory) / 'sing-box.json'
    fd = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(client_config(profile, port, interface), stream)
    return subprocess.Popen([str(Path(root) / 'sing-box'), 'run', '-c', str(config)],
                            stdout=output, stderr=output)


def stop_client(proc):
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


def serve(active):
    root = Path(__file__).resolve().parent
    stopping = False

    def stop(signum, frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    while not stopping:
        try:
            network = physical_network()
            profile = json.loads(Path(active).read_text())
            try:
                configure_browser_proxy(network[0])
            except Exception:
                # CLI networking remains protected if the OS refuses a browser setting.
                print('Browser proxy configuration requires attention.', flush=True)
            with tempfile.TemporaryDirectory(prefix='neo3-agent-transport-') as directory:
                proc = start_client(root, profile, 12809, network[0], directory)
                try:
                    while not stopping and proc.poll() is None:
                        time.sleep(2)
                        try:
                            if physical_network() != network:
                                break
                        except (RuntimeError, subprocess.SubprocessError):
                            break
                finally:
                    stop_client(proc)
        except Exception:
            # Configuration/authentication data must never appear in service logs.
            print('Agent bridge waiting for physical network or valid configuration.', flush=True)
        if not stopping:
            time.sleep(2)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('active_config')
    serve(parser.parse_args().active_config)
