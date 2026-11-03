"""Record a one-shot release only after its independent verifier succeeds."""
import json
import pathlib
import subprocess
import sys

root = pathlib.Path("/Users/dimasik/Antigravity Project/claude agent/cloudcli-fork")
release = pathlib.Path(sys.argv[1]).resolve()
node = "/usr/local/bin/node"
result = subprocess.run([node, str(release / "apply-combined-local-release.mjs"), "--apply", str(release / "manifest.json")], cwd=root)
status_path = release / "status.json"
status = json.loads(status_path.read_text()) if status_path.exists() else {}
if result.returncode or status.get("status") != "verified":
    print("Release not verified; Autopilot remains unfinished. See release report.")
    sys.exit(1)

def ap(*args):
    subprocess.run([sys.executable, str(root / ".autopilot/ap.py"), *args], cwd=root, check=True)

ap("ticket", "05", "done", "--tests", "1692/0", "--commit", status["sourceSha"])
ap("tests", "1692/0")
ap("add", "report", "Общий выпуск четырёх сессий проверен отдельным исполнителем: новый PID, origin/public health, точный JS, новые таблицы и маршруты. Доставка писем и полный browser E2E не заявляются.")
progress = root / ".autopilot/PROGRESS.md"
old = progress.read_text()
progress.write_text("# Подтверждённый общий выпуск 03.11.2026\n\n" +
    "Все четыре набора изменений объединены и применены. Исходный коммит: `" + status["sourceSha"] + "`. Новый PID: " + str(status["verification"]["pid"]) + ".\n" +
    "1692/1692 теста; типы и обе сборки; две миграции на копии базы сохранили данные 30 таблиц.\n" +
    "Проверка выпуска: `" + str(release / "report.md") + "`. Backup и старые сборки: `" + str(release) + "`.\n" +
    "Почта без подключения, доставка писем, печать PDF и полный browser E2E остаются непроверенными. Указания ниже о неприменённом коде — исторические, заменены этим подтверждением.\n\n" + old)
ap("finish", "--result", "Четыре работы объединены и применены; новый PID и точная публичная сборка проверены, внешние E2E-ограничения сохранены")
# Commit only the run record, never unrelated work that may have resumed.
subprocess.run(["git", "add", "--", ".autopilot"], cwd=root, check=True)
subprocess.run(["git", "commit", "-m", "docs: record verified combined Neo3 release", "--", ".autopilot"], cwd=root, check=True)
print("Verified release recorded in Autopilot and Git.")
