import { Shuffle,X } from "lucide-react";
import { t } from "../../../i18n";
import { mainLayer } from "../../../timeline/model";
import { transitionEverywhere } from "../../../timeline/transitions";
import { useEditorPanel } from "../../state/EditorContext";
import { TRANSITION_ICONS,TRANSITIONS } from "../../transition-catalog";
import type { EditorLeftRailBindings } from '../EditorLeftRail';
import { SubTabs, useSubTab } from './SubTabs';

/** The transitions in four kinds, so the tab isn't one long grid. Every transition is in exactly one (tested). */
export const TRANSITION_GROUPS: { id: 'simple' | 'dynamic' | 'shapes' | 'three-d'; label: string; kinds: string[] }[] = [
  { id: 'simple', label: 'Simple', kinds: ['crossfade', 'dip', 'flash', 'cross-blur', 'wipe', 'slide'] },
  { id: 'dynamic', label: 'Dynamic', kinds: ['light-wipe', 'zoom', 'whip', 'cross-zoom', 'spin-in', 'spin-out', 'swap'] },
  { id: 'shapes', label: 'Shapes', kinds: ['circle-open', 'circle-close', 'doorway', 'puzzle-left', 'puzzle-right', 'mosaic', 'ripple'] },
  { id: 'three-d', label: '3D', kinds: ['cube', 'page-curl-left', 'page-curl-right'] },
];

export function TransitionsTabSection1() {
  const { leftTab, transitionPick, draggableAs, setTransitionPick, applyToSelected, timeline, change, setConfirmingClear } = useEditorPanel<EditorLeftRailBindings>('left');
  const [part, choose] = useSubTab('transitions', TRANSITION_GROUPS);
  const shown = TRANSITION_GROUPS.find((group) => group.id === part)!.kinds;
  return (<>{leftTab === 'transitions' && <>
          <SubTabs label="Transition kinds" tabs={TRANSITION_GROUPS} part={part} onChoose={choose}/>
          <p className="ed-tip">Drag onto a clip, or click to apply to the selected clip.</p>
          <div className="ed-quick" role="group" aria-label="Transitions">{TRANSITIONS.filter((item) => shown.includes(item.id)).map((item) => <button key={item.id} className={`ed-quick-tile transition ${transitionPick === item.id ? 'on' : ''}`} {...draggableAs({ kind: 'transition', transition: item.id })} onClick={() => { setTransitionPick(item.id); applyToSelected({ kind: 'transition', transition: item.id }); }} title={`${item.label} into a clip`}>{TRANSITION_ICONS[item.id]}{item.label}</button>)}</div>
          {timeline && mainLayer(timeline).items.length > 1 && !mainLayer(timeline).locked && <>
            <button className="ed-button wide" onClick={() => change(transitionEverywhere(timeline, transitionPick, 0.6), 'transition-all')} title={`Put a ${transitionPick} on every cut`}><Shuffle size={14}/>Every cut: {TRANSITIONS.find((item) => item.id === transitionPick)?.label ?? transitionPick}</button>
            {mainLayer(timeline).items.some((clip) => clip.transition_in) && <button className="ed-button wide" onClick={() => setConfirmingClear(true)}><X size={14}/>Remove all transitions</button>}
          </>}
          <p className="ed-tip">{t('To change one cut’s length or direction, click the cut between two clips on the timeline.')}</p>
        </>}</>);
}
