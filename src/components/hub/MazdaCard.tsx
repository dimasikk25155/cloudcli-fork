import { Car, ExternalLink } from 'lucide-react';

export default function MazdaCard() {
  return (
    <div className="flex min-h-[50vh] flex-col items-start justify-center gap-4 p-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
        <Car className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="max-w-md space-y-2">
        <h3 className="text-base font-semibold text-foreground">Мазда живёт на своём сайте</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          В приложении на маке чужой пароль не всплывает, поэтому машину сюда не вставляем.
          Открой сайт в браузере — там ты уже залогинен.
        </p>
      </div>
      <a
        href="https://mazda.neo3.ru"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
      >
        Открыть mazda.neo3.ru
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
