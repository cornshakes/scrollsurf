import { get_db } from './connection';

const SET_ENABLED_SQL =
  'INSERT OR REPLACE INTO user_settings (user_id, dataset, enabled) VALUES ($user_id, $dataset, $enabled)';

const GET_ENABLED_SQL = `
  SELECT d.name AS dataset, COALESCE(us.enabled, 1) AS enabled
  FROM datasets d
  LEFT JOIN user_settings us ON us.dataset = d.name AND us.user_id = $user_id
  ORDER BY d.name
`;

export const set_dataset_enabled = (dataset: string, enabled: boolean, user_id: number) => {
  get_db()
    .prepare(SET_ENABLED_SQL)
    .run({ $user_id: user_id, $dataset: dataset, $enabled: enabled ? 1 : 0 });
};

export const get_datasets_enabled = (user_id: number | null): Record<string, boolean> => {
  const rows = get_db().prepare(GET_ENABLED_SQL).all({ $user_id: user_id }) as unknown as {
    dataset: string;
    enabled: number;
  }[];
  return Object.fromEntries(rows.map((r) => [r.dataset, r.enabled === 1]));
};
