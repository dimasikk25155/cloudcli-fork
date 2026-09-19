import {
  Camera,
  Car,
  CircleDot,
  Coins,
  Droplets,
  Ban,
  FlaskConical,
  Folder,
  Gauge,
  Gem,
  Globe,
  Image,
  Landmark,
  Leaf,
  ListTodo,
  Map,
  MessageCircle,
  Mic,
  Moon,
  Mountain,
  Music,
  Play,
  Scale,
  Server,
  Settings,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Smile,
  Sparkles,
  Terminal,
  Timer,
  User,
  Wallet,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ProjectGlyph } from './projectIconSpec';
import { cn } from '../../lib/utils';

const GLYPHS: Record<ProjectGlyph, LucideIcon> = {
  tire: CircleDot,
  car: Car,
  wallet: Wallet,
  smile: Smile,
  mic: Mic,
  mountain: Mountain,
  scale: Scale,
  bag: ShoppingBag,
  leaf: Leaf,
  music: Music,
  moon: Moon,
  code: Terminal,
  calendar: Timer,
  workflow: Workflow,
  shield: ShieldCheck,
  server: Server,
  settings: Settings,
  tasks: ListTodo,
  globe: Globe,
  flask: FlaskConical,
  building: Landmark,
  coins: Coins,
  play: Play,
  user: User,
  share: Share2,
  sparkles: Sparkles,
  image: Image,
  map: Map,
  camera: Camera,
  droplets: Droplets,
  gem: Gem,
  wrench: Wrench,
  gauge: Gauge,
  message: MessageCircle,
  ban: Ban,
  folder: Folder,
};

const SIZE = {
  sm: { box: 'h-7 w-7', icon: 'h-3.5 w-3.5', letter: 'text-[10px]', mono: 'text-[9px]' },
  md: { box: 'h-10 w-10', icon: 'h-5 w-5', letter: 'text-sm', mono: 'text-[11px]' },
  lg: { box: 'h-[4.25rem] w-[4.25rem]', icon: 'h-8 w-8', letter: 'text-2xl', mono: 'text-[1.35rem]' },
  dock: { box: 'h-14 w-14', icon: 'h-7 w-7', letter: 'text-xl', mono: 'text-base' },
} as const;

export type AppIconSize = keyof typeof SIZE;

type AppIconProps = {
  background: string;
  foreground: string;
  glyph: ProjectGlyph;
  letter: string;
  src?: string | null;
  size?: AppIconSize;
  starred?: boolean;
  className?: string;
};

export default function AppIcon({
  background,
  foreground,
  glyph,
  letter,
  src = null,
  size = 'lg',
  starred = false,
  className,
}: AppIconProps) {
  const Icon = GLYPHS[glyph] ?? Folder;
  const dimensions = SIZE[size];
  const showLetter = glyph === 'folder' && !src;
  const twoLetter = letter.length > 1;

  return (
    <span
      className={cn(
        'neo3-squircle relative inline-flex items-center justify-center overflow-hidden',
        dimensions.box,
        className,
      )}
      style={{ background }}
      aria-hidden="true"
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : showLetter ? (
        <span
          className={cn(
            'relative z-[1] font-semibold leading-none tracking-tight',
            twoLetter ? dimensions.mono : dimensions.letter,
          )}
          style={{ color: foreground }}
        >
          {letter}
        </span>
      ) : (
        <Icon className={cn('relative z-[1]', dimensions.icon)} style={{ color: foreground }} strokeWidth={1.9} />
      )}
      {starred && (
        <span className="absolute right-0.5 top-0.5 z-[2] h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" />
      )}
    </span>
  );
}
