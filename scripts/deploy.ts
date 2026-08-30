import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { arch } from 'node:os';
import path from 'node:path';

const [, , command, target] = process.argv;

if (!command || !target || (target !== 'test' && target !== 'prod')) {
  console.error('Usage: deploy.ts <up|down|logs> <test|prod>');
  process.exit(1);
}

const env_file = `.env.${target}`;
if (!existsSync(path.resolve(env_file))) {
  console.error(`${env_file} not found — copy .env.example to ${env_file} and fill it in.`);
  process.exit(1);
}
process.loadEnvFile(path.resolve(env_file));

const ssh_host = process.env.SSH_HOST;
const docker_context = process.env.DOCKER_CONTEXT;
const data_dir_host = process.env.DATA_DIR_HOST;

if (!ssh_host) {
  throw new Error(`SSH_HOST must be set in ${env_file}`);
}
if (!docker_context) {
  throw new Error(`DOCKER_CONTEXT must be set in ${env_file}`);
}
if (command === 'up') {
  if (!data_dir_host) {
    throw new Error(`DATA_DIR_HOST must be set in ${env_file}`);
  }
}

// The box is amd64, the Pi is arm64. A remote build on the box leaves the image
// where it is needed; the Mac can only cross-build for the Pi and ship it over.
const build_mode = target === 'prod' ? 'remote' : 'local';
const platform = target === 'prod' ? 'linux/amd64' : 'linux/arm64';

const compose_file = `docker-compose.${target}.yml`;
const project = `scrollsurf-${target}`;
const dc = `docker --context ${docker_context} compose -p ${project} --env-file ${env_file} -f ${compose_file}`;

const run = (cmd: string) => execSync(cmd, { stdio: 'inherit' });

// `compose up` against a missing external network fails with an error that says
// nothing about how to repair it, so check first and name the fix.
const check_caddy_net = () => {
  try {
    execSync(`docker --context ${docker_context} network inspect caddy_net`, { stdio: 'ignore' });
  } catch {
    throw new Error(
      `The external network caddy_net does not exist on the ${docker_context} context. ` +
        'Create it with `docker --context ' +
        docker_context +
        ' network create caddy_net`, or bring up the proxy in ~/code/box-caddy first.'
    );
  }
};

if (command === 'up') {
  if (target === 'prod') {
    check_caddy_net();
  }
  const datasets_dir = path.resolve('datasets');
  const has_datasets =
    existsSync(datasets_dir) && readdirSync(datasets_dir).some((f) => f.endsWith('.db'));
  if (has_datasets) {
    run(`rsync -av --delete ${datasets_dir}/ ${ssh_host}:${data_dir_host}/datasets/`);
  } else {
    console.warn(
      `No *.db files in ${datasets_dir} — skipping dataset sync. ` +
        'Run the download-* scripts first if the app should have content.'
    );
  }
  const image = `scrollsurf-${target}`;
  const commit_id = execSync('git rev-parse --short HEAD').toString().trim();
  if (build_mode === 'local') {
    if (arch() !== 'arm64') {
      throw new Error(`Local build requires an ARM64 machine (current: ${arch()}).`);
    }
    run(`docker build --platform ${platform} --build-arg COMMIT_ID=${commit_id} -t ${image} .`);
    run(`docker save ${image} | gzip | ssh ${ssh_host} docker load`);
  } else {
    // The remote daemon already holds the built image — no save/load round trip.
    run(
      `docker --context ${docker_context} build --build-arg COMMIT_ID=${commit_id} -t ${image} .`
    );
  }
  run(`${dc} up -d`);
} else if (command === 'logs') {
  run(`${dc} logs -f app`);
} else if (command === 'down') {
  run(`${dc} down`);
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
