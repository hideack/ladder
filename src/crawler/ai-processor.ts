import { spawn } from 'child_process';

/**
 * 日本語文字（ひらがな・カタカナ・漢字）の割合を返す
 */
function japaneseCharRatio(text: string): number {
  const total = text.replace(/\s/g, '').length;
  if (total === 0) return 0;
  const jpChars = (text.match(/[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff\uff00-\uffef]/g) ?? []).length;
  return jpChars / total;
}

/**
 * テキストが日本語かどうか判定する（10% 以上が日本語文字なら日本語とみなす）
 */
export function isJapanese(text: string): boolean {
  return japaneseCharRatio(text) >= 0.1;
}

/**
 * `claude -p` コマンド経由でテキストを要約または翻訳する。
 * - 日本語の場合: 要約して返す
 * - 日本語以外の場合: 日本語に翻訳して返す
 * Max プランの枠内で動作するため API 追加課金なし。
 */
export async function summarizeOrTranslate(text: string): Promise<string> {
  const japanese = isJapanese(text);
  const label = japanese ? 'Summary' : 'Translation (ja)';

  // テキストが長すぎる場合は先頭 8000 文字に制限
  const truncated = text.length > 8000 ? text.slice(0, 8000) + '\n\n[以下省略...]' : text;

  const prompt = japanese
    ? `以下の記事本文を日本語で簡潔に要約してください。重要なポイントを箇条書きでまとめた後、2〜3文の総括を書いてください。\n\n${truncated}`
    : `以下の記事本文を日本語に翻訳してください。元の文章の構成をできるだけ保ちながら、自然な日本語に翻訳してください。\n\n${truncated}`;

  const output = await new Promise<string>((resolve, reject) => {
    const proc = spawn('claude', ['-p', prompt], { encoding: 'utf8' } as Parameters<typeof spawn>[2]);
    let stdout = '';
    let stderr = '';

    (proc.stdout as NodeJS.ReadableStream).on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    (proc.stderr as NodeJS.ReadableStream).on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('claude コマンドがタイムアウトしました (120s)'));
    }, 120_000);

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`claude コマンドの実行に失敗しました: ${err.message}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude コマンドがエラーを返しました: ${stderr.trim() || `exit code ${code}`}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });

  return `[AI ${label}]\n\n${output}`;
}
