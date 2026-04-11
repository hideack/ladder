import blessed from 'neo-blessed';

export type LayoutMode = 'horizontal' | 'vertical';

export interface Layout {
  screen: blessed.Widgets.Screen;
  feedPane: blessed.Widgets.BoxElement;
  entryPane: blessed.Widgets.BoxElement;
  contentPane: blessed.Widgets.BoxElement;
  statusBar: blessed.Widgets.BoxElement;
  unifiedListPane: blessed.Widgets.BoxElement;
  unifiedContentPane: blessed.Widgets.BoxElement;
}

export function createLayout(): Layout {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'ladder',
    fullUnicode: true,
    dockBorders: true,
  });

  const feedPane = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '25%',
    height: '100%-1',
    border: { type: 'line' },
    label: ' Feeds ',
    tags: true,
    style: {
      border: { fg: 'gray' },
      label: { fg: 'gray' },
    },
    keys: true,
    mouse: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: { fg: 'gray' },
    },
  });

  const entryPane = blessed.box({
    parent: screen,
    top: 0,
    left: '25%',
    width: '35%',
    height: '100%-1',
    border: { type: 'line' },
    label: ' Entries ',
    tags: true,
    style: {
      border: { fg: 'gray' },
      label: { fg: 'gray' },
    },
    keys: true,
    mouse: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: { fg: 'gray' },
    },
  });

  const contentPane = blessed.box({
    parent: screen,
    top: 0,
    left: '60%',
    width: '40%',
    height: '100%-1',
    border: { type: 'line' },
    label: ' Content ',
    style: {
      border: { fg: 'gray' },
      label: { fg: 'gray' },
    },
    keys: true,
    mouse: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: { fg: 'gray' },
    },
    tags: true,
    wrap: true,
  });

  const statusBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    tags: true,
    style: {
      bg: 'black',
      fg: 'white',
    },
    content:
      ' {bold}n/p{/bold}:feed  {bold}j/k{/bold}:entry  {bold}Spc/b{/bold}:read  {bold}o{/bold}:browser  {bold}c{/bold}:pin  {bold}m{/bold}:read-all  {bold}/{/bold}:search  {bold}?{/bold}:help  {bold}q{/bold}:quit',
  });

  const unifiedListPane = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '40%',
    height: '100%-1',
    hidden: true,
    border: { type: 'line' },
    label: ' Unified ',
    tags: true,
    style: {
      border: { fg: 'gray' },
      label: { fg: 'gray' },
    },
    keys: true,
    mouse: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: { fg: 'gray' },
    },
  });

  const unifiedContentPane = blessed.box({
    parent: screen,
    top: 0,
    left: '40%',
    width: '60%',
    height: '100%-1',
    hidden: true,
    border: { type: 'line' },
    label: ' Content ',
    tags: true,
    style: {
      border: { fg: 'gray' },
      label: { fg: 'gray' },
    },
    keys: true,
    mouse: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: { fg: 'gray' },
    },
    wrap: true,
  });

  return { screen, feedPane, entryPane, contentPane, statusBar, unifiedListPane, unifiedContentPane };
}

export function applyLayout(layout: Layout, mode: LayoutMode): void {
  const { feedPane, entryPane, contentPane } = layout;
  type P = { top: string | number; left: string | number; width: string | number; height: string | number };

  if (mode === 'horizontal') {
    // 従前: 3ペイン水平並び (25% / 35% / 40%)
    (feedPane as unknown as { position: P }).position.top    = 0;
    (feedPane as unknown as { position: P }).position.left   = 0;
    (feedPane as unknown as { position: P }).position.width  = '25%';
    (feedPane as unknown as { position: P }).position.height = '100%-1';

    (entryPane as unknown as { position: P }).position.top    = 0;
    (entryPane as unknown as { position: P }).position.left   = '25%';
    (entryPane as unknown as { position: P }).position.width  = '35%';
    (entryPane as unknown as { position: P }).position.height = '100%-1';

    (contentPane as unknown as { position: P }).position.top    = 0;
    (contentPane as unknown as { position: P }).position.left   = '60%';
    (contentPane as unknown as { position: P }).position.width  = '40%';
    (contentPane as unknown as { position: P }).position.height = '100%-1';
  } else {
    // 新レイアウト: 左1/3=フィード、右2/3を上下1:1=エントリー/コンテンツ
    (feedPane as unknown as { position: P }).position.top    = 0;
    (feedPane as unknown as { position: P }).position.left   = 0;
    (feedPane as unknown as { position: P }).position.width  = '33%';
    (feedPane as unknown as { position: P }).position.height = '100%-1';

    (entryPane as unknown as { position: P }).position.top    = 0;
    (entryPane as unknown as { position: P }).position.left   = '33%';
    (entryPane as unknown as { position: P }).position.width  = '67%';
    (entryPane as unknown as { position: P }).position.height = '33%';

    (contentPane as unknown as { position: P }).position.top    = '33%';
    (contentPane as unknown as { position: P }).position.left   = '33%';
    (contentPane as unknown as { position: P }).position.width  = '67%';
    (contentPane as unknown as { position: P }).position.height = '67%-1';
  }
}
