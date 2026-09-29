import { describe, expect, it } from 'vitest'
import { createInstanceRegistryStore } from '../src/client/instance-registry-store.ts'

describe('instance registry store', () => {
  it('seeds the origin roster and replaces it through the declared action', () => {
    const initial = [{ name: 'Local', url: 'http://localhost:3080' }]
    const store = createInstanceRegistryStore(initial).create()
    expect(store.getSnapshot()).toEqual({ instances: initial })

    store.actions.setInstances([{ name: 'Dev', url: 'https://dev.example.com' }])
    expect(store.getSnapshot()).toEqual({ instances: [{ name: 'Dev', url: 'https://dev.example.com' }] })
    expect(initial).toEqual([{ name: 'Local', url: 'http://localhost:3080' }])
  })

  it('starts with an empty roster when the page has no saved origin', () => {
    expect(createInstanceRegistryStore().create().getSnapshot()).toEqual({ instances: [] })
  })
})
