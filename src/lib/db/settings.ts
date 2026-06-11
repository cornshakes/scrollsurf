import { type StatementSync } from 'node:sqlite';
import { get_db } from './connection';

let stmts: { set_enabled: StatementSync; get_enabled: StatementSync } | null = null;
const s = () => {
  if (stmts) {
    return stmts;
  }
  const db = get_db();
  stmts = {
    set_enabled: db.prepare(
      'INSERT OR REPLACE INTO user_settings (user_id, dataset, enabled) VALUES ($user_id, $dataset, $enabled)'
    ),
    get_enabled: db.prepare(
      `SELECT d.name AS dataset, COALESCE(us.enabled, 1) AS enabled
       FROM datasets d
       LEFT JOIN user_settings us ON us.dataset = d.name AND us.user_id = $user_id
       ORDER BY d.name`
    ),
  };
  return stmts;
};

export const set_dataset_enabled = (dataset: string, enabled: boolean, user_id: number) => {
  s().set_enabled.run({ $user_id: user_id, $dataset: dataset, $enabled: enabled ? 1 : 0 });
};

export const get_datasets_enabled = (user_id: number | null): Record<string, boolean> => {
  const rows = s().get_enabled.all({ $user_id: user_id }) as unknown as {
    dataset: string;
    enabled: number;
  }[];
  return Object.fromEntries(rows.map((r) => [r.dataset, r.enabled === 1]));
};
