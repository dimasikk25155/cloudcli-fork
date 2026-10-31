/**
 * Тексты заданий модели и разбор её ответов. Без сети и диска — чистые функции.
 *
 * Бриф и идеи идут прогоном «только чтение» (readOnly в runHeadlessPrompt):
 * модель может открыть код бота, но ничего не меняет. Действия — только
 * через решения, которые одобряет Дима.
 */
import path from 'node:path';
const STATUS_RU = {
    up: 'работает',
    idle: 'ждёт по расписанию',
    down: 'лежит',
    missing: 'нет на машине',
    unreachable: 'машина не отвечает',
    unknown: 'не проверить',
};
export function statusRu(status) {
    return STATUS_RU[status] ?? status;
}
export function moscowTime(iso) {
    try {
        return new Date(iso).toLocaleString('ru-RU', {
            timeZone: 'Europe/Moscow',
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    }
    catch {
        return iso;
    }
}
function serviceLine(entry, muted) {
    return [
        `- [${entry.id}]`,
        entry.crit ? 'КРИТ' : 'обычн',
        `${entry.machine}/${entry.method}`,
        `«${entry.label}» (${entry.target})`,
        `— ${statusRu(entry.status)} с ${moscowTime(entry.since)}`,
        muted.has(entry.id) ? '[не следим — Дима выключил наблюдение]' : '',
    ].filter(Boolean).join(' ');
}
const KIND_RU = {
    morning: 'утренний бриф',
    manual: 'Дима нажал «Проверить сейчас»',
    incident: 'только что упал сервис',
};
export function buildBriefPrompt(input) {
    const muted = new Set(input.muted);
    const broken = input.snapshot.services.filter((entry) => entry.status !== 'up' && entry.status !== 'idle' && !muted.has(entry.id));
    const logs = broken
        .map((entry) => (input.details[entry.id] ? `### [${entry.id}] ${entry.label}\n${input.details[entry.id]}` : ''))
        .filter(Boolean)
        .join('\n\n');
    const events = input.events.slice(-25).map((event) => `- ${moscowTime(event.at)} ${event.text}`).join('\n');
    const pending = input.pending.map((decision) => `- [${decision.serviceId}] ${decision.title}`).join('\n');
    const ideas = input.ideas.filter((idea) => idea.status === 'new').length;
    return [
        'Ты — «Дуэт», напарник Димы. Следишь за его ботами и сервисами и пишешь первым, как Claude Duet.',
        `Повод: ${KIND_RU[input.kind]}. Сейчас ${moscowTime(input.now.toISOString())} МСК.`,
        '',
        'Парк (id в квадратных скобках):',
        input.snapshot.services.map((entry) => serviceLine(entry, muted)).join('\n'),
        '',
        logs ? `Логи того, что не работает:\n\n${logs}` : 'Логов нет: всё работает или машина не отвечает.',
        '',
        events ? `События за последние сутки:\n${events}` : 'Событий за сутки не было.',
        pending ? `\nУже ждут решения Димы (не предлагай их снова):\n${pending}` : '',
        `\nНовых идей по ботам ждёт: ${ideas}.`,
        '',
        'Правила:',
        '- Пиши по-русски, просто, без жаргона: Дима читает с телефона. Не выдумывай сервисы — только из списка.',
        '- Можешь читать файлы (Read/Grep/Glob), чтобы понять причину. Ничего не меняешь и не запускаешь.',
        '- Секреты (.env, .secrets.env) не открывай и значения ключей не пиши.',
        '- Сервис, выключенный, похоже, намеренно (disabled, давно лежит, заменён), предложи «не следить», а не чинить.',
        '- Если всё хорошо — так и скажи одной-двумя строками, не раздувай.',
        '',
        'Ответь ТОЛЬКО JSON, без ``` и текста вокруг:',
        '{"brief": "markdown, до 12 строк: главное сверху, что лежит и почему (если видно), что советуешь",',
        ' "proposals": [{"serviceId": "id из списка", "choice": "restart|fix|mute", "why": "одна строка, почему"}]}',
        'proposals — только по тому, что не работает и ещё не ждёт решения; restart — если похоже на разовый сбой,',
        'fix — если нужна починка агентом (ошибка в коде, конфиге, токене), mute — если выключено намеренно.',
    ].join('\n');
}
/** Первый JSON-объект из ответа модели (с ``` или без). */
export function extractJson(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : text;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start)
        return null;
    try {
        return JSON.parse(body.slice(start, end + 1));
    }
    catch {
        return null;
    }
}
function clip(text, max) {
    const value = typeof text === 'string' ? text.trim() : '';
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
/** Битый ответ — не исключение: текст модели становится брифом как есть. */
export function parseBriefReply(text, knownIds) {
    const json = extractJson(text);
    if (!json || typeof json.brief !== 'string') {
        return { brief: clip(text, 4000) || 'Дуэт не смог собрать бриф.', proposals: [] };
    }
    const proposals = [];
    const seen = new Set();
    for (const raw of Array.isArray(json.proposals) ? json.proposals : []) {
        const item = raw;
        const id = typeof item.serviceId === 'string' ? item.serviceId.trim() : '';
        const choice = item.choice;
        if (!knownIds.has(id) || seen.has(id))
            continue;
        if (choice !== 'restart' && choice !== 'fix' && choice !== 'mute')
            continue;
        seen.add(id);
        proposals.push({ serviceId: id, choice, why: clip(item.why, 240) });
    }
    return { brief: clip(json.brief, 4000), proposals };
}
export function buildIdeasPrompt(input) {
    const { service } = input;
    return [
        `Ты — «Дуэт», напарник Димы. Посмотри бота/сервис «${service.label}» и предложи, как сделать его лучше.`,
        `Где работает: ${service.machine} (${service.method} ${service.target}), сейчас ${statusRu(service.status)}.`,
        `Код проекта — текущая папка: ${input.projectPath}`,
        '',
        'Как смотреть: сначала CLAUDE.md и README, потом главные файлы (Read/Grep/Glob, не больше ~20 файлов).',
        'Ты только читаешь: ничего не меняешь и не запускаешь. Секреты (.env, .secrets.env) не открывай.',
        '',
        'Нужны до 3 идей, которые реально помогут: людям, которые пользуются ботом (больше пользы, меньше трения),',
        'или надёжности (не падает, сам встаёт, видно, что сломалось). Конкретно: что сделать и где в коде.',
        'Без общих слов вроде «добавить тесты» или «улучшить логирование», если не видно конкретной боли.',
        input.existingTitles.length > 0
            ? `Эти идеи уже были — не повторяй:\n${input.existingTitles.map((title) => `- ${title}`).join('\n')}`
            : '',
        '',
        'Ответь ТОЛЬКО JSON, без ``` и текста вокруг, по-русски:',
        '{"ideas": [{"title": "до 80 символов", "why": "2–3 предложения: что сделать, зачем, какие файлы", "effort": "S|M|L"}]}',
    ].filter((line) => line !== '').join('\n');
}
export function parseIdeasReply(text, existingTitles) {
    const json = extractJson(text);
    const seen = new Set(existingTitles.map((title) => title.trim().toLowerCase()));
    const ideas = [];
    for (const raw of Array.isArray(json?.ideas) ? json.ideas : []) {
        const item = raw;
        const title = clip(item.title, 100);
        const why = clip(item.why, 700);
        if (!title || !why || seen.has(title.toLowerCase()))
            continue;
        seen.add(title.toLowerCase());
        const effort = item.effort === 'S' || item.effort === 'L' ? item.effort : 'M';
        ideas.push({ title, why, effort });
        if (ideas.length >= 3)
            break;
    }
    return ideas;
}
// ------------------------------------------------------------------ работа по одобрению
const RULES = [
    'Не трогай другие сервисы, профили Dolphin и прокси-слот 447902. Секреты не печатай.',
    'Первая строка ответа строго: «ИТОГ: ГОТОВО — …», «ИТОГ: НЕ ВЫШЛО — …» или «ИТОГ: НЕ НАДО — …»,',
    'потом 2–5 строк по-русски, что сделал и что осталось Диме (если осталось).',
];
export function buildFixPrompt(service, detail) {
    const access = service.machine === 'vps-nl'
        ? 'Доступ: `ssh vps-nl` (root). Шпаргалка — скилл vps-ops.'
        : service.machine === 'mac'
            ? 'Это мак, на котором ты работаешь: launchctl, логи в папке проекта.'
            : 'Машина — Windows: `ssh claude@100.98.152.66`, шпаргалка — скилл win-ops.';
    return [
        `Дима разрешил Дуэту починить «${service.label}» (${service.machine}, ${service.method} ${service.target}).`,
        `Сейчас: ${statusRu(service.status)} с ${moscowTime(service.since)} МСК.`,
        access,
        detail ? `Что видно в логе:\n${detail}` : 'Лога нет — начни с журнала сервиса.',
        '',
        'Найди причину и почини. Если сервис выключен намеренно — ничего не включай, так и напиши («НЕ НАДО»).',
        'Если без Димы никак (новый вход, токен, оплата) — не обходи, напиши одной строкой, что ему сделать.',
        ...RULES,
    ].join('\n');
}
export function buildIdeaPrompt(service, idea) {
    return [
        `Дима одобрил идею Дуэта для «${service.label}»: ${idea.title}.`,
        idea.why,
        '',
        'Сделай это в текущем проекте. Сначала прочитай CLAUDE.md проекта и следуй ему.',
        'Проверь работу (тесты или сборка, если они есть). На прод не выкатывай и боевые сервисы не перезапускай —',
        'в конце напиши, как выкатить. Если это git-репозиторий, сохрани работу коммитом в отдельной ветке duet/<коротко>.',
        ...RULES,
    ].join('\n');
}
/** «ИТОГ: …» — удалось ли (НЕ НАДО тоже успех: Дуэт честно ничего не тронул). */
export function parseOutcome(text) {
    const line = text.split('\n').map((value) => value.trim()).find((value) => /^\**ИТОГ:/i.test(value)) ?? '';
    const ok = line ? !/НЕ ВЫШЛО/i.test(line) : text.trim().length > 0;
    const summary = clip(line.replace(/^\**ИТОГ:\s*/i, '').replace(/\*+$/, '') || text, 300);
    return { ok, summary };
}
// ------------------------------------------------------------------ привязка к проектам
/**
 * Угадывает папку проекта по сервису. Строго: имя юнита начинается с имени
 * папки (`insta-comments-api` → `insta-comments`) или первое слово подписи
 * совпадает с папкой (`tyres WA` → `Tyres`). Остальное Дима привяжет в панели.
 */
export function guessProject(service, projectPaths) {
    const base = service.target
        .replace(/^(ru\.neo3\.|com\.dimasik\.|com\.dima\.)/, '')
        .replace(/\.(service|timer)$/, '')
        .toLowerCase();
    const firstWord = service.label.split(/[\s—–-]+/)[0]?.toLowerCase() ?? '';
    let best = null;
    for (const projectPath of projectPaths) {
        const folder = path.basename(projectPath).toLowerCase().replace(/\s+/g, '-');
        if (folder.length < 4)
            continue;
        const hit = base === folder || base.startsWith(`${folder}-`) || firstWord === folder;
        if (hit && (!best || folder.length > path.basename(best).length))
            best = projectPath;
    }
    return best;
}
//# sourceMappingURL=duet-brain.js.map