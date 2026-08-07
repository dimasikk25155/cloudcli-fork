/**
 * Логотип Neo3 — та же монета, что в favicon, PWA-иконках и APK.
 *
 * Мастер `public/logo-512.png` — растр БЕЗ альфа-канала: фон залит фирменным
 * #070504. Поэтому картинка едет в круглой маске, иначе на светлых темах в
 * шапке торчал бы чёрный квадрат. Лёгкий `scale` срезает чёрную кайму между
 * краем монеты и краем кадра.
 *
 * `animated` — для экрана загрузки: монета медленно поворачивается вокруг
 * вертикальной оси. Движение выключается при prefers-reduced-motion.
 */
import { cn } from '../../lib/utils';

type Neo3LogoProps = {
  className?: string;
  animated?: boolean;
};

export default function Neo3Logo({ className, animated = false }: Neo3LogoProps) {
  return (
    <span
      className={cn('relative inline-flex overflow-hidden rounded-full bg-[#070504]', className)}
      role="img"
      aria-label="Neo3 Agent System"
    >
      {animated && (
        <style>{`
          @media (prefers-reduced-motion: no-preference) {
            .neo3-logo-spin { animation: neo3-logo-spin 4.4s ease-in-out infinite; }
          }
          @keyframes neo3-logo-spin {
            0%, 100% { transform: scale(1.14) rotateY(0deg); }
            50% { transform: scale(1.14) rotateY(180deg); }
          }
        `}</style>
      )}
      <img
        src="/logo-512.png"
        alt=""
        className={cn('h-full w-full scale-[1.14] object-cover', animated && 'neo3-logo-spin')}
        draggable={false}
      />
    </span>
  );
}
