import { SDK, DefineAPI } from "caido:plugin";
import { RequestSpec } from "caido:utils";

// Store for processed requests to avoid duplicates
const processedRequests = new Set<string>();
// Track the latest request ID we've seen
let lastRequestId: string | null = null;
// Store the cursor from the last query for pagination
let lastCursor: string | null = null;
// Store the interval ID for polling
let pollingIntervalId: ReturnType<typeof setInterval> | null = null;

// Simple URL parser function to extract host and path
function parseUrl(sdk: SDK, url: string): { host: string, path: string } {
  sdk.console.log(`[MethodCheck] Parsing URL: ${url}`);

  try {
    // Extract host - look for double slash and then the next slash or colon
    let host = '';
    const doubleSlashIndex = url.indexOf('//');
    if (doubleSlashIndex >= 0) {
      const hostStart = doubleSlashIndex + 2;
      const pathSlashIndex = url.indexOf('/', hostStart);
      const queryIndex = url.indexOf('?', hostStart);
      const portIndex = url.indexOf(':', hostStart);

      let hostEnd;
      if (pathSlashIndex > 0) {
        hostEnd = pathSlashIndex;
      } else if (queryIndex > 0) {
        hostEnd = queryIndex;
      } else if (portIndex > hostStart) {
        // If there's a port specified
        hostEnd = portIndex;
      } else {
        hostEnd = url.length;
      }

      host = url.substring(hostStart, hostEnd);
    }

    // Extract path - everything after the host up to query string
    let path = '/';
    const doubleSlashFromIndex = doubleSlashIndex + 2;
    const hostEndSlashIndex = url.indexOf('/', doubleSlashFromIndex);

    if (hostEndSlashIndex > 0) {
      const queryStart = url.indexOf('?', hostEndSlashIndex);
      if (queryStart > 0) {
        path = url.substring(hostEndSlashIndex, queryStart);
      } else {
        path = url.substring(hostEndSlashIndex);
      }
    }

    sdk.console.log(`[MethodCheck] Parsed URL - Host: ${host}, Path: ${path}`);
    return { host, path };
  } catch (error) {
    sdk.console.error(`[MethodCheck] Error parsing URL: ${error}`);
    return { host: '', path: '/' };
  }
}

// Function to check methods for a given URL
async function checkMethods(sdk: SDK, url: string, originalMethod: string): Promise<string[]> {
  sdk.console.log(`[MethodCheck] Checking methods for URL: ${url} (original method: ${originalMethod})`);

  try {
    // Use our custom URL parser instead of the URL class
    const parsedUrl = parseUrl(sdk, url);
    const optionsSpec = new RequestSpec(url);

    // Set the method to OPTIONS
    optionsSpec.setMethod("OPTIONS");

    // Set basic headers
    optionsSpec.setHeader('User-Agent', 'Caido MethodCheck');
    optionsSpec.setHeader('Host', parsedUrl.host);

    // Send the OPTIONS request
    sdk.console.log(`[MethodCheck] Sending OPTIONS request...`);
    const sentRequest = await sdk.requests.send(optionsSpec);

    // Log the sent request ID
    const sentRequestId = sentRequest.request.getId();
    sdk.console.log(`[MethodCheck] OPTIONS request sent with ID: ${sentRequestId}`);

    const optionsResponse = sentRequest.response;

    if (!optionsResponse) {
      sdk.console.error(`[MethodCheck] No response received for OPTIONS request to ${url}`);
      return [];
    }

    // Check for Allow header or Access-Control-Allow-Methods header
    const allowHeader = optionsResponse.getHeader('Allow') || [];
    const corsMethodsHeader = optionsResponse.getHeader('Access-Control-Allow-Methods') || [];

    // Log the headers only if they contain useful information
    if (allowHeader.length > 0) {
      sdk.console.log(`[MethodCheck] Found Allow header: ${allowHeader[0]}`);
    }

    if (corsMethodsHeader.length > 0) {
      sdk.console.log(`[MethodCheck] Found Access-Control-Allow-Methods header: ${corsMethodsHeader[0]}`);
    }

    // Combine and parse available methods
    const allowedMethods = new Set<string>();

    // Parse Allow header
    if (allowHeader.length > 0) {
      const methods = allowHeader[0].split(/,\s*/);
      methods.forEach(method => allowedMethods.add(method.trim().toUpperCase()));
    }

    // Parse CORS methods header
    if (corsMethodsHeader.length > 0) {
      const methods = corsMethodsHeader[0].split(/,\s*/);
      methods.forEach(method => allowedMethods.add(method.trim().toUpperCase()));
    }

    // Filter out the current method
    allowedMethods.delete(originalMethod.toUpperCase());
    allowedMethods.delete('OPTIONS'); // OPTIONS is expected for CORS preflight

    const result = Array.from(allowedMethods);
    sdk.console.log(`[MethodCheck] Found ${result.length} additional methods: ${JSON.stringify(result)}`);

    return result;
  } catch (error) {
    sdk.console.error(`[MethodCheck] Error checking methods: ${error}`);
    if (error instanceof Error) {
      sdk.console.error(`[MethodCheck] Error stack: ${error.stack}`);
    }
    return [];
  }
}

// Function to actively poll for new requests
async function pollForRequests(sdk: SDK): Promise<void> {
  try {
    // Build the query, using the last cursor if available
    let query = sdk.requests.query().descending("req", "id");

    if (lastCursor) {
      query = query.after(lastCursor);
    }

    // Limit the number of requests to process in one batch
    query = query.first(50);

    const results = await query.execute();

    if (results.items.length === 0) {
      return;
    }

    // Store the cursor for the next query
    if (results.pageInfo.endCursor) {
      lastCursor = results.pageInfo.endCursor;
    }

    // Process requests in reverse order (oldest to newest)
    for (let i = results.items.length - 1; i >= 0; i--) {
      const item = results.items[i];
      const request = item.request;
      const id = request.getId();

      // Update the last request ID we've seen
      lastRequestId = id;

      // Process the request if it's not an OPTIONS request (to avoid recursion)
      if (request.getMethod() !== 'OPTIONS') {
        await processRequest(sdk, id);
      }
    }
  } catch (error) {
    sdk.console.error(`[MethodCheck] Error polling for requests: ${error}`);
    if (error instanceof Error) {
      sdk.console.error(`[MethodCheck] Error stack: ${error.stack}`);
    }
  }
}

// Function to process a request
async function processRequest(sdk: SDK, requestId: string): Promise<string> {
  try {
    // Skip if we've already processed this request
    if (processedRequests.has(requestId)) {
      return "";
    }

    // Mark as processed to avoid duplicate checks
    processedRequests.add(requestId);

    // Get the request
    const reqRes = await sdk.requests.get(requestId);
    if (!reqRes) {
      sdk.console.error(`[MethodCheck] Could not find request with ID: ${requestId}`);
      return "";
    }

    const request = reqRes.request;
    const method = request.getMethod();
    const url = request.getUrl();
    const host = request.getHost();
    const path = request.getPath();

    // Skip OPTIONS requests to avoid recursion
    if (method === 'OPTIONS') {
      return "";
    }

    // Create a unique key based on the URL and original method
    const dedupeKey = `methodcheck-${host}-${path}-${method}`;

    // Check if a finding already exists using the direct API
    const existingFinding = await sdk.findings.exists(dedupeKey);
    if (existingFinding) {
      return "";
    }

    // Check for allowed methods
    const allowedMethods = await checkMethods(sdk, url, method);

    // If we found alternative methods, create a finding
    if (allowedMethods.length > 0) {
      const methodsString = allowedMethods.join(', ');

      try {
        // Create a new finding
        await sdk.findings.create({
          title: `Alternative HTTP Methods Available: ${methodsString}`,
          description: `The endpoint at ${url} was accessed using ${method}, but also supports these methods: ${methodsString}.

This could indicate expanded functionality or potential security issues if unexpected methods are accessible.

**Details**:
- Original request: ${method} ${url}
- Original request ID: ${requestId}
- Host: ${host}
- Path: ${path}
- Additional methods: ${methodsString}`,
          reporter: "MethodCheck Plugin",
          dedupeKey: dedupeKey,
          request: request
        });
      } catch (error) {
        sdk.console.error(`[MethodCheck] Error creating finding: ${error}`);
        if (error instanceof Error) {
          sdk.console.error(`[MethodCheck] Error stack: ${error.stack}`);
        }
        // Continue execution even if finding creation fails
      }

      // Set comment and tag
      const comment = `Allows additional methods: ${methodsString}`;
      await sdk.requests.setComment(requestId, comment);
      await sdk.requests.setTag(requestId, 'method-check');

      return methodsString;
    } else {
      return "";
    }

  } catch (error) {
    sdk.console.error(`[MethodCheck] Error processing request: ${error}`);
    if (error instanceof Error) {
      sdk.console.error(`[MethodCheck] Error stack: ${error.stack}`);
    }
    return "";
  }
}

// Function to manually check a request
async function checkRequest(sdk: SDK, requestId: string): Promise<string> {
  try {
    // Force a recheck even if already processed
    processedRequests.delete(requestId);

    // Process the request
    const result = await processRequest(sdk, requestId);

    if (result) {
      if (sdk.toast) {
        sdk.toast.success(`Found methods: ${result}`);
      }
      return result;
    } else {
      if (sdk.toast) {
        sdk.toast.info('No additional methods found');
      }
      return "";
    }
  } catch (error) {
    sdk.console.error(`[MethodCheck] Error in manual check: ${error}`);
    if (error instanceof Error) {
      sdk.console.error(`[MethodCheck] Error stack: ${error.stack}`);
    }
    if (sdk.toast) {
      sdk.toast.error('Failed to check methods');
    }
    return "";
  }
}

// Function to start the periodic polling
async function startPolling(sdk: SDK): Promise<void> {
  // Only start polling if it's not already running
  if (pollingIntervalId !== null) {
    sdk.console.log(`[MethodCheck] Polling already active, not starting again`);
    return;
  }

  // Poll immediately, then every 5 seconds
  await pollForRequests(sdk);

  // Continue polling at regular intervals
  pollingIntervalId = setInterval(async () => {
    await pollForRequests(sdk);
  }, 5000);

  sdk.console.log(`[MethodCheck] Polling started with interval ID: ${pollingIntervalId}`);
}

// Function to stop the periodic polling
function stopPolling(sdk: SDK): boolean {
  if (pollingIntervalId === null) {
    sdk.console.log(`[MethodCheck] No active polling to stop`);
    return false;
  }

  clearInterval(pollingIntervalId);
  pollingIntervalId = null;
  sdk.console.log(`[MethodCheck] Polling stopped`);
  return true;
}

// Function to toggle polling state
function togglePolling(sdk: SDK): boolean {
  if (pollingIntervalId === null) {
    startPolling(sdk);
    return true; // Polling is now active
  } else {
    stopPolling(sdk);
    return false; // Polling is now inactive
  }
}

// Function to create a test finding
async function createTestFinding(sdk: SDK): Promise<void> {
  try {
    const testDedupeKey = `methodcheck-test-finding-${Date.now()}`;

    // First, get a real request to use as a reference
    const query = sdk.requests.query().first(1);
    const results = await query.execute();

    if (results.items.length === 0) {
      return;
    }

    const sampleRequest = results.items[0].request;

    await sdk.findings.create({
      title: "TEST FINDING - MethodCheck Plugin Test",
      description: `This is a TEST FINDING created to verify the Findings API functionality.

**Test Details**:
- Creation time: ${new Date().toISOString()}
- Plugin: MethodCheck
- Purpose: Verify findings API integration
- Status: This is not a real finding and can be safely deleted

If you see this, it means the findings API is working correctly!`,
      reporter: "MethodCheck Plugin [TEST MODE]",
      dedupeKey: testDedupeKey,
      request: sampleRequest // Use a real request as reference
    });
  } catch (error) {
    sdk.console.error(`[MethodCheck] Error creating test finding: ${error}`);
    if (error instanceof Error) {
      sdk.console.error(`[MethodCheck] Error stack: ${error.stack}`);
    }
  }
}

// Export the API type
export type API = DefineAPI<{
  checkRequest: typeof checkRequest;
  togglePolling: typeof togglePolling;
  isPollingActive: () => boolean;
}>;

// Initialize the plugin
export function init(sdk: SDK<API>) {
  // Register the API
  sdk.api.register("checkRequest", checkRequest);
  sdk.api.register("togglePolling", () => togglePolling(sdk));
  sdk.api.register("isPollingActive", () => pollingIntervalId !== null);

  // Listen for proxy responses
  try {
    sdk.proxy.on('response', async (event) => {
      try {
        const requestId = event.request.getId();
        const request = event.request;

        // Skip OPTIONS requests to avoid recursion
        if (request.getMethod() === 'OPTIONS') {
          return;
        }

        // Check if we've already processed this request
        if (processedRequests.has(requestId)) {
          return;
        }

        // Check if we already have a finding for this request
        const host = request.getHost();
        const path = request.getPath();
        const method = request.getMethod();
        const dedupeKey = `methodcheck-${host}-${path}-${method}`;

        // Skip if a finding already exists
        const existingFinding = await sdk.findings.exists(dedupeKey);
        if (existingFinding) {
          return;
        }

        // Process the request
        await processRequest(sdk, requestId);
      } catch (error) {
        sdk.console.error(`[MethodCheck] Error in proxy response handler: ${error}`);
        if (error instanceof Error) {
          sdk.console.error(`[MethodCheck] Error stack: ${error.stack}`);
        }
      }
    });
  } catch (error) {
    sdk.console.error(`[MethodCheck] Failed to register proxy listener: ${error}`);
    if (error instanceof Error) {
      sdk.console.error(`[MethodCheck] Error stack: ${error.stack}`);
    }

    // Fall back to polling if we couldn't register the proxy listener
    startPolling(sdk);
  }

  createTestFinding(sdk);
}