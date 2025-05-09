import { SDK } from "caido:plugin";
import type { API, BackendEvents } from "../../backend/src/index";
import App from './views/App.vue';

export type CaidoSDK = SDK<API, BackendEvents>;

export function init(sdk: CaidoSDK) {
  console.log("[MethodCheck] Frontend initializing...");

  // Listen for method check events from backend
  sdk.backend.onEvent("method-check-result", (data) => {
    console.log(`[MethodCheck] Found methods for ${data.url}: ${data.availableMethods.join(', ')}`);
  });

  // Register our plugin's view
  if (sdk.view) {
    sdk.view.register({
      id: 'methodcheck',
      component: App,
      icon: 'fas fa-exchange-alt',
      title: 'Method Check',
    });
    console.log("[MethodCheck] View registered");
  } else {
    console.warn("[MethodCheck] View API not available");
  }

  // Register a context menu item for HTTP requests
  if (sdk.menu) {
    sdk.menu.registerItem({
      type: 'RequestRow',
      commandId: 'methodcheck.check',
      label: 'Check Available Methods',
      leadingIcon: 'fas fa-exchange-alt',
    });
    console.log("[MethodCheck] Menu item registered");
  } else {
    console.warn("[MethodCheck] Menu API not available");
  }

  // Register HTTPQL extension for finding requests with alternative methods
  if (sdk.httpql) {
    sdk.httpql.extendMetadata({
      tags: [
        {
          id: 'method-check',
          name: 'Method Check',
          description: 'Requests with alternative HTTP methods available',
          color: 'danger',
        },
      ],
    });
    console.log("[MethodCheck] HTTPQL metadata extended");
  } else {
    console.warn("[MethodCheck] HTTPQL API not available");
  }

  console.log("[MethodCheck] Frontend initialized successfully!");
}