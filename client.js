/**
 * DSH-memory-nebula — client half.
 * 仓库：https://github.com/yb-zhai/agent-memory
 *
 * 注册主面板 + 侧栏入口。面板是内置 server.js 提供的页面（默认 127.0.0.1:8898），
 * 插件只拥有 iframe 外壳；渲染、SSE、召回逻辑都在页面里。
 *
 * 端口冲突时 server 会退到下一个端口，client 探测同一范围后建 iframe。
 * Panel key: `memory-nebula`。
 */
window.__ModuleLoader__.load({
  id: 'dsh-nebula-memory',
  factory: (require) => {
    const react = require('react');
    const { useEffect, useState } = react;

    const KEY = 'memory-nebula';
    const PORTS = Array.from({ length: 23 }, (_, i) => 8898 + i);
    const LABEL = '记忆星云';

    function Mark(props) {
      const size = props && props.size ? props.size : 16;
      return react.createElement(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        react.createElement('circle', { cx: 12, cy: 12, r: 1.7, fill: 'currentColor', stroke: 'none' }),
        react.createElement('ellipse', { cx: 12, cy: 12, rx: 9.2, ry: 4.4, transform: 'rotate(-24 12 12)' }),
        react.createElement('ellipse', { cx: 12, cy: 12, rx: 9.2, ry: 4.4, transform: 'rotate(38 12 12)', opacity: 0.75 }),
        react.createElement('circle', { cx: 18.4, cy: 8.2, r: 1.15, fill: 'currentColor', stroke: 'none' }),
        react.createElement('circle', { cx: 5.6, cy: 15.6, r: 1.15, fill: 'currentColor', stroke: 'none' }),
      );
    }

    function findServer() {
      return Promise.all(
        PORTS.map(async (port) => {
          try {
            const res = await fetch(`http://127.0.0.1:${port}/healthz`, {
              signal: AbortSignal.timeout(1000),
            });
            if (!res.ok) return 0;
            const json = await res.json();
            return json && json.service === 'dsh-nebula-memory' ? port : 0;
          } catch {
            return 0;
          }
        }),
      ).then((hits) => hits.find(Boolean) || 0);
    }

    function NebulaPanel() {
      const [url, setUrl] = useState(null);

      useEffect(() => {
        let cancelled = false;
        let timer = 0;

        const discover = async () => {
          // 加 rev 参数：iframe 的 URL 不变时浏览器会直接用缓存里的那份页面，
          // 升级插件后重启也看不到新面板。每次挂载都换一个 rev 强制重新拉取。
          const rev = Date.now();
          for (let attempt = 0; attempt < 40 && !cancelled; attempt += 1) {
            const port = await findServer();
            if (cancelled) return;
            if (port) {
              setUrl(`http://127.0.0.1:${port}/?rev=${rev}`);
              return;
            }
            await new Promise((resolve) => {
              timer = setTimeout(resolve, 1500);
            });
          }
          if (!cancelled) setUrl(`http://127.0.0.1:8898/?rev=${rev}`);
        };

        discover();
        return () => {
          cancelled = true;
          clearTimeout(timer);
        };
      }, []);

      if (!url) {
        return react.createElement(
          'div',
          {
            style: {
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '100%', height: '100%', minHeight: 'calc(100vh - 132px)',
              background: '#05070c', color: '#b7c4d8',
              fontFamily: 'system-ui, sans-serif', fontSize: 13, letterSpacing: '.08em',
            },
          },
          '正在连接记忆星云…',
        );
      }

      return react.createElement(
        'div',
        {
          style: {
            position: 'relative', width: '100%', height: '100%',
            minHeight: 'calc(100vh - 132px)', background: '#05070c', overflow: 'hidden',
          },
        },
        react.createElement('iframe', {
          src: url,
          title: 'Memory Nebula',
          allow: 'clipboard-read; clipboard-write',
          style: {
            display: 'block', width: '100%', height: '100%',
            minHeight: 'calc(100vh - 132px)', border: '0',
            background: '#05070c', colorScheme: 'dark',
          },
        }),
      );
    }

    function apply(ctx) {
      try {
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: KEY }, NebulaPanel),
        );
      } catch (error) {
        console.warn('[memory-nebula] main panel not registered:', error);
      }
      try {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: KEY, order: 21, label: () => LABEL },
            Mark,
          ),
        );
      } catch (error) {
        console.warn('[memory-nebula] sidebar entry not registered:', error);
      }
    }

    return { inject: ['slots'], apply, NebulaPanel };
  },
});
