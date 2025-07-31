import { assertEquals, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  VersionUtils,
  MigrationManager,
  PreFlightChecks,
  SCHEMA_VERSIONS,
  migrationManager
} from './migration.ts';

Deno.test("VersionUtils - parse version", () => {
  const version = VersionUtils.parse('1.2.3');
  assertEquals(version.major, 1);
  assertEquals(version.minor, 2);
  assertEquals(version.patch, 3);
  
  // Invalid formats
  assertThrows(() => VersionUtils.parse('1.2'), Error, 'Invalid version format');
  assertThrows(() => VersionUtils.parse('1.2.3.4'), Error, 'Invalid version format');
  assertThrows(() => VersionUtils.parse('abc'), Error, 'Invalid version format');
});

Deno.test("VersionUtils - compare versions", () => {
  // Equal versions
  assertEquals(VersionUtils.compare('1.0.0', '1.0.0'), 0);
  
  // Major version differences
  assertEquals(VersionUtils.compare('2.0.0', '1.0.0'), 1);
  assertEquals(VersionUtils.compare('1.0.0', '2.0.0'), -1);
  
  // Minor version differences
  assertEquals(VersionUtils.compare('1.2.0', '1.1.0'), 1);
  assertEquals(VersionUtils.compare('1.1.0', '1.2.0'), -1);
  
  // Patch version differences
  assertEquals(VersionUtils.compare('1.0.2', '1.0.1'), 1);
  assertEquals(VersionUtils.compare('1.0.1', '1.0.2'), -1);
});

Deno.test("VersionUtils - check compatibility", () => {
  // Current version is always compatible
  assertEquals(VersionUtils.isCompatible(SCHEMA_VERSIONS.CURRENT), true);
  
  // Minimum compatible version
  assertEquals(VersionUtils.isCompatible(SCHEMA_VERSIONS.MINIMUM_COMPATIBLE), true);
  
  // Future versions (assuming current is 1.0.0)
  if (SCHEMA_VERSIONS.CURRENT === '1.0.0') {
    assertEquals(VersionUtils.isCompatible('1.1.0'), false);
    assertEquals(VersionUtils.isCompatible('2.0.0'), false);
  }
});

Deno.test("MigrationManager - register migration", () => {
  const manager = new MigrationManager();
  
  // Valid migration
  manager.registerMigration({
    id: 'test-migration',
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    description: 'Test migration',
    migrate: (data) => data
  });
  
  // Invalid migration (from >= to)
  assertThrows(() => {
    manager.registerMigration({
      id: 'invalid-migration',
      fromVersion: '1.1.0',
      toVersion: '1.0.0',
      description: 'Invalid migration',
      migrate: (data) => data
    });
  }, Error, 'fromVersion');
  
  // Duplicate ID
  assertThrows(() => {
    manager.registerMigration({
      id: 'test-migration',
      fromVersion: '1.1.0',
      toVersion: '1.2.0',
      description: 'Duplicate ID',
      migrate: (data) => data
    });
  }, Error, 'already registered');
});

Deno.test("MigrationManager - find migration path", () => {
  const manager = new MigrationManager();
  
  // Register a chain of migrations
  manager.registerMigration({
    id: 'v1.0-to-v1.1',
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    description: 'Upgrade to 1.1',
    migrate: (data) => ({ ...data, v11: true })
  });
  
  manager.registerMigration({
    id: 'v1.1-to-v1.2',
    fromVersion: '1.1.0',
    toVersion: '1.2.0',
    description: 'Upgrade to 1.2',
    migrate: (data) => ({ ...data, v12: true })
  });
  
  manager.registerMigration({
    id: 'v1.2-to-v2.0',
    fromVersion: '1.2.0',
    toVersion: '2.0.0',
    description: 'Major upgrade to 2.0',
    migrate: (data) => ({ ...data, v20: true })
  });
  
  // Find direct path
  const path1 = manager.findMigrationPath('1.0.0', '1.1.0');
  assertEquals(path1.length, 1);
  assertEquals(path1[0].id, 'v1.0-to-v1.1');
  
  // Find multi-step path
  const path2 = manager.findMigrationPath('1.0.0', '2.0.0');
  assertEquals(path2.length, 3);
  assertEquals(path2[0].id, 'v1.0-to-v1.1');
  assertEquals(path2[1].id, 'v1.1-to-v1.2');
  assertEquals(path2[2].id, 'v1.2-to-v2.0');
  
  // Same version - no migration needed
  const path3 = manager.findMigrationPath('1.0.0', '1.0.0');
  assertEquals(path3.length, 0);
  
  // No path available
  assertThrows(() => {
    manager.findMigrationPath('3.0.0', '4.0.0');
  }, Error, 'No migration path found');
  
  // Backwards migration not allowed
  assertThrows(() => {
    manager.findMigrationPath('2.0.0', '1.0.0');
  }, Error, 'Cannot migrate backwards');
});

Deno.test("MigrationManager - migrate data", async () => {
  const manager = new MigrationManager();
  
  // Register migration
  manager.registerMigration({
    id: 'add-new-field',
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    description: 'Add new field',
    migrate: (data) => ({
      ...data,
      newField: 'added',
      version: '1.1.0'
    })
  });
  
  // Test data
  const testData = {
    version: '1.0.0',
    existingField: 'value'
  };
  
  // Migrate
  const result = await manager.migrate(testData, '1.0.0', '1.1.0');
  
  assertEquals(result.success, true);
  assertEquals(result.fromVersion, '1.0.0');
  assertEquals(result.toVersion, '1.1.0');
  assertEquals(result.migrationsApplied.length, 1);
  assertEquals(result.migrationsApplied[0], 'add-new-field');
  assertEquals(result.errors.length, 0);
});

Deno.test("MigrationManager - migrate with validation", async () => {
  const manager = new MigrationManager();
  
  // Register migration with validation
  manager.registerMigration({
    id: 'validated-migration',
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    description: 'Migration with validation',
    validate: (data) => data.requiredField !== undefined,
    migrate: (data) => ({
      ...data,
      migrated: true,
      version: '1.1.0'
    })
  });
  
  // Test with invalid data
  const invalidData = {
    version: '1.0.0',
    // missing requiredField
  };
  
  const result1 = await manager.migrate(invalidData, '1.0.0', '1.1.0');
  assertEquals(result1.success, false);
  assertEquals(result1.errors.length, 1);
  assertEquals(result1.errors[0].includes('validation failed'), true);
  
  // Test with valid data
  const validData = {
    version: '1.0.0',
    requiredField: 'present'
  };
  
  const result2 = await manager.migrate(validData, '1.0.0', '1.1.0');
  assertEquals(result2.success, true);
  assertEquals(result2.errors.length, 0);
});

Deno.test("MigrationManager - check compatibility", () => {
  const manager = new MigrationManager();
  
  // Compatible data
  const compatible1 = manager.checkCompatibility({
    version: SCHEMA_VERSIONS.CURRENT
  });
  assertEquals(compatible1.compatible, true);
  assertEquals(compatible1.version, SCHEMA_VERSIONS.CURRENT);
  
  // Compatible with metadata
  const compatible2 = manager.checkCompatibility({
    metadata: { version: SCHEMA_VERSIONS.CURRENT }
  });
  assertEquals(compatible2.compatible, true);
  
  // No version info
  const noVersion = manager.checkCompatibility({
    someData: 'value'
  });
  assertEquals(noVersion.compatible, false);
  assertEquals(noVersion.reason?.includes('No version'), true);
  
  // Incompatible version (future)
  const incompatible = manager.checkCompatibility({
    version: '99.0.0'
  });
  assertEquals(incompatible.compatible, false);
  assertEquals(incompatible.reason?.includes('not compatible'), true);
});

Deno.test("MigrationManager - create migration report", () => {
  const manager = new MigrationManager();
  
  // Register some migrations for the report
  manager.registerMigration({
    id: 'test-migration-1',
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    description: 'First test migration',
    migrate: (data) => data
  });
  
  manager.registerMigration({
    id: 'test-migration-2',
    fromVersion: '1.1.0',
    toVersion: '1.2.0',
    description: 'Second test migration',
    migrate: (data) => data
  });
  
  const report = manager.createMigrationReport();
  
  assertEquals(report.includes('# Migration Report'), true);
  assertEquals(report.includes(SCHEMA_VERSIONS.CURRENT), true);
  assertEquals(report.includes('test-migration-1'), true);
  assertEquals(report.includes('test-migration-2'), true);
  assertEquals(report.includes('Migration Path Examples'), true);
});

Deno.test("PreFlightChecks - run all checks", async () => {
  const results = await PreFlightChecks.runAll();
  
  // We should have results
  assertEquals(results.checks.length > 0, true);
  
  // Check structure
  for (const check of results.checks) {
    assertEquals(typeof check.name, 'string');
    assertEquals(typeof check.passed, 'boolean');
    if (check.message) {
      assertEquals(typeof check.message, 'string');
    }
  }
  
  // Specific checks should exist
  const checkNames = results.checks.map(c => c.name);
  assertEquals(checkNames.includes('Deno Version'), true);
  assertEquals(checkNames.includes('Permissions'), true);
  assertEquals(checkNames.includes('Data Directories'), true);
  assertEquals(checkNames.includes('Dependencies'), true);
});

// Clean up any created directories
Deno.test("Cleanup - remove test directories", async () => {
  const dirs = ['.knowledge', '.queue', '.processes'];
  for (const dir of dirs) {
    try {
      await Deno.remove(dir, { recursive: true });
    } catch {
      // Directory might not exist, that's ok
    }
  }
});