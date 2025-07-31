import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getWebUIUrl,
  getProcessUrl,
  getIssueUrl,
  getNoteUrl,
  getDashboardUrl,
  getQueueUrl,
  getKnowledgeUrl,
} from './url-utils.ts';

// Test helper to set/clear environment variables
function withEnvVar<T>(name: string, value: string | undefined, fn: () => T): T {
  const originalValue = Deno.env.get(name);
  
  if (value === undefined) {
    Deno.env.delete(name);
  } else {
    Deno.env.set(name, value);
  }
  
  try {
    return fn();
  } finally {
    // Restore original value
    if (originalValue === undefined) {
      Deno.env.delete(name);
    } else {
      Deno.env.set(name, originalValue);
    }
  }
}

Deno.test("getWebUIUrl - should use default port when no environment variable", () => {
  withEnvVar('WEB_UI_PORT', undefined, () => {
    const url = getWebUIUrl();
    assertEquals(url, 'http://localhost:8080');
  });
});

Deno.test("getWebUIUrl - should use default port with path", () => {
  withEnvVar('WEB_UI_PORT', undefined, () => {
    const url = getWebUIUrl('/test');
    assertEquals(url, 'http://localhost:8080/test');
  });
});

Deno.test("getWebUIUrl - should normalize path without leading slash", () => {
  withEnvVar('WEB_UI_PORT', undefined, () => {
    const url = getWebUIUrl('test');
    assertEquals(url, 'http://localhost:8080/test');
  });
});

Deno.test("getWebUIUrl - should use custom port from environment", () => {
  withEnvVar('WEB_UI_PORT', '3000', () => {
    const url = getWebUIUrl();
    assertEquals(url, 'http://localhost:3000');
  });
});

Deno.test("getWebUIUrl - should use custom port with path", () => {
  withEnvVar('WEB_UI_PORT', '9090', () => {
    const url = getWebUIUrl('#dashboard');
    assertEquals(url, 'http://localhost:9090/#dashboard');
  });
});

Deno.test("getWebUIUrl - should throw error for invalid port", () => {
  withEnvVar('WEB_UI_PORT', 'invalid', () => {
    assertThrows(
      () => getWebUIUrl(),
      Error,
      'Invalid port number: invalid. Port must be between 1 and 65535.'
    );
  });
});

Deno.test("getWebUIUrl - should throw error for port out of range (too low)", () => {
  withEnvVar('WEB_UI_PORT', '0', () => {
    assertThrows(
      () => getWebUIUrl(),
      Error,
      'Invalid port number: 0. Port must be between 1 and 65535.'
    );
  });
});

Deno.test("getWebUIUrl - should throw error for port out of range (too high)", () => {
  withEnvVar('WEB_UI_PORT', '65536', () => {
    assertThrows(
      () => getWebUIUrl(),
      Error,
      'Invalid port number: 65536. Port must be between 1 and 65535.'
    );
  });
});

Deno.test("getWebUIUrl - should handle edge case ports", () => {
  withEnvVar('WEB_UI_PORT', '1', () => {
    const url = getWebUIUrl();
    assertEquals(url, 'http://localhost:1');
  });
  
  withEnvVar('WEB_UI_PORT', '65535', () => {
    const url = getWebUIUrl();
    assertEquals(url, 'http://localhost:65535');
  });
});

Deno.test("getProcessUrl - should generate correct process URL", () => {
  withEnvVar('WEB_UI_PORT', undefined, () => {
    const url = getProcessUrl('proc-123');
    assertEquals(url, 'http://localhost:8080/#processes?id=proc-123');
  });
});

Deno.test("getProcessUrl - should handle special characters in process ID", () => {
  withEnvVar('WEB_UI_PORT', undefined, () => {
    const url = getProcessUrl('proc-123_test-v2');
    assertEquals(url, 'http://localhost:8080/#processes?id=proc-123_test-v2');
  });
});

Deno.test("getIssueUrl - should generate correct issue URL", () => {
  withEnvVar('WEB_UI_PORT', undefined, () => {
    const url = getIssueUrl('ISSUE_42');
    assertEquals(url, 'http://localhost:8080/#knowledge?type=issue&id=ISSUE_42');
  });
});

Deno.test("getNoteUrl - should generate correct note URL", () => {
  withEnvVar('WEB_UI_PORT', undefined, () => {
    const url = getNoteUrl('note-xyz');
    assertEquals(url, 'http://localhost:8080/#knowledge?type=note&id=note-xyz');
  });
});

Deno.test("getDashboardUrl - should generate correct dashboard URL", () => {
  withEnvVar('WEB_UI_PORT', undefined, () => {
    const url = getDashboardUrl();
    assertEquals(url, 'http://localhost:8080/#overview');
  });
});

Deno.test("getQueueUrl - should generate correct queue URL", () => {
  withEnvVar('WEB_UI_PORT', undefined, () => {
    const url = getQueueUrl();
    assertEquals(url, 'http://localhost:8080/#queue');
  });
});

Deno.test("getKnowledgeUrl - should generate correct knowledge base URL", () => {
  withEnvVar('WEB_UI_PORT', undefined, () => {
    const url = getKnowledgeUrl();
    assertEquals(url, 'http://localhost:8080/#knowledge');
  });
});

Deno.test("URL functions - should respect custom port from environment", () => {
  withEnvVar('WEB_UI_PORT', '4000', () => {
    assertEquals(getProcessUrl('test'), 'http://localhost:4000/#processes?id=test');
    assertEquals(getIssueUrl('ISSUE_1'), 'http://localhost:4000/#knowledge?type=issue&id=ISSUE_1');
    assertEquals(getNoteUrl('note-1'), 'http://localhost:4000/#knowledge?type=note&id=note-1');
    assertEquals(getDashboardUrl(), 'http://localhost:4000/#overview');
    assertEquals(getQueueUrl(), 'http://localhost:4000/#queue');
    assertEquals(getKnowledgeUrl(), 'http://localhost:4000/#knowledge');
  });
});

Deno.test("URL functions - should handle empty string IDs", () => {
  withEnvVar('WEB_UI_PORT', undefined, () => {
    assertEquals(getProcessUrl(''), 'http://localhost:8080/#processes?id=');
    assertEquals(getIssueUrl(''), 'http://localhost:8080/#knowledge?type=issue&id=');
    assertEquals(getNoteUrl(''), 'http://localhost:8080/#knowledge?type=note&id=');
  });
});