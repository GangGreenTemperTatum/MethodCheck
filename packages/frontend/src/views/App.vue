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
  </div>
</template>

<script setup lang="ts">
// No additional script needed for this simple informational view
</script>
