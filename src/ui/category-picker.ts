import blessed from 'neo-blessed';
import { Queries } from '../db/queries.js';

export function showCategoryPicker(
  screen: blessed.Widgets.Screen,
  q: Queries,
  currentCategoryId: number | null,
  onSelect: (categoryId: number | null) => void,
  onCancel: () => void
): void {
  const categories = q.getCategories();

  const items: Array<{ label: string; categoryId: number | null }> = [
    { label: '(No category)', categoryId: null },
    ...categories.map((cat) => ({ label: cat.name, categoryId: cat.id })),
  ];

  let selectedIndex = items.findIndex((item) => item.categoryId === currentCategoryId);
  if (selectedIndex < 0) selectedIndex = 0;

  const height = Math.min(items.length + 4, 20);

  const overlay = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: 52,
    height,
    border: { type: 'line' },
    label: ' Assign Category ',
    tags: true,
    style: {
      border: { fg: 'cyan' },
      label: { fg: 'cyan', bold: true },
      bg: 'black',
      fg: 'white',
    },
  });

  function render(): void {
    const lines: string[] = [''];
    items.forEach((item, i) => {
      const isCurrent = item.categoryId === currentCategoryId;
      const isSelected = i === selectedIndex;
      const marker = isCurrent ? ' {yellow-fg}✓{/yellow-fg}' : '';
      if (isSelected) {
        lines.push(` {bold}{cyan-fg}▶ ${item.label}${marker}{/cyan-fg}{/bold}`);
      } else {
        lines.push(`   ${item.label}${marker}`);
      }
    });
    lines.push('');
    lines.push(' {gray-fg}Enter:確定  Esc:キャンセル{/gray-fg}');
    overlay.setContent(lines.join('\n'));
    screen.render();
  }

  render();
  overlay.focus();

  function onKeypress(ch: string | undefined, key: { name: string }): void {
    if (key.name === 'up') {
      selectedIndex = Math.max(0, selectedIndex - 1);
      render();
    } else if (key.name === 'down') {
      selectedIndex = Math.min(items.length - 1, selectedIndex + 1);
      render();
    } else if (key.name === 'enter') {
      screen.removeListener('keypress', onKeypress);
      overlay.destroy();
      screen.render();
      onSelect(items[selectedIndex].categoryId);
    } else if (key.name === 'escape') {
      screen.removeListener('keypress', onKeypress);
      overlay.destroy();
      screen.render();
      onCancel();
    }
  }

  screen.on('keypress', onKeypress);
}
