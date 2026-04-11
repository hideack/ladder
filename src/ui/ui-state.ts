import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { LayoutMode } from './layout.js';
import type { FilterMode } from './feed-list.js';

export type UiMode = '3pane' | 'unified';

export interface UiState {
  layoutMode: LayoutMode;
  filterMode: FilterMode;
  uiMode?: UiMode;
}

const DEFAULT_UI_STATE: UiState = {
  layoutMode: 'horizontal',
  filterMode: 'active',
  uiMode: '3pane',
};

function getUiStatePath(): string {
  const configDir = join(homedir(), '.config', 'ladder');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  return join(configDir, 'ui-state.json');
}

export function loadUiState(): UiState {
  try {
    const raw = readFileSync(getUiStatePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<UiState>;
    return {
      layoutMode: parsed.layoutMode === 'vertical' ? 'vertical' : 'horizontal',
      filterMode: (['active', 'unread', 'all'] as FilterMode[]).includes(parsed.filterMode as FilterMode)
        ? (parsed.filterMode as FilterMode)
        : 'active',
      uiMode: parsed.uiMode === 'unified' ? 'unified' : '3pane',
    };
  } catch {
    return { ...DEFAULT_UI_STATE };
  }
}

export function saveUiState(state: UiState): void {
  try {
    writeFileSync(getUiStatePath(), JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // 保存失敗は無視（動作に影響しない）
  }
}
