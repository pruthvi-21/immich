import { clearEnvCache, ConfigRepository } from 'src/repositories/config.repository';

const getEnv = () => {
  clearEnvCache();
  return new ConfigRepository().getEnv();
};

const resetEnv = () => {
  for (const env of [
    'IMMICH_WORKERS_INCLUDE',
    'IMMICH_WORKERS_EXCLUDE',

    'DB_URL',
    'DB_HOSTNAME',
    'DB_PORT',
    'DB_USERNAME',
    'DB_PASSWORD',
    'DB_DATABASE_NAME',
    'DB_SKIP_MIGRATIONS',
    'DB_VECTOR_EXTENSION',

    'REDIS_HOSTNAME',
    'REDIS_PORT',
    'REDIS_DBINDEX',
    'REDIS_USERNAME',
    'REDIS_PASSWORD',
    'REDIS_SOCKET',
    'REDIS_URL',

    'NO_COLOR',
  ]) {
    delete process.env[env];
  }
};

const sentinelConfig = {
  sentinels: [
    {
      host: 'redis-sentinel-node-0',
      port: 26_379,
    },
    {
      host: 'redis-sentinel-node-1',
      port: 26_379,
    },
    {
      host: 'redis-sentinel-node-2',
      port: 26_379,
    },
  ],
  name: 'redis-sentinel',
};

describe('getEnv', () => {
  beforeEach(() => {
    resetEnv();
  });

  describe('database', () => {
    it('should use defaults', () => {
      const { database } = getEnv();
      expect(database).toEqual({
        url: undefined,
        host: 'database',
        port: 5432,
        name: 'immich',
        username: 'postgres',
        password: 'postgres',
        skipMigrations: false,
        vectorExtension: 'vectors',
      });
    });

    it('should allow skipping migrations', () => {
      process.env.DB_SKIP_MIGRATIONS = 'true';
      const { database } = getEnv();
      expect(database).toMatchObject({ skipMigrations: true });
    });
  });

  describe('redis', () => {
    it('should use defaults', () => {
      const { redis } = getEnv();
      expect(redis).toEqual({
        host: 'redis',
        port: 6379,
        db: 0,
        username: undefined,
        password: undefined,
        path: undefined,
      });
    });

    it('should parse base64 encoded config, ignore other env', () => {
      process.env.REDIS_URL = `ioredis://${Buffer.from(JSON.stringify(sentinelConfig)).toString('base64')}`;
      process.env.REDIS_HOSTNAME = 'redis-host';
      process.env.REDIS_USERNAME = 'redis-user';
      process.env.REDIS_PASSWORD = 'redis-password';
      const { redis } = getEnv();
      expect(redis).toEqual(sentinelConfig);
    });

    it('should reject invalid json', () => {
      process.env.REDIS_URL = `ioredis://${Buffer.from('{ "invalid json"').toString('base64')}`;
      expect(() => getEnv()).toThrowError('Failed to decode redis options');
    });
  });

  describe('noColor', () => {
    beforeEach(() => {
      delete process.env.NO_COLOR;
    });

    it('should default noColor to false', () => {
      const { noColor } = getEnv();
      expect(noColor).toBe(false);
    });

    it('should map NO_COLOR=1 to true', () => {
      process.env.NO_COLOR = '1';
      const { noColor } = getEnv();
      expect(noColor).toBe(true);
    });

    it('should map NO_COLOR=true to true', () => {
      process.env.NO_COLOR = 'true';
      const { noColor } = getEnv();
      expect(noColor).toBe(true);
    });
  });

  describe('workers', () => {
    it('should return default workers', () => {
      const { workers } = getEnv();
      expect(workers).toEqual(['api', 'microservices']);
    });

    it('should return included workers', () => {
      process.env.IMMICH_WORKERS_INCLUDE = 'api';
      const { workers } = getEnv();
      expect(workers).toEqual(['api']);
    });

    it('should excluded workers from defaults', () => {
      process.env.IMMICH_WORKERS_EXCLUDE = 'api';
      const { workers } = getEnv();
      expect(workers).toEqual(['microservices']);
    });

    it('should exclude workers from include list', () => {
      process.env.IMMICH_WORKERS_INCLUDE = 'api,microservices,randomservice';
      process.env.IMMICH_WORKERS_EXCLUDE = 'randomservice,microservices';
      const { workers } = getEnv();
      expect(workers).toEqual(['api']);
    });

    it('should remove whitespace from included workers before parsing', () => {
      process.env.IMMICH_WORKERS_INCLUDE = 'api, microservices';
      const { workers } = getEnv();
      expect(workers).toEqual(['api', 'microservices']);
    });

    it('should remove whitespace from excluded workers before parsing', () => {
      process.env.IMMICH_WORKERS_EXCLUDE = 'api, microservices';
      const { workers } = getEnv();
      expect(workers).toEqual([]);
    });

    it('should remove whitespace from included and excluded workers before parsing', () => {
      process.env.IMMICH_WORKERS_INCLUDE = 'api, microservices, randomservice,randomservice2';
      process.env.IMMICH_WORKERS_EXCLUDE = 'randomservice,microservices, randomservice2';
      const { workers } = getEnv();
      expect(workers).toEqual(['api']);
    });

    it('should throw error for invalid workers', () => {
      process.env.IMMICH_WORKERS_INCLUDE = 'api,microservices,randomservice';
      expect(getEnv).toThrowError('Invalid worker(s) found: api,microservices,randomservice');
    });
  });
});