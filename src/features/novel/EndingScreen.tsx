/** 结局页：展示命中结局的标题与正文，提供重开/返回。 */
import { selectEndedEnding, useEngineStore } from './useEngineStore';

export function EndingScreen() {
  const story = useEngineStore((s) => s.story);
  const ending = useEngineStore(selectEndedEnding);
  const restart = useEngineStore((s) => s.restart);
  const back = useEngineStore((s) => s.backToTitle);

  return (
    <div className="ending">
      <p className="kicker">{story?.meta.title ?? '剧情'} · 结局</p>
      <h2>{ending?.title ?? '剧终'}</h2>
      <div className="text">{ending?.text ?? '故事在这里画下了句点。'}</div>
      <div className="ending-actions">
        <button type="button" className="title-btn" onClick={restart}>
          再来一次
        </button>
        <button type="button" className="title-btn title-btn-primary" onClick={back}>
          回到标题
        </button>
      </div>
    </div>
  );
}
