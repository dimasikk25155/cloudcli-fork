// Manual source audit, not a runtime test or an instruction to apply upstream.
// Keep revision pins: a later code change requires another behavioral review.
export const reviewedProposal = {
  reviewedAt: '2026-09-24',
  forkSha: 'dc1c288815f82847a41662e5f8b9c39a8137d2af',
  upstreamSha: '6c51fcaa76c250af70561fad7312c5a7f841a733',
  method: 'Ручное сравнение исходного кода, без end-to-end воспроизведения. Выводы относятся к снимку на дату проверки; локальные правки требуют повторной проверки перед переносом.',
  firstBatch: [
    { sha: '557109a2e98e833ad9cb6659ec89e97ccacdd024', title: 'Защита токена GitHub при клонировании', coverage: 'missing-at-review', risk: 'Средний риск: взять только защиту clone/route/progress, не весь PR из 87 файлов. Проверить синтетическим токеном argv, origin и потоки вывода.' },
    { sha: 'fd424f3fcd739371daeb6b173167e61f95270670', title: 'Safari: подтверждение IME не отправляет сообщение', coverage: 'missing-at-review', risk: 'Небольшой перенос; сохранить собственные double-Enter и историю ввода.' },
    { sha: '3ed3be5aa047b17ed1f6e591cfd3692eda2f1160', title: 'Закрытие настроек по Escape и фону', coverage: 'missing-at-review', risk: 'Сохранить вложенные окна: Escape закрывает сначала верхний слой, drag-selection не закрывает настройки.' },
  ],
  secondBatch: [
    { sha: '580be52dacd3538f1b0ec6fee56aa02d793cd21a', title: 'Точные ссылки на файлы и строки', coverage: 'missing-at-review', risk: 'Средний риск, 18 файлов: сохранить доступ к внешним файлам и политику файловой системы форка.' },
    { sha: '6c51fcaa76c250af70561fad7312c5a7f841a733', title: 'Изменяемая ширина боковой панели', coverage: 'missing-at-review', risk: 'Средний риск: перенести resize и нужный overflow, не всю переделку header; проверить мобильный drawer.' },
  ],
  partial: 'Восстановление фоновых агентов покрыто частично; свой streaming input и task_notification уже есть. Большой upstream PR требует отдельного согласования и воспроизведения конкретной ошибки.',
  alreadyPresent: ['история ввода стрелками (#1238)', 'сохранение архива при rescan (#1220)', 'одновременная загрузка commands и skills (#1274)'],
};
