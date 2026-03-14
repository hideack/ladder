import blessed from 'neo-blessed';
import { Queries, Category } from '../db/queries.js';

type InputHandler = (ch: string | undefined, key: { name: string; ctrl: boolean }) => void;

export function showCategoryManager(
  screen: blessed.Widgets.Screen,
  q: Queries,
  onClose: () => void
): void {
  let categories: Category[] = [];
  let selectedIndex = 0;
  // 現在アクティブな入力ハンドラー。null のとき通常モード
  let inputHandler: InputHandler | null = null;

  const overlay = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '70%',
    height: '70%',
    border: { type: 'line' },
    label: ' Category Manager ',
    tags: true,
    style: {
      border: { fg: 'green' },
      label: { fg: 'green', bold: true },
      bg: 'black',
      fg: 'white',
    },
  });

  const contentBox = blessed.box({
    parent: overlay,
    top: 0,
    left: 0,
    width: '100%-2',
    height: '100%-3',
    tags: true,
    scrollable: true,
    style: { bg: 'black', fg: 'white' },
  });

  const statusBox = blessed.box({
    parent: overlay,
    bottom: 0,
    left: 0,
    width: '100%-2',
    height: 1,
    tags: true,
    style: { bg: 'black', fg: 'gray' },
  });

  function setStatus(msg: string): void {
    statusBox.setContent(msg);
    screen.render();
  }

  function resetStatus(): void {
    setStatus(
      ' {bold}a{/bold}:追加  {bold}r{/bold}:リネーム  {bold}d{/bold}:削除  {bold}Esc/q{/bold}:閉じる'
    );
  }

  function loadAndRender(): void {
    categories = q.getCategories();
    if (categories.length > 0 && selectedIndex >= categories.length) {
      selectedIndex = categories.length - 1;
    }
    render();
  }

  function render(): void {
    if (categories.length === 0) {
      contentBox.setContent(
        '\n {gray-fg}カテゴリがありません。{bold}a{/bold} キーで追加できます。{/gray-fg}'
      );
      screen.render();
      return;
    }

    const lines: string[] = [''];
    categories.forEach((cat, i) => {
      const isSelected = i === selectedIndex;
      const parentName =
        cat.parent_id != null
          ? ` {gray-fg}← ${categories.find((c) => c.id === cat.parent_id)?.name ?? '?'}{/gray-fg}`
          : '';
      if (isSelected) {
        lines.push(` {bold}{green-fg}▶ ${cat.name}${parentName}{/green-fg}{/bold}`);
      } else {
        lines.push(`   ${cat.name}${parentName}`);
      }
    });
    contentBox.setContent(lines.join('\n'));
    screen.render();
  }

  function promptInput(
    promptText: string,
    initialValue: string,
    onDone: (value: string) => void,
    onAbort: () => void
  ): void {
    let value = initialValue;
    setStatus(`${promptText}: ${value}▋  (Enter:確定  Esc:キャンセル)`);

    inputHandler = (ch, key) => {
      if (key.name === 'enter') {
        inputHandler = null;
        resetStatus();
        value.trim() ? onDone(value.trim()) : onAbort();
      } else if (key.name === 'escape') {
        inputHandler = null;
        resetStatus();
        onAbort();
      } else if (key.name === 'backspace') {
        value = value.slice(0, -1);
        setStatus(`${promptText}: ${value}▋  (Enter:確定  Esc:キャンセル)`);
      } else if (ch && !key.ctrl && ch.length === 1) {
        value += ch;
        setStatus(`${promptText}: ${value}▋  (Enter:確定  Esc:キャンセル)`);
      }
    };
  }

  function onKeypress(ch: string | undefined, key: { name: string; ctrl: boolean }): void {
    // 入力ハンドラーがあれば委譲して終了
    if (inputHandler) {
      inputHandler(ch, key);
      return;
    }

    if (key.name === 'up') {
      selectedIndex = Math.max(0, selectedIndex - 1);
      render();
    } else if (key.name === 'down') {
      selectedIndex = Math.min(Math.max(categories.length - 1, 0), selectedIndex + 1);
      render();
    } else if (ch === 'a') {
      promptInput('カテゴリ名', '', (name) => {
        q.createCategory(name);
        loadAndRender();
      }, () => {});
    } else if (ch === 'r') {
      if (categories.length === 0) return;
      const cat = categories[selectedIndex];
      promptInput('リネーム', cat.name, (newName) => {
        q.renameCategory(cat.id, newName);
        loadAndRender();
      }, () => {});
    } else if (ch === 'd') {
      if (categories.length === 0) return;
      const cat = categories[selectedIndex];
      setStatus(`"${cat.name}" を削除しますか？ (y/N)`);
      inputHandler = (ch2) => {
        inputHandler = null;
        if (ch2 === 'y') {
          q.deleteCategory(cat.id);
          loadAndRender();
        } else {
          resetStatus();
        }
      };
    } else if (key.name === 'escape' || ch === 'q') {
      screen.removeListener('keypress', onKeypress);
      overlay.destroy();
      screen.render();
      onClose();
    }
  }

  screen.on('keypress', onKeypress);
  overlay.focus();
  loadAndRender();
  resetStatus();
}
