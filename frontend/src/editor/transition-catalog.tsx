import { Aperture, ArrowLeftRight, Blend, BookOpen, Box as CubeIcon, ChevronsRight, CircleDot, DoorOpen, Droplets, Focus as FocusIcon, Grid3x3, MoveHorizontal, Puzzle,
  RectangleHorizontal, RotateCcw, RotateCw, Waves, Wind, Zap, ZoomIn } from 'lucide-react';
import type { TransitionDirection, TransitionKind } from '../timeline/animation';
export { TRANSITION_GROUPS } from '../timeline/transitions';

/** Every transition, in the order the side panel shows them. */
export const TRANSITIONS: { id: TransitionKind; label: string }[] = [{ id: 'crossfade', label: 'Crossfade' }, { id: 'wipe', label: 'Wipe' }, { id: 'slide', label: 'Slide' }, { id: 'zoom', label: 'Zoom' }, { id: 'whip', label: 'Whip' }, { id: 'flash', label: 'Flash' }, { id: 'dip', label: 'Dip to black' }, { id: 'circle-open', label: 'Circle open' }, { id: 'circle-close', label: 'Circle close' }, { id: 'cross-blur', label: 'Cross blur' },
  { id: 'cross-zoom', label: 'Cross zoom' }, { id: 'spin-in', label: 'Spin in' }, { id: 'spin-out', label: 'Spin out' }, { id: 'doorway', label: 'Doorway' }, { id: 'puzzle-left', label: 'Puzzle left' }, { id: 'puzzle-right', label: 'Puzzle right' }, { id: 'mosaic', label: 'Mosaic' }, { id: 'ripple', label: 'Ripple' },
  { id: 'cube', label: 'Cube' }, { id: 'swap', label: 'Swap' }, { id: 'page-curl-left', label: 'Page curl left' }, { id: 'page-curl-right', label: 'Page curl right' }];

export const TRANSITION_DIRECTIONS: { id: TransitionDirection; label: string }[] = [{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }, { id: 'up', label: 'Up' }, { id: 'down', label: 'Down' }];

export const TRANSITION_ICONS: Record<TransitionKind, React.ReactNode> = { crossfade: <Blend size={13}/>, wipe: <ChevronsRight size={13}/>, slide: <MoveHorizontal size={13}/>, zoom: <ZoomIn size={13}/>, whip: <Wind size={13}/>, flash: <Zap size={13}/>, dip: <RectangleHorizontal size={13}/>, 'circle-open': <Aperture size={13}/>, 'circle-close': <CircleDot size={13}/>, 'cross-blur': <Droplets size={13}/>,
  'cross-zoom': <FocusIcon size={13}/>, 'spin-in': <RotateCw size={13}/>, 'spin-out': <RotateCcw size={13}/>, doorway: <DoorOpen size={13}/>, 'puzzle-left': <Puzzle size={13}/>, 'puzzle-right': <Puzzle size={13}/>, mosaic: <Grid3x3 size={13}/>, ripple: <Waves size={13}/>,
  cube: <CubeIcon size={13}/>, swap: <ArrowLeftRight size={13}/>, 'page-curl-left': <BookOpen size={13}/>, 'page-curl-right': <BookOpen size={13} style={{ transform: 'scaleX(-1)' }}/> };


export const transitionLabel = (kind: TransitionKind) => TRANSITIONS.find((item) => item.id === kind)?.label ?? kind;

/** Names short enough for the popover's tiles; the full name is the tile's tooltip. */
export const transitionShortLabel = (kind: TransitionKind) => ({ 'page-curl-left': 'Curl left', 'page-curl-right': 'Curl right' } as Partial<Record<TransitionKind, string>>)[kind] ?? transitionLabel(kind);
