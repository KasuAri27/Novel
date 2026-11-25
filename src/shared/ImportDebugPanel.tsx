/** 导入调试面板：展示 parser 编译剧情时产生的带行号错误。 */
import type { CompileError } from '../core/parser/compiler';

interface Props {
  errors: CompileError[];
}

export function ImportDebugPanel({ errors }: Props) {
  if (errors.length === 0) return null;
  return (
    <div className="debug-errors">
      <h4>剧情导入诊断（{errors.length} 条）</h4>
      {errors.map((e, i) => (
        <div className="err-item" key={i}>
          <b>
            {e.file}:{e.line || '?'}
          </b>{' '}
          {e.message}
        </div>
      ))}
    </div>
  );
}
