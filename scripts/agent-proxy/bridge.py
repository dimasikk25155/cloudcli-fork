#!/usr/bin/env python3
"""Пульт моста ИИ: статус, выбор пути, починка. Один мозг для окна «Пульт моста»,
иконки «Починить мост», Neo3 и кнопок в Telegram.

  bridge.py status            — коротко по-русски
  bridge.py json [--quick]    — статус JSON (--quick: без ssh-проверок путей, ~0,1 с)
  bridge.py auto              — сам выбирает путь (сначала Митя, потом свой VPS)
  bridge.py use mitya|vps     — закрепить путь
  bridge.py fix               — починить: перезапуск канала, другие пути, мосты на серверах
  bridge.py on | off          — включить мост / аварийно выключить (агенты пойдут с IP мака)
  bridge.py help              — что делать, если…
Флаг --json у действий печатает итог JSON: {"ok", "message", "status"}.
Секретов не читает и не печатает. Системный прокси мака не трогает.
Совместим с /usr/bin/python3 (3.9).
"""
import concurrent.futures
import datetime
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time

HOME = Path.home()
DIR = Path(os.environ.get('NEO3_BRIDGE_DIR') or (HOME / '.local/share/neo3-agent-proxy'))
LABEL = os.environ.get('NEO3_BRIDGE_TUNNEL_LABEL', 'com.dimasik.neo3-agent-tunnel')
PUBLIC_LABEL = os.environ.get('NEO3_BRIDGE_PUBLIC_LABEL', 'com.dimasik.neo3-public-tunnel')
PORT = int(os.environ.get('NEO3_AGENT_TUNNEL_PORT', '12809'))
PUBLIC_URL = os.environ.get('NEO3_BRIDGE_PUBLIC_URL', 'https://claude.neo3.ru/')
SSH = os.environ.get('NEO3_AGENT_TUNNEL_SSH', '/usr/bin/ssh')
WAIT_SEC = int(os.environ.get('NEO3_BRIDGE_WAIT_SEC', '50'))
UID = os.getuid()
MODES = ('auto', 'mitya', 'vps')
# Какой мост перезапускать на сервере пути.
REMOTE_SERVICE = {'mitya': 'neo3-reserve-proxy', 'vps-ts': 'neo3-agent-hysteria', 'vps-pub': 'neo3-agent-hysteria'}
TITLES = {'mitya': 'сервер Мити', 'vps-ts': 'мой VPS (Tailscale)', 'vps-pub': 'мой VPS (публичный адрес)',
          'none': 'нет пути', 'vps': 'мой VPS', 'auto': 'авто'}
ORDER = {'auto': ['mitya', 'vps-ts', 'vps-pub'], 'mitya': ['mitya'], 'vps': ['vps-ts', 'vps-pub']}


def expected_ip():
    try:
        for line in (DIR / 'proxy.env').read_text().splitlines():
            if line.startswith('NEO3_AGENT_EXPECTED_IP='):
                return line.split('=', 1)[1].strip().strip("'\"")
    except OSError:
        pass
    return '45.86.61.144'


EXPECTED = expected_ip()


def run(cmd, timeout=20, **kw):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, **kw)
    except (subprocess.TimeoutExpired, OSError) as error:
        return subprocess.CompletedProcess(cmd, 124, '', str(error))


def read(name, default=''):
    try:
        return (DIR / name).read_text().strip()
    except OSError:
        return default


def mode():
    value = read('mode', 'auto')
    return value if value in MODES else 'auto'


def route():
    parts = read('route').split()
    name = parts[0] if parts else ''
    since = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
    return name, since


def health_age():
    value = read('health')
    return int(time.time()) - int(value) if value.isdigit() else None


def loaded(label):
    return run(['launchctl', 'print', f'gui/{UID}/{label}'], timeout=5).returncode == 0


def probe_exit():
    for url in ('https://api.ipify.org', 'https://checkip.amazonaws.com'):
        p = run(['curl', '--fail', '--silent', '--connect-timeout', '5', '--max-time', '8', '--noproxy', '',
                 '--proxy', f'http://127.0.0.1:{PORT}', url], timeout=10)
        ip = p.stdout.strip()
        if p.returncode == 0 and ip:
            return ip
    return ''


def ssh_target(name):
    """Аргументы ssh для пути — из routes.sh, чтобы адреса жили в одном месте."""
    script = '. "$1"; route_ssh_target "$2"'
    env = dict(os.environ, NEO3_BRIDGE_ROUTES_FILE=str(DIR / 'routes.sh'))
    p = run(['/bin/sh', '-c', script, 'sh', str(DIR / 'routes.sh'), name], timeout=5, env=env)
    return p.stdout.split() if p.returncode == 0 else []


def ssh(name, command, timeout=15):
    target = ssh_target(name)
    if not target:
        return subprocess.CompletedProcess([], 1, '', 'нет пути')
    return run([SSH, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=yes',
                *target, command], timeout=timeout)


def route_alive(name):
    p = ssh(name, f'curl --fail --silent --max-time 8 --proxy http://127.0.0.1:12809 https://api.ipify.org')
    if p.returncode == 0 and p.stdout.strip() == EXPECTED:
        return 'ok'
    if p.returncode == 255 or p.returncode == 124:
        return 'server_down'
    return 'bridge_down'


def blocked_last_hour():
    cutoff = (datetime.datetime.now() - datetime.timedelta(hours=1)).strftime('%Y-%m-%d %H:%M:%S')
    count = 0
    for line in read('blocked.log').splitlines()[-500:]:
        if line[:19] >= cutoff:
            count += 1
    return count


def last_switches(limit=5):
    rows = []
    for line in read('switches.log').splitlines()[-limit:]:
        parts = line.split()
        if len(parts) >= 3:
            rows.append({'at': f'{parts[0]} {parts[1]}', 'route': parts[2], 'title': TITLES.get(parts[2], parts[2])})
    return rows


def public_code():
    p = run(['curl', '--silent', '--noproxy', '*', '--max-time', '8', '--output', '/dev/null',
             '--write-out', '%{http_code}', PUBLIC_URL], timeout=10)
    return p.stdout.strip() if p.returncode == 0 else ''


def status(quick=False):
    installed = loaded(LABEL)
    current_mode = mode()
    name, since = route()
    age = health_age()
    data = {
        'checked_at': int(time.time()), 'installed': installed, 'mode': current_mode,
        'mode_title': TITLES[current_mode], 'route': name or None, 'route_title': TITLES.get(name, name) if name else None,
        'route_since': since, 'health_age': age, 'expected_ip': EXPECTED,
        'public_tunnel': loaded(PUBLIC_LABEL), 'blocked_last_hour': blocked_last_hour(),
        'switches': last_switches(),
    }
    if quick:
        data['exit_ok'] = age is not None and age <= 60
        data['exit_ip'] = EXPECTED if data['exit_ok'] else None
    else:
        ip = probe_exit()
        data['exit_ip'] = ip or None
        data['exit_ok'] = ip == EXPECTED
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            futures = {key: pool.submit(route_alive, key) for key in ('mitya', 'vps-ts', 'vps-pub')}
            checks = {key: f.result() for key, f in futures.items()}
            code = public_code()
        data['routes'] = {
            'mitya': checks['mitya'],
            'vps': 'ok' if 'ok' in (checks['vps-ts'], checks['vps-pub']) else (
                'bridge_down' if 'bridge_down' in (checks['vps-ts'], checks['vps-pub']) else 'server_down'),
        }
        data['public_http'] = code or None
    order = ORDER[current_mode]
    if not installed:
        level, text = 'red', 'Мост выключен: агенты идут с IP мака (риск для общей с Митей подписки).'
    elif not data['exit_ok']:
        level, text = 'red', 'Мост не работает: агенты стоят («Agent blocked»). Нажми «Починить».'
    elif current_mode == 'auto' and name and name != order[0]:
        level, text = 'yellow', f'Работает через запасной путь — {TITLES.get(name, name)}. Основной вернётся сам.'
    else:
        level, text = 'green', f'Работает: {TITLES.get(name, name or "—")}, выход {EXPECTED}.'
    if installed and not data['public_tunnel']:
        level = 'yellow' if level == 'green' else level
        text += ' Туннель claude.neo3.ru не запущен.'
    data['level'] = level
    data['text'] = text
    return data


def human(data):
    dot = {'green': '🟢', 'yellow': '🟡', 'red': '🔴'}[data['level']]
    lines = [f"{dot} {data['text']}", f"Режим: {data['mode_title']}."]
    if data.get('route_since') and data.get('route'):
        when = datetime.datetime.fromtimestamp(data['route_since']).strftime('%d.%m %H:%M')
        lines.append(f"Путь «{data['route_title']}» — с {when}.")
    if 'routes' in data:
        word = {'ok': 'жив', 'bridge_down': 'сервер отвечает, мост на нём не работает', 'server_down': 'сервер не отвечает'}
        lines.append(f"Сервер Мити: {word[data['routes']['mitya']]}. Мой VPS: {word[data['routes']['vps']]}.")
        if data.get('public_http'):
            lines.append(f"claude.neo3.ru: {'открывается' if data['public_http'] in ('200', '301', '302', '401') else 'код ' + data['public_http']}.")
        else:
            lines.append('claude.neo3.ru: не открывается.')
    if data['blocked_last_hour']:
        lines.append(f"Агентов заблокировано за час: {data['blocked_last_hour']}.")
    return '\n'.join(lines)


def wait_route(order, seconds=WAIT_SEC):
    end = time.time() + seconds
    while time.time() < end:
        name, _ = route()
        age = health_age()
        if name in order and age is not None and age <= 30:
            return name
        time.sleep(2)
    return ''


def kickstart():
    return run(['launchctl', 'kickstart', '-k', f'gui/{UID}/{LABEL}'], timeout=15).returncode == 0


def write_mode(value):
    tmp = DIR / 'mode.tmp'
    tmp.write_text(value + '\n')
    os.replace(tmp, DIR / 'mode')


def act_mode(value):
    if not loaded(LABEL):
        return False, 'Мост выключен. Сначала «Вернуть мост».'
    write_mode(value)
    # Канал сбрасывает сам: сохранённый режим читается при подключении.
    os.replace(DIR / 'route', DIR / 'route.prev') if (DIR / 'route').exists() else None
    kickstart()
    got = wait_route(ORDER[value])
    if got:
        return True, f'Готово: {TITLES[value]} — сейчас через «{TITLES[got]}», выход {EXPECTED}.'
    return False, f'Режим «{TITLES[value]}» сохранён, но канал за {WAIT_SEC} с не поднялся. Нажми «Починить».'


def scripts_dir():
    try:
        root = json.loads((DIR / 'installation.json').read_text()).get('sdk_root')
    except (OSError, ValueError):
        root = None
    return Path(root) / 'scripts/agent-proxy' if root else None


def act_on():
    src = scripts_dir()
    if not src or not (src / 'on.sh').exists():
        return False, 'Не нашёл on.sh (папка Neo3 переехала?).'
    p = run(['/bin/bash', str(src / 'on.sh')], timeout=180)
    ok = wait_route(ORDER[mode()], 40) != ''
    tail = (p.stdout.strip().splitlines() or [''])[-1]
    return ok, ('Мост включён: агенты выходят с ' + EXPECTED + '.') if ok else ('Мост включён, но выход пока не появился. ' + tail)


def act_off():
    src = scripts_dir()
    if not src or not (src / 'off.sh').exists():
        return False, 'Не нашёл off.sh.'
    p = run(['/bin/bash', str(src / 'off.sh')], timeout=120)
    return p.returncode == 0, ('Мост выключен: агенты идут с IP мака. Вернуть — «Вернуть мост» в пульте.'
                               if p.returncode == 0 else 'off.sh не отработал: ' + p.stderr.strip()[-200:])


def act_fix():
    if not loaded(LABEL):
        return act_on()
    if probe_exit() == EXPECTED:
        name, _ = route()
        return True, f'Мост работает ({TITLES.get(name, "—")}), чинить нечего.'
    steps = []
    kickstart()
    got = wait_route(ORDER[mode()], 45)
    if got:
        return True, f'Починил: канал перезапущен, сейчас через «{TITLES[got]}».'
    steps.append('перезапуск канала не помог')
    # Перезапуск мостов на серверах, которые отвечают.
    restarted = []
    for name in ('mitya', 'vps-ts', 'vps-pub'):
        service = REMOTE_SERVICE[name]
        if service in [s for _, s in restarted]:
            continue
        p = ssh(name, f'systemctl restart {service}', timeout=25)
        if p.returncode == 0:
            restarted.append((name, service))
    if not restarted:
        return False, ('Ни сервер Мити, ни мой VPS не отвечают по ssh. Интернет мака работает, агенты постоят. '
                       'Если работать надо прямо сейчас — «Аварийно выключить мост» (риск для подписки) '
                       'или «Запасной агент» (DeepSeek, мост не нужен).')
    steps.append('перезапущены мосты: ' + ', '.join(TITLES[n] for n, _ in restarted))
    if mode() != 'auto':
        write_mode('auto')
        steps.append('режим переключён на «авто»')
    time.sleep(3)
    kickstart()
    got = wait_route(ORDER['auto'], 50)
    if got:
        return True, 'Починил (' + '; '.join(steps) + f'). Сейчас через «{TITLES[got]}».'
    return False, 'Не вышло: ' + '; '.join(steps) + '. Журнал — tunnel.log. Нажми «Запасной агент».'


HELP = DIR / 'HELP.txt'


def main(argv):
    as_json = '--json' in argv
    argv = [a for a in argv if a != '--json']
    cmd = argv[0] if argv else 'status'
    if cmd == 'json':
        print(json.dumps(status(quick='--quick' in argv), ensure_ascii=False))
        return 0
    if cmd == 'status':
        print(human(status()))
        return 0
    if cmd == 'help':
        print(HELP.read_text() if HELP.exists() else __doc__)
        return 0
    actions = {'auto': lambda: act_mode('auto'), 'fix': act_fix, 'on': act_on, 'off': act_off}
    if cmd == 'use' and len(argv) > 1 and argv[1] in ('mitya', 'vps'):
        action = lambda: act_mode(argv[1])  # noqa: E731
    elif cmd in actions:
        action = actions[cmd]
    else:
        print(__doc__)
        return 2
    DIR.mkdir(parents=True, exist_ok=True)
    with open(DIR / 'bridge.lock', 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            ok, message = False, 'Уже идёт другое действие с мостом — подожди минуту.'
        else:
            ok, message = action()
    if as_json:
        print(json.dumps({'ok': ok, 'message': message, 'status': status(quick=True)}, ensure_ascii=False))
    else:
        print(('✅ ' if ok else '❌ ') + message)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
