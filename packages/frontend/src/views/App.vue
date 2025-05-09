<template>
  <div class="p-4">
    <h1 class="text-2xl font-bold mb-4">Method Check</h1>

    <div class="bg-surface-700 p-4 rounded mb-4">
      <h2 class="text-xl font-semibold mb-2">How it works</h2>
      <p class="mb-2">
        This plugin automatically checks if the server allows additional HTTP
        methods beyond the one used in the original request.
      </p>
      <p class="mb-2">
        When additional methods are found, the request will be:
      </p>
      <ul class="list-disc pl-6 mb-4">
        <li>
          Tagged with
          <span class="bg-danger-700 px-2 py-1 rounded text-white"
            >method-check</span
          >
        </li>
        <li>Updated with a comment listing the allowed methods</li>
      </ul>
    </div>

    <div class="bg-surface-700 p-4 rounded">
      <h2 class="text-xl font-semibold mb-2">Manual Check</h2>
      <p>
        You can manually check a request by right-clicking it in the HTTP
        History and selecting <strong>Check Available Methods</strong>.
      </p>
    </div>

    <div class="mb-4">
      <p class="mb-2">
        This plugin checks for alternative HTTP methods that are allowed on
        endpoints.
      </p>
      <button
        class="px-4 py-2 rounded"
        :class="
          pollingActive
            ? 'bg-red-500 hover:bg-red-600'
            : 'bg-green-500 hover:bg-green-600'
        "
        @click="togglePolling"
      >
        {{ pollingActive ? "Disable Polling" : "Enable Polling" }}
      </button>
      <span class="ml-2 text-sm" v-if="pollingActive">Polling is active</span>
      <span class="ml-2 text-sm" v-else>Polling is inactive</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useCaidoSDK } from "../hooks/useCaidoSDK";

const sdk = useCaidoSDK();
const pollingActive = ref(false);

// Check initial polling state
onMounted(async () => {
  if (sdk) {
    pollingActive.value = await sdk.api.isPollingActive();
  }
});

// Toggle polling function
const togglePolling = async () => {
  if (sdk) {
    pollingActive.value = await sdk.api.togglePolling();
  }
};
</script>
