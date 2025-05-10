import { SDK, DefineAPI, DefineEvents } from "caido:plugin";
import { RequestSpec } from "caido:utils";

// Define event types
type MethodCheckEvent = {
  requestId: string;
  url: string;
  originalMethod: string;
  availableMethods: string[];
};

// Define events for backend to frontend communication
export type BackendEvents = DefineEvents<{
  "method-check-result": (data: MethodCheckEvent) => void;
}>;

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

    return { host, path };
  } catch (error) {
    sdk.console.error(`[MethodCheck] Error parsing URL: ${error}`);
    return { host: '', path: '/' };
  }
}

// Function to check methods for a given URL
async function checkMethods(sdk: SDK, url: string, originalMethod: string): Promise<string[]> {
  try {
    const parsedUrl = parseUrl(sdk, url);
    const optionsSpec = new RequestSpec(url);

    // Set the method to OPTIONS
    optionsSpec.setMethod("OPTIONS");

    // Set basic headers
    optionsSpec.setHeader('User-Agent', 'Caido MethodCheck');
    optionsSpec.setHeader('Host', parsedUrl.host);

    // Send the OPTIONS request
    const sentRequest = await sdk.requests.send(optionsSpec);
    const optionsResponse = sentRequest.response;

    if (!optionsResponse) {
      sdk.console.error(`[MethodCheck] No response received for OPTIONS request to ${url}`);
      return [];
    }

    // Check for Allow header or Access-Control-Allow-Methods header
    const allowHeader = optionsResponse.getHeader('Allow') || [];
    const corsMethodsHeader = optionsResponse.getHeader('Access-Control-Allow-Methods') || [];

    // Log the headers for debugging
    sdk.console.log(`[MethodCheck] Allow header: ${JSON.stringify(allowHeader)}`);
    sdk.console.log(`[MethodCheck] CORS Methods header: ${JSON.stringify(corsMethodsHeader)}`);

    // Combine and parse available methods
    const allowedMethods = new Set<string>();

    // Parse Allow header
    if (allowHeader.length > 0) {
      const methods = allowHeader[0].split(/,\s*/);
      sdk.console.log(`[MethodCheck] Parsed Allow methods: ${JSON.stringify(methods)}`);
      methods.forEach((method: string) => allowedMethods.add(method.trim().toUpperCase()));
    }

    // Parse CORS methods header
    if (corsMethodsHeader.length > 0) {
      const methods = corsMethodsHeader[0].split(/,\s*/);
      sdk.console.log(`[MethodCheck] Parsed CORS methods: ${JSON.stringify(methods)}`);
      methods.forEach((method: string) => allowedMethods.add(method.trim().toUpperCase()));
    }

    // Filter out the current method
    allowedMethods.delete(originalMethod.toUpperCase());
    allowedMethods.delete('OPTIONS'); // OPTIONS is expected for CORS preflight

    const result = Array.from(allowedMethods);
    sdk.console.log(`[MethodCheck] Final allowed methods (after filtering): ${JSON.stringify(result)}`);

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

        // Send event to frontend
        sdk.api.send("method-check-result", {
          requestId,
          url,
          originalMethod: method,
          availableMethods: allowedMethods
        });
      } catch (error) {
        sdk.console.error(`[MethodCheck] Error creating finding: ${error}`);
        if (error instanceof Error) {
          sdk.console.error(`[MethodCheck] Error stack: ${error.stack}`);
        }
        // Continue execution even if finding creation fails
      }

      sdk.console.log(`[MethodCheck] Request ${requestId} allows methods: ${methodsString}`);

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
      return result;
    } else {
      return "";
    }
  } catch (error) {
    sdk.console.error(`[MethodCheck] Error in manual check: ${error}`);
    if (error instanceof Error) {
      sdk.console.error(`[MethodCheck] Error stack: ${error.stack}`);
    }
    return "";
  }
}

// Function to start the periodic polling
async function startPolling(sdk: SDK): Promise<void> {
  // Only start polling if it's not already running
  if (pollingIntervalId !== null) {
    return;
  }

  // Poll immediately, then every 5 seconds
  await pollForRequests(sdk);

  // Continue polling at regular intervals
  pollingIntervalId = setInterval(async () => {
    await pollForRequests(sdk);
  }, 5000);
}

// Function to stop the periodic polling
function stopPolling(sdk: SDK): boolean {
  if (pollingIntervalId === null) {
    return false;
  }

  clearInterval(pollingIntervalId);
  pollingIntervalId = null;
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
export function init(sdk: SDK<API, BackendEvents>) {
  // Register the API
  sdk.api.register("checkRequest", checkRequest);
  sdk.api.register("togglePolling", () => togglePolling(sdk));
  sdk.api.register("isPollingActive", () => pollingIntervalId !== null);

  // Listen for proxy responses
  try {
    sdk.events.onInterceptResponse(async (sdk: SDK, request: any, response: any) => {
      try {
        const requestId = request.getId();
        const requestMethod = request.getMethod();

        // Skip OPTIONS requests to avoid recursion
        if (requestMethod === 'OPTIONS') {
          return;
        }

        // Check if we've already processed this request
        if (processedRequests.has(requestId)) {
          return;
        }

        // Check if this response has an Allow header - we can use it directly
        const allowHeader = response.getHeader('Allow') || [];

        if (allowHeader.length > 0) {
          sdk.console.log(`[MethodCheck] Direct response with Allow header: ${JSON.stringify(allowHeader)}`);

          const url = request.getUrl();
          const host = request.getHost();
          const path = request.getPath();
          const dedupeKey = `methodcheck-${host}-${path}-${requestMethod}`;

          // Skip if a finding already exists
          const existingFinding = await sdk.findings.exists(dedupeKey);
          if (existingFinding) {
            return;
          }

          // Parse methods from the header
          const allowedMethods = new Set<string>();
          const methods = allowHeader[0].split(/,\s*/);
          methods.forEach((method: string) => allowedMethods.add(method.trim().toUpperCase()));

          // Filter out the current method and OPTIONS
          allowedMethods.delete(requestMethod.toUpperCase());
          allowedMethods.delete('OPTIONS');

          const availableMethods = Array.from(allowedMethods);

          if (availableMethods.length > 0) {
            const methodsString = availableMethods.join(', ');

            // Create a finding
            await sdk.findings.create({
              title: `Alternative HTTP Methods Available: ${methodsString}`,
              description: `The endpoint at ${url} was accessed using ${requestMethod}, but also supports these methods: ${methodsString}.

This could indicate expanded functionality or potential security issues if unexpected methods are accessible.

**Details**:
- Original request: ${requestMethod} ${url}
- Original request ID: ${requestId}
- Host: ${host}
- Path: ${path}
- Additional methods: ${methodsString}
- Source: Allow header in direct response`,
              reporter: "MethodCheck Plugin",
              dedupeKey: dedupeKey,
              request: request
            });

            // Send event to frontend
            sdk.api.send("method-check-result", {
              requestId,
              url,
              originalMethod: requestMethod,
              availableMethods: availableMethods
            });

            sdk.console.log(`[MethodCheck] Created finding from direct response: ${methodsString}`);
          }
        } else {
          // If no Allow header in the response, use the normal processing path
          await processRequest(sdk, requestId);
        }
      } catch (error) {
        sdk.console.error(`[MethodCheck] Error in response interceptor: ${error}`);
        if (error instanceof Error) {
          sdk.console.error(`[MethodCheck] Error stack: ${error.stack}`);
        }
      }
    });
  } catch (error) {
    sdk.console.error(`[MethodCheck] Failed to register response interceptor: ${error}`);
    if (error instanceof Error) {
      sdk.console.error(`[MethodCheck] Error stack: ${error.stack}`);
    }

    // Fall back to polling if we couldn't register the response interceptor
    startPolling(sdk);
  }

  createTestFinding(sdk);
}