import pg from 'pg';
import { loadScene, loadUnplaced } from '../src/server/reads.js';

const pool = new pg.Pool({ connectionString: process.env.DB_URL });
const CANVAS = 'c0000000-0000-0000-0000-000000000001';

async function main() {
  const db = await pool.connect();

  const scene = await loadScene(db, CANVAS);
  console.log('scene:',
    scene!.placements.length, 'placements |',
    scene!.records.length, 'records |',
    scene!.links.length, 'drawable links |',
    scene!.annotations.length, 'annotations |',
    'snapshot at seq', scene!.seq);
  console.log('distinct tables on this ONE canvas:',
    new Set(scene!.records.map((r) => r.table_id)).size);

  const unplaced = await loadUnplaced(db, CANVAS);
  console.log('unplaced tray:',
    (unplaced.records as any[]).map((r) => r.data.name).join(', '),
    unplaced.hasMore ? '(+ more)' : '');

  const t0 = Date.now();
  for (let i = 0; i < 20; i++) await loadScene(db, CANVAS);
  console.log(`scene load avg: ${((Date.now() - t0) / 20).toFixed(1)}ms`);

  db.release();
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
