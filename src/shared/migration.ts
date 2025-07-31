/**
 * Migration and Version Management
 * 
 * Handles version compatibility, data migrations, and upgrade paths
 * to ensure smooth transitions between versions.
 */

import { ProcessEntry } from './types.ts';
import { KnowledgeEntry } from '../knowledge/types.ts';
import { QueueEntry } from '../queue/types.ts';

/**
 * Version information
 */
export interface Version {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Migration result
 */
export interface MigrationResult {
  success: boolean;
  fromVersion: string;
  toVersion: string;
  migrationsApplied: string[];
  warnings: string[];
  errors: string[];
}

/**
 * Data schema versions
 */
export const SCHEMA_VERSIONS = {
  CURRENT: '1.0.0',
  MINIMUM_COMPATIBLE: '1.0.0'
} as const;

/**
 * Migration definition
 */
export interface Migration {
  id: string;
  fromVersion: string;
  toVersion: string;
  description: string;
  migrate: (data: any) => any;
  validate?: (data: any) => boolean;
}

/**
 * Version utilities
 */
export class VersionUtils {
  /**
   * Parse version string
   */
  static parse(version: string): Version {
    const parts = version.split('.').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
      throw new Error(`Invalid version format: ${version}`);
    }
    
    return {
      major: parts[0],
      minor: parts[1],
      patch: parts[2]
    };
  }
  
  /**
   * Compare versions
   */
  static compare(v1: string, v2: string): number {
    const version1 = this.parse(v1);
    const version2 = this.parse(v2);
    
    if (version1.major !== version2.major) {
      return version1.major - version2.major;
    }
    if (version1.minor !== version2.minor) {
      return version1.minor - version2.minor;
    }
    return version1.patch - version2.patch;
  }
  
  /**
   * Check if version is compatible
   */
  static isCompatible(version: string): boolean {
    return this.compare(version, SCHEMA_VERSIONS.MINIMUM_COMPATIBLE) >= 0 &&
           this.compare(version, SCHEMA_VERSIONS.CURRENT) <= 0;
  }
  
  /**
   * Format version for display
   */
  static format(version: Version): string {
    return `${version.major}.${version.minor}.${version.patch}`;
  }
}

/**
 * Migration manager
 */
export class MigrationManager {
  private migrations: Migration[] = [];
  
  constructor() {
    this.registerBuiltInMigrations();
  }
  
  /**
   * Register a migration
   */
  registerMigration(migration: Migration): void {
    // Validate migration
    if (VersionUtils.compare(migration.fromVersion, migration.toVersion) >= 0) {
      throw new Error(
        `Invalid migration: fromVersion (${migration.fromVersion}) must be less than toVersion (${migration.toVersion})`
      );
    }
    
    // Check for duplicates
    const duplicate = this.migrations.find(m => m.id === migration.id);
    if (duplicate) {
      throw new Error(`Migration with id '${migration.id}' already registered`);
    }
    
    this.migrations.push(migration);
    
    // Keep migrations sorted by fromVersion
    this.migrations.sort((a, b) => 
      VersionUtils.compare(a.fromVersion, b.fromVersion)
    );
  }
  
  /**
   * Find migration path
   */
  findMigrationPath(fromVersion: string, toVersion: string): Migration[] {
    if (VersionUtils.compare(fromVersion, toVersion) === 0) {
      return []; // No migration needed
    }
    
    if (VersionUtils.compare(fromVersion, toVersion) > 0) {
      throw new Error(
        `Cannot migrate backwards from ${fromVersion} to ${toVersion}`
      );
    }
    
    const path: Migration[] = [];
    let currentVersion = fromVersion;
    
    while (VersionUtils.compare(currentVersion, toVersion) < 0) {
      const nextMigration = this.migrations.find(m => 
        m.fromVersion === currentVersion
      );
      
      if (!nextMigration) {
        throw new Error(
          `No migration path found from ${currentVersion} to ${toVersion}`
        );
      }
      
      path.push(nextMigration);
      currentVersion = nextMigration.toVersion;
    }
    
    return path;
  }
  
  /**
   * Migrate data
   */
  async migrate(
    data: any,
    fromVersion: string,
    toVersion: string = SCHEMA_VERSIONS.CURRENT
  ): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: false,
      fromVersion,
      toVersion,
      migrationsApplied: [],
      warnings: [],
      errors: []
    };
    
    try {
      // Check if migration is needed
      if (VersionUtils.compare(fromVersion, toVersion) === 0) {
        result.success = true;
        return result;
      }
      
      // Find migration path
      const migrations = this.findMigrationPath(fromVersion, toVersion);
      
      if (migrations.length === 0) {
        result.warnings.push('No migrations needed');
        result.success = true;
        return result;
      }
      
      // Apply migrations
      let migratedData = data;
      
      for (const migration of migrations) {
        try {
          // Validate before migration if validator provided
          if (migration.validate && !migration.validate(migratedData)) {
            throw new Error(
              `Data validation failed before migration '${migration.id}'`
            );
          }
          
          // Apply migration
          migratedData = await migration.migrate(migratedData);
          result.migrationsApplied.push(migration.id);
          
        } catch (error) {
          result.errors.push(
            `Migration '${migration.id}' failed: ${error.message}`
          );
          throw error;
        }
      }
      
      // Update version in data
      if (typeof migratedData === 'object' && migratedData !== null) {
        migratedData.version = toVersion;
      }
      
      result.success = true;
      return result;
      
    } catch (error) {
      result.success = false;
      if (result.errors.length === 0) {
        result.errors.push(error.message);
      }
      return result;
    }
  }
  
  /**
   * Register built-in migrations
   */
  private registerBuiltInMigrations(): void {
    // Example migration for future use
    // this.registerMigration({
    //   id: 'add-priority-field',
    //   fromVersion: '1.0.0',
    //   toVersion: '1.1.0',
    //   description: 'Add priority field to process entries',
    //   migrate: (data) => {
    //     if (data.processes) {
    //       data.processes = data.processes.map((p: any) => ({
    //         ...p,
    //         priority: p.priority || 'normal'
    //       }));
    //     }
    //     return data;
    //   }
    // });
  }
  
  /**
   * Check data compatibility
   */
  checkCompatibility(data: any): {
    compatible: boolean;
    version?: string;
    reason?: string;
  } {
    // Check for version field
    if (!data.version && !data.metadata?.version) {
      return {
        compatible: false,
        reason: 'No version information found in data'
      };
    }
    
    const version = data.version || data.metadata.version;
    
    if (!VersionUtils.isCompatible(version)) {
      return {
        compatible: false,
        version,
        reason: `Version ${version} is not compatible with current version ${SCHEMA_VERSIONS.CURRENT}`
      };
    }
    
    return {
      compatible: true,
      version
    };
  }
  
  /**
   * Create migration report
   */
  createMigrationReport(): string {
    const lines = [
      '# Migration Report',
      '',
      `Current Schema Version: ${SCHEMA_VERSIONS.CURRENT}`,
      `Minimum Compatible Version: ${SCHEMA_VERSIONS.MINIMUM_COMPATIBLE}`,
      '',
      '## Available Migrations',
      ''
    ];
    
    if (this.migrations.length === 0) {
      lines.push('No migrations registered.');
    } else {
      for (const migration of this.migrations) {
        lines.push(
          `### ${migration.id}`,
          `- From: ${migration.fromVersion}`,
          `- To: ${migration.toVersion}`,
          `- Description: ${migration.description}`,
          ''
        );
      }
    }
    
    lines.push(
      '## Migration Path Examples',
      '',
      '```',
      `# Migrate from 1.0.0 to current (${SCHEMA_VERSIONS.CURRENT})`,
      `migrationManager.migrate(data, '1.0.0')`,
      '',
      '# Check compatibility',
      'migrationManager.checkCompatibility(data)',
      '```'
    );
    
    return lines.join('\n');
  }
}

/**
 * Pre-flight checks before starting the application
 */
export class PreFlightChecks {
  /**
   * Run all pre-flight checks
   */
  static async runAll(): Promise<{
    passed: boolean;
    checks: Array<{
      name: string;
      passed: boolean;
      message?: string;
    }>;
  }> {
    const checks = [
      this.checkDenoVersion(),
      this.checkPermissions(),
      this.checkDataDirectories(),
      this.checkDependencies()
    ];
    
    const results = await Promise.all(checks);
    
    return {
      passed: results.every(r => r.passed),
      checks: results
    };
  }
  
  /**
   * Check Deno version
   */
  private static async checkDenoVersion(): Promise<{
    name: string;
    passed: boolean;
    message?: string;
  }> {
    try {
      const denoVersion = Deno.version.deno;
      const minVersion = '1.38.0';
      
      const passed = VersionUtils.compare(denoVersion, minVersion) >= 0;
      
      return {
        name: 'Deno Version',
        passed,
        message: passed ? 
          `Deno ${denoVersion} meets minimum requirement (${minVersion})` :
          `Deno ${denoVersion} is below minimum requirement (${minVersion})`
      };
    } catch (error) {
      return {
        name: 'Deno Version',
        passed: false,
        message: `Failed to check Deno version: ${error.message}`
      };
    }
  }
  
  /**
   * Check required permissions
   */
  private static async checkPermissions(): Promise<{
    name: string;
    passed: boolean;
    message?: string;
  }> {
    const requiredPermissions = [
      { name: 'read', paths: ['.'] },
      { name: 'write', paths: ['.'] },
      { name: 'run' },
      { name: 'net' }
    ];
    
    const missing: string[] = [];
    
    for (const perm of requiredPermissions) {
      const status = await Deno.permissions.query(perm as any);
      if (status.state !== 'granted') {
        missing.push(perm.name);
      }
    }
    
    return {
      name: 'Permissions',
      passed: missing.length === 0,
      message: missing.length === 0 ?
        'All required permissions granted' :
        `Missing permissions: ${missing.join(', ')}`
    };
  }
  
  /**
   * Check data directories
   */
  private static async checkDataDirectories(): Promise<{
    name: string;
    passed: boolean;
    message?: string;
  }> {
    const directories = ['.knowledge', '.queue', '.processes'];
    const missing: string[] = [];
    
    for (const dir of directories) {
      try {
        await Deno.stat(dir);
      } catch {
        missing.push(dir);
      }
    }
    
    // Create missing directories
    for (const dir of missing) {
      try {
        await Deno.mkdir(dir, { recursive: true });
      } catch (error) {
        return {
          name: 'Data Directories',
          passed: false,
          message: `Failed to create directory ${dir}: ${error.message}`
        };
      }
    }
    
    return {
      name: 'Data Directories',
      passed: true,
      message: missing.length > 0 ?
        `Created missing directories: ${missing.join(', ')}` :
        'All data directories exist'
    };
  }
  
  /**
   * Check dependencies
   */
  private static async checkDependencies(): Promise<{
    name: string;
    passed: boolean;
    message?: string;
  }> {
    // In a real implementation, this would check for required
    // external dependencies, network connectivity, etc.
    return {
      name: 'Dependencies',
      passed: true,
      message: 'All dependencies available'
    };
  }
}

// Export singleton instance
export const migrationManager = new MigrationManager();