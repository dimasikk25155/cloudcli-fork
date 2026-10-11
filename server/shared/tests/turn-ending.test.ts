import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyTurnEnding } from '@/shared/turn-ending.js';

// Endings taken from real Neo3 sessions (Claude/Grok/Codex replies to Dima):
// the agent stops and asks for a manual action on the user's side.
const MANUAL_ASKS = [
  'Сборка выкачена на тестовый порт.\n\nОткрой http://localhost:3006 на телефоне и пришли скриншот хаба.',
  'Кэш почистил.\n\nНажми «Обновить» в панели сервера — должно позеленеть.',
  'Ссылка на оплату готова.\n\nСкопируй ссылку из письма и вставь сюда, я проверю статус.',
  'Правку залил в форк.\n\nПроверь у себя на телефоне, пропала ли жёлтая точка.',
  'Ключ перевыпущен в кабинете.\n\nСкинь мне новый токен через .secrets.env, дальше сделаю сам.',
  'Скрипт лежит в ~/bin/clipwatch.\n\nЗапусти у себя в терминале: `clipwatch --once` и пришли вывод.',
  'Нужен вход в аккаунт.\n\nЗайди в кабинет Cloudflare и подтверди код из письма.',
  'Осталось за тобой:\n1. Открой настройки Telegram-бота.\n2. Отправь /start боту @neo3_speech_bot.',
  'Теперь сделай рестарт приложения на телефоне — смахни его и открой заново.',
  'APK собран: Neo3AgentSystem.apk.\n\nСкачай его по ссылке и установи поверх старого.',
  'All set on the server side.\n\nPlease open the dashboard and send me a screenshot.',
];

// Endings with a direct question and no imperative request.
const QUESTIONS = [
  'Нашёл две причины лагов.\n\nЧинить обе сразу или начнём с Tailscale?',
  'Готово, тесты зелёные.\n\nВыкатываю на прод?',
  'Есть два варианта названия: «Ждут тебя» и «Нужен ответ». Какой берём?',
  'Should I also update the Android build?',
];

// Ordinary end-of-turn reports: nothing is asked of the user.
const NEUTRAL = [
  'Готово. Сборка зелёная, typecheck и тесты проходят.',
  'Исправил регэксп ретрая в claude-sdk.js, добавил тест на новую формулировку ошибки. Коммит bbb46ad8.',
  'Если хочешь, могу ещё добавить кнопку «Скопировать» в окно файла.',
  'Открыл файл, нашёл причину: таймаут был 5 минут вместо бесконечного ожидания. Поправил.',
  'Деплой прошёл, smoke зелёный: https://cli.neo3.ru/?ref=hub отвечает 200.',
  '⏳ Серверы Anthropic перегружены — повторяю запрос сам через 15 с (попытка 1 из 3). Делать ничего не надо.',
  'Вот команда, которой я проверял:\n\n```bash\ncurl -s "https://example.com/api?x=1" | jq .\n# открой и пришли\n```',
];

test('manual-action endings are classified as manual_ask', () => {
  for (const text of MANUAL_ASKS) {
    const result = classifyTurnEnding(text);
    assert.equal(result.kind, 'manual_ask', `expected manual_ask for: ${text}`);
    assert.ok(result.excerpt.length > 0, `excerpt must not be empty for: ${text}`);
  }
});

test('direct question endings are classified as question', () => {
  for (const text of QUESTIONS) {
    const result = classifyTurnEnding(text);
    assert.equal(result.kind, 'question', `expected question for: ${text}`);
  }
});

test('neutral report endings are classified as none', () => {
  for (const text of NEUTRAL) {
    const result = classifyTurnEnding(text);
    assert.equal(result.kind, 'none', `expected none for: ${text}`);
    assert.equal(result.excerpt, '');
  }
});

test('the excerpt is the last paragraph, not earlier text', () => {
  const result = classifyTurnEnding('Первый абзац с отчётом.\n\nВыкатываю на прод?');
  assert.equal(result.excerpt, 'Выкатываю на прод?');
});

test('a long final paragraph is cut to at most 200 characters', () => {
  const long = `${'Длинное пояснение '.repeat(30)}— выкатываю?`;
  const result = classifyTurnEnding(long);
  assert.equal(result.kind, 'question');
  assert.ok(result.excerpt.length <= 200);
});

test('empty or non-string input is none', () => {
  assert.deepEqual(classifyTurnEnding(''), { kind: 'none', excerpt: '' });
  assert.deepEqual(classifyTurnEnding(undefined as unknown as string), { kind: 'none', excerpt: '' });
});
