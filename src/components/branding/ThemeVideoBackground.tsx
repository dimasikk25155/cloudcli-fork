import { useEffect, useRef, useState } from 'react';

/**
 * Живые обои темы: зацикленный ролик во весь экран под интерфейсом.
 *
 * Отличие от фото-фона (`theme-photo-bg`) не в красоте, а в цене. Лендинг
 * листают секунды, а в агентской системе сидят часами — поэтому ролик здесь
 * обязан быть дешевле, чем на сайте, и обязан замолкать, когда его не смотрят:
 *
 *   — пауза, как только окно ушло в фон (`visibilitychange`) — иначе ноутбук
 *     греет вентилятор ради картинки, которую никто не видит;
 *   — `prefers-reduced-motion` останавливает ролик совсем: остаётся постер,
 *     то есть ровно тот же кадр, только неподвижный;
 *   — постер лежит ПОД видео и проявляется мгновенно, поэтому фон не мигает
 *     чёрным, пока ролик грузится, и остаётся на месте, если тот не запустился.
 *
 * Скрим берём тот же, что у фото-тем (`theme-photo-scrim`): он уже подобран
 * под читаемость интерфейса, в том числе на проекторе.
 *
 * ЧЕГО ЗДЕСЬ НЕ ДЕЛАТЬ — купленная грабля 22.08.2026. Первая версия экономила
 * кадрами: ролик кодировался в 15 fps и проигрывался на 0.75, то есть 11 новых
 * кадров в секунду. Расчёт был «на медленной туманности разницы не видно» —
 * и он оказался неверным: рывки видно сразу, владелец заметил их первым же
 * взглядом. Частоту кадров фона резать нельзя: дёргающийся фон читается как
 * тормозящее приложение, и никакая экономия батареи этого не окупает.
 * Экономить можно разрешением, битрейтом и паузой в фоне — но не плавностью.
 */
export default function ThemeVideoBackground({
  src,
  poster,
  rate = 1,
}: {
  src: string;
  poster: string;
  rate?: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    // Системная настройка «убрать анимации» сильнее любой темы: ролик не
    // грузим вовсе, постер уже нарисован.
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motionQuery.matches) return undefined;

    video.playbackRate = rate;

    // play() возвращает промис, который Safari умеет отклонять. Отказ — не
    // ошибка: постер остаётся на экране, интерфейс не замечает разницы.
    // `has-live-wallpaper` на <html> снимает backdrop-filter с панелей темы:
    // блюр поверх движущегося кадра пересчитывается 24 раза в секунду и стоит
    // дороже самого видео. Класс живёт ровно столько, сколько играет ролик, —
    // встало видео, вернулось стекло.
    const mark = (on: boolean) => {
      document.documentElement.classList.toggle('has-live-wallpaper', on);
    };

    const start = () => {
      video.play().then(
        () => { setPlaying(true); mark(true); },
        () => { setPlaying(false); mark(false); },
      );
    };

    const onVisibility = () => {
      if (document.hidden) {
        video.pause();
        mark(false);
      } else {
        start();
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      video.pause();
      mark(false);
    };
  }, [src, rate]);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="theme-photo-bg theme-photo-bg--static" style={{ backgroundImage: `url(${poster})` }} />
      <video
        ref={videoRef}
        className="theme-video-bg"
        style={{ opacity: playing ? 1 : 0 }}
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        preload="auto"
        tabIndex={-1}
        disablePictureInPicture
        disableRemotePlayback
      />
      <div className="theme-photo-scrim" />
    </div>
  );
}
