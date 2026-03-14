import blessed from 'neo-blessed';

export interface Layout {
  screen: blessed.Widgets.Screen;
  feedPane: blessed.Widgets.BoxElement;
  entryPane: blessed.Widgets.BoxElement;
  contentPane: blessed.Widgets.BoxElement;
  statusBar: blessed.Widgets.BoxElement;
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
      bg: 'blue',
      fg: 'white',
    },
    content:
      ' {bold}j/k{/bold}:move  {bold}Enter{/bold}:select  {bold}P{/bold}:pin  {bold}u{/bold}:read  {bold}v{/bold}:browser  {bold}r{/bold}:reload  {bold}/{/bold}:search  {bold}q{/bold}:quit',
  });

  return { screen, feedPane, entryPane, contentPane, statusBar };
}
