/** Shared local instance roster store used by the sidebar selector and Settings page. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { DshInstance } from './instance-registry.ts'

/** Instance roster shown by the selector and Settings page. */
export interface InstanceRegistryState {
  /** Saved DSH origins and their display names. */
  instances: readonly DshInstance[]
}

/** Writes available to the instance-roster components. */
type InstanceRegistryActions = {
  /** Replace the roster after it has been initialized or persisted. */
  setInstances: (draft: InstanceRegistryState, instances: readonly DshInstance[]) => void
}

/** Declare the shared instance-roster state and its update action.
 * @param instances Initial origins to show in this web page.
 * @returns The store handle.
 */
export function createInstanceRegistryStore(
  instances: readonly DshInstance[] = [],
): EngineStoreHandle<InstanceRegistryState, InstanceRegistryActions> {
  return defineStore({
    init: (): InstanceRegistryState => ({ instances: [...instances] }),
    actions: {
      setInstances: (draft, instances) => { draft.instances = [...instances] },
    },
  })
}
