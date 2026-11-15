import { cancelRenderJob } from "../../../api/client";
import { mainLayer } from "../../../timeline/model";
import { useEditorPanel } from "../../state/EditorContext";
import { WordsPanel } from "../../Words";
import type { EditorLeftRailBindings } from '../EditorLeftRail';

export function WordsTabSection1() {
  const { leftTab, tokens, mainClips, language, setLanguage, setWordSelection, missingWords, timeline, wordJob, transcribeClips, seek, cutWords, playhead, wordSelection, tidy, pauseLength, setPauseLength, removeFillers, setRemoveFillers, removePauses, setMenu } = useEditorPanel<EditorLeftRailBindings>('left');
  return (<>{leftTab === 'words' && <div data-keep-panel><WordsPanel tokens={tokens} clips={mainClips} language={language} onLanguage={(next) => { setLanguage(next); setWordSelection(new Set()); try { localStorage.setItem('wa.wordsLanguage', next); } catch { /* It just won't be remembered. */ } }} missing={missingWords.length} locked={Boolean(timeline && mainLayer(timeline).locked)}
          busy={wordJob ? `Listening to your video… ${wordJob.progress}%` : null} hasTracks={Boolean(timeline && timeline.layers.length > 1)} onTranscribe={() => { void transcribeClips(); }} onCancel={() => { if (wordJob) void cancelRenderJob(wordJob.id); }} onSeek={seek} onCut={cutWords} playhead={playhead} selection={wordSelection} onSelection={setWordSelection} tidy={tidy} pauseLength={pauseLength} onPauseLength={setPauseLength} fillers={removeFillers} onFillers={setRemoveFillers} onTidy={removePauses}
          onMenu={(event, keys) => setMenu({ x: event.clientX, y: event.clientY, items: [{ label: keys.size === 1 ? 'Cut' : `Cut ${keys.size} items`, hint: '⌫', danger: true, onSelect: () => cutWords(keys) }] })}/></div>}</>);
}
