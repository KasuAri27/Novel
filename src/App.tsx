import { useEffect, useState } from 'react';
import { useEngineStore } from './store/useEngineStore';
import { TitleScreen } from './ui/TitleScreen';
import { PlayScreen } from './ui/PlayScreen';
import { EndingScreen } from './ui/EndingScreen';
import { ChatScreen } from './chat/ChatScreen';

/** 地址栏 #chat 时进入聊天模式；其余为小说阅读（标题 / 全屏阅读 / 结局）。 */
function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export default function App() {
  const screen = useEngineStore((s) => s.screen);
  const hash = useHashRoute();

  if (hash === '#chat') {
    return <ChatScreen onExit={() => (window.location.hash = '')} />;
  }

  return (
    <div className="player">
      {screen === 'title' && <TitleScreen />}
      {screen === 'play' && <PlayScreen />}
      {screen === 'ending' && <EndingScreen />}
    </div>
  );
}
