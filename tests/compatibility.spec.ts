import { describe, expect, it } from 'vitest'
import {
  detectCompatibility,
  evaluateCompatibility,
  SUPPORTED_DSH_PLUGIN_API_VERSION,
  SUPPORTED_NODE_RANGE,
  SUPPORTED_PI_AI_VERSION,
  SUPPORTED_PI_AI_VERSIONS,
  COMPATIBILITY_CONTRACT,
} from '../src/compatibility.ts'

const compatiblePackages = {
  '@deepseek-ai/dsh-llm': SUPPORTED_DSH_PLUGIN_API_VERSION,
  '@deepseek-ai/dsh-llm-pi-ai': SUPPORTED_DSH_PLUGIN_API_VERSION,
  '@earendil-works/pi-ai': SUPPORTED_PI_AI_VERSION,
} as const

describe('compatibility contract', () => {
  it('evaluates the declared Node, DSH API, and pi-ai versions as compatible', () => {
    const report = evaluateCompatibility({ nodeVersion: 'v22.19.0', packageVersions: compatiblePackages })
    expect(report).toEqual({
      schemaVersion: 1,
      status: 'compatible',
      node: { supported: SUPPORTED_NODE_RANGE, installed: 'v22.19.0', status: 'compatible' },
      packages: {
        '@deepseek-ai/dsh-llm': { supported: SUPPORTED_DSH_PLUGIN_API_VERSION, installed: SUPPORTED_DSH_PLUGIN_API_VERSION, status: 'compatible' },
        '@deepseek-ai/dsh-llm-pi-ai': { supported: SUPPORTED_DSH_PLUGIN_API_VERSION, installed: SUPPORTED_DSH_PLUGIN_API_VERSION, status: 'compatible' },
        '@earendil-works/pi-ai': { supported: SUPPORTED_PI_AI_VERSIONS.join(' || '), installed: SUPPORTED_PI_AI_VERSION, status: 'compatible' },
      },
    })
  })

  it('accepts the legacy and current pi-ai releases with either supported DSH API', () => {
    expect(COMPATIBILITY_CONTRACT.piAi.versions).toEqual(['0.84.4', '0.85.1'])
    for (const dsh of ['0.1.1-rc.2', '0.1.2-rc.1']) {
      for (const piAi of ['0.84.4', '0.85.1']) {
        const report = evaluateCompatibility({
          nodeVersion: 'v24.0.0',
          packageVersions: {
            '@deepseek-ai/dsh-llm': dsh,
            '@deepseek-ai/dsh-llm-pi-ai': dsh,
            '@earendil-works/pi-ai': piAi,
          },
        })
        expect(report.status).toBe('compatible')
      }
    }
  })

  it('does not claim compatibility for unverified pi-ai versions', () => {
    for (const installed of ['0.84.3', '0.84.5', '0.85.0', '0.85.1-rc.1', '0.85.2', '0.86.0', '1.0.0', 'not-a-version']) {
      const report = evaluateCompatibility({
        nodeVersion: 'v24.0.0',
        packageVersions: { ...compatiblePackages, '@earendil-works/pi-ai': installed },
      })
      expect(report.packages['@earendil-works/pi-ai'].status).toBe('incompatible')
    }
  })

  it('marks a known version mismatch incompatible', () => {
    const report = evaluateCompatibility({
      nodeVersion: 'v24.0.0',
      packageVersions: { ...compatiblePackages, '@earendil-works/pi-ai': '0.82.2' },
    })
    expect(report.status).toBe('incompatible')
    expect(report.packages['@earendil-works/pi-ai']).toMatchObject({ installed: '0.82.2', status: 'incompatible' })
  })

  it('accepts every listed DSH plugin API version and newer same-major prereleases', () => {
    for (const installed of ['0.1.1-rc.2', '0.1.2-rc.1', '0.1.2-rc.2', '0.1.2', '0.1.3-rc.1']) {
      const report = evaluateCompatibility({
        nodeVersion: 'v24.0.0',
        packageVersions: { ...compatiblePackages, '@deepseek-ai/dsh-llm': installed },
      })
      expect(report.packages['@deepseek-ai/dsh-llm'].status).toBe('compatible')
    }
  })

  it('rejects DSH plugin API versions below the supported minimum or past the major line', () => {
    for (const installed of ['0.1.0-rc.6', '0.1.1-rc.1', '1.0.0', 'not-a-version']) {
      const report = evaluateCompatibility({
        nodeVersion: 'v24.0.0',
        packageVersions: { ...compatiblePackages, '@deepseek-ai/dsh-llm': installed },
      })
      expect(report.packages['@deepseek-ai/dsh-llm'].status).toBe('incompatible')
    }
  })

  it('keeps missing metadata unknown rather than claiming compatibility', () => {
    const report = evaluateCompatibility({ nodeVersion: 'not-a-node-version', packageVersions: {} })
    expect(report.status).toBe('unknown')
    expect(report.node.status).toBe('unknown')
    expect(report.packages['@deepseek-ai/dsh-llm'].installed).toBeNull()
  })

  it('supports injected package metadata without reading paths or credentials', async () => {
    const report = await detectCompatibility({
      nodeVersion: 'v24.0.1',
      readPackageVersion: async name => compatiblePackages[name],
    })
    expect(report.status).toBe('compatible')
    expect(JSON.stringify(report)).not.toMatch(/node_modules|Users|token|credential/iu)
  })
})
