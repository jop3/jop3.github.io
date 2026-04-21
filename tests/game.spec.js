const { test, expect } = require('@playwright/test');

const THEMES = ['land', 'sea', 'cloud', 'cave', 'normandy', 'forest', 'volcano', 'arctic', 'desert', 'city', 'space'];

test.describe('Game boot', () => {
  test('loads without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(500);
    const hasTestHook = await page.evaluate(() => !!window.__TEST);
    expect(hasTestHook).toBe(true);
    expect(errors).toEqual([]);
  });

  test('starts on title screen', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => window.__TEST.state);
    expect(state).toBe(0); // ST.TITLE
  });

  test('starts game on Enter', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => {
      window.__TEST.startGame();
      return window.__TEST.state;
    });
    expect(state).toBe(1); // ST.PLAYING
  });
});

test.describe('Theme terrain generation', () => {
  for (const theme of THEMES) {
    test(`${theme}: generates valid terrain`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://localhost:8173');
      await page.waitForTimeout(300);

      const result = await page.evaluate((th) => {
        const T = window.__TEST;
        T.setThemeOrder([th, ...T.THEMES.filter(t => t !== th)]);
        T.startGame();

        // Check terrain array
        const terrain = T.terrain;
        let nanCount = 0, infCount = 0, validCount = 0;
        for (let i = 0; i < T.WORLD_W; i++) {
          if (isNaN(terrain[i])) nanCount++;
          else if (!isFinite(terrain[i])) infCount++;
          else validCount++;
        }

        // Check player spawned
        const p = T.player;
        const playerValid = p && isFinite(p.x) && isFinite(p.y) && p.hp > 0;

        return { nanCount, infCount, validCount, playerValid, theme: T.getLevelTheme(T.level) };
      }, theme);

      expect(result.theme).toBe(theme);
      expect(result.nanCount).toBe(0);
      expect(result.infCount).toBe(0);
      expect(result.validCount).toBe(12000); // WORLD_W
      expect(result.playerValid).toBe(true);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('Theme enemy spawning', () => {
  for (const theme of THEMES) {
    test(`${theme}: spawns enemies`, async ({ page }) => {
      await page.goto('http://localhost:8173');
      await page.waitForTimeout(300);

      const result = await page.evaluate((th) => {
        const T = window.__TEST;
        T.setThemeOrder([th, ...T.THEMES.filter(t => t !== th)]);
        T.startGame();
        return {
          enemyCount: T.enemies.length,
          aliveCount: T.enemies.filter(e => e.alive).length,
        };
      }, theme);

      expect(result.enemyCount).toBeGreaterThan(0);
      expect(result.aliveCount).toBeGreaterThan(0);
    });
  }
});

test.describe('Theme level completion', () => {
  for (const theme of THEMES) {
    test(`${theme}: completable when targets destroyed`, async ({ page }) => {
      await page.goto('http://localhost:8173');
      await page.waitForTimeout(300);

      const result = await page.evaluate((th) => {
        const T = window.__TEST;
        T.setThemeOrder([th, ...T.THEMES.filter(t => t !== th)]);
        T.startGame();

        // Kill all enemies
        for (const e of T.enemies) { e.alive = false; e.burning = false; }
        // Destroy all buildings
        for (const b of T.buildings) b.alive = false;
        // Destroy theme-specific targets
        if (T.cityBuildings) for (const cb of T.cityBuildings) cb.alive = false;
        // Destroy tanks, trains, AA guns (normandy/forest targets)
        if (T.tanks) for (const t of T.tanks) t.alive = false;
        if (T.trains) for (const t of T.trains) t.alive = false;
        if (T.aaGuns) for (const a of T.aaGuns) a.alive = false;

        T.checkLevelComplete();
        return { state: T.state, score: T.score };
      }, theme);

      expect(result.state).toBe(4); // ST.LEVEL_COMPLETE
      expect(result.score).toBeGreaterThan(0);
    });
  }
});

test.describe('Game simulation - no crashes', () => {
  for (const theme of THEMES) {
    test(`${theme}: survives 300 tick simulation`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://localhost:8173');
      await page.waitForTimeout(300);

      const result = await page.evaluate((th) => {
        const T = window.__TEST;
        T.setThemeOrder([th, ...T.THEMES.filter(t => t !== th)]);
        T.startGame();

        // Make player invincible so we can tick without dying
        T.player.invincible = 999;
        T.player.fuel = 99999;

        // Simulate 300 frames (~5 seconds)
        T.tick(300);

        return {
          state: T.state,
          playerAlive: T.player.hp > 0,
          playerX: T.player.x,
          playerY: T.player.y,
          xValid: isFinite(T.player.x),
          yValid: isFinite(T.player.y),
        };
      }, theme);

      expect(result.xValid).toBe(true);
      expect(result.yValid).toBe(true);
      expect(result.playerAlive).toBe(true);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('Wingman system', () => {
  test('adds wingman and they follow player', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const T = window.__TEST;
      T.startGame();
      T.player.invincible = 999;
      T.player.fuel = 99999;

      // Add wingmen
      T.addWingman();
      T.addWingman();
      const countAfterAdd = T.wingmen.length;

      // Simulate — wingmen should follow
      T.tick(60);
      const wingmenAlive = T.wingmen.filter(w => w.alive).length;
      const wingmenNearPlayer = T.wingmen.filter(w =>
        Math.abs(w.x - T.player.x) < 200 && Math.abs(w.y - T.player.y) < 200
      ).length;

      return { countAfterAdd, wingmenAlive, wingmenNearPlayer };
    });

    expect(result.countAfterAdd).toBe(2);
    expect(result.wingmenAlive).toBe(2);
    expect(result.wingmenNearPlayer).toBe(2);
  });

  test('respects MAX_WINGMEN cap', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);

    const count = await page.evaluate(() => {
      const T = window.__TEST;
      T.startGame();
      for (let i = 0; i < 5; i++) T.addWingman();
      return T.wingmen.length;
    });

    expect(count).toBe(3); // MAX_WINGMEN
  });
});

test.describe('Supply drop system', () => {
  test('activates supply and it expires', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const T = window.__TEST;
      T.startGame();
      T.player.invincible = 999;

      T.activateSupply('twin_guns');
      const activeAfter = T.activeSupply ? T.activeSupply.type : null;
      const timerStart = T.activeSupply ? T.activeSupply.timer : 0;

      // Tick until it expires
      T.tick(900); // 15 seconds at 60fps
      const activeAfterExpiry = T.activeSupply;

      return { activeAfter, timerStart, activeAfterExpiry };
    });

    expect(result.activeAfter).toBe('twin_guns');
    expect(result.timerStart).toBe(15);
    expect(result.activeAfterExpiry).toBeNull();
  });

  test('armor halves damage', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const T = window.__TEST;
      T.startGame();

      // Take 2 damage without armor
      const hpBefore = T.player.hp;
      T.damagePlayer(2);
      const hpAfterNormal = T.player.hp;
      T.player.invincible = 0; // reset i-frames

      // Reset HP, activate armor, take 2 damage
      T.player.hp = T.PLAYER_MAX_HP;
      T.player.burning = false;
      T.activateSupply('armor');
      T.player.invincible = 0;
      T.damagePlayer(2);
      const hpAfterArmor = T.player.hp;

      return { hpBefore, hpAfterNormal, hpAfterArmor, maxHp: T.PLAYER_MAX_HP };
    });

    // Without armor: 3 - 2 = 1
    expect(result.hpAfterNormal).toBe(result.hpBefore - 2);
    // With armor: 3 - 1 = 2 (halved from 2 to 1)
    expect(result.hpAfterArmor).toBe(result.maxHp - 1);
  });
});

test.describe('Weather system', () => {
  test('initializes weather for each level', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const T = window.__TEST;
      T.startGame();
      const weather = T.weather;
      return {
        hasType: typeof weather.type === 'string',
        hasIntensity: typeof weather.intensity === 'number',
        validType: ['clear', 'rain', 'lightning', 'fog', 'wind'].includes(weather.type),
      };
    });

    expect(result.hasType).toBe(true);
    expect(result.hasIntensity).toBe(true);
    expect(result.validType).toBe(true);
  });

  test('arctic has forced wind weather', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);

    const type = await page.evaluate(() => {
      const T = window.__TEST;
      T.setThemeOrder(['arctic', ...T.THEMES.filter(t => t !== 'arctic')]);
      T.startGame();
      return T.weather.type;
    });

    expect(type).toBe('wind');
  });

  test('desert has forced wind weather', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);

    const type = await page.evaluate(() => {
      const T = window.__TEST;
      T.setThemeOrder(['desert', ...T.THEMES.filter(t => t !== 'desert')]);
      T.startGame();
      return T.weather.type;
    });

    expect(type).toBe('wind');
  });
});

test.describe('Ace nemesis', () => {
  test('spawns on level 3', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const T = window.__TEST;
      T.startGame();
      T.level = 3;
      T.initLevel();
      const nemesis = T.enemies.find(e => e.isNemesis);
      return {
        hasNemesis: !!nemesis,
        nemesisAlive: nemesis ? nemesis.alive : false,
        aceNemesisActive: T.aceNemesis ? T.aceNemesis.active : false,
      };
    });

    expect(result.hasNemesis).toBe(true);
    expect(result.nemesisAlive).toBe(true);
    expect(result.aceNemesisActive).toBe(true);
  });

  test('escaping nemesis increases escape count', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const T = window.__TEST;
      T.startGame();
      T.level = 3;
      T.initLevel();

      const nem = T.enemies.find(e => e.isNemesis);
      if (nem) nem.x = -300; // fly off map

      // Directly check escape (tick would kill nemesis first via updateEnemies)
      T.checkNemesisEscape();

      return {
        escapes: T.aceNemesis ? T.aceNemesis.escapes : -1,
        active: T.aceNemesis ? T.aceNemesis.active : true,
      };
    });

    expect(result.escapes).toBe(1);
    expect(result.active).toBe(false);
  });
});

test.describe('Theme-specific features', () => {
  test('volcano: has lava geysers', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);

    const count = await page.evaluate(() => {
      const T = window.__TEST;
      T.setThemeOrder(['volcano', ...T.THEMES.filter(t => t !== 'volcano')]);
      T.startGame();
      return T.lavaGeysers.length;
    });

    expect(count).toBeGreaterThan(0);
  });

  test('desert: has pyramids and mirages', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const T = window.__TEST;
      T.setThemeOrder(['desert', ...T.THEMES.filter(t => t !== 'desert')]);
      T.startGame();
      return { pyramids: T.pyramids.length, mirages: T.mirages.length };
    });

    expect(result.pyramids).toBeGreaterThan(0);
    expect(result.mirages).toBeGreaterThan(0);
  });

  test('city: has skyscrapers and searchlights', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const T = window.__TEST;
      T.setThemeOrder(['city', ...T.THEMES.filter(t => t !== 'city')]);
      T.startGame();
      return { buildings: T.cityBuildings.length };
    });

    expect(result.buildings).toBeGreaterThan(0);
  });

  test('space: has asteroids', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);

    const count = await page.evaluate(() => {
      const T = window.__TEST;
      T.setThemeOrder(['space', ...T.THEMES.filter(t => t !== 'space')]);
      T.startGame();
      return T.asteroids.length;
    });

    expect(count).toBeGreaterThan(0);
  });

  test('sea: carrier not stuck in island', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const T = window.__TEST;
      // Run multiple seeds to catch intermittent issues
      let allClear = true;
      for (let attempt = 0; attempt < 10; attempt++) {
        T.setThemeOrder(['sea', ...T.THEMES.filter(t => t !== 'sea')]);
        T.startGame();

        // Check terrain around carrier base is at water level (not island)
        const baseCenter = T.player.x; // player spawns at base
        const waterY = T.getTerrainY(baseCenter);

        // Check 200px on each side — terrain should be flat carrier deck
        let maxDeviation = 0;
        for (let dx = -200; dx <= 200; dx += 10) {
          const ty = T.getTerrainY(baseCenter + dx);
          const dev = Math.abs(ty - waterY);
          if (dev > maxDeviation) maxDeviation = dev;
        }
        // Deviation > 50 means island terrain is encroaching
        if (maxDeviation > 50) allClear = false;
      }
      return { allClear };
    });

    expect(result.allClear).toBe(true);
  });
});

test.describe('Shuffled theme order', () => {
  test('all themes appear in shuffled order', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const T = window.__TEST;
      T.shuffleThemes();
      const order = T.getThemeOrder();
      const hasAll = T.THEMES.every(t => order.includes(t));
      const rightLength = order.length === T.THEMES.length;
      return { hasAll, rightLength, order };
    });

    expect(result.hasAll).toBe(true);
    expect(result.rightLength).toBe(true);
  });

  test('shuffle produces different orders', async ({ page }) => {
    await page.goto('http://localhost:8173');
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const T = window.__TEST;
      const orders = [];
      for (let i = 0; i < 10; i++) {
        T.shuffleThemes();
        orders.push(T.getThemeOrder().join(','));
      }
      const unique = new Set(orders);
      return { uniqueCount: unique.size };
    });

    // With 11 themes, 10 shuffles should produce at least 2 different orders
    expect(result.uniqueCount).toBeGreaterThan(1);
  });
});
