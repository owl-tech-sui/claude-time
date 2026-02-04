#!/usr/bin/env node
/**
 * claude-time MCPサーバー エントリポイント
 */

import { Storage } from './storage.js';
import { MCPServer } from './server.js';

async function main(): Promise<void> {
  const storage = new Storage();
  const server = new MCPServer(storage);

  // 終了時にストレージを閉じる
  process.on('SIGINT', () => {
    storage.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    storage.close();
    process.exit(0);
  });

  await server.run();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
