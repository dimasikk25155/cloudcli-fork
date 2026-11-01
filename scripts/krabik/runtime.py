#!/usr/bin/env python3
"""Provider-aware Herdr lifecycle and bounded transcript reader for Krabik."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

HOME = Path('/home/agents')
PROJECT = HOME / 'krabik'
HERDR = str(HOME / '.local/bin/herdr')
CONFIG = HOME / '.config/krabik/provider'
UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$', re.I)


def run(args, timeout=20):
    return subprocess.run(args, text=True, capture_output=True, timeout=timeout)


def herdr(*args):
    result = run([HERDR, *args])
    try:
        data = json.loads(result.stdout or result.stderr)
    except ValueError:
        raise RuntimeError('Herdr не ответил корректным JSON') from None
    if result.returncode or 'error' in data:
        error = data.get('error', {})
        if isinstance(error, dict) and error.get('code') in ('agent_not_found', 'not_found'):
            return {}
        raise RuntimeError('Команда Herdr не выполнена; проверь его службу')
    return data.get('result', {})


def current():
    return herdr('agent', 'get', 'krabik').get('agent')


def provider():
    value = CONFIG.read_text().strip() if CONFIG.exists() else 'claude'
    if value not in ('claude', 'codex'):
        raise RuntimeError('В конфиге Крабика указан неизвестный движок')
    return value


def check_login(engine):
    if engine == 'codex':
        if run(['/usr/local/bin/codex', 'login', 'status']).returncode:
            raise RuntimeError('CODEX_AUTH_REQUIRED: нужен вход Codex пользователя agents')


def session_files(engine):
    if engine == 'claude':
        root = HOME / '.claude/projects/-home-agents-krabik'
        files = list(root.glob('*.jsonl'))
    else:
        root = HOME / '.codex/sessions'
        files = list(root.rglob('*.jsonl'))
    return root, sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)


def session_file(engine, session_id=None):
    root, files = session_files(engine)
    if session_id and not UUID.fullmatch(session_id):
        raise RuntimeError('Herdr вернул некорректный id сессии')
    for file in files:
        if file.is_symlink() or not file.resolve().is_relative_to(root.resolve()):
            continue
        if session_id and not file.stem.endswith(session_id):
            continue
        if engine == 'codex':
            try:
                with file.open() as stream:
                    meta = json.loads(stream.readline(131072))
                if meta.get('type') != 'session_meta' or meta.get('payload', {}).get('cwd') != str(PROJECT):
                    continue
            except (OSError, ValueError):
                continue
        return file
    return None


def start(engine, pane=None):
    check_login(engine)
    if pane is None:
        panes = herdr('pane', 'list').get('panes', [])
        pane = next((p['pane_id'] for p in panes if p.get('cwd') == str(PROJECT) and not p.get('agent')), None)
    if pane is None:
        pane = herdr('workspace', 'create', '--cwd', str(PROJECT), '--label', 'krabik').get('root_pane', {}).get('pane_id')
    if not pane:
        raise RuntimeError('Не удалось открыть панель Крабика')
    saved = session_file(engine)
    session_id = saved.stem[-36:] if saved else None
    if session_id and not UUID.fullmatch(session_id):
        session_id = None
    # Keep the existing owner-approved administrative rights and project rules.
    if engine == 'codex':
        # Herdr must own the interactive process and its proxy environment.
        args = ['--no-daemon'] + (['resume', session_id] if session_id else []) + ['--cd', str(PROJECT), '--ask-for-approval', 'never', '--sandbox', 'danger-full-access']
    else:
        args = (['--resume', session_id] if session_id else []) + ['--model', 'opus[1m]', '--permission-mode', 'bypassPermissions']
    result = herdr('agent', 'start', 'krabik', '--kind', engine, '--pane', pane, '--timeout', '12000', '--', *args)
    if not result:
        raise RuntimeError('Herdr не подтвердил запуск Крабика')


def ensure():
    engine = provider()
    agent = current()
    if agent:
        if agent.get('agent') != engine:
            raise RuntimeError('Крабик работает на другом движке; используй явное переключение')
        return 'ok'
    start(engine)
    return 'started'


def switch(engine):
    check_login(engine)  # Never stop a working fallback before target auth exists.
    agent = current()
    old = provider()
    if agent and agent.get('agent') == engine:
        CONFIG.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        CONFIG.write_text(engine + '\n')
        return 'ok'
    pane = None
    if agent:
        if agent.get('agent_status') not in ('idle', 'done'):
            raise RuntimeError('Крабик занят или ждёт ответа — переключение отложено')
        pane = agent.get('pane_id')
        herdr('agent', 'prompt', 'krabik', '/exit')
        for _ in range(20):
            if not current():
                break
            time.sleep(0.2)
        else:
            raise RuntimeError('Прежний движок ещё не завершился; второй агент не запущен')
    try:
        start(engine, pane)
    except Exception:
        # Preserve availability if target startup fails after an idle switch.
        if not current():
            start(old, pane)
        raise
    CONFIG.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    CONFIG.write_text(engine + '\n')
    return 'started'


def transcript():
    agent = current()
    engine = agent.get('agent') if agent else provider()
    if engine not in ('claude', 'codex'):
        raise RuntimeError('Неизвестный движок Крабика')
    session_id = (agent.get('agent_session') or {}).get('value') if agent else None
    file = session_file(engine, session_id)
    if file:
        with file.open('rb') as stream:
            stream.seek(0, os.SEEK_END)
            size = stream.tell()
            stream.seek(max(0, size - 3_000_000))
            sys.stdout.buffer.write(stream.read())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['ensure', 'transcript', 'check', 'switch'])
    parser.add_argument('engine', nargs='?', choices=['claude', 'codex'])
    args = parser.parse_args()
    if Path.home() != HOME:
        raise RuntimeError('Запускай от пользователя agents: sudo -iu agents')
    if args.action == 'transcript':
        transcript()
    elif args.action == 'check':
        check_login(args.engine or provider())
        print('ok')
    elif args.action == 'switch':
        if not args.engine:
            parser.error('switch requires claude or codex')
        print(switch(args.engine))
    else:
        print(ensure())


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print('error ' + str(error), file=sys.stderr)
        sys.exit(1)
