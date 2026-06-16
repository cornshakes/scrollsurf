import path from 'node:path';

const data_dir = (): string => {
  const dir = process.env.SCROLLSURF_DATA_DIR;
  if (!dir) {
    if (process.env.NODE_ENV === 'development') {
      return '.';
    }
    throw new Error('SCROLLSURF_DATA_DIR must be set');
  }
  return dir;
};

export const db_path = () => path.join(data_dir(), 'scrollsurf.db');
export const dataset_path = (filename: string) => path.join(data_dir(), 'datasets', filename);
