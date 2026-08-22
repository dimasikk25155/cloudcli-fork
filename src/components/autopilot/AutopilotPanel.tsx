import { useTranslation } from 'react-i18next';

type AutopilotPanelProps = {
  url: string | null;
};

/**
 * Дашборд автопилота внутри Neo3.
 *
 * Страницу целиком рисует сам скилл — она статическая и обновляет себя раз в
 * десять секунд, подтягивая `state.js` рядом. Поэтому здесь только рамка: свой
 * рендер прогресса разошёлся бы с дашбордом на первом же изменении формата.
 */
export default function AutopilotPanel({ url }: AutopilotPanelProps) {
  const { t } = useTranslation();

  if (!url) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {t('autopilot.noRun')}
      </div>
    );
  }

  return (
    <iframe
      src={url}
      title={t('tabs.autopilot')}
      className="h-full w-full border-0 bg-white"
      // Без `allow-same-origin` намеренно: иначе страница из папки проекта
      // дотянулась бы до localStorage самого Neo3, где лежит токен входа.
      // Цена — дашборд не запомнит переключение темы и языка между
      // открытиями; тему он и так берёт системную, а токен дороже.
      sandbox="allow-scripts"
    />
  );
}
