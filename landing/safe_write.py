"""Безопасная запись для сборщиков страниц лендинга.

Зачем: 2026-07-30 пересборка /guide затёрла 33 строки ручных правок живой
страницы (og:url, canonical, классы .back/.toc/.path, ссылку «Вопросы» на
/start, бейдж «Новое», пункт про скрепку). Сборщики отстали от страниц,
которые люди правили руками, поэтому право молча затирать у них забрали.

Поведение: пишем черновик рядом (<имя>.generated.html), показываем, какие
строки живой страницы генератор потеряет, и НЕ трогаем живой файл.
Перезапись — только осознанно, флагом --force.
"""


def safe_write(path, content, force=False):
    path.parent.mkdir(exist_ok=True)
    draft = path.with_name(path.stem + ".generated" + path.suffix)
    label = f"{path.parent.name}/{path.name}"

    if not path.exists():
        path.write_text(content, encoding="utf-8")
        print(f"создано: {label} (живого файла не было)")
        return

    draft.write_text(content, encoding="utf-8")
    live = path.read_text(encoding="utf-8").splitlines()
    new = set(content.splitlines())
    lost = [l.strip() for l in live if l not in new and l.strip()]

    if lost:
        print(f"\n⚠ {label}: генератор потеряет {len(lost)} строк(и) живой страницы:")
        for line in lost[:12]:
            print(f"    − {line[:110]}")
        if len(lost) > 12:
            print(f"    … и ещё {len(lost) - 12}")
    else:
        print(f"{label}: расхождений с живой страницей нет.")

    if force:
        path.write_text(content, encoding="utf-8")
        draft.unlink()
        print(f"ПЕРЕЗАПИСАНО (--force): {label}")
    else:
        print(f"живой файл НЕ тронут. Черновик: {label.replace(path.name, draft.name)}")
        print(f"    сравнить:  diff {label} {label.replace(path.name, draft.name)}")
