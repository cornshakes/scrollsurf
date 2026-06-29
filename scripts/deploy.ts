import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { arch } from 'node:os';
import path from 'node:path';

const [, , command, target] = process.argv;

if (!command || !target || (target !== 'test' && target !== 'prod')) {
  console.error('Usage: deploy.ts <up|down|logs|funnel> <test|prod>');
  process.exit(1);
}

const env_file = `.env.${target}`;
if (!existsSync(path.resolve(env_file))) {
  console.error(`${env_file} not found — copy .env.example to ${env_file} and fill it in.`);
  process.exit(1);
}
process.loadEnvFile(path.resolve(env_file));

const pi_ssh = process.env.PI_SSH;
const data_dir_host = process.env.DATA_DIR_HOST;

if (!pi_ssh) {
  throw new Error(`PI_SSH must be set in ${env_file}`);
}
if (command === 'up') {
  if (!data_dir_host) {
    throw new Error(`DATA_DIR_HOST must be set in ${env_file}`);
  }
  if (target === 'prod' && !process.env.TS_AUTHKEY) {
    throw new Error(`TS_AUTHKEY must be set in ${env_file} for prod deploys`);
  }
}

const compose_file = `docker-compose.${target}.yml`;
const project = `scrollsurf-${target}`;
const dc = `docker --context pi compose -p ${project} --env-file ${env_file} -f ${compose_file}`;

const run = (cmd: string) => execSync(cmd, { stdio: 'inherit' });

if (command === 'up') {
  if (arch() !== 'arm64') {
    throw new Error(`Local build requires an ARM64 machine (current: ${arch()}).`);
  }
  const datasets_dir = path.resolve('datasets');
  const has_datasets =
    existsSync(datasets_dir) && readdirSync(datasets_dir).some((f) => f.endsWith('.db'));
  if (has_datasets) {
    run(`rsync -av --delete ${datasets_dir}/ ${pi_ssh}:${data_dir_host}/datasets/`);
  } else {
    console.warn(
      `No *.db files in ${datasets_dir} — skipping dataset sync. ` +
        'Run the download-* scripts first if the app should have content.'
    );
  }
  if (target === 'prod') {
    // Push the Funnel serve config to an absolute path on the Pi. A relative
    // bind mount in the compose file resolves against the local (Mac) path and
    // is fabricated as an empty dir on the remote daemon, so copy it explicitly.
    const serve_config = path.resolve('tailscale/serve.json');
    if (!existsSync(serve_config)) {
      throw new Error(`${serve_config} not found — required for prod Funnel`);
    }
    run(`rsync -av ${serve_config} ${pi_ssh}:${data_dir_host}/serve.json`);
  }
  const image = `scrollsurf-${target}`;
  const commit_id = execSync('git rev-parse --short HEAD').toString().trim();
  run(`docker build --platform linux/arm64 --build-arg COMMIT_ID=${commit_id} -t ${image} .`);
  run(`docker save ${image} | gzip | ssh ${pi_ssh} docker load`);
  run(`${dc} up -d`);
  if (target === 'prod') {
    console.warn('\nChecking Tailscale Funnel status...');
    try {
      run(`${dc} exec ts-scrollsurf tailscale funnel status`);
    } catch {
      console.warn('(funnel status unavailable — container may still be starting)');
    }
  }
} else if (command === 'logs') {
  // the grep removes the tailscale watchdog every 15s
  run(`${dc} logs -f | grep -vF "localapi: [POST] /localapi/v0/debug"`);
} else if (command === 'down') {
  run(`${dc} down`);
} else if (command === 'funnel') {
  if (target !== 'prod') {
    console.error('funnel command is only available for the prod target');
    process.exit(1);
  }
  run(`${dc} exec ts-scrollsurf tailscale funnel status`);
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
