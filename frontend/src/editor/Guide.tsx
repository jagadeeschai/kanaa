import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Keyboard, Search, X } from 'lucide-react';
import { ARTICLES, type Article } from './guide-articles';

/**
 * Kanaa's own guide, in the app and offline: short articles on each feature, found by topic or by search, plus the
 * keyboard shortcuts. Every ⓘ in the settings panels opens it at the article for that section.
 */
export function Guide({ article, shortcuts, onClose, onResetLayout }: { article: string | null; shortcuts: [string, string][]; onClose: () => void; onResetLayout: () => void }) {
  const [current, setCurrent] = useState<string>(article ?? ARTICLES[0].id);
  const [query, setQuery] = useState('');
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { if (article) setCurrent(article); }, [article]);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [current]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); onClose(); } };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);
  const found = useMemo(() => {
    const words = query.trim().toLowerCase();
    if (!words) return ARTICLES;
    return ARTICLES.filter((item) => [item.title, item.tamil ?? '', item.summary, item.topic, ...item.points, ...(item.tips ?? [])].join(' ').toLowerCase().includes(words));
  }, [query]);
  const topics = [...new Set(found.map((item) => item.topic))];
  const shown: Article | undefined = current === 'shortcuts' ? undefined : ARTICLES.find((item) => item.id === current) ?? ARTICLES[0];
  return <div className="ed-modal" role="dialog" aria-modal="true" aria-label="Kanaa guide" onClick={onClose}>
    <div className="ed-card ed-guide" onClick={(event) => event.stopPropagation()}>
      <button className="ed-close" aria-label="Close the guide" onClick={onClose}><X size={17}/></button>
      <nav className="ed-guide-nav" aria-label="Guide topics">
        <h2><BookOpen size={16}/>Guide</h2>
        <label className="ed-find"><Search size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the guide" aria-label="Search the guide" autoFocus/></label>
        <div className="ed-guide-list">
          {topics.map((topic) => <div key={topic}><h3>{topic}</h3>{found.filter((item) => item.topic === topic).map((item) => <button key={item.id} className={current === item.id ? 'on' : ''} onClick={() => setCurrent(item.id)}>{item.title}</button>)}</div>)}
          {!found.length && <p className="ed-tip">Nothing found. Try another word, such as blur, music or captions.</p>}
          <div><h3>Keys</h3><button className={current === 'shortcuts' ? 'on' : ''} onClick={() => setCurrent('shortcuts')}><Keyboard size={12}/> Shortcuts and layout</button></div>
        </div>
      </nav>
      <article className="ed-guide-body" ref={body}>
        {shown ? <>
          <span className="ed-guide-topic">{shown.topic}</span>
          <h2>{shown.title}{shown.tamil && <em lang="ta">{shown.tamil}</em>}</h2>
          <p className="ed-guide-summary">{shown.summary}</p>
          <h3>How it works</h3>
          <ul>{shown.points.map((point) => <li key={point}>{point}</li>)}</ul>
          {shown.where && <><h3>Where to find it</h3><p>{shown.where}</p></>}
          {shown.tips?.length ? <><h3>Tips</h3><ul className="ed-guide-tips">{shown.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul></> : null}
          {shown.related?.length ? <div className="ed-guide-related"><span>See also</span>{shown.related.map((id) => { const other = ARTICLES.find((item) => item.id === id); return other ? <button key={id} className="ed-link" onClick={() => setCurrent(id)}>{other.title}</button> : null; })}</div> : null}
        </> : <>
          <span className="ed-guide-topic">Keys</span>
          <h2>Shortcuts and layout</h2>
          <div className="ed-keys">{shortcuts.flatMap(([keys, action]) => [<kbd key={keys}>{keys}</kbd>, <span key={action}>{action}</span>])}</div>
          <p>Drag the gaps between panels to resize them. Double-click a gap to reset it.</p>
          <button className="ed-button" onClick={() => { onResetLayout(); onClose(); }}>Reset layout</button>
        </>}
      </article>
    </div>
  </div>;
}
