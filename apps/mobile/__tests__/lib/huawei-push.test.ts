import { describe, expect, it, vi } from 'vitest';
import { addAgcpClasspath, addHuaweiMaven, applyAgcpPlugin } from '../../huawei-gradle.cjs';
import { createHuaweiRegistrar } from '../../src/lib/huawei-push-sync';

const ROOT_GRADLE = `buildscript {
  repositories {
    google()
    mavenCentral()
  }
  dependencies {
    classpath('com.android.tools.build:gradle')
    classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')
  }
}

allprojects {
  repositories {
    google()
    mavenCentral()
  }
}
`;

describe('huawei gradle', () => {
  it('adds the maven repo and agconnect plugin once', () => {
    const root = addAgcpClasspath(addHuaweiMaven(ROOT_GRADLE));
    expect(root.match(/developer\.huawei\.com\/repo\//g)).toHaveLength(2);
    expect(root).toContain("classpath('com.android.tools.build:gradle:8.11.0')");
    expect(root).toContain("classpath('com.huawei.agconnect:agcp:1.9.6.300')");
    expect(addAgcpClasspath(addHuaweiMaven(root))).toBe(root);

    const app = applyAgcpPlugin('dependencies {}\n');
    expect(app).toContain('apply plugin: "com.huawei.agconnect"');
    expect(applyAgcpPlugin(app)).toBe(app);
  });
});

describe('huawei registrar', () => {
  it('posts a new token once and retries when the first read is empty', async () => {
    const register = vi.fn(async () => undefined);
    let reads = 0;
    const registrar = createHuaweiRegistrar(
      {
        getToken: async () => {
          reads += 1;
          return reads === 1 ? '' : 'tok-1';
        },
        register,
      },
      0,
    );

    await registrar.sync();
    await registrar.sync();
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('tok-1');
  });

  it('joins an in-flight sync and retries after a failed post', async () => {
    const token = 'tok-2';
    let posts = 0;
    const held: { release: (() => void) | null } = { release: null };
    const gate = new Promise<void>((resolve) => {
      held.release = resolve;
    });
    const registrar = createHuaweiRegistrar(
      {
        getToken: async () => token,
        register: async () => {
          posts += 1;
          if (posts === 1) {
            await gate;
            throw new Error('offline');
          }
        },
      },
      0,
    );

    const first = registrar.sync();
    const second = registrar.sync();
    held.release?.();
    await first;
    await second;
    expect(posts).toBe(1);

    await registrar.sync();
    expect(posts).toBe(2);
  });
});
