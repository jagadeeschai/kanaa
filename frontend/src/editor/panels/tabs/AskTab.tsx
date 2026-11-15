import AskPanel from "../../AskPanel";
import { useEditorPanel } from "../../state/EditorContext";
import type { EditorLeftRailBindings } from '../EditorLeftRail';

export function AskTabSection1() {
  const { leftTab, timeline, askOptions, askProject, runAsk } = useEditorPanel<EditorLeftRailBindings>('left');
  return (<>{leftTab === 'ask' && timeline && <div data-keep-panel><AskPanel timeline={timeline} options={askOptions} project={askProject} onApply={runAsk}/></div>}</>);
}
