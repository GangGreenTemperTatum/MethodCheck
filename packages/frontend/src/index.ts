import { SDK } from "caido:plugin";
import type { API } from "../../backend/src/index";
import App from './views/App.vue';

export type CaidoSDK = SDK<API>;

export function init(sdk: CaidoSDK) {
  console.log("[MethodCheck] Frontend initializing...");

  try {
    // Register our plugin's view
    sdk.view.register({
      id: 'methodcheck',
      component: App,
      icon: 'fas fa-exchange-alt',
      title: 'Method Check',
    });
    console.log("[MethodCheck] View registered");
  } catch (error) {
    console.error("[MethodCheck] Error registering view:", error);
  }

  try {
    // Register a context menu item for HTTP requests
    sdk.menu.registerItem({
      type: 'RequestRow',
      commandId: 'methodcheck.check',
      label: 'Check Available Methods',
      leadingIcon: 'fas fa-exchange-alt',
    });
    console.log("[MethodCheck] Menu item registered");
  } catch (error) {
    console.error("[MethodCheck] Error registering menu item:", error);
  }

  try {
    // Register HTTPQL extension for finding requests with alternative methods
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
  } catch (error) {
    console.error("[MethodCheck] Error extending HTTPQL metadata:", error);
  }

  console.log("[MethodCheck] Frontend initialized successfully!");
}