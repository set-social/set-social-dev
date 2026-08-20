import React from 'react';
import type { SvgProps } from 'react-native-svg';
import {
  Activity,
  Award,
  Bell,
  Bookmark,
  Calendar,
  CalendarPlus,
  Camera,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleAlert,
  CircleCheck,
  Clock,
  Copy,
  Crown,
  Dumbbell,
  Eye,
  EyeOff,
  Flag,
  Flame,
  GripVertical,
  Heart,
  Home,
  Image,
  Info,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Medal,
  Megaphone,
  Menu,
  MessageCircle,
  Minus,
  Moon,
  MoreVertical,
  Music,
  PartyPopper,
  Pause,
  Pencil,
  Play,
  Plus,
  PlusCircle,
  Repeat,
  RotateCcw,
  Ruler,
  Scale,
  Search,
  Settings,
  Share2,
  SkipBack,
  SkipForward,
  Square,
  Star,
  Sun,
  Target,
  Timer,
  Trash2,
  TrendingDown,
  TrendingUp,
  Trophy,
  User,
  Users,
  Video,
  Weight,
  X,
  Zap,
} from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeProvider';

const ICONS = {
  activity: Activity,
  award: Award,
  bell: Bell,
  bookmark: Bookmark,
  calendar: Calendar,
  calendarPlus: CalendarPlus,
  camera: Camera,
  check: Check,
  checkSquare: CheckSquare,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  circle: Circle,
  circleAlert: CircleAlert,
  circleCheck: CircleCheck,
  clock: Clock,
  copy: Copy,
  crown: Crown,
  dumbbell: Dumbbell,
  eye: Eye,
  eyeOff: EyeOff,
  flag: Flag,
  flame: Flame,
  gripVertical: GripVertical,
  heart: Heart,
  home: Home,
  image: Image,
  info: Info,
  lock: Lock,
  logOut: LogOut,
  mail: Mail,
  mapPin: MapPin,
  medal: Medal,
  megaphone: Megaphone,
  menu: Menu,
  messageCircle: MessageCircle,
  minus: Minus,
  moon: Moon,
  moreVertical: MoreVertical,
  music: Music,
  partyPopper: PartyPopper,
  pause: Pause,
  pencil: Pencil,
  play: Play,
  plus: Plus,
  plusCircle: PlusCircle,
  repeat: Repeat,
  rotateCcw: RotateCcw,
  ruler: Ruler,
  scale: Scale,
  search: Search,
  settings: Settings,
  share: Share2,
  skipBack: SkipBack,
  skipForward: SkipForward,
  square: Square,
  star: Star,
  sun: Sun,
  target: Target,
  timer: Timer,
  trash: Trash2,
  trendingDown: TrendingDown,
  trendingUp: TrendingUp,
  trophy: Trophy,
  user: User,
  users: Users,
  video: Video,
  weight: Weight,
  x: X,
  zap: Zap,
} as const;

export type IconName = keyof typeof ICONS;

type IconSize = 'sm' | 'md' | 'lg' | number;

type IconProps = Omit<SvgProps, 'width' | 'height' | 'color'> & {
  name: IconName;
  size?: IconSize;
  color?: string;
  strokeWidth?: number;
};

/**
 * Single entry point for every icon in the app — all icons come from Lucide's
 * outline set with a shared default stroke width, so nothing drifts to a
 * different icon family or weight.
 */
export function Icon({ name, size = 'md', color, strokeWidth = 2, ...rest }: IconProps) {
  const theme = useTheme();
  const Glyph = ICONS[name];
  const resolvedSize = typeof size === 'number' ? size : theme.sizes.icon[size];
  return (
    <Glyph
      size={resolvedSize}
      color={color ?? theme.colors.text.primary}
      strokeWidth={strokeWidth}
      {...rest}
    />
  );
}
