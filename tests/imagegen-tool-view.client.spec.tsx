// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { ImagegenToolView } from '../src/client/ImagegenToolView.tsx'
import { en } from '../src/client/locales.ts'
import type { OpenAICodexSettingsKey } from '../src/client/locales.ts'

type Props = Parameters<typeof ImagegenToolView>[0]
type Block = Props['block']

function t(key: OpenAICodexSettingsKey, params: Record<string, unknown> = {}): string {
  return Object.entries(params).reduce(
    (value, [name, replacement]) => value.replace(`{${name}}`, String(replacement)),
    en[key],
  )
}

function useDisclosure() {
  const [expanded, setExpanded] = useState(false)
  return { expanded, setExpanded, toggle: () => { setExpanded(value => !value) } }
}

const attachment: ImageAttachmentRef = {
  attachmentId: AttachmentId('a'.repeat(64)),
  mediaType: 'image/png', bytes: 100, width: 32, height: 32, name: 'generated.png',
}

function resultBlock(call: { name: string; argsRaw: string } | null): Block {
  return {
    kind: 'tool-result', seq: 2, time: 1, callId: 'imagegen-1', name: 'imagegen',
    args: call === null ? PartialArguments.EMPTY : PartialArguments.fromText(call.argsRaw),
    call, callTime: call === null ? null : 0,
    content: [
      { type: 'image', attachment },
      { type: 'text', text: '<output_path operation="create">/workspace/generated.png</output_path>' },
    ],
    isError: false, subCalls: [],
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('imagegen tool view on the 0.2 client contract', () => {
  it('renders and updates incomplete preparing arguments without requiring argsRaw', () => {
    const args = new PartialArguments()
    args.append('{"prompt":"a red')
    const block: Block = {
      phase: 'preparing', callId: 'imagegen-1', name: 'imagegen', turn: 1,
      step: 1, time: 0, subCalls: [], args,
    }
    const common = { toolName: 'imagegen', openFile: vi.fn(), loadImage: vi.fn(), useDisclosure, t }
    const view = render(<ImagegenToolView {...common} block={block} />)
    expect(screen.getByText('a red')).toBeTruthy()
    args.append(' kite"}')
    args.refresh()
    view.rerender(<ImagegenToolView {...common} block={block} />)
    expect(screen.getByText('a red kite')).toBeTruthy()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/"prompt": "a red kite"/)).toBeTruthy()
  })

  it('uses the host image loader and preserves preview, file opening, and disclosure', async () => {
    const loadImage = vi.fn(async () => 'blob:host-owned-image')
    const openFile = vi.fn()
    const inspect = vi.fn()
    const block = resultBlock({ name: 'imagegen', argsRaw: '{"prompt":"a red kite"}' })
    render(<ImagegenToolView block={block} toolName="imagegen" openFile={openFile} inspect={inspect} loadImage={loadImage} useDisclosure={useDisclosure} t={t} />)
    const image = await screen.findByRole('img')
    expect(image.getAttribute('src')).toBe('blob:host-owned-image')
    expect(loadImage).toHaveBeenCalledExactlyOnceWith(attachment)
    fireEvent.click(screen.getByRole('button', { name: t('imageOpenNamed', { name: 'generated.png' }) }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '/workspace/generated.png' }))
    expect(openFile).toHaveBeenCalledExactlyOnceWith('/workspace/generated.png')
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(screen.getByRole('button', { name: t('inspectToolCall') }))
    expect(inspect).toHaveBeenCalledOnce()
  })

  it('renders a retained result whose paired call has left the history window', async () => {
    const loadImage = vi.fn(async () => 'blob:retained-image')
    render(<ImagegenToolView block={resultBlock(null)} toolName="imagegen" openFile={vi.fn()} loadImage={loadImage} useDisclosure={useDisclosure} t={t} />)
    await waitFor(() => { expect(screen.getByRole('img').getAttribute('src')).toBe('blob:retained-image') })
    expect(loadImage).toHaveBeenCalledExactlyOnceWith(attachment)
  })
})
