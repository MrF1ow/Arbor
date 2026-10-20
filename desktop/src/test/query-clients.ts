import type { QueryClient } from "@tanstack/react-query";

const testQueryClients = new Set<QueryClient>();

export function trackTestQueryClient(client: QueryClient) {
  testQueryClients.add(client);
}

export async function cleanupTestQueryClients() {
  await Promise.all(
    [...testQueryClients].map(async (queryClient) => {
      await queryClient.cancelQueries();
      queryClient.clear();
    }),
  );
  testQueryClients.clear();
}
