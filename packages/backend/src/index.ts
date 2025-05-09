import { SDK, DefineAPI } from "caido:plugin";
import { RequestSpec } from "caido:utils";

// Store for processed requests to avoid duplicates
const processedRequests = new Set<string>();
// Track the latest request ID we've seen
let lastRequestId: string | null = null;

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

    sdk.console.log(`[MethodCheck] Created OPTIONS request to ${optionsSpec.getHost()}:${optionsSpec.getPort()}${optionsSpec.getPath()}`);
    sdk.console.log(`[MethodCheck] Request headers: ${JSON.stringify(optionsSpec.getHeaders())}`);

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

    const statusCode = optionsResponse.getCode();
    sdk.console.log(`[MethodCheck] OPTIONS response received, status: ${statusCode}`);
    sdk.console.log(`[MethodCheck] Response headers: ${JSON.stringify(optionsResponse.getHeaders())}`);

    // Check for Allow header or Access-Control-Allow-Methods header
    const allowHeader = optionsResponse.getHeader('Allow') || [];
    const corsMethodsHeader = optionsResponse.getHeader('Access-Control-Allow-Methods') || [];

    // Log the headers
    if (allowHeader.length > 0) {
      sdk.console.log(`[MethodCheck] Found Allow header: ${allowHeader[0]}`);
    } else {
      sdk.console.log(`[MethodCheck] No Allow header found`);
    }

    if (corsMethodsHeader.length > 0) {
      sdk.console.log(`[MethodCheck] Found Access-Control-Allow-Methods header: ${corsMethodsHeader[0]}`);
    } else {
      sdk.console.log(`[MethodCheck] No Access-Control-Allow-Methods header found`);
    }

    // Combine and parse available methods
    const allowedMethods = new Set<string>();

    // Parse Allow header
    if (allowHeader.length > 0) {
      const methods = allowHeader[0].split(/,\s*/);
      sdk.console.log(`[MethodCheck] Parsed methods from Allow header: ${JSON.stringify(methods)}`);
      methods.forEach(method => allowedMethods.add(method.trim().toUpperCase()));
    }

    // Parse CORS methods header
    if (corsMethodsHeader.length > 0) {
      const methods = corsMethodsHeader[0].split(/,\s*/);
      sdk.console.log(`[MethodCheck] Parsed methods from CORS header: ${JSON.stringify(methods)}`);
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
    sdk.console.log(`[MethodCheck] Polling for requests, last ID: ${lastRequestId || 'none'}`);

    // Query for the latest requests
    const query = sdk.requests.query().descending("req", "id").first(10);
    const results = await query.execute();

    if (results.items.length === 0) {
      sdk.console.log(`[MethodCheck] No requests found in poll`);
      return;
    }

    sdk.console.log(`[MethodCheck] Found ${results.items.length} requests in poll`);

    // Process requests in reverse order (oldest to newest)
    for (let i = results.items.length - 1; i >= 0; i--) {
      const item = results.items[i];
      const request = item.request;
      const id = request.getId();

      // Skip if we've already seen this request or it's older than our last processed
      if (lastRequestId && id <= lastRequestId) {
        continue;
      }

      // Update the last request ID we've seen
      lastRequestId = id;

      sdk.console.log(`[MethodCheck] Discovered new request #${id}: ${request.getMethod()} ${request.getUrl()}`);

      // Process the request if it's not an OPTIONS request (to avoid recursion)
      if (request.getMethod() !== 'OPTIONS') {
        await processRequest(sdk, id);
      } else {
        sdk.console.log(`[MethodCheck] Skipping OPTIONS request #${id} to avoid recursion`);
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
      sdk.console.log(`[MethodCheck] Skipping already processed request: ${requestId}`);
      return "";
    }

    // Mark as processed to avoid duplicate checks
    processedRequests.add(requestId);
    sdk.console.log(`[MethodCheck] Marked request ${requestId} as processed`);

    // Get the request
    sdk.console.log(`[MethodCheck] Retrieving request with ID: ${requestId}`);
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

    sdk.console.log(`[MethodCheck] Processing request ${requestId}: ${method} ${url}`);
    sdk.console.log(`[MethodCheck] Request details - Host: ${host}, Path: ${path}`);
    sdk.console.log(`[MethodCheck] Request headers: ${JSON.stringify(request.getHeaders())}`);

    // Skip OPTIONS requests to avoid recursion
    if (method === 'OPTIONS') {
      sdk.console.log(`[MethodCheck] Skipping OPTIONS request to avoid recursion: ${url}`);
      return "";
    }

    // Check for allowed methods
    sdk.console.log(`[MethodCheck] Checking methods for request ${requestId}`);
    const allowedMethods = await checkMethods(sdk, url, method);

    // If we found alternative methods, create a finding
    if (allowedMethods.length > 0) {
      const methodsString = allowedMethods.join(', ');
      sdk.console.log(`[MethodCheck] Found additional methods for ${url}: ${methodsString}`);

      try {
        // Create a unique key based on the URL and original method
        const dedupeKey = `methodcheck-${host}-${path}-${method}`;

        // Check if a finding already exists
        const existingFinding = await sdk.findings.exists(dedupeKey);

        if (!existingFinding) {
          sdk.console.log(`[MethodCheck] Creating new finding for ${url}`);

          // Create a new finding
          await sdk.findings.create({
            title: `Alternative HTTP Methods Available: ${methodsString}`,
            description: `The endpoint at ${url} was accessed using ${method},  but also supports these methods: ${methodsString}.

This could indicate expanded functionality or potential security issues if  unexpected methods are accessible.

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

          sdk.console.log(`[MethodCheck] Successfully created finding for alternative methods on ${url}`);
        } else {
          sdk.console.log(`[MethodCheck] Finding already exists for ${url}, skipping creation`);
        }
      } catch (error) {
        sdk.console.error(`[MethodCheck] Error creating finding: ${error}`);
        if (error instanceof Error) {
          sdk.console.error(`[MethodCheck] Error stack: ${error.stack}`);
        }
        // Continue execution even if finding creation fails
      }

      // Set comment and tag
      const comment = `Allows additional methods: ${methodsString}`;
      sdk.console.log(`[MethodCheck] Setting comment for request ${requestId}:  "${comment}"`);
      await sdk.requests.setComment(requestId, comment);

      sdk.console.log(`[MethodCheck] Tagging request ${requestId} with  'method-check'`);
      await sdk.requests.setTag(requestId, 'method-check');

      return methodsString;
    } else {
      sdk.console.log(`[MethodCheck] No additional methods found for ${url}`);
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
    sdk.console.log(`[MethodCheck] Manual check requested for request ID: ${requestId}`);

    // Force a recheck even if already processed
    processedRequests.delete(requestId);
    sdk.console.log(`[MethodCheck] Removed request ${requestId} from processed cache to allow rechecking`);

    // Process the request
    const result = await processRequest(sdk, requestId);

    if (result) {
      sdk.console.log(`[MethodCheck] Manual check successful, found methods: ${result}`);
      if (sdk.toast) {
        sdk.toast.success(`Found methods: ${result}`);
      }
      return result;
    } else {
      sdk.console.log(`[MethodCheck] Manual check completed, no additional methods found`);
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
  sdk.console.log(`[MethodCheck] Starting request polling`);

  // Poll immediately, then every 5 seconds
  await pollForRequests(sdk);

  // Continue polling at regular intervals
  setInterval(async () => {
    await pollForRequests(sdk);
  }, 5000);
}

// Function to create a test finding
async function createTestFinding(sdk: SDK): Promise<void> {
  try {
    sdk.console.log("[MethodCheck] Attempting to create a test finding...");

    const testDedupeKey = `methodcheck-test-finding-${Date.now()}`;

    // First, get a real request to use as a reference
    const query = sdk.requests.query().first(1);
    const results = await query.execute();

    if (results.items.length === 0) {
      sdk.console.log("[MethodCheck] No requests available to use for test finding");
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

    sdk.console.log("[MethodCheck] Successfully created test finding with key: " + testDedupeKey);
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
}>;

// Initialize the plugin
export function init(sdk: SDK<API>) {
  sdk.console.log("[MethodCheck] Plugin initializing...");

  // Log available SDK features for debugging
  const features = Object.keys(sdk);
  sdk.console.log(`[MethodCheck] Available SDK features: ${features.join(", ") || "none"}`);

  // Register the API
  sdk.api.register("checkRequest", checkRequest);
  sdk.console.log("[MethodCheck] Registered API method: checkRequest");

  // Listen for proxy responses
  try {
    sdk.proxy.on('response', async (event) => {
      try {
        const requestId = event.request.getId();
        sdk.console.log(`[MethodCheck] Received proxy response event for request ${requestId}`);
        await processRequest(sdk, requestId);
      } catch (error) {
        sdk.console.error(`[MethodCheck] Error in proxy response handler: ${error}`);
        if (error instanceof Error) {
          sdk.console.error(`[MethodCheck] Error stack: ${error.stack}`);
        }
      }
    });
    sdk.console.log("[MethodCheck] Proxy response listener registered");
  } catch (error) {
    sdk.console.error(`[MethodCheck] Failed to register proxy listener: ${error}`);
    if (error instanceof Error) {
      sdk.console.error(`[MethodCheck] Error stack: ${error.stack}`);
    }

    // Fall back to polling if we couldn't register the proxy listener
    sdk.console.log("[MethodCheck] Falling back to polling-based checking");
    startPolling(sdk);
  }

  // Register the command for manual checking
  try {
    sdk.commands.register('methodcheck.check', async (context) => {
      if (context.type === 'request' && context.id) {
        sdk.console.log(`[MethodCheck] Command executed for request: ${context.id}`);
        await checkRequest(sdk, context.id);
      } else {
        sdk.console.error(`[MethodCheck] Invalid context: ${JSON.stringify(context)}`);
      }
    });
    sdk.console.log("[MethodCheck] Command registered for manual checks");
  } catch (error) {
    sdk.console.error(`[MethodCheck] Failed to register command: ${error}`);
    if (error instanceof Error) {
      sdk.console.error(`[MethodCheck] Error stack: ${error.stack}`);
    }
  }

  sdk.console.log("[MethodCheck] Creating a test finding to verify API functionality");
  createTestFinding(sdk);

  sdk.console.log("[MethodCheck] Plugin initialized successfully!");
}