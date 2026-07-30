"""Собирает /guide из общего стиля и варп-движка лендинга Neo3 Agent System.

Собирает ТОЛЬКО /guide. Старое название «и /kp» неверно: /kp, /business и
/install ведутся вручную, /start собирается отдельным build_start.py.

По умолчанию НИЧЕГО НЕ ЗАТИРАЕТ — пишет черновик рядом и показывает, что
разойдётся с живой страницей. Причина: 2026-07-30 пересборка съела 33 строки
ручных правок живой /guide (og:url, canonical, классы .back/.toc/.doc h2 .num/
.path, ссылку «Вопросы» на /start, бейдж «Новое», пункт про скрепку и 20
файлов). Генератор отстал от страницы, поэтому право затирать у него забрали.

    python3 build_pages.py            # черновик + отчёт о расхождениях
    python3 build_pages.py --force    # перезаписать живую /guide

Перед --force перенеси в генератор всё, что он теряет, иначе откатишь прод.
"""
import pathlib, re, sys

from safe_write import safe_write

BASE = pathlib.Path(__file__).resolve().parent
FORCE = "--force" in sys.argv
src = (BASE / "index.html").read_text()

# --- общие куски из лендинга ---
style = re.search(r"<style>(.*?)</style>", src, re.S).group(1)
svg_defs = re.search(r"(<svg width=\"0\" height=\"0\".*?</svg>)", src, re.S).group(1)
lines = src.split("\n")
start = next(i for i, l in enumerate(lines) if "WARP «макс-кино»" in l)
end = next(i for i, l in enumerate(lines[start:], start) if l.strip() == "})();")
warp = "\n".join(lines[start:end + 1])

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '<link href="https://fonts.googleapis.com/css2?family=Russo+One&family=Jura:wght@400;600;700'
         '&family=Golos+Text:wght@400;500;600;700&family=Roboto+Flex:opsz,wdth,wght@8..144,25..151,100..1000'
         '&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">')

# Ядро дизайн-системы портала. Источник правды — neo3-hub/shared/neo3.css,
# копия раскладывается сюда скриптом neo3-hub/shared/sync.sh.
# Подключается ДО <style>, чтобы страница могла переопределить базу.
CORE_CSS = '<link rel="stylesheet" href="/neo3.css">'

FAVICON = ('<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' '
           'viewBox=\'0 0 64 64\'%3E%3Crect width=\'64\' height=\'64\' rx=\'14\' fill=\'%23070504\'/%3E'
           '%3Ctext x=\'32\' y=\'47\' font-family=\'Arial Black,Arial,sans-serif\' font-size=\'42\' '
           'font-weight=\'900\' fill=\'%23f7931a\' text-anchor=\'middle\'%3E3%3C/text%3E%3C/svg%3E">')

# --- CSS, общий для подстраниц ---
SUB_CSS = """
  /* ---------- подстраница: компактная шапка вместо 100svh-героя ---------- */
  .page-hero{position:relative;padding:140px 22px 40px;text-align:center}
  .page-hero h1{font-size:clamp(34px,7vw,68px);letter-spacing:-1px;margin-bottom:14px}
  .page-hero .sub{margin:0 auto}
  .back{display:inline-flex;align-items:center;gap:8px;font-family:'Jura',sans-serif;font-weight:600;
        font-size:13px;letter-spacing:1px;color:var(--muted);margin-bottom:22px;transition:color .2s}
  .back:hover{color:var(--a)}
  /* height:auto обязателен — глобальное правило nav{height:64px} (от шапки) резало оглавление */
  .toc{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:820px;margin:26px auto 0;height:auto}
  .toc a{font-family:'Jura',sans-serif;font-weight:600;font-size:12.5px;letter-spacing:.5px;color:var(--muted);
         border:1px solid var(--line);border-radius:999px;padding:7px 15px;transition:border-color .2s,color .2s}
  .toc a:hover{color:var(--fg);border-color:rgba(247,147,26,.5)}

  /* ---------- длинный текст ---------- */
  .doc{max-width:820px;margin:0 auto}
  .doc section{padding:44px 0;border-bottom:1px solid var(--line);scroll-margin-top:84px}
  .doc section:last-of-type{border-bottom:0}
  .doc h2{font-size:clamp(22px,3.4vw,30px);margin:0 0 14px;display:flex;flex-wrap:wrap;align-items:baseline;gap:0 14px}
  .doc h2 .num{font-family:'Russo One',sans-serif;font-size:26px;color:var(--a);opacity:.6;
               text-shadow:0 0 20px var(--glow);flex:none}
  .doc p{color:var(--muted);font-size:15.5px;line-height:1.7;margin-bottom:12px}
  .doc p strong,.doc li strong{color:var(--fg);font-weight:600}
  .doc ul{list-style:none;margin:6px 0 12px}
  .doc li{position:relative;padding-left:22px;color:var(--muted);font-size:15.5px;line-height:1.7;margin-bottom:9px}
  .doc li::before{content:'';position:absolute;left:2px;top:11px;width:7px;height:7px;border-radius:50%;
                  background:var(--a);box-shadow:0 0 10px var(--glow)}
  .path{font-family:'JetBrains Mono',monospace;font-size:13.5px;color:var(--a2);
        border:1px solid rgba(247,147,26,.3);border-radius:8px;padding:3px 9px;display:inline-block;
        max-width:100%;overflow-wrap:break-word}
  .tip{border:1px solid var(--line);border-left:3px solid var(--a);border-radius:0 14px 14px 0;
       background:var(--card);padding:16px 20px;margin:16px 0 4px}
  .tip p{margin:0;font-size:14.5px}
  .tip b{color:var(--a2)}

  /* ---------- живые скриншоты интерфейса ---------- */
  .shot{margin:20px 0 6px;border:1px solid var(--line);border-radius:14px;overflow:hidden;
        background:rgba(0,0,0,.35);box-shadow:0 24px 60px -34px rgba(0,0,0,.9)}
  .shot img{display:block;width:100%;height:auto}
  .shot figcaption{font-size:12.5px;color:var(--muted);padding:10px 15px;border-top:1px solid var(--line);
        background:var(--card)}
  .shot.narrow{max-width:330px}
  .shot.strip{max-width:560px}
"""

KP_CSS = """
  /* ---------- КП ---------- */
  .kp{max-width:900px;margin:0 auto}
  .kp section{padding:40px 0;border-bottom:1px solid var(--line)}
  .kp section:last-of-type{border-bottom:0}
  .kp h2{font-size:clamp(21px,3.2vw,28px);margin:0 0 8px}
  .kp p{color:var(--muted);font-size:15.5px;line-height:1.7;margin-bottom:12px}
  .kp p strong,.kp li strong{color:var(--fg);font-weight:600}
  .lead{font-size:17px!important;color:var(--fg)!important;line-height:1.65!important}
  .check{list-style:none;display:grid;gap:12px;margin-top:18px}
  .check li{position:relative;padding-left:38px;color:var(--muted);font-size:15.5px;line-height:1.65}
  .check li::before{content:'';position:absolute;left:0;top:1px;width:24px;height:24px;border-radius:50%;
    background:rgba(247,147,26,.12);border:1px solid rgba(247,147,26,.45)}
  .check li::after{content:'';position:absolute;left:8.5px;top:8px;width:6px;height:11px;
    border:solid var(--a);border-width:0 2.2px 2.2px 0;transform:rotate(42deg)}
  .flow{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-top:22px;counter-reset:f}
  .flow .st{border:1px solid var(--line);border-radius:16px;background:var(--card);padding:20px 16px}
  .flow .st::before{counter-increment:f;content:counter(f);font-family:'Russo One',sans-serif;font-size:26px;
    color:var(--a);opacity:.55;display:block;margin-bottom:6px;text-shadow:0 0 18px var(--glow)}
  .flow h3{font-family:'Jura',sans-serif;font-weight:700;font-size:15px;margin-bottom:5px}
  .flow p{font-size:13px;margin:0}
  .money{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px}
  .money .m{border:1px solid var(--line);border-radius:18px;background:var(--card);padding:24px 22px}
  .money .m h3{font-family:'Jura',sans-serif;font-weight:700;font-size:17px;margin-bottom:10px;color:var(--a2)}
  .money .m p{font-size:14.5px;margin:0}
  .soon-list{list-style:none;margin-top:18px;display:grid;gap:2px}
  .soon-list li{position:relative;padding:14px 0 14px 26px;border-top:1px solid var(--line);
    color:var(--muted);font-size:15px;line-height:1.6}
  .soon-list li:last-child{border-bottom:1px solid var(--line)}
  .soon-list li::before{content:'';position:absolute;left:4px;top:22px;width:10px;height:1.5px;
    background:var(--a);opacity:.7}
  @media(max-width:860px){.flow{grid-template-columns:1fr 1fr}.money{grid-template-columns:1fr}}
  @media(max-width:520px){.flow{grid-template-columns:1fr}}
  @media print{
    #road,#pixels,header,.back,.btn{display:none!important}
    body{background:#fff;color:#111}
    .kp section{border-color:#ddd;page-break-inside:avoid}
    .kp p,.kp li,.flow p{color:#333}
    h1,h2,.eyebrow,.money .m h3{color:#111!important;-webkit-text-fill-color:#111!important;
      background:none!important;text-shadow:none!important;animation:none!important;filter:none!important}
    .money .m,.flow .st,.banner{background:#fafafa;border-color:#ddd}
  }
"""

FOOT = """<footer><div class="wrap"><div class="foot">
  <div class="logo">NEO3 <b>AGENT</b></div>
  <div style="display:flex;gap:18px;flex-wrap:wrap;font-family:'Jura',sans-serif;font-weight:600;font-size:13px">
    <a href="/" style="color:var(--muted)">О продукте</a>
    <a href="/guide" style="color:var(--muted)">Гайд</a>
    <a href="https://neo3.ru" style="color:var(--muted)">neo3.ru · хаб</a>
    <a href="https://portfolio.neo3.ru" style="color:var(--muted)">Портфолио</a>
  </div>
  <div>© 2026 neo3 · Свой ИИ-агент для бизнеса</div>
</div></div></footer>"""

SUB_JS = """<script>
(function(){
  const reduce = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  if(!reduce)document.documentElement.classList.add('js');

  const hdr=document.getElementById('hdr');
  if(hdr){const onScroll=()=>hdr.classList.toggle('solid',window.scrollY>40);onScroll();
    window.addEventListener('scroll',onScroll,{passive:true});}

  document.querySelectorAll('.focus').forEach(el=>{
    const words=el.textContent.trim().split(/\\s+/);el.textContent='';
    words.forEach((w,i)=>{const s=document.createElement('span');s.className='w';s.style.setProperty('--i',i);
      s.textContent=w;el.appendChild(s);if(i<words.length-1)el.appendChild(document.createTextNode(' '));});
  });
  const io=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('seen');io.unobserve(e.target);}});},{threshold:.18});
  document.querySelectorAll('.focus,.card3,.st,.m').forEach(el=>io.observe(el));

__WARP__
})();
</script>"""


def page(title, desc, extra_css, body, noindex=False, canonical=None):
    robots = '<meta name="robots" content="noindex,nofollow">\n' if noindex else ''
    canon = f'<link rel="canonical" href="{canonical}">\n' if canonical else ''
    return f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
{robots}{canon}<meta property="og:type" content="website">
<meta property="og:site_name" content="neo3">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="https://cli.neo3.ru/og-neo3.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://cli.neo3.ru/og-neo3.png">
{FAVICON}
{FONTS}
{CORE_CSS}
<style>{style}{extra_css}</style>
</head>
<body>

{svg_defs}

<header id="hdr"><div class="wrap"><nav aria-label="Основная навигация">
  <a class="logo" href="/">NEO3 <b>AGENT</b></a>
  <div class="nav-links">
    <a href="/">О продукте</a>
    <a href="/business">Чем полезно</a>
    <a href="/guide">Гайд</a>
    <a href="/kp">Предложение</a>
  </div>
  <a class="btn pulse" href="https://t.me/bitcoin_tothe_moon" target="_blank" rel="noopener">Написать</a>
</nav></div></header>

<canvas id="road" aria-hidden="true"></canvas>

<main>
{body}
</main>

{FOOT}

{SUB_JS.replace('__WARP__', warp)}
</body>
</html>
"""


# ============================ GUIDE ============================
GUIDE_SECTIONS = [
    ("first", "Первый вход", """
    <p>Откройте ссылку вашего сервера в браузере. Первый, кто заходит, сам придумывает логин и пароль — это единственный вход на сервер, регистрация после этого закрывается.</p>
    <div class="tip"><p><b>Важно:</b> сохраните пароль в надёжном месте. Восстановить его самостоятельно через интерфейс нельзя — если потеряете, обращайтесь к тому, кто настраивал сервер.</p></div>
    <figure class="shot">
      <img src="/guide/img/01-login.webp" alt="Экран входа: логин и пароль придумывает первый, кто зашёл" loading="lazy">
      <figcaption>Экран входа: логин и пароль придумывает первый, кто зашёл</figcaption>
    </figure>"""),

    ("claude", "Подключение вашего аккаунта Claude", """
    <p>Прежде чем ставить агенту задачи, нужно подключить подписку. Путь такой:</p>
    <p><span class="path">Settings (шестерёнка) → Агенты → Claude → «Войти снова»</span></p>
    <p>Откроется ссылка входа в Anthropic — это компания, которая делает Claude. Логинитесь там своим аккаунтом, тем, на котором оформлена подписка Claude Code. После этого возвращаетесь в Neo3 Agent System — всё готово к работе.</p>
    <p>Данные входа хранятся только на вашем сервере. Ни с чьей чужой подпиской они не пересекаются.</p>
    <figure class="shot">
      <img src="/guide/img/02-connect.webp" alt="Settings → Агенты → Claude: статус подключения и кнопка «Войти снова»" loading="lazy">
      <figcaption>Settings → Агенты → Claude: статус подключения и кнопка «Войти снова»</figcaption>
    </figure>"""),

    ("screen", "Главный экран: три колонки", """
    <ul>
      <li><strong>Слева</strong> — список проектов и сеансов (историй переписки).</li>
      <li><strong>По центру</strong> — сам чат: сюда пишете задачи, здесь агент отвечает.</li>
      <li><strong>Наверху по центру</strong> — вкладки текущего проекта: <strong>Chat</strong> (чат), <strong>Files</strong> (файлы проекта), <strong>Tasks</strong> (список текущих и прошлых задач), иногда <strong>Shell</strong> (терминал, если не отключён администратором) и <strong>Browser</strong> (встроенный браузер для агента).</li>
    </ul>
    <figure class="shot">
      <img src="/guide/img/03-columns.webp" alt="Слева проекты и сеансы, по центру чат, сверху вкладки проекта" loading="lazy">
      <figcaption>Слева проекты и сеансы, по центру чат, сверху вкладки проекта</figcaption>
    </figure>"""),

    ("projects", "Проекты и сеансы", """
    <ul>
      <li><strong>Проект</strong> — это папка с документами или кодом, с которой работает агент (обычно ваш git-репозиторий).</li>
      <li><strong>Новый проект</strong> — кнопка сверху списка, указываете путь к папке.</li>
      <li><strong>Сеанс</strong> — отдельный диалог внутри проекта. Можно вести несколько параллельно, по разным задачам, не смешивая их в одну кучу.</li>
      <li><strong>Вкладка «Недавние»</strong> — быстрый доступ к последним сеансам, не нужно каждый раз искать их по проектам.</li>
      <li><strong>Избранное</strong> — закрепить важные проекты наверху списка.</li>
    </ul>
    <figure class="shot">
      <img src="/guide/img/04-projects.webp" alt="Боковая панель: избранные проекты сверху, поиск, вкладка «Недавние»" loading="lazy">
      <figcaption>Боковая панель: избранные проекты сверху, поиск, вкладка «Недавние»</figcaption>
    </figure>"""),

    ("task", "Как поставить задачу", """
    <p>Внизу чата — обычное текстовое поле. Пишите своими словами, что нужно сделать: «собери отчёт по продажам за июнь из файла X», «разбери, почему падает скрипт», «сделай черновик договора по шаблону».</p>
    <p>Агент читает и меняет файлы проекта сам, объясняет по ходу, что делает, и задаёт уточняющие вопросы, если формулировка неполная.</p>
    <h3 style="font-family:'Jura',sans-serif;font-weight:700;font-size:17px;margin:22px 0 8px">Выбор модели</h3>
    <p>Рядом с полем ввода — кнопка <strong>«Выбрать модель»</strong>. Модели отличаются скоростью, ценой и «сообразительностью»: для простой рутины подойдёт та, что попроще и быстрее, для сложной задачи — самая мощная. Меняется прямо в процессе диалога, без перезапуска.</p>
    <h3 style="font-family:'Jura',sans-serif;font-weight:700;font-size:17px;margin:22px 0 8px">Уровень размышления</h3>
    <p>Там же — переключатель того, насколько глубоко модель думает перед ответом. Быстрее и дешевле — для рутины. Медленнее, но основательнее — для задач, где ошибка дорого стоит. Тоже переключается на лету.</p>
    <figure class="shot strip">
      <img src="/guide/img/05-task.webp" alt="Поле ввода: рядом — выбор модели, уровень размышления и счётчик расхода" loading="lazy">
      <figcaption>Поле ввода: рядом — выбор модели, уровень размышления и счётчик расхода</figcaption>
    </figure>"""),

    ("working", "Пока агент работает", """
    <ul>
      <li>Можно свернуть браузер или заблокировать телефон — задача продолжает выполняться на сервере, ничего не обрывается.</li>
      <li>Если приложение установлено на телефон, придёт push-уведомление, когда задача готова — не нужно держать вкладку открытой и ждать.</li>
      <li>Кнопка <strong>«Стоп»</strong> останавливает текущий запуск, не теряя историю диалога — можно продолжить позже с того же места.</li>
    </ul>"""),

    ("tokens", "Счётчик токенов", """
    <p>Расход токенов — единиц, по которым тарифицируется подписка, — виден по каждой сессии. Не нужно гадать, во что обошлась конкретная задача: цифра перед глазами в реальном времени.</p>
    <figure class="shot strip">
      <img src="/guide/img/07-tokens.webp" alt="Счётчик токенов и остаток лимита — прямо в строке ввода" loading="lazy">
      <figcaption>Счётчик токенов и остаток лимита — прямо в строке ввода</figcaption>
    </figure>"""),

    ("files", "Файлы, задачи, терминал", """
    <ul>
      <li><strong>Files</strong> — посмотреть файлы проекта прямо в браузере, без скачивания.</li>
      <li><strong>Tasks</strong> — список задач, которые ставились агенту, с их статусами.</li>
      <li><strong>Shell</strong> — обычный терминал сервера. На части установок отключён специально, чтобы не нужно было разбираться в командной строке. Если вкладки нет — так и задумано.</li>
    </ul>
    <figure class="shot">
      <img src="/guide/img/08-files.webp" alt="Вкладка «Файлы»: содержимое проекта видно прямо в браузере" loading="lazy">
      <figcaption>Вкладка «Файлы»: содержимое проекта видно прямо в браузере</figcaption>
    </figure>"""),

    ("settings", "Настройки (шестерёнка вверху)", """
    <ul>
      <li><strong>Внешний вид</strong> — 13 визуальных тем, светлые и тёмные.</li>
      <li><strong>Агенты</strong> — подключение и переподключение аккаунта Claude (см. раздел 2).</li>
      <li><strong>Уведомления</strong> — push-уведомления о готовых задачах.</li>
      <li><strong>Голос</strong> — голосовой ввод сообщений вместо печати.</li>
      <li><strong>API, Git, Browser-use, Tasks</strong> — технические разделы. Обычному пользователю трогать не нужно, всё настроено при установке.</li>
    </ul>
    <figure class="shot">
      <img src="/guide/img/09-settings.webp" alt="Настройки → Внешний вид: тема, язык интерфейса, параметры редактора" loading="lazy">
      <figcaption>Настройки → Внешний вид: тема, язык интерфейса, параметры редактора</figcaption>
    </figure>"""),

    ("mobile", "Приложение на телефоне", """
    <p>Откройте сайт в браузере телефона → меню браузера → <strong>«Добавить на главный экран»</strong>. Иконка появится как у обычного приложения, будут приходить push-уведомления о готовых задачах — не нужно держать телефон с открытым браузером.</p>
    <p>Магазин приложений не нужен, установка ничего не весит.</p>
    <figure class="shot narrow">
      <img src="/guide/img/10-mobile.webp" alt="Тот же интерфейс на телефоне — ставится на домашний экран" loading="lazy">
      <figcaption>Тот же интерфейс на телефоне — ставится на домашний экран</figcaption>
    </figure>"""),

    ("trouble", "Если что-то не работает", """
    <ul>
      <li><strong>Чат «завис»</strong> — смело закрывайте вкладку и открывайте заново, прогресс не теряется.</li>
      <li><strong>Агент не отвечает совсем</strong> — проверьте, что аккаунт Claude всё ещё подключён: <span class="path">Settings → Агенты</span> — не истекла ли подписка или сессия входа.</li>
      <li><strong>Любые другие сбои</strong> — напишите тому, кто настраивал сервер. Это входит в поддержку.</li>
    </ul>"""),
]

toc = "\n".join(f'    <a href="#{sid}">{i}. {t}</a>' for i, (sid, t, _) in enumerate(GUIDE_SECTIONS, 1))
secs = "\n".join(
    f'  <section id="{sid}">\n    <h2><span class="num">{i}</span>{t}</h2>{body}\n  </section>'
    for i, (sid, t, body) in enumerate(GUIDE_SECTIONS, 1))

guide_body = f"""<div class="page-hero wrap">
  <a class="back" href="/">← К описанию продукта</a>
  <div class="eyebrow">Инструкция</div>
  <h1 class="focus" style="font-family:'Jura',sans-serif;text-transform:uppercase;color:var(--fg);
      -webkit-text-fill-color:currentColor;background:none;animation:none;filter:none">Гайд по интерфейсу</h1>
  <p class="sub" style="max-width:660px">Для человека, который раньше не пользовался подобными инструментами и не является программистом. Каждый экран — простыми словами.</p>
  <nav class="toc" aria-label="Содержание">
{toc}
  </nav>
</div>

<div class="wrap doc">
{secs}

  <section style="text-align:center;border-bottom:0">
    <p style="font-size:16px">Остались вопросы по интерфейсу — просто напишите, разберём вживую.</p>
    <a class="btn pulse shine" href="https://t.me/bitcoin_tothe_moon" target="_blank" rel="noopener"
       style="font-size:16px;padding:15px 34px;margin-top:8px">Написать в Telegram</a>
  </section>
</div>"""

safe_write(BASE / "guide" / "index.html", page(
    "Гайд по интерфейсу Neo3 Agent System — для новичка",
    "Пошаговая инструкция по Neo3 Agent System для человека без технического опыта: первый вход, подключение Claude, проекты и сеансы, постановка задач, приложение на телефоне.",
    SUB_CSS, guide_body, canonical="https://cli.neo3.ru/guide"), FORCE)

# ============================ КП ============================
kp_body = """<div class="page-hero wrap">
  <div class="eyebrow">Коммерческое предложение</div>
  <h1 class="focus" style="font-family:'Jura',sans-serif;text-transform:uppercase;color:var(--fg);
      -webkit-text-fill-color:currentColor;background:none;animation:none;filter:none;font-size:clamp(28px,5.4vw,52px);max-width:900px;margin:0 auto">ИИ-агент для вашего бизнеса на вашем сервере</h1>
  <p class="sub" style="max-width:680px">Не разовая автоматизация под одну задачу, а рабочий инструмент, которым вы пользуетесь сами — для любых задач, без нового исполнителя каждый раз.</p>
</div>

<div class="wrap kp">

  <section>
    <div class="eyebrow">Суть</div>
    <h2 class="focus">Что предлагаю</h2>
    <p class="lead">Разворачиваю на отдельном сервере вашего бизнеса ИИ-агента на том же движке, что стоит за Claude Code от Anthropic — в виде сайта и приложения на телефоне, доступного без VPN. Беру на себя сервер, установку, подключение подписки, обучение и поддержку. Дальше вы сами, обычными словами, ставите агенту задачи.</p>
    <p>Ключевое отличие от привычного чат-бота: агент живёт рядом с файлами вашего бизнеса, сам их читает и меняет, а не просто отвечает текстом в окне, который вы потом руками переносите в работу.</p>
  </section>

  <section>
    <div class="eyebrow">Зачем</div>
    <h2 class="focus">Что это меняет</h2>
    <ul class="check">
      <li><strong>Нет очереди к исполнителю.</strong> Сегодня каждая новая задача — это новый заказ, поиск подрядчика, ожидание и повторная оплата за настройку. Здесь настройка одна, а задачи — любые и когда угодно.</li>
      <li><strong>Задачи ставятся словами, а не техническим заданием.</strong> «Собери отчёт по продажам за июнь из выгрузки», «сведи прайсы трёх поставщиков и подсвети расхождения», «сделай черновик договора по нашему шаблону».</li>
      <li><strong>Работает, пока вы заняты.</strong> Поставили задачу — можно закрыть браузер или заблокировать телефон: придёт уведомление, когда готово.</li>
      <li><strong>Разбираться в своём бизнесе с помощью ИИ должен сам предприниматель.</strong> Я даю для этого рабочий инструмент и учу им пользоваться, а не становлюсь узким горлышком между вами и результатом.</li>
    </ul>
  </section>

  <section>
    <div class="eyebrow">Состав</div>
    <h2 class="focus">Что входит в работу</h2>
    <ul class="check">
      <li><strong>Сервер.</strong> Арендую и настраиваю отдельный VPS (арендованный сервер в дата-центре) под ваш бизнес — при необходимости в России. Это ваша машина, а не место на общей.</li>
      <li><strong>Установка.</strong> Разворачиваю проверенную сборку и подключаю вашу подписку. С оплатой помогаю: прямой аккаунт Anthropic требует не-российскую карту, для РФ есть вариант проще через реселлера — разбираем оба на месте.</li>
      <li><strong>Обучение.</strong> Письменный гайд по каждому экрану плюс живой разбор первых задач именно вашего бизнеса.</li>
      <li><strong>Поддержка.</strong> Остаюсь на связи: если что-то пошло не так — разбираюсь и чиню.</li>
    </ul>
  </section>

  <section>
    <div class="eyebrow">Порядок</div>
    <h2 class="focus">Как проходит запуск</h2>
    <div class="flow">
      <div class="st"><h3>Разговор</h3><p>Обсуждаем задачи вашего бизнеса и что именно вы хотите переложить на агента.</p></div>
      <div class="st"><h3>Сервер</h3><p>Арендую и готовлю отдельную машину под вас.</p></div>
      <div class="st"><h3>Установка</h3><p>Разворачиваю сборку, подключаю вашу подписку, настраиваю рабочую папку.</p></div>
      <div class="st"><h3>Проверка</h3><p>Прогоняю обязательный тест: реальная задача, обрыв связи, перезапуск сервера.</p></div>
      <div class="st"><h3>Передача</h3><p>Отдаю ссылку и пароль, показываю интерфейс, разбираем первые задачи.</p></div>
    </div>
    <p style="margin-top:22px"><strong>По срокам:</strong> от согласия до рабочей ссылки с логином и паролем — часы, а не недели. Процесс отработан по чек-листу, ничего не импровизируется на ходу.</p>
  </section>

  <section>
    <div class="eyebrow">Инструмент</div>
    <h2 class="focus">Что вы получаете в интерфейсе</h2>
    <ul class="check">
      <li><strong>Надёжность.</strong> Полгода боевых доработок на живом сервере: чат не виснет, если свернуть браузер или телефон уснул посреди задачи, а после перезапуска сервис поднимается сам, без потери прогресса.</li>
      <li><strong>Приложение на телефоне.</strong> Ставится на домашний экран без магазинов приложений, с push-уведомлениями о готовых задачах.</li>
      <li><strong>Доступ без VPN.</strong> Открывается как обычный сайт.</li>
      <li><strong>Управление прямо в чате.</strong> Модель под задачу — побыстрее или поумнее, глубина размышления и счётчик расхода в реальном времени.</li>
      <li><strong>Файлы и история под рукой.</strong> Файлы проекта видно в браузере, задачи — со статусами, недавние сеансы — в один клик.</li>
      <li><strong>Сотрудникам — по отдельному кабинету.</strong> Свой вход и свой проект у каждого, работа не пересекается, файлы синхронизируются через git.</li>
    </ul>
  </section>

  <section>
    <div class="eyebrow">Деньги и данные</div>
    <h2 class="focus">Из чего складывается стоимость</h2>
    <div class="money">
      <div class="m">
        <h3>Моя часть</h3>
        <p>Аренда и настройка сервера, установка, подключение подписки, обучение и поддержка. Считается под ваш случай — зависит от того, сколько человек будет работать и что именно нужно настроить. Обсуждаем на первом разговоре, без сюрпризов задним числом.</p>
      </div>
      <div class="m">
        <h3>Подписка Anthropic</h3>
        <p>Вы платите за неё напрямую, со своего аккаунта. Я не перепродаю доступ через общий — это честнее и безопаснее для вас: нет риска, что из-за чужих действий общий аккаунт заблокируют и работа встанет у всех разом.</p>
      </div>
    </div>
    <p style="margin-top:22px"><strong>Ваши данные остаются вашими.</strong> Файлы, история диалогов и вход в аккаунт хранятся только на вашем сервере — с другими клиентами не пересекается ничего, у каждого своя машина. Рабочая папка агента — ваш приватный репозиторий: это обычные файлы, не запертый формат. Захотите уйти — сервер, файлы и аккаунт останутся у вас целиком.</p>
  </section>

  <section>
    <div class="eyebrow">Честно</div>
    <h2 class="focus">О чём говорю прямо</h2>
    <p>Часть вещей видна в интерфейсе или стоит в плане, но пока не обкатана в бою так, как Claude. Когда будут готовы — вы получите их бесплатным обновлением. Как доступное сегодня я их не обещаю:</p>
    <ul class="soon-list">
      <li><strong>Другие движки вместо Claude</strong> — Codex, Cursor, OpenCode, Kimi K2</li>
      <li><strong>Личные логины сотрудников на одном сервере</strong> — сегодня каждому делается отдельный кабинет, это работает</li>
      <li><strong>Отдельная база знаний под документы</strong> — сейчас агент работает с обычной папкой файлов</li>
      <li><strong>Веб-панель, где вы сами добавляете сотрудников</strong> — пока делаю вручную, это быстро</li>
    </ul>
    <p style="margin-top:18px">Так же прямо отвечу на любой вопрос при разговоре: если чего-то инструмент не умеет, вы услышите это до оплаты, а не после.</p>
  </section>

  <section style="text-align:center;border-bottom:0;padding-bottom:20px">
    <div class="eyebrow">Следующий шаг</div>
    <h2 class="focus">Посмотрим на вашем примере</h2>
    <p style="max-width:600px;margin:0 auto 26px">Напишите в Telegram — разберём задачи вашего бизнеса, покажу интерфейс вживую и скажу, что именно войдёт в работу у вас.</p>
    <a class="btn pulse shine" href="https://t.me/bitcoin_tothe_moon" target="_blank" rel="noopener"
       style="font-size:17px;padding:16px 38px">Написать в Telegram</a>
    <p style="margin-top:26px;font-size:14px">Подробное описание продукта — <a href="/" style="color:var(--a)">cli.neo3.ru</a> · Гайд по интерфейсу — <a href="/guide" style="color:var(--a)">cli.neo3.ru/guide</a></p>
  </section>
</div>"""

# /kp и /business — самодостаточные страницы, поддерживаются ВРУЧНУЮ
# (исходники: kp-business-preview.html / biz-value-preview.html в корне проекта).
# Сборщик их НЕ генерит и НЕ трогает, чтобы случайным перезапуском не затереть.
# Здесь остаётся только сборка /guide.

print("guide:", (BASE / "guide" / "index.html").stat().st_size, "bytes")
