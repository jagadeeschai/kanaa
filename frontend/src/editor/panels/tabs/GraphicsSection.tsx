import { useRef } from 'react';
import { t } from '../../../i18n';
import { createGraphicActions } from '../../actions/graphics';
import { useEditor } from '../../state/EditorContext';
import type { GraphicKind } from '../../../timeline/model';

const GRAPHICS: { kind: GraphicKind; label: string }[] = [{ kind: 'step-list', label: 'Step list' }];

export function GraphicsSection() {
  const editor = useEditor();
  const timelineRef = useRef(editor.timeline); timelineRef.current = editor.timeline;
  const engineRef = useRef({ currentTime: editor.now, seek: editor.seek }); engineRef.current = { currentTime: editor.now, seek: editor.seek };
  const actions = createGraphicActions(() => ({ timelineRef, engineRef, change: editor.change,
    setSelectedId: (id) => { if (typeof id !== 'function') editor.select(id); }, sourceFor: () => undefined, setError: () => {} }));
  return <section className="ed-add" aria-label={t('Graphics')}><h3 className="ed-sub">{t('Graphics')}</h3><div className="ed-templates">
    {GRAPHICS.map(({ kind, label }) => <button key={kind} className="ed-template" onClick={() => actions.addExplainerGraphic(kind, [.5, .5])}>
      <span className="ed-template-art"><svg width="100" height="54" viewBox="0 0 100 54" aria-hidden="true">
        {[0,1,2].map((i) => <g key={i}><circle cx="18" cy={12+i*15} r="4" fill="currentColor"/><path d={`M30 ${12+i*15}h50`} stroke="currentColor" strokeWidth="3"/><animate attributeName="opacity" values="0;1;1" dur="2s" begin={`${i*.3}s`} repeatCount="indefinite"/></g>)}
      </svg></span><span>{t(label)}</span></button>)}
  </div></section>;
}
