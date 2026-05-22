import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { gatewayRpc } from '../../server/gateway'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  getConfiguredModelIds,
  getConfiguredProviderNames,
  getConfiguredModelsFromConfig,
} from '../../server/providers'
import {
  discoverAllLocalRunners,
  localModelsAsCatalogEntries,
} from '../../server/local-llm'
import { maskApiKeys } from '../../server/_redact'

type ModelsListGatewayResponse = {
  models?: Array<unknown>
}

type ModelEntry = {
  provider?: string
  id?: string
  name?: string
  [key: string]: unknown
}

export const Route = createFileRoute('/api/models')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        // Local-runner discovery runs in parallel with the gateway call and
        // is non-blocking — if Ollama / LM Studio is unreachable we just get
        // an empty array. Never fails the whole route.
        const localRunnersPromise = discoverAllLocalRunners().catch(
          () => [] as Awaited<ReturnType<typeof discoverAllLocalRunners>>,
        )

        try {
          const payload = await gatewayRpc<ModelsListGatewayResponse>(
            'models.list',
            {},
          )
          const allModels = Array.isArray(payload.models) ? payload.models : []

          // Filter to only configured providers AND configured model IDs
          const configuredProviders = getConfiguredProviderNames()
          const configuredModelIds = getConfiguredModelIds()
          const providerSet = new Set(configuredProviders)

          const filteredModels = allModels.filter((model) => {
            if (typeof model === 'string') return false
            const entry = model as ModelEntry

            // Must be from a configured provider
            if (!entry.provider || !providerSet.has(entry.provider)) {
              return false
            }

            // Must be a configured model ID
            if (!entry.id || !configuredModelIds.has(entry.id)) {
              return false
            }

            return true
          })

          // Merge in any models from config that the gateway didn't auto-discover
          const discoveredIds = new Set(
            filteredModels.map((m) => (m as ModelEntry).id),
          )
          const configModels = getConfiguredModelsFromConfig()
          for (const cm of configModels) {
            if (!discoveredIds.has(cm.id)) {
              filteredModels.push(cm)
              // Track config-supplemented ids in the set so a local model
              // with the same id (e.g. an ollama/qwen3:32b also declared in
              // openclaw.json) doesn't get appended twice on the next merge.
              discoveredIds.add(cm.id)
            }
          }

          // Merge in live local models (Ollama, LM Studio, …). These are
          // additive — they bypass the configured-provider filter on purpose
          // so users get them as soon as they pull a model, without having
          // to also edit ~/.openclaw/openclaw.json.
          const localRunners = await localRunnersPromise
          const localEntries = localModelsAsCatalogEntries(localRunners)
          for (const entry of localEntries) {
            if (!discoveredIds.has(entry.id)) {
              filteredModels.push(entry)
              discoveredIds.add(entry.id)
            }
          }

          const reachableLocalProviders = localRunners
            .filter((r) => r.reachable)
            .map((r) => r.provider)
          const mergedConfiguredProviders = Array.from(
            new Set([...configuredProviders, ...reachableLocalProviders]),
          )

          return json({
            ok: true,
            models: filteredModels,
            configuredProviders: mergedConfiguredProviders,
          })
        } catch (err) {
          // Only treat NETWORK-level gateway failures as "fall back to local
          // models". A 500 from the gateway with a real response body should
          // surface as an error, not silently degrade to a local-only picker.
          const isNetworkFailure =
            (err instanceof TypeError &&
              /fetch|network|connect/i.test(err.message)) ||
            (err instanceof Error &&
              (err.name === 'AbortError' ||
                /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/.test(err.message)))

          if (!isNetworkFailure) {
            // Gateway is reachable but errored — surface the failure rather
            // than mask it behind a local-only fallback. Scrub the message
            // in case it contains a token-shaped substring.
            return json(
              {
                ok: false,
                error: maskApiKeys(
                  err instanceof Error ? err.message : String(err),
                ),
              },
              { status: 502 },
            )
          }

          // Genuine gateway-down → local-only fallback. Scrub the error
          // string before forwarding (it may contain internal URLs / auth
          // header fragments depending on the underlying error class).
          const localRunners = await localRunnersPromise
          const localEntries = localModelsAsCatalogEntries(localRunners)
          if (localEntries.length > 0) {
            return json({
              ok: true,
              models: localEntries,
              configuredProviders: localRunners
                .filter((r) => r.reachable)
                .map((r) => r.provider),
              gatewayError: maskApiKeys(
                err instanceof Error ? err.message : String(err),
              ),
            })
          }
          return json(
            {
              ok: false,
              error: maskApiKeys(
                err instanceof Error ? err.message : String(err),
              ),
            },
            { status: 503 },
          )
        }
      },
    },
  },
})
